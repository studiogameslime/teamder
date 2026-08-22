import Foundation

/**
 Attributes written by the app that the server has not acknowledged yet.

 `setAttributes` used to POST fire-and-forget: on failure it logged and dropped
 the value. An attribute set while offline never reached the server at all, and
 because the in-app sync path ALSO carried attributes and let them override the
 stored profile, in-app targeting still looked right - so the loss was invisible
 everywhere it mattered (segments, journeys, email).

 Events have had a SQLite-backed at-least-once queue with retry-on-next-flush
 since the beginning. Attributes had nothing. This closes that gap.

 ## Persisted, and why that is not a reversal of the no-PII-at-rest rule

 `76037051` deliberately stopped persisting the attribute TRAIT BAG, and there
 is purge-on-init code that removes any bag an older build left behind. This
 queue is a different thing and is stored separately:

 | | the trait bag | this queue |
 |---|---|---|
 | what it is | a cache of who the user is | undelivered work |
 | lifetime | indefinite | until the server acks |
 | contents | everything | only un-acked keys |
 | if lost | re-read from the server | **the write never happens** |

 That last row is why it must survive process death: nothing else holds the
 value. The trait bag can be lost safely because the server already has it.

 Stored in the Keychain (device-only, after-first-unlock) rather than
 UserDefaults, matching where the identity-linking secrets were moved, and
 cleared the moment the server acks - so it holds PII only between a failed
 send and the next successful one, and only when a send has actually failed.
 Purged on reset() and optOut() alongside everything else.

 ## Second job: the un-acked set IS the dirty set

 `pending()` is what the in-app sync request sends. Only attributes the server
 has not confirmed need to ride that request; everything else is already in the
 profile and the server should read its own copy. That turns the sync payload
 from "everything the device believes" into "the little the server might not
 know yet", which is what makes server-authoritative targeting safe.
 */
final class PendingAttributes {
    private var pending: [String: Any] = [:]
    private let lock = NSLock()

    /**
     Encrypted durable backing, or nil to stay in-memory only.

     Persisted because an un-acked write is UNDELIVERED WORK, not a cache: if
     the process dies before the flush, the value never reaches the server and
     nothing else holds it. That is the one case in-memory retry cannot cover.
     Keychain-backed, cleared on ack, purged on reset/opt-out.
     */
    private weak var storage: StorageManager?

    /// Cap so a pathological app setting unique keys in a loop while offline
    /// cannot grow this without bound. Oldest keys are dropped first; they are
    /// also the ones most likely to have been superseded.
    private let maxKeys: Int

    init(maxKeys: Int = 500, storage: StorageManager? = nil) {
        self.maxKeys = maxKeys
        self.storage = storage
        restore()
    }

    private func restore() {
        guard let json = storage?.getPendingAttributes(), !json.isEmpty,
              let data = json.data(using: .utf8) else { return }
        guard let restored = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            // Corrupt blob: drop it rather than fail SDK init.
            storage?.clearPendingAttributes()
            return
        }
        lock.lock()
        pending.merge(restored) { _, new in new }
        lock.unlock()
    }

    /// Caller must hold the lock.
    private func persistLocked() {
        guard let storage else { return }
        guard !pending.isEmpty else {
            storage.clearPendingAttributes()
            return
        }
        guard JSONSerialization.isValidJSONObject(pending),
              let data = try? JSONSerialization.data(withJSONObject: pending),
              let json = String(data: data, encoding: .utf8) else { return }
        storage.setPendingAttributes(json)
    }

    /// Mark attributes as written locally and not yet acknowledged.
    func mark(_ attributes: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        for (key, value) in attributes {
            pending[key] = value
        }
        if pending.count > maxKeys {
            // Dictionaries are unordered, so "oldest" is approximate. The cap
            // exists to bound memory, not to be fair.
            let overflow = pending.count - maxKeys
            for key in pending.keys.prefix(overflow) {
                pending.removeValue(forKey: key)
            }
        }
        persistLocked()
    }

    /// Everything the server has not confirmed.
    func pendingAttributes() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return pending
    }

    var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return pending.isEmpty
    }

    /**
     Clear the keys the server confirmed - but ONLY where the value is still the
     one that was sent.

     If the app called `setAttributes(["plan": "pro"])` while a flush carrying
     `plan: "free"` was in flight, acking the flush must not clear `plan`, or
     the newer value is silently lost. Comparing values, not just keys, is what
     makes a concurrent write safe.
     */
    func acknowledge(_ sent: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        for (key, sentValue) in sent {
            guard let current = pending[key] else { continue }
            if isSameValue(current, sentValue) {
                pending.removeValue(forKey: key)
            }
        }
        persistLocked()
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        pending.removeAll()
        storage?.clearPendingAttributes()
    }

    /// Loose equality across the JSON-ish types attributes can hold. Anything
    /// we cannot compare is treated as CHANGED, so the attribute stays pending
    /// and is retried - re-sending is harmless, dropping is not.
    private func isSameValue(_ a: Any, _ b: Any) -> Bool {
        if let a = a as? String, let b = b as? String { return a == b }
        if let a = a as? Bool, let b = b as? Bool { return a == b }
        if let a = a as? Int, let b = b as? Int { return a == b }
        if let a = a as? Double, let b = b as? Double { return a == b }
        if let a = a as? NSNumber, let b = b as? NSNumber { return a == b }
        return false
    }
}

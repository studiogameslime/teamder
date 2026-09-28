import Foundation

/// Manages user identity and attributes
class IdentityManager {
    private let storage: StorageManager
    private let logger: Logger
    private var identity: UserIdentity

    init(
        storage: StorageManager,
        logger: Logger,
        initialUserId: String? = nil,
        initialAnonymousId: String? = nil
    ) {
        self.storage = storage
        self.logger = logger

        // A caller-supplied anonymous id SEEDS the stored one, exactly as the
        // web SDK does: it is used for this run, and persisted only when
        // nothing is stored yet, so an id set once at init survives the app
        // dropping the option later. `JoryioConfig.anonymousId` was accepted
        // and never read here (audit 2026-09-26, I9).
        if let seed = initialAnonymousId, !seed.isEmpty, !storage.hasStoredAnonymousId() {
            storage.setAnonymousId(seed)
        }

        // Load or create identity. Attributes are the PII trait bag
        // (email/phone/name/custom) and are NEVER persisted at rest: start
        // empty each session (the server is the source of truth, and
        // increment/append/remove are now server-atomic so no local value is
        // needed for correctness). Kept in memory only for in-session reads.
        let anonymousId = (initialAnonymousId?.isEmpty == false ? initialAnonymousId : nil)
            ?? storage.getAnonymousId()
        let userId = initialUserId ?? storage.getUserId()

        self.identity = UserIdentity(
            userId: userId,
            anonymousId: anonymousId,
            attributes: [:]
        )

        // One-time purge: delete any attributes bag persisted by an older SDK
        // build so previously-stored PII is removed from existing installs.
        storage.clearUserAttributes()

        logger.info("Identity initialized - User: \(userId ?? "anonymous"), AnonymousId: \(anonymousId)")
    }

    // MARK: - Identity Access

    func getIdentity() -> UserIdentity {
        return identity
    }

    func getUserId() -> String? {
        return identity.userId
    }

    func getAnonymousId() -> String {
        return identity.anonymousId
    }

    func getUserAttributes() -> UserAttributes {
        return identity.attributes.reduce(into: [:]) { result, pair in
            result[pair.key] = pair.value.value
        }
    }

    /// Get a single attribute's current value (nil if unset).
    func getAttribute(_ key: String) -> Any? {
        return identity.attributes[key]?.value
    }

    // MARK: - Identification

    func identify(userId: String) {
        logger.info("Identifying user: \(userId)")

        // Update identity
        identity.userId = userId
        storage.setUserId(userId)

        logger.debug("User identified successfully")
    }

    func alias(userId: String) {
        logger.info("Aliasing anonymous user to: \(userId)")

        // Note: The actual aliasing is done server-side via API call
        // Here we just update the local identity
        identity.userId = userId
        storage.setUserId(userId)

        logger.debug("User alias set locally")
    }

    // MARK: - Attributes Management

    /// Attributes written locally but not acknowledged by the server. Lives
    /// here because it is identity state, and because both the SDK facade (to
    /// flush it) and the in-app sync (to send it) already hold this manager -
    /// threading a new dependency through their initializers would have
    /// changed public signatures the RN bridge and demo app compile against.
    lazy var pending = PendingAttributes(storage: storage)

    func setAttributes(_ attributes: UserAttributes) {
        logger.debug("Setting \(attributes.count) user attributes")

        // Merge new attributes with existing — in memory only, NOT persisted
        // (PII stays off durable storage).
        for (key, value) in attributes {
            identity.attributes[key] = AnyCodable(value)
        }
    }

    func setAttribute(_ key: String, value: Any) {
        logger.debug("Setting attribute: \(key)")

        // In-memory only — NOT persisted (PII stays off durable storage).
        identity.attributes[key] = AnyCodable(value)
    }

    func incrementAttribute(_ key: String, by value: Double) {
        logger.debug("Incrementing attribute: \(key) by \(value)")

        // Get current value
        let currentValue: Double
        if let existing = identity.attributes[key]?.value as? Double {
            currentValue = existing
        } else if let existing = identity.attributes[key]?.value as? Int {
            currentValue = Double(existing)
        } else {
            currentValue = 0
        }

        // Increment and set
        let newValue = currentValue + value
        setAttribute(key, value: newValue)
    }

    func unsetAttribute(_ key: String) {
        logger.debug("Unsetting attribute: \(key)")

        // In-memory only — NOT persisted (PII stays off durable storage).
        identity.attributes.removeValue(forKey: key)
    }

    // MARK: - Reset

    func reset() {
        logger.info("Resetting user identity")

        // Clear user ID but keep anonymous ID
        identity.userId = nil
        storage.setUserId(nil)

        // Clear attributes, including any un-acked writes still queued for the
        // OUTGOING user - sending them after a reset would attribute one
        // person's traits to the next.
        identity.attributes = [:]
        storage.clearUserAttributes()
        pending.clear()

        logger.debug("Identity reset complete")
    }

    /// After `wipeData()` has cleared storage: drop the in-memory anonymous id
    /// and take the freshly minted one, so the wiped install reports under a
    /// new identity rather than the one it was asked to erase.
    ///
    /// This manager caches the id at init (Android reads storage on every
    /// call), so clearing storage alone left every subsequent event carrying
    /// the OLD id - and, because `getAnonymousId()` re-persists what it finds
    /// missing, the wipe was undone by the next flush. A caller-supplied seed
    /// (`JoryioConfig.anonymousId`) is not re-applied either: the seed must
    /// not outlive the data it seeded. Matches Android's `onDataWiped()`.
    func onDataWiped() {
        identity.anonymousId = storage.getAnonymousId()
        logger.info("Anonymous ID regenerated after wipe: \(identity.anonymousId)")
    }
}

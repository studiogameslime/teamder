import Foundation
import UIKit

/// Holds a background-task identifier by reference so it can be safely mutated
/// from both the expiration handler and the flush completion without triggering
/// exclusive-access issues on a captured `var`.
private final class BackgroundTaskToken {
    var id: UIBackgroundTaskIdentifier = .invalid
}

/// Manages event queue, batching, and flushing.
///
/// SQLite I/O runs off the main thread: `flush()` is non-isolated (so awaiting
/// it from the @MainActor timer hops onto the cooperative pool), and
/// StorageManager serializes every DB op on its own queue. The single-flight
/// guard is protected by `flushLock` since flush() can now be entered from
/// multiple threads (timer, enqueue-triggered, background/terminate).
class QueueManager {
    private let storage: StorageManager
    private let network: NetworkClient
    private let logger: Logger
    private let batchSize: Int
    private let flushInterval: TimeInterval
    private let maxQueueSize: Int
    private let sendImmediately: Bool

    private var flushTimer: Timer?
    private let flushLock = NSLock()
    private var isFlushingQueue = false

    init(
        storage: StorageManager,
        network: NetworkClient,
        logger: Logger,
        batchSize: Int,
        flushInterval: TimeInterval,
        maxQueueSize: Int,
        sendImmediately: Bool
    ) {
        self.storage = storage
        self.network = network
        self.logger = logger
        self.batchSize = batchSize
        self.flushInterval = flushInterval
        self.maxQueueSize = maxQueueSize
        self.sendImmediately = sendImmediately

        startFlushTimer()
    }

    deinit {
        stopFlushTimer()
    }

    // MARK: - Queue Management

    func enqueue(_ event: Event) {
        do {
            try storage.enqueueEvent(event)
            logger.debug("Event queued: \(event.type)")

            // Check if we should flush immediately
            if sendImmediately {
                Task {
                    await flush()
                }
            } else {
                // Check queue size and flush if needed
                let queueSize = storage.getQueueSize()
                if queueSize >= batchSize {
                    logger.debug("Queue size reached batch threshold (\(queueSize)/\(batchSize)), flushing...")
                    Task {
                        await flush()
                    }
                }
            }

            // Prevent queue from growing too large
            if storage.getQueueSize() > maxQueueSize {
                logger.warn("Queue size exceeded maximum (\(maxQueueSize)), dropping oldest events")
                try storage.deleteEvents(count: batchSize)
            }
        } catch {
            logger.error("Failed to enqueue event: \(error.localizedDescription)")
        }
    }

    // MARK: - Flushing

    /// Non-isolated: DB work + network run off the main thread. Awaiting this
    /// from a @MainActor context (the flush timer / lifecycle handlers) hops off
    /// the main actor for the duration.
    func flush() async {
        // Single-flight: claim the flag atomically (flush() is now reentrant
        // across threads, so the previous @MainActor serialization is gone).
        flushLock.lock()
        if isFlushingQueue {
            flushLock.unlock()
            logger.debug("Flush already in progress, skipping")
            return
        }
        isFlushingQueue = true
        flushLock.unlock()

        defer {
            flushLock.lock()
            isFlushingQueue = false
            flushLock.unlock()
        }

        do {
            // Drain the queue batch-by-batch in one flush (the old recursive
            // `await flush()` was dead code — it re-entered the guard above and
            // returned immediately, so only one batch ever went per flush).
            while true {
                let events = try storage.dequeueEvents(limit: batchSize)
                if events.isEmpty { break }

                let batch = EventBatch(events: events)
                try await network.trackBatch(batch)

                // Delete only after a successful send (at-least-once; eventId
                // gives the backend idempotency for a resend after a mid-flush
                // interruption).
                try storage.deleteEvents(count: events.count)
                logger.info("Flushed \(events.count) events")
            }
        } catch {
            logger.error("Failed to flush queue: \(error.localizedDescription)")
            // Events remain in queue for retry on the next flush.
        }
    }

    func flushSync() {
        // Wrap the flush in a background task so a flush triggered by the app
        // entering background / terminating gets time to finish the network
        // send AND the delete-after-send, instead of being suspended midway.
        Task { @MainActor in
            let application = UIApplication.shared
            let token = BackgroundTaskToken()
            token.id = application.beginBackgroundTask(withName: "JoryioQueueFlush") {
                if token.id != .invalid {
                    application.endBackgroundTask(token.id)
                    token.id = .invalid
                }
            }

            await self.flush()

            if token.id != .invalid {
                application.endBackgroundTask(token.id)
                token.id = .invalid
            }
        }
    }

    // MARK: - Timer Management

    /// Resume periodic flushing. Safe to call repeatedly — it stops any existing
    /// timer first, so a duplicate foreground notification cannot leave two.
    func resumePeriodicFlush() {
        startFlushTimer()
    }

    /// Stop periodic flushing while the app is backgrounded.
    ///
    /// iOS usually suspends a backgrounded process, which stops the timer for
    /// us — but NOT for apps that declare a background mode (audio, navigation,
    /// VoIP). Those keep running, and there the timer would wake every 5 seconds
    /// indefinitely to look at an empty queue. Stopping explicitly also keeps
    /// behaviour identical to Android, where the process really does stay alive.
    func suspendPeriodicFlush() {
        stopFlushTimer()
    }

    private func startFlushTimer() {
        stopFlushTimer()

        logger.debug("Starting flush timer with interval: \(flushInterval)s")

        flushTimer = Timer.scheduledTimer(
            withTimeInterval: flushInterval,
            repeats: true
        ) { [weak self] _ in
            self?.flushSync()
        }

        // Ensure timer fires on background thread
        if let timer = flushTimer {
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    private func stopFlushTimer() {
        flushTimer?.invalidate()
        flushTimer = nil
        logger.debug("Flush timer stopped")
    }

    // MARK: - Queue Info

    func getQueueSize() -> Int {
        return storage.getQueueSize()
    }

    func clearQueue() {
        do {
            try storage.clearQueue()
            logger.info("Event queue cleared")
        } catch {
            logger.error("Failed to clear queue: \(error.localizedDescription)")
        }
    }
}

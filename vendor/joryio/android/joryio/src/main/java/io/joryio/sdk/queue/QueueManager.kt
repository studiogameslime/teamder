package io.joryio.sdk.queue

import android.content.Context
import io.joryio.sdk.core.Logger
import io.joryio.sdk.models.Event
import io.joryio.sdk.models.EventBatch
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import java.util.Date

/**
 * Manages event queue with SQLite persistence
 */
internal class QueueManager(
    context: Context,
    sdkKey: String,
    private val logger: Logger,
    private val batchSize: Int = 50,
    private val flushInterval: Long = 5000, // 5 seconds
    private val maxQueueSize: Int = 10000,
    private val maxRetries: Int = 3
) {
    private companion object {
        const val MAX_AUTO_FLUSH_DELAY_MS = 300_000L // 5 minutes
    }

    private val database = JoryioDatabase.getInstance(context, sdkKey)
    private val eventDao = database.eventDao()

    private var flushJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Ensures only one flush runs at a time. Concurrent triggers (batch-size on
    // enqueue, auto-flush timer, ON_STOP, manual flush) would otherwise read the
    // same rows before either deletes them and double-POST the batch.
    private val flushMutex = Mutex()

    // Number of consecutive failed flushes; drives auto-flush backoff so we don't
    // hammer a downed backend every flushInterval. Reset to 0 on a successful send.
    @Volatile
    private var consecutiveFailures = 0

    // Callback for when events are ready to flush
    var onFlush: (suspend (EventBatch) -> Boolean)? = null

    init {
        logger.debug("QueueManager initialized (batchSize=$batchSize, flushInterval=${flushInterval}ms)")
        startAutoFlush()
    }

    /**
     * Add event to queue
     */
    suspend fun enqueue(event: Event) {
        try {
            // Check queue size and trim if needed
            val currentSize = eventDao.getCount()
            if (currentSize >= maxQueueSize) {
                val deleteCount = (maxQueueSize * 0.1).toInt() // Remove 10%
                logger.warn("Queue full, deleting $deleteCount oldest events")
                eventDao.deleteOldest(deleteCount)
            }

            // Insert event
            val entity = EventEntity.fromEvent(event)
            val id = eventDao.insert(entity)
            logger.debug("Event enqueued: ${event.type} (id=$id)")

            // Check if we should flush immediately
            val queueSize = eventDao.getCount()
            if (queueSize >= batchSize) {
                logger.debug("Batch size reached, flushing immediately")
                flush()
            }
        } catch (e: Exception) {
            logger.error("Failed to enqueue event: ${e.message}", e)
        }
    }

    /**
     * Add multiple events to queue
     */
    suspend fun enqueueAll(events: List<Event>) {
        try {
            val entities = events.map { EventEntity.fromEvent(it) }
            eventDao.insertAll(entities)
            logger.debug("${events.size} events enqueued")

            // Check if we should flush
            val queueSize = eventDao.getCount()
            if (queueSize >= batchSize) {
                flush()
            }
        } catch (e: Exception) {
            logger.error("Failed to enqueue events: ${e.message}", e)
        }
    }

    /**
     * Flush events to network
     */
    suspend fun flush() {
        // Only one flush at a time. If another flush already holds the lock, this
        // trigger no-ops rather than racing to read/send the same rows.
        if (!flushMutex.tryLock()) {
            logger.debug("Flush already in progress, skipping this trigger")
            return
        }
        try {
            val queueSize = eventDao.getCount()
            if (queueSize == 0) {
                logger.debug("Queue empty, nothing to flush")
                return
            }

            logger.debug("Flushing queue (size=$queueSize)")

            // Get batch of events
            val entities = eventDao.getEvents(batchSize)
            if (entities.isEmpty()) {
                return
            }

            // Convert to events
            val events = entities.map { it.toEvent() }
            val batch = EventBatch(
                events = events,
                sentAt = Date()
            )

            logger.debug("Sending batch of ${events.size} events")

            // Call flush callback
            val success = onFlush?.invoke(batch) ?: false

            if (success) {
                // Delete successfully sent events
                val ids = entities.map { it.id }
                eventDao.deleteByIds(ids)
                consecutiveFailures = 0
                logger.info("Successfully flushed ${events.size} events")
            } else {
                // Increment retry count
                val ids = entities.map { it.id }
                eventDao.incrementRetryCount(ids)
                consecutiveFailures++
                logger.warn("Failed to flush events, incremented retry count")

                // Delete events that have been retried too many times
                eventDao.deleteExpiredEvents(maxRetries)
            }
        } catch (e: Exception) {
            logger.error("Failed to flush queue: ${e.message}", e)
        } finally {
            flushMutex.unlock()
        }
    }

    /**
     * Start automatic flush timer.
     *
     * Internal rather than private so the SDK can stop it when the app goes to
     * the background and start it again on return — see the ON_STOP/ON_START
     * handlers in Joryio. Safe to call repeatedly: it cancels any existing job
     * first, so a double ON_START cannot leave two loops running.
     */
    internal fun startAutoFlush() {
        flushJob?.cancel()
        flushJob = scope.launch {
            while (isActive) {
                // Escalate the wait while the backend is failing (exponential up to
                // a 5-minute cap) instead of retrying every flushInterval forever.
                val delayMs = if (consecutiveFailures == 0) {
                    flushInterval
                } else {
                    val factor = 1L shl consecutiveFailures.coerceAtMost(6) // cap the shift
                    (flushInterval * factor).coerceAtMost(MAX_AUTO_FLUSH_DELAY_MS)
                }
                delay(delayMs)
                try {
                    flush()
                } catch (e: Exception) {
                    logger.error("Auto-flush failed: ${e.message}", e)
                }
            }
        }
        logger.debug("Auto-flush started (interval=${flushInterval}ms)")
    }

    /**
     * Stop automatic flush timer
     */
    fun stopAutoFlush() {
        flushJob?.cancel()
        flushJob = null
        logger.debug("Auto-flush stopped")
    }

    /**
     * Get queue size
     */
    suspend fun getQueueSize(): Int {
        return try {
            eventDao.getCount()
        } catch (e: Exception) {
            logger.error("Failed to get queue size: ${e.message}", e)
            0
        }
    }

    /**
     * Clear all events from queue
     */
    suspend fun clear() {
        try {
            eventDao.deleteAll()
            logger.info("Queue cleared")
        } catch (e: Exception) {
            logger.error("Failed to clear queue: ${e.message}", e)
        }
    }

    /**
     * Shutdown queue manager
     */
    fun shutdown() {
        stopAutoFlush()
        scope.cancel()
        logger.debug("QueueManager shutdown")
    }
}

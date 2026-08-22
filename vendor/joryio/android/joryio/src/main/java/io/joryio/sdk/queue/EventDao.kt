package io.joryio.sdk.queue

import androidx.room.*

/**
 * Data Access Object for events
 */
@Dao
internal interface EventDao {

    /**
     * Insert a new event
     */
    @Insert
    suspend fun insert(event: EventEntity): Long

    /**
     * Insert multiple events
     */
    @Insert
    suspend fun insertAll(events: List<EventEntity>): List<Long>

    /**
     * Get events for batching (oldest first)
     */
    @Query("SELECT * FROM events ORDER BY createdAt ASC LIMIT :limit")
    suspend fun getEvents(limit: Int): List<EventEntity>

    /**
     * Get all events
     */
    @Query("SELECT * FROM events ORDER BY createdAt ASC")
    suspend fun getAllEvents(): List<EventEntity>

    /**
     * Delete events by IDs
     */
    @Query("DELETE FROM events WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    /**
     * Delete all events
     */
    @Query("DELETE FROM events")
    suspend fun deleteAll()

    /**
     * Get queue size
     */
    @Query("SELECT COUNT(*) FROM events")
    suspend fun getCount(): Int

    /**
     * Increment retry count
     */
    @Query("UPDATE events SET retryCount = retryCount + 1 WHERE id IN (:ids)")
    suspend fun incrementRetryCount(ids: List<Long>)

    /**
     * Delete events with too many retries
     */
    @Query("DELETE FROM events WHERE retryCount >= :maxRetries")
    suspend fun deleteExpiredEvents(maxRetries: Int)

    /**
     * Delete oldest events to maintain size limit
     */
    @Query("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY createdAt ASC LIMIT :count)")
    suspend fun deleteOldest(count: Int)
}

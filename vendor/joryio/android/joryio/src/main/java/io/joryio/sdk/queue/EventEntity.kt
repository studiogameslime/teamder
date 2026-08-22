package io.joryio.sdk.queue

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import io.joryio.sdk.models.Event
import java.util.Date

/**
 * Room entity for persisting events
 */
@Entity(tableName = "events")
@TypeConverters(EventConverters::class)
data class EventEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    val type: String,
    val properties: String, // JSON string
    val timestamp: Date,
    val userId: String?,
    val anonymousId: String,
    val sessionId: String,
    // Client-generated idempotency id, persisted so retries reuse the same id.
    val eventId: String,
    val createdAt: Date = Date(),
    val retryCount: Int = 0
) {
    /**
     * Convert to Event model
     */
    fun toEvent(): Event {
        val gson = Gson()
        val propertiesMap = gson.fromJson<Map<String, Any?>>(
            properties,
            object : TypeToken<Map<String, Any?>>() {}.type
        )

        return Event(
            type = type,
            properties = propertiesMap,
            timestamp = timestamp,
            userId = userId,
            anonymousId = anonymousId,
            sessionId = sessionId,
            eventId = eventId
        )
    }

    companion object {
        /**
         * Create from Event model
         */
        fun fromEvent(event: Event): EventEntity {
            val gson = Gson()
            val propertiesJson = gson.toJson(event.properties)

            return EventEntity(
                type = event.type,
                properties = propertiesJson,
                timestamp = event.timestamp,
                userId = event.userId,
                anonymousId = event.anonymousId,
                sessionId = event.sessionId,
                eventId = event.eventId
            )
        }
    }
}

/**
 * Type converters for Room
 */
class EventConverters {
    @TypeConverter
    fun fromTimestamp(value: Long?): Date? {
        return value?.let { Date(it) }
    }

    @TypeConverter
    fun dateToTimestamp(date: Date?): Long? {
        return date?.time
    }
}

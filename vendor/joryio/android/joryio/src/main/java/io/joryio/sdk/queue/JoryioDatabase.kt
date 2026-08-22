package io.joryio.sdk.queue

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

/**
 * Room database for Joryio SDK
 */
@Database(
    entities = [EventEntity::class],
    version = 2, // v2 adds EventEntity.eventId (idempotency id)
    exportSchema = false
)
@TypeConverters(EventConverters::class)
internal abstract class JoryioDatabase : RoomDatabase() {

    abstract fun eventDao(): EventDao

    companion object {
        @Volatile
        private var INSTANCE: JoryioDatabase? = null

        fun getInstance(context: Context, sdkKey: String): JoryioDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    JoryioDatabase::class.java,
                    "joryio_${sdkKey.hashCode()}.db"
                )
                    .fallbackToDestructiveMigration()
                    .build()

                INSTANCE = instance
                instance
            }
        }

        fun clearInstance() {
            INSTANCE = null
        }
    }
}

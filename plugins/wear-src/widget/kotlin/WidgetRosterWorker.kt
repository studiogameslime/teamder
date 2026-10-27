package com.studiogameslime.soccerapp.widget

import android.content.Context
import android.util.Log
import androidx.work.*
import java.util.concurrent.TimeUnit

/** Current server state for BOTH widgets; the injected backend is for isolated tests. */
class WidgetRosterWorker(context: Context, params: WorkerParameters, private val backend: WidgetBackend) : Worker(context, params) {
    constructor(context: Context, params: WorkerParameters) : this(context, params, FirebaseWidgetBackend())
    override fun doWork(): Result {
        val uid = inputData.getString("viewerId") ?: return Result.failure()
        val session = inputData.getLong("session", -1)
        val serial = WidgetStateStore.actionSerial(applicationContext)
        fun current() = !isStopped && WidgetStateStore.generation(applicationContext) == session &&
            WidgetStateStore.owner(WidgetStateStore.read(applicationContext)) == uid
        if (!current()) return Result.success()
        try {
            val authenticated = backend.userId()
            if (authenticated == null) return retryOrFail("פתחו את האפליקציה כדי לחדש את החיבור")
            if (authenticated != uid) return Result.success()
            val initial = WidgetStateStore.read(applicationContext) ?: return Result.success()
            if (backend is FirebaseWidgetBackend) {
                com.studiogameslime.soccerapp.watch.PhoneServerClock.get()?.let { clock ->
                    synchronized(TeamderWidgetProvider.STATE_LOCK) {
                        if (current()) WidgetStateStore.read(applicationContext)?.let { state ->
                            state.put("clockOffsetMs", clock.offsetMs)
                            WidgetStateStore.write(applicationContext, state)
                        }
                    }
                }
            }
            val now = System.currentTimeMillis() + (WidgetStateStore.read(applicationContext) ?: initial).optLong("clockOffsetMs")
            val selected = WidgetGameModel.select(backend.games(uid, now - 48L * 60L * 60L * 1000L), uid, now)
            val identities = selected?.let { backend.identities(WidgetRosterModel.memberIds(it.data)) } ?: emptyMap()
            synchronized(TeamderWidgetProvider.STATE_LOCK) {
                if (!current() || backend.userId() != uid) return Result.success()
                if (serial != WidgetStateStore.actionSerial(applicationContext)) return Result.retry()
                val base = WidgetStateStore.read(applicationContext) ?: return Result.success()
                WidgetStateStore.write(applicationContext, WidgetStateStore.payload(base, selected, identities,
                    System.currentTimeMillis() + base.optLong("clockOffsetMs")))
                WidgetStateStore.prefs(applicationContext).edit().putLong("rosterFetchedAt", System.currentTimeMillis()).apply()
            }
            WidgetStateStore.refresh(applicationContext)
            if (backend is FirebaseWidgetBackend) {
                // Preserve the existing phone-to-watch fan-out after authoritative reads.
                val json = synchronized(TeamderWidgetProvider.STATE_LOCK) {
                    if (current()) WidgetStateStore.read(applicationContext)?.toString() else null
                }
                if (json != null && current()) TeamderMessagingService.relayState(applicationContext, json)
            }
            return Result.success()
        } catch (error: Exception) {
            Log.w("WidgetRosterWorker", "Refresh deferred", error)
            return retryOrFail("העדכון נכשל. מוצג המידע האחרון")
        }
    }
    private fun retryOrFail(message: String): Result {
        synchronized(TeamderWidgetProvider.STATE_LOCK) {
            val state = WidgetStateStore.read(applicationContext)
            if (!isStopped && state != null && WidgetStateStore.owner(state) == inputData.getString("viewerId") &&
                WidgetStateStore.generation(applicationContext) == inputData.getLong("session", -1)) {
                state.put("widgetError", message)
                WidgetStateStore.write(applicationContext, state)
            }
        }
        WidgetStateStore.refresh(applicationContext)
        return if (runAttemptCount < 3) Result.retry() else Result.failure()
    }
    companion object {
        fun enqueue(context: Context, gameId: String?, owner: String?, replace: Boolean = false) {
            if (owner.isNullOrBlank() || WidgetStateStore.owner(WidgetStateStore.read(context)) != owner) return
            val request = OneTimeWorkRequest.Builder(WidgetRosterWorker::class.java)
                .setInputData(Data.Builder().putString("viewerId", owner).putLong("session", WidgetStateStore.generation(context)).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniqueWork("widget-state:$owner",
                if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, request)
        }
        fun enqueueCachedIfStale(context: Context) {
            val state = WidgetStateStore.read(context) ?: return
            val age = System.currentTimeMillis() - WidgetStateStore.prefs(context).getLong("rosterFetchedAt", 0)
            if (age in 0 until 30L * 60L * 1000L) return
            enqueue(context, state.optString("gameId"), WidgetStateStore.owner(state))
        }
    }
}

package com.studiogameslime.soccerapp.watch

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.studiogameslime.soccerapp.widget.TeamderPlayersWidgetProvider
import com.studiogameslime.soccerapp.widget.TeamderWidgetProvider

/**
 * Bridges the React Native side to TWO native surfaces that mirror the
 * current game state:
 *   1. Wearable Data Layer (`/teamder/state`)  → paired watch app + Wear Tile
 *   2. SharedPreferences (`TeamderWidgetState`) → phone home-screen widget
 *
 * JS calls `WatchBridge.publishState(jsonString)` once; we fan it out to
 * both. Same JSON shape (computed by `watchSyncService.computeWatchPayload`),
 * so adding a new state means changing the JS payload once and every
 * surface picks it up.
 *
 * Watch publish: a timestamp is included so an unchanged JSON payload
 * still produces a TYPE_CHANGED event on the watch (Data Layer dedups by
 * content otherwise). Widget publish: prefs write + APPWIDGET_UPDATE
 * broadcast — no-op if no widget is currently placed.
 */
class WatchBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WatchBridge"

    @ReactMethod
    fun publishState(json: String, promise: Promise) {
        // 1) Phone home-screen widgets (timer + players-list). Both read
        //    the same SharedPreferences payload — one write, two refreshes.
        //    Best-effort — never blocks the watch publish or fails the
        //    promise.
        try {
            reactContext.getSharedPreferences(
                TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE,
            ).edit().putString(TeamderWidgetProvider.KEY_JSON, json).apply()
            TeamderWidgetProvider.requestRefresh(reactContext)
            TeamderPlayersWidgetProvider.requestRefresh(reactContext)
        } catch (_: Exception) {
            // Widget refresh failing should not affect the watch path —
            // swallow and continue.
        }

        // 2) Paired watch (existing path).
        try {
            val request = PutDataMapRequest.create(STATE_PATH).apply {
                dataMap.putString(KEY_JSON, json)
                dataMap.putLong(KEY_TS, System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()

            Wearable.getDataClient(reactContext).putDataItem(request)
                .addOnSuccessListener { promise.resolve(true) }
                .addOnFailureListener { e -> promise.reject("WATCH_PUBLISH_FAILED", e) }
        } catch (e: Exception) {
            promise.reject("WATCH_PUBLISH_FAILED", e)
        }
    }

    /**
     * Drain physical sessions the Galaxy Watch recorded (via Wear Health
     * Services) and relayed to `WearPhysicalService`, which queued them in
     * SharedPreferences. Returns the JSON array string `[{gameId, metrics}]`
     * (or "[]"), clearing the queue. The JS side (physicalSyncService
     * .drainWatchPhysical) persists each via the saveGamePhysical callable,
     * signed as the authenticated user — the only auth'd write path.
     */
    @ReactMethod
    fun consumePendingPhysical(promise: Promise) {
        try {
            promise.resolve(WearPhysicalService.drain(reactContext))
        } catch (e: Exception) {
            promise.reject("PHYSICAL_DRAIN_FAILED", e)
        }
    }

    companion object {
        private const val STATE_PATH = "/teamder/state"
        private const val KEY_JSON = "json"
        private const val KEY_TS = "ts"
    }
}

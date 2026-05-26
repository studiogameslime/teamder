package com.studiogameslime.soccerapp.watch

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

/**
 * Bridges the React Native side to the Wearable Data Layer so the phone can
 * publish the current game state to the paired Teamder watch app.
 *
 * JS calls `WatchBridge.publishState(jsonString)`; we write it to the
 * DataItem at `/teamder/state`. The watch's WearStateRepository listens to
 * that path and renders the matching screen. A timestamp is included so an
 * unchanged JSON payload still produces a TYPE_CHANGED event on the watch.
 */
class WatchBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WatchBridge"

    @ReactMethod
    fun publishState(json: String, promise: Promise) {
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

    companion object {
        private const val STATE_PATH = "/teamder/state"
        private const val KEY_JSON = "json"
        private const val KEY_TS = "ts"
    }
}

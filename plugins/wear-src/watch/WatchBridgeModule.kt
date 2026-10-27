package com.studiogameslime.soccerapp.watch

import org.json.JSONObject
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.studiogameslime.soccerapp.widget.TeamderPlayersWidgetProvider
import com.studiogameslime.soccerapp.widget.TeamderWidgetProvider
import com.studiogameslime.soccerapp.widget.WidgetStateStore
import com.google.firebase.auth.FirebaseAuth

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

    // Coarse connectivity only. Uses the existing ACCESS_NETWORK_STATE permission.
    @ReactMethod
    fun getNetworkDiagnostics(promise: Promise) {
        try {
            val manager = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val caps = manager.getNetworkCapabilities(manager.activeNetwork)
            val result = Arguments.createMap()
            result.putBoolean("networkConnected", caps != null)
            result.putBoolean("internetReachable", caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
            result.putString("networkType", when {
                caps == null -> "none"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                else -> "other"
            })
            promise.resolve(result)
        } catch (_: Exception) {
            promise.resolve(null)
        }
    }

    // Fixed operation codes only: never keep screenshots, state JSON or errors.
    private val diagnosticCodes = java.util.ArrayDeque<String>()
    private var diagnosticOverflow = false

    @Synchronized
    private fun recordDiagnostic(code: String) {
        if (diagnosticCodes.size == 31) {
            diagnosticCodes.removeFirst()
            diagnosticOverflow = true
        }
        diagnosticCodes.addLast(code)
    }

    @ReactMethod
    @Synchronized
    fun takeDiagnostics(promise: Promise) {
        val result = Arguments.createArray()
        diagnosticCodes.forEach { result.pushString(it) }
        if (diagnosticOverflow) result.pushString("native.overflow")
        diagnosticCodes.clear()
        diagnosticOverflow = false
        promise.resolve(result)
    }

    override fun getName(): String = "WatchBridge"

    @ReactMethod
    fun publishState(json: String, promise: Promise) {
        // 1) Phone home-screen widgets (timer + players-list). Both read
        //    the same SharedPreferences payload — one write, two refreshes.
        //    Best-effort — never blocks the watch publish or fails the
        //    promise.
        try {
            WidgetStateStore.acceptPhone(reactContext, json, FirebaseAuth.getInstance().currentUser?.uid)
        } catch (_: Exception) {
            recordDiagnostic("watch.widgets")
            // Widget refresh failing should not affect the watch path —
            // swallow and continue.
        }

        ActivitySourceStore.fenceAuth(reactContext)

        // 2) Paired watch (existing path).
        try {
            val request = PutDataMapRequest.create(STATE_PATH).apply {
                val canonical = synchronized(TeamderWidgetProvider.STATE_LOCK) {
                    WidgetStateStore.read(reactContext)?.apply {
                        put("viewerId", WidgetStateStore.owner(this))
                        put("sessionGeneration", WidgetStateStore.generation(reactContext))
                    } ?: JSONObject(json)
                }
                dataMap.putString(KEY_JSON, canonical.toString())
                dataMap.putLong(KEY_TS, System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()

            Wearable.getDataClient(reactContext).putDataItem(request)
                .addOnSuccessListener { promise.resolve(true) }
                .addOnFailureListener { e -> promise.reject("WATCH_PUBLISH_FAILED", e) }
        } catch (e: Exception) {
            promise.reject("WATCH_PUBLISH_FAILED", e)
        }
    }

    @ReactMethod
    fun getPendingActivity(promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        try {
            val uid = FirebaseAuth.getInstance().currentUser?.uid.orEmpty()
            require(uid.isNotBlank() && uid == WidgetStateStore.owner(WidgetStateStore.read(reactContext)))
            val result = Arguments.createArray()
            synchronized(WearTimerCommandService.ACTIVITY_LOCK) {
                reactContext.getSharedPreferences("TeamderActivityInbox", Context.MODE_PRIVATE).all
                    .filterKeys { uid.isNotBlank() && it.startsWith("$uid:") }.values.filterIsInstance<String>()
                    .sortedWith(compareBy<String> { JSONObject(it).optString("sessionId") }.thenBy { JSONObject(it).optLong("revision") }).forEach { raw ->
                        if (raw is String) result.pushMap(Arguments.makeNativeMap(jsonMap(JSONObject(raw))))
                    }
            }
            promise.resolve(result)
        } catch (error: Exception) { promise.reject("ACTIVITY_READ_FAILED", error) }
    }

    @ReactMethod
    fun ackActivity(sessionId: String, revision: Double, promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        try {
            require(sessionId.matches(Regex("[A-Za-z0-9-]{1,80}")) && revision > 0 && revision.isFinite() && revision % 1.0 == 0.0)
            val uid = FirebaseAuth.getInstance().currentUser?.uid.orEmpty()
            require(uid.isNotBlank() && uid == WidgetStateStore.owner(WidgetStateStore.read(reactContext)))
            val prefs = reactContext.getSharedPreferences("TeamderActivityInbox", Context.MODE_PRIVATE)
            val key = "$uid:$sessionId:${revision.toLong()}"
            val request = PutDataMapRequest.create("/teamder/activity-ack/$sessionId/${revision.toLong()}").apply {
                dataMap.putString("userId", uid)
                dataMap.putLong("revision", revision.toLong())
            }.asPutDataRequest().setUrgent()
            Wearable.getDataClient(reactContext).putDataItem(request).addOnSuccessListener {
                if (FirebaseAuth.getInstance().currentUser?.uid != uid || WidgetStateStore.owner(WidgetStateStore.read(reactContext)) != uid) {
                    promise.reject("ACTIVITY_SESSION_CHANGED", "החשבון השתנה לפני אישור הסנכרון")
                    return@addOnSuccessListener
                }
                synchronized(WearTimerCommandService.ACTIVITY_LOCK) {
                    val old = prefs.getString(key, null)?.let { JSONObject(it) }
                    if (old != null && old.optLong("revision") <= revision.toLong()) prefs.edit().remove(key).commit()
                }
                promise.resolve(true)
            }.addOnFailureListener { promise.reject("ACTIVITY_ACK_FAILED", it) }
        } catch (error: Exception) { promise.reject("ACTIVITY_ACK_FAILED", error) }
    }

    @ReactMethod
    fun getActivityReaderInstallationId(promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        try { promise.resolve(ActivitySourceStore.readerId(reactContext)) }
        catch(error: Exception) { promise.reject("ACTIVITY_READER_FAILED",error) }
    }

    @ReactMethod
    fun publishActivitySource(json: String, promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        ActivitySourceStore.executor.execute {
            try { ActivitySourceStore.accept(reactContext,JSONObject(json)); promise.resolve(true) }
            catch(error: Exception) { promise.reject("ACTIVITY_SOURCE_FAILED",error) }
        }
    }

    @ReactMethod
    fun refreshActivitySource(promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        ActivitySourceStore.executor.execute {
            try { promise.resolve(Arguments.makeNativeMap(jsonMap(ActivitySourceStore.refresh(reactContext)))) }
            catch(error: Exception) { promise.reject("ACTIVITY_SOURCE_FAILED",error) }
        }
    }

    @ReactMethod
    fun getActivityDevices(promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        ActivitySourceStore.executor.execute {
            try {
                val uid=FirebaseAuth.getInstance().currentUser?.takeUnless{it.isAnonymous}?.uid ?: error("No session")
                val nodes=com.google.android.gms.tasks.Tasks.await(Wearable.getNodeClient(reactContext).connectedNodes,10,java.util.concurrent.TimeUnit.SECONDS).map{it.id}.toSet()
                val items=com.google.android.gms.tasks.Tasks.await(Wearable.getDataClient(reactContext).dataItems,10,java.util.concurrent.TimeUnit.SECONDS)
                val result=Arguments.createArray()
                try { for(item in items) {
                    if(item.uri.path?.startsWith("/teamder/activity-device/")!=true) continue
                    val raw=com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap.getString("json") ?: continue
                    val body=JSONObject(raw);val device=body.optString("deviceId")
                    if(!device.matches(Regex("[A-Za-z0-9-]{1,80}")) || item.uri.path!="/teamder/activity-device/$device") continue
                    val row=Arguments.createMap();row.putString("deviceId",device);row.putString("sourceId",device)
                    row.putString("label",body.optString("label","שעון אנדרואיד"));row.putString("nodeId",item.uri.host)
                    row.putBoolean("connected",item.uri.host in nodes);result.pushMap(row)
                } } finally { items.release() }
                require(FirebaseAuth.getInstance().currentUser?.uid==uid)
                promise.resolve(result)
            } catch(error: Exception) { promise.reject("ACTIVITY_DEVICES_FAILED",error) }
        }
    }

    @ReactMethod
    fun getPendingStandaloneActivity(promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        try {
            val uid=FirebaseAuth.getInstance().currentUser?.takeUnless{it.isAnonymous}?.uid ?: error("No session")
            val result=Arguments.createArray()
            synchronized(WearTimerCommandService.ACTIVITY_LOCK) {
                reactContext.getSharedPreferences("TeamderStandaloneActivityInbox",0).all.values.filterIsInstance<String>()
                    .map{JSONObject(it)}.filter{it.optString("userId")==uid && ActivitySourceStore.matches(reactContext,it)}
                    .sortedWith(compareBy<JSONObject>{it.optString("sessionId")}.thenBy{it.optLong("revision")})
                    .forEach{result.pushMap(Arguments.makeNativeMap(jsonMap(it)))}
            }
            require(FirebaseAuth.getInstance().currentUser?.uid==uid)
            promise.resolve(result)
        } catch(error: Exception) { promise.reject("ACTIVITY_READ_FAILED",error) }
    }

    @ReactMethod
    fun ackStandaloneActivity(sessionId: String, revision: Double, promise: Promise) {
        if (!SportsActivity.ENABLED) { promise.reject("activity_disabled", "Activity disabled"); return }
        ActivitySourceStore.executor.execute {
            try {
                require(revision.isFinite() && revision>0 && revision%1.0==0.0)
                val uid=FirebaseAuth.getInstance().currentUser?.takeUnless{it.isAnonymous}?.uid ?: error("No session")
                StandaloneActivityInbox.acknowledge(reactContext,uid,sessionId,revision.toLong())
                promise.resolve(true)
            } catch(error: Exception) { promise.reject("ACTIVITY_ACK_FAILED",error) }
        }
    }

    private fun jsonMap(value: JSONObject): Map<String, Any?> = value.keys().asSequence().associateWith { key ->
        when (val item = value.get(key)) {
            JSONObject.NULL -> null
            is JSONObject -> jsonMap(item)
            is org.json.JSONArray -> (0 until item.length()).map { i ->
                val row = item.get(i)
                if (row is JSONObject) jsonMap(row) else if (row == JSONObject.NULL) null else row
            }
            else -> item
        }
    }

    companion object {
        private const val STATE_PATH = "/teamder/state"
        private const val KEY_JSON = "json"
        private const val KEY_TS = "ts"
    }
}

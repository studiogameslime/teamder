package com.studiogameslime.soccerapp.wear.activity

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import com.google.android.gms.wearable.Wearable
import java.util.UUID

object WearClockSync {
    @Volatile private var anchor: ActivityClock? = null
    private var restored = false
    @Volatile private var anchorBootEpoch = 0L
    val calibration: ActivityClock? get() = anchor?.takeIf {
        kotlin.math.abs((System.currentTimeMillis() - SystemClock.elapsedRealtime()) - anchorBootEpoch) <= 100
    }
    private var requestId = ""
    private var sent = 0L
    private var sentRealtime = 0L
    private var expectedUser = ""
    @Synchronized fun restore(context: Context) {
        if (restored) return
        restored = true
        val prefs = context.getSharedPreferences("WearClockAnchor", Context.MODE_PRIVATE)
        val stored = prefs.getString("anchor", null) ?: return
        try {
            val body = JSONObject(stored)
            val boot = body.getLong("bootEpoch")
            val value = ActivityClock(body.getDouble("offsetMs"), body.getDouble("uncertaintyMs"), body.getLong("measuredAtMs"))
            if (kotlin.math.abs((System.currentTimeMillis() - SystemClock.elapsedRealtime()) - boot) <= 100 && value.fresh(System.currentTimeMillis())) {
                anchorBootEpoch = boot; anchor = value; expectedUser = body.optString("userId")
            }
        } catch (_: Exception) { }
    }
    @Synchronized fun request(context: Context, node: String, user: String) {
        restore(context)
        if (node.isBlank() || user.isBlank()) return
        if (expectedUser == user && calibration?.fresh(System.currentTimeMillis()) == true) return
        if (expectedUser == user && requestId.isNotBlank() && SystemClock.elapsedRealtime() - sentRealtime < 10_000) return
        expectedUser = user; anchor = null
        requestId = UUID.randomUUID().toString(); sent = System.currentTimeMillis(); sentRealtime = SystemClock.elapsedRealtime()
        val body = JSONObject().put("id", requestId).put("watchSentAtMs", sent)
        Wearable.getMessageClient(context).sendMessage(node, "/teamder/clock-request", body.toString().toByteArray())
    }
    @Synchronized fun accept(context: Context, json: String) {
        try {
            val body = JSONObject(json)
            val received = System.currentTimeMillis()
            if (body.optString("id") != requestId || body.optString("userId") != expectedUser || !body.optBoolean("serverClockReady")) return
            if (kotlin.math.abs((received - sent) - (SystemClock.elapsedRealtime() - sentRealtime)) > 100) return
            anchor = ActivityClock.resolve(sent, body.getDouble("phoneReceivedAtMs").toLong(), body.getDouble("phoneSentAtMs").toLong(), received,
                body.optDouble("phoneUncertaintyMs", Double.POSITIVE_INFINITY))
            anchorBootEpoch = received - SystemClock.elapsedRealtime()
            requestId = ""
            anchor?.let { value ->
                context.getSharedPreferences("WearClockAnchor", Context.MODE_PRIVATE).edit().putString("anchor", JSONObject()
                    .put("offsetMs", value.offsetMs).put("uncertaintyMs", value.uncertaintyMs).put("measuredAtMs", value.measuredAtMs)
                    .put("bootEpoch", anchorBootEpoch).put("userId", expectedUser).toString()).apply()
            }
        } catch (_: Exception) { }
    }
}

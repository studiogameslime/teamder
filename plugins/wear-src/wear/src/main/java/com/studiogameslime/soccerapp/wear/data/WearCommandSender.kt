package com.studiogameslime.soccerapp.wear.data

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.mutableStateOf
import com.google.android.gms.wearable.Wearable
import com.studiogameslime.soccerapp.wear.model.WearGameState
import org.json.JSONObject
import java.util.UUID

/** A command is bound to the exact viewer, round and phone that rendered it. */
object WearCommandSender {
    val feedback = mutableStateOf("")
    val pending = mutableStateOf(false)
    var phoneNodeId: String = ""
    private var pendingId = ""
    private var contextKey = ""
    fun bindContext(user: String, game: String, round: String, generation: Long) {
        val next = "$user:$game:$round:$generation"
        if (next != contextKey) {
            contextKey = next; pendingId = ""; pending.value = false; feedback.value = ""
        }
    }
    private val handler = Handler(Looper.getMainLooper())

    fun sendTimerCommand(context: Context, action: String, state: WearGameState.Live) {
        if (pending.value || state.stale || !state.canControl || action !in setOf("start", "pause", "reset")) return
        if (phoneNodeId.isBlank() || state.gameId.isBlank() || state.viewerId.isBlank() || state.roundId.isBlank() || state.sessionGeneration < 0) {
            feedback.value = "פתחו את האפליקציה בטלפון לעדכון החיבור"
            return
        }
        val clock = com.studiogameslime.soccerapp.wear.activity.WearClockSync.calibration
        if (clock == null || !clock.fresh(System.currentTimeMillis())) {
            feedback.value = "ממתין לכיול השעון מול הטלפון"
            com.studiogameslime.soccerapp.wear.activity.WearClockSync.request(context, phoneNodeId, state.viewerId)
            return
        }
        val id = UUID.randomUUID().toString()
        pendingId = id
        pending.value = true
        feedback.value = "ממתין לשמירה בטלפון"
        val payload = JSONObject().put("protocol", 2).put("action", action)
            .put("gameId", state.gameId).put("userId", state.viewerId).put("roundId", state.roundId)
            .put("sessionGeneration", state.sessionGeneration).put("commandId", id)
            .put("resetConfirmed", action == "reset")
            .put("issuedAtMs", (System.currentTimeMillis() + clock.offsetMs).toLong()).put("sourceStateAtMs", state.publishedAtMs)
        Wearable.getMessageClient(context).sendMessage(phoneNodeId, "/teamder/timer-command", payload.toString().toByteArray())
            .addOnFailureListener { finish(id, "הטלפון אינו זמין. הפעולה לא אושרה") }
        handler.postDelayed({ finish(id, "לא התקבל אישור. בדקו בטלפון לפני ניסיון נוסף") }, 20_000)
    }

    fun receiveResult(json: String) {
        try {
            val value = JSONObject(json)
            finish(value.optString("commandId"), if (value.optBoolean("ok")) "הפעולה נשמרה" else value.optString("message", "הפעולה לא נשמרה"))
        } catch (_: Exception) { }
    }

    private fun finish(id: String, message: String) {
        handler.post {
            if (id != pendingId || !pending.value) return@post
            pending.value = false
            feedback.value = message
        }
    }
}

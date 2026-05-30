package com.studiogameslime.soccerapp.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import org.json.JSONObject

/**
 * Handles the widget's play / pause / reset button taps and mutates the
 * game's timer in Firestore DIRECTLY from native Kotlin — no detour
 * through the JS app. This is what makes the widget feel like a real
 * control surface vs. a status bookmark.
 *
 * The mutation logic mirrors `gameService.startTimer/pauseTimer/resetTimer`
 * in `src/services/gameService.ts` exactly:
 *   start  → running=true,  lastStartedAt=now,            accumulator unchanged
 *   pause  → running=false, lastStartedAt=null,           accumulator += (now − lastStartedAt)
 *   reset  → running=false, lastStartedAt=null,           accumulator = 0
 * Each writes `timerControlledBy` + `timerControlledByName` so other
 * devices' UIs can show "מופעל ע״י X".
 *
 * Authentication: FirebaseAuth is shared between the JS app and native
 * code (same FirebaseApp instance), so a user who's logged into the JS
 * app is also authenticated for our Firestore transaction here — no
 * extra sign-in plumbing.
 *
 * After the transaction succeeds, we also patch the widget's
 * SharedPreferences with the new timer fields and broadcast a refresh.
 * That gives the widget an instant visual update without waiting for
 * the JS app's onSnapshot → bridge → publish round-trip (which only
 * fires if the JS app is currently running).
 */
class TimerActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        val gameId = intent.getStringExtra(EXTRA_GAME_ID) ?: return
        val userName = intent.getStringExtra(EXTRA_USER_NAME) ?: ""

        val auth = FirebaseAuth.getInstance()
        val uid = auth.currentUser?.uid
        if (uid == null) {
            Log.w(TAG, "no signed-in user; widget button ignored")
            return
        }

        // goAsync lets the receiver outlive its synchronous lifetime so
        // the Firestore transaction (~0.5-2s round-trip) can complete.
        val pending = goAsync()
        val now = System.currentTimeMillis()

        val db = FirebaseFirestore.getInstance()
        val ref = db.collection("games").document(gameId)

        db.runTransaction<Map<String, Any?>?> { tx ->
            val snap = tx.get(ref)
            if (!snap.exists()) return@runTransaction null
            val status = snap.getString("status")
            if (status == "finished" || status == "cancelled") return@runTransaction null
            @Suppress("UNCHECKED_CAST")
            val live = snap.get("liveMatch") as? Map<String, Any?>
                ?: return@runTransaction null

            val newLive = live.toMutableMap()
            val wasRunning = live["timerRunning"] as? Boolean == true
            val acc = (live["timerAccumulatedMs"] as? Number)?.toLong() ?: 0L
            val lastStarted = (live["timerLastStartedAt"] as? Number)?.toLong() ?: 0L

            when (action) {
                ACTION_START -> {
                    if (wasRunning) return@runTransaction null  // idempotent
                    newLive["timerRunning"] = true
                    newLive["timerLastStartedAt"] = now
                    newLive["timerAccumulatedMs"] = acc
                }
                ACTION_PAUSE -> {
                    if (!wasRunning) return@runTransaction null
                    val elapsed = if (lastStarted > 0) (now - lastStarted).coerceAtLeast(0L) else 0L
                    newLive["timerRunning"] = false
                    newLive["timerLastStartedAt"] = null
                    newLive["timerAccumulatedMs"] = acc + elapsed
                }
                ACTION_RESET -> {
                    newLive["timerRunning"] = false
                    newLive["timerLastStartedAt"] = null
                    newLive["timerAccumulatedMs"] = 0L
                }
                else -> return@runTransaction null
            }
            newLive["timerControlledBy"] = uid
            newLive["timerControlledByName"] = userName

            tx.update(ref, mapOf("liveMatch" to newLive, "updatedAt" to now))
            // Return the new timer slice for the optimistic prefs update below.
            mapOf(
                "timerRunning" to newLive["timerRunning"],
                "timerLastStartedAt" to newLive["timerLastStartedAt"],
                "timerAccumulatedMs" to newLive["timerAccumulatedMs"],
                "timerControlledBy" to newLive["timerControlledBy"],
                "timerControlledByName" to newLive["timerControlledByName"],
            )
        }.addOnSuccessListener { newTimer ->
            if (newTimer != null) {
                applyOptimisticPrefsUpdate(context, newTimer)
                TeamderWidgetProvider.requestRefresh(context)
            }
            pending.finish()
        }.addOnFailureListener { e ->
            Log.w(TAG, "timer mutation failed for action=$action gameId=$gameId", e)
            pending.finish()
        }
    }

    /**
     * Apply the new timer fields to the cached SharedPreferences payload
     * so the widget reflects them immediately — without waiting for the
     * JS app to re-publish via the bridge (which only happens if the JS
     * app is currently running). Best-effort; failure means a brief
     * staleness, never corruption.
     */
    private fun applyOptimisticPrefsUpdate(
        context: Context,
        newTimer: Map<String, Any?>,
    ) {
        try {
            val prefs = context.getSharedPreferences(
                TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE,
            )
            val current = prefs.getString(TeamderWidgetProvider.KEY_JSON, null) ?: return
            val o = JSONObject(current)
            if (o.optString("kind") != "live") return
            val timer = o.optJSONObject("timer") ?: JSONObject()
            timer.put("running", newTimer["timerRunning"] as? Boolean == true)
            timer.put("lastStartedAt", (newTimer["timerLastStartedAt"] as? Number)?.toLong() ?: 0L)
            timer.put("accumulatedMs", (newTimer["timerAccumulatedMs"] as? Number)?.toLong() ?: 0L)
            o.put("timer", timer)
            o.put("controlledBy", newTimer["timerControlledBy"] as? String ?: "")
            o.put("controlledByName", newTimer["timerControlledByName"] as? String ?: "")
            prefs.edit().putString(TeamderWidgetProvider.KEY_JSON, o.toString()).apply()
        } catch (_: Exception) {
            // Best-effort; JS bridge's next publish (if running) will
            // make the prefs converge to the canonical Firestore value.
        }
    }

    companion object {
        private const val TAG = "TimerActionReceiver"

        // Distinct intent action per button — fully-qualified to avoid
        // collisions with any other receiver in the system.
        const val ACTION_START = "com.studiogameslime.soccerapp.widget.TIMER_START"
        const val ACTION_PAUSE = "com.studiogameslime.soccerapp.widget.TIMER_PAUSE"
        const val ACTION_RESET = "com.studiogameslime.soccerapp.widget.TIMER_RESET"

        // Extras carried by every action intent. Set by the widget
        // provider when building the PendingIntent for each button.
        const val EXTRA_ACTION = "action"
        const val EXTRA_GAME_ID = "gameId"
        const val EXTRA_USER_NAME = "userName"
    }
}

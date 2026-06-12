package com.studiogameslime.soccerapp.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
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
 * code (same FirebaseApp instance). BUT when the app process was killed,
 * tapping a widget button spawns a FRESH process where Firebase Auth may
 * still be restoring the persisted user from disk — so `currentUser` can
 * be momentarily null. Previously we bailed silently in that case, which
 * is exactly why "the button does nothing" when the app isn't running.
 * Now we wait briefly for the auth state to restore before giving up, and
 * we Toast on every failure so a tap is never a silent no-op.
 *
 * After the transaction succeeds, we also patch the widget's
 * SharedPreferences with the new timer fields and broadcast a refresh.
 */
class TimerActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        val gameId = intent.getStringExtra(EXTRA_GAME_ID) ?: return
        val userName = intent.getStringExtra(EXTRA_USER_NAME) ?: ""

        // goAsync lets the receiver outlive its synchronous lifetime so the
        // auth-restore wait + Firestore transaction (~0.5-2s) can complete.
        val pending = goAsync()
        val auth = FirebaseAuth.getInstance()

        val existing = auth.currentUser
        if (existing != null) {
            performMutation(context, action, gameId, userName, existing.uid, pending)
            return
        }

        // Cold-started receiver process — wait for Firebase Auth to finish
        // restoring the persisted user (up to AUTH_WAIT_MS) before bailing.
        Log.d(TAG, "currentUser null; waiting for auth restore")
        val handler = Handler(Looper.getMainLooper())
        val listenerHolder = arrayOfNulls<FirebaseAuth.AuthStateListener>(1)
        var settled = false

        val giveUp = Runnable {
            if (settled) return@Runnable
            settled = true
            listenerHolder[0]?.let { auth.removeAuthStateListener(it) }
            Log.w(TAG, "auth did not restore in time; widget button ignored")
            toast(context, "התחברו לאפליקציה כדי לשלוט בטיימר")
            pending.finish()
        }

        val listener = FirebaseAuth.AuthStateListener { a ->
            val u = a.currentUser
            if (u != null && !settled) {
                settled = true
                handler.removeCallbacks(giveUp)
                listenerHolder[0]?.let { a.removeAuthStateListener(it) }
                performMutation(context, action, gameId, userName, u.uid, pending)
            }
        }
        listenerHolder[0] = listener
        auth.addAuthStateListener(listener)
        handler.postDelayed(giveUp, AUTH_WAIT_MS)
    }

    private fun performMutation(
        context: Context,
        action: String,
        gameId: String,
        userName: String,
        uid: String,
        pending: BroadcastReceiver.PendingResult,
    ) {
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
                // Also push to the paired watch so the Wear tile reflects a
                // timer change driven from the phone widget — without this,
                // controlling the timer from the widget left the watch stale
                // (the JS watch-sync only runs while the app is alive).
                publishToWatch(context)
            } else {
                // Transaction ran but was a no-op (game finished / not live /
                // idempotent). Tell the user so the tap isn't a silent miss.
                Log.w(TAG, "timer mutation no-op for action=$action gameId=$gameId")
                toast(context, "לא ניתן לעדכן את הטיימר כרגע")
            }
            pending.finish()
        }.addOnFailureListener { e ->
            Log.w(TAG, "timer mutation failed for action=$action gameId=$gameId", e)
            // Most common cause: the viewer isn't the game's admin/creator,
            // so the Firestore rules reject the liveMatch write.
            toast(context, "פעולת הטיימר נכשלה — רק מנהל המשחק יכול לשלוט")
            pending.finish()
        }
    }

    private fun toast(context: Context, msg: String) {
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(context.applicationContext, msg, Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Mirror the freshly-updated widget payload to the Wear Data Layer so
     * the watch tile refreshes. The widget prefs JSON and the watch payload
     * are the SAME shape (see WatchBridgeModule), so we forward it verbatim
     * with a new timestamp (the Data Layer dedups identical content). The
     * watch's TileUpdateListenerService picks this up and re-renders.
     */
    private fun publishToWatch(context: Context) {
        try {
            val json = context.getSharedPreferences(
                TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE,
            ).getString(TeamderWidgetProvider.KEY_JSON, null) ?: return
            val request = PutDataMapRequest.create("/teamder/state").apply {
                dataMap.putString("json", json)
                dataMap.putLong("ts", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()
            Wearable.getDataClient(context).putDataItem(request)
        } catch (_: Exception) {
            // Best-effort — no paired watch, or Play Services unavailable.
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

        /** How long to wait for Firebase Auth to restore in a cold process. */
        private const val AUTH_WAIT_MS = 5_000L

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

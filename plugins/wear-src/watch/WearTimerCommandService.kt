package com.studiogameslime.soccerapp.watch

import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.studiogameslime.soccerapp.widget.TeamderWidgetProvider
import com.studiogameslime.soccerapp.widget.TimerActionReceiver
import org.json.JSONObject

/**
 * Phone-side receiver for timer commands sent FROM the watch.
 *
 * The watch's `WearCommandSender` sends a MessageClient message at
 * [TIMER_COMMAND_PATH] with payload `"<action>|<gameId>"`. We translate it
 * into the EXACT same broadcast the home-screen widget's play/pause/reset
 * buttons fire, so all three control surfaces (watch, widget, in-app) run a
 * single Firestore mutation path ([TimerActionReceiver]) — no duplicated
 * timer logic, no drift.
 *
 * `gameId` normally rides in on the message. If it's missing (older watch
 * build, or a race), we recover it from the last state the phone published
 * to its widgets — the same SharedPreferences payload the widget reads. The
 * viewer's display name comes from that payload too (for the
 * "מופעל ע״י X" attribution other devices show).
 */
class WearTimerCommandService : WearableListenerService() {

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != TIMER_COMMAND_PATH) return

        val raw = String(event.data, Charsets.UTF_8)
        val parts = raw.split("|", limit = 2)
        val action = parts.getOrNull(0)?.trim().orEmpty()
        var gameId = parts.getOrNull(1)?.trim().orEmpty()

        val receiverAction = when (action) {
            "start" -> TimerActionReceiver.ACTION_START
            "pause" -> TimerActionReceiver.ACTION_PAUSE
            "reset" -> TimerActionReceiver.ACTION_RESET
            else -> {
                Log.w(TAG, "unknown timer action from watch: '$action'")
                return
            }
        }

        // Fall back to the last-published payload if the watch didn't send a
        // gameId. Either way, the viewer name is read from that payload.
        val payload = readPayload(this)
        if (gameId.isBlank()) gameId = payload?.optString("gameId").orEmpty()
        if (gameId.isBlank()) {
            Log.w(TAG, "no gameId for watch command; ignoring")
            return
        }
        val viewerName = payload?.optJSONObject("viewer")?.optString("name").orEmpty()

        // Replay the widget-button path. TimerActionReceiver is exported=false
        // and matched by explicit component, so this is an in-app delivery.
        val intent = Intent(this, TimerActionReceiver::class.java).apply {
            putExtra(TimerActionReceiver.EXTRA_ACTION, receiverAction)
            putExtra(TimerActionReceiver.EXTRA_GAME_ID, gameId)
            putExtra(TimerActionReceiver.EXTRA_USER_NAME, viewerName)
        }
        sendBroadcast(intent)
    }

    private fun readPayload(context: Context): JSONObject? = try {
        val prefs = context.getSharedPreferences(
            TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE,
        )
        val json = prefs.getString(TeamderWidgetProvider.KEY_JSON, null)
        if (json != null) JSONObject(json) else null
    } catch (_: Exception) {
        null
    }

    companion object {
        private const val TAG = "WearTimerCommand"
        private const val TIMER_COMMAND_PATH = "/teamder/timer-command"
    }
}

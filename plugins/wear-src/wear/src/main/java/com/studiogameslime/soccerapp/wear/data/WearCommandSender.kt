package com.studiogameslime.soccerapp.wear.data

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.Wearable

/**
 * Sends timer control commands from the watch BACK to the phone over the
 * Wearable Data Layer's MessageClient. This is the reverse of
 * [WearStateRepository] (which only listens): together they make the watch
 * a real control surface, not just a mirror.
 *
 * Wire format: a single message at [TIMER_COMMAND_PATH] whose payload is
 * `"<action>|<gameId>"` (UTF-8), where action ∈ { start, pause, reset }.
 * The phone's `WearTimerCommandService` parses it and replays the EXACT
 * same Firestore mutation the home-screen widget buttons use — so the watch,
 * the widget and the in-app controls all converge on one code path.
 *
 * Fire-and-forget: a failed send (phone asleep / unpaired) is logged and
 * dropped. The user simply taps again, or the timer is controlled from the
 * phone instead. We never block the UI on the round-trip.
 */
object WearCommandSender {

    private const val TAG = "WearCommandSender"
    private const val TIMER_COMMAND_PATH = "/teamder/timer-command"

    fun sendTimerCommand(context: Context, action: String, gameId: String) {
        // Demo/preview states carry no gameId — nothing to control.
        if (gameId.isBlank()) return
        val payload = "$action|$gameId".toByteArray(Charsets.UTF_8)
        val messageClient = Wearable.getMessageClient(context)
        // Fan the command out to every connected node (normally just the
        // paired phone). Each delivery is independent and best-effort.
        Wearable.getNodeClient(context).connectedNodes
            .addOnSuccessListener { nodes ->
                if (nodes.isEmpty()) {
                    Log.w(TAG, "no connected node; command dropped: $action")
                    return@addOnSuccessListener
                }
                for (node in nodes) {
                    messageClient.sendMessage(node.id, TIMER_COMMAND_PATH, payload)
                        .addOnFailureListener { e ->
                            Log.w(TAG, "sendMessage failed to ${node.id}", e)
                        }
                }
            }
            .addOnFailureListener { e -> Log.w(TAG, "connectedNodes failed", e) }
    }
}

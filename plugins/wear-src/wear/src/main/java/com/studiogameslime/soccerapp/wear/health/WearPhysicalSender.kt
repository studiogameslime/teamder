package com.studiogameslime.soccerapp.wear.health

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.Wearable

/**
 * Sends a finished physical session from the watch BACK to the phone over the
 * Wearable Data Layer's MessageClient — the mirror of [WearPhysicalSender]'s
 * cousin [com.studiogameslime.soccerapp.wear.data.WearCommandSender].
 *
 * Wire format: one message at [PHYSICAL_PATH] whose payload is the UTF-8 JSON
 * `{ gameId, distanceM, steps, calories, topSpeedKmh, avgSpeedKmh, sprints,
 *    avgHr, maxHr, effortScore, source:"wear" }`. The phone's
 * `WearPhysicalService` queues it; the RN app drains + persists it via the
 * saveGamePhysical callable.
 *
 * No store-and-forward: MessageClient drops a message if no node is connected.
 * So the caller ([ExerciseRecorderService]) keeps the session in a watch-side
 * stash and only removes it once [onDelivered] fires — giving at-least-once
 * delivery with a re-send on the next match. [onDelivered] runs at most once,
 * on the first node that acknowledges.
 */
object WearPhysicalSender {

    private const val TAG = "WearPhysicalSender"
    private const val PHYSICAL_PATH = "/teamder/physical"

    fun sendSession(context: Context, json: String, onDelivered: (() -> Unit)? = null) {
        val payload = json.toByteArray(Charsets.UTF_8)
        val messageClient = Wearable.getMessageClient(context)
        // Guard so onDelivered fires at most once even across multiple nodes.
        val delivered = java.util.concurrent.atomic.AtomicBoolean(false)
        Wearable.getNodeClient(context).connectedNodes
            .addOnSuccessListener { nodes ->
                if (nodes.isEmpty()) {
                    Log.w(TAG, "no connected node; keeping physical session stashed")
                    return@addOnSuccessListener
                }
                for (node in nodes) {
                    messageClient.sendMessage(node.id, PHYSICAL_PATH, payload)
                        .addOnSuccessListener {
                            Log.i(TAG, "physical sent to ${node.id}")
                            if (delivered.compareAndSet(false, true)) onDelivered?.invoke()
                        }
                        .addOnFailureListener { e ->
                            Log.w(TAG, "sendMessage failed to ${node.id}", e)
                        }
                }
            }
            .addOnFailureListener { e -> Log.w(TAG, "connectedNodes failed", e) }
    }
}

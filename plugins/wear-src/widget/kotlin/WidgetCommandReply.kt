package com.studiogameslime.soccerapp.widget

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** ACK reports the transaction outcome, never merely receipt of the watch message. */
object WidgetCommandReply {
    fun send(context: Context, node: String?, command: String?, ok: Boolean, message: String, await: Boolean = false) {
        if (node.isNullOrBlank() || command.isNullOrBlank()) return
        try {
            val bytes = JSONObject().put("commandId", command).put("ok", ok).put("message", message).toString().toByteArray(Charsets.UTF_8)
            val task = Wearable.getMessageClient(context).sendMessage(node, "/teamder/timer-result", bytes)
            if (await) Tasks.await(task, 5, TimeUnit.SECONDS)
        } catch (_: Exception) { /* Watch shows an unconfirmed outcome and can refresh authoritative state. */ }
    }
}

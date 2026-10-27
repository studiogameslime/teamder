package com.studiogameslime.soccerapp.watch

import android.content.Intent
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import com.google.android.gms.wearable.Wearable
import com.google.firebase.auth.FirebaseAuth
import com.studiogameslime.soccerapp.widget.TimerActionReceiver
import com.studiogameslime.soccerapp.widget.WidgetTimerWorker
import org.json.JSONObject

/** Reject legacy unbound commands; the durable widget transaction owns all timer writes. */
class WearTimerCommandService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == "/teamder/activity-source-request") {
            if (!SportsActivity.ENABLED) return
            if(!SOURCE_PENDING.compareAndSet(false,true))return
            val raw=event.data.clone()
            ActivitySourceStore.executor.execute {
                try {
                    val body=JSONObject(String(raw,Charsets.UTF_8))
                    if(body.optString("userId")==FirebaseAuth.getInstance().currentUser?.uid) ActivitySourceStore.refresh(this)
                } catch(_:Exception) { }
                finally{SOURCE_PENDING.set(false)}
            }
            return
        }
        if (event.path == "/teamder/request-state") {
            try {
                val input = JSONObject(String(event.data, Charsets.UTF_8))
                val state = com.studiogameslime.soccerapp.widget.WidgetStateStore.read(this)
                val owner = com.studiogameslime.soccerapp.widget.WidgetStateStore.owner(state)
                if (owner.isNotBlank() && input.optString("userId") == owner && FirebaseAuth.getInstance().currentUser?.uid == owner) {
                    com.studiogameslime.soccerapp.widget.WidgetRosterWorker.enqueue(this, state?.optString("gameId"), owner, false)
                }
            } catch (_: Exception) { }
            return
        }
        if (event.path == "/teamder/clock-request") {
            val received = System.currentTimeMillis()
            val receivedRt = android.os.SystemClock.elapsedRealtime()
            val raw = event.data.clone()
            val node = event.sourceNodeId
            CLOCK_EXECUTOR.execute {
                try {
                    val input = JSONObject(String(raw, Charsets.UTF_8))
                    val uid = FirebaseAuth.getInstance().currentUser?.uid.orEmpty()
                    val generation = com.studiogameslime.soccerapp.widget.WidgetStateStore.generation(this)
                    val anchor = PhoneServerClock.get()?.takeIf {
                        kotlin.math.abs((System.currentTimeMillis() - received) - (android.os.SystemClock.elapsedRealtime() - receivedRt)) <= 100
                    }
                    if (anchor != null) synchronized(com.studiogameslime.soccerapp.widget.TeamderWidgetProvider.STATE_LOCK) {
                        val current = com.studiogameslime.soccerapp.widget.WidgetStateStore.read(this)
                        if (uid.isNotBlank() && FirebaseAuth.getInstance().currentUser?.uid == uid &&
                            com.studiogameslime.soccerapp.widget.WidgetStateStore.owner(current) == uid &&
                            com.studiogameslime.soccerapp.widget.WidgetStateStore.generation(this) == generation && current != null) {
                            current.put("clockOffsetMs", anchor.offsetMs.toLong())
                            com.studiogameslime.soccerapp.widget.WidgetStateStore.write(this, current)
                        }
                    }
                    val output = JSONObject().put("id", input.optString("id"))
                        .put("watchSentAtMs", input.optLong("watchSentAtMs"))
                        .put("userId", FirebaseAuth.getInstance().currentUser?.uid.orEmpty())
                        .put("serverClockReady", anchor != null)
                    if (anchor != null) output.put("phoneReceivedAtMs", received + anchor.offsetMs)
                        .put("phoneSentAtMs", System.currentTimeMillis() + anchor.offsetMs)
                        .put("phoneUncertaintyMs", PhoneServerClock.uncertaintyNow(anchor))
                    Wearable.getMessageClient(this).sendMessage(node, "/teamder/clock-result", output.toString().toByteArray())
                } catch (_: Exception) { }
            }
            return
        }
        if (event.path != "/teamder/timer-command" || event.data.size > 4096) return
        try {
            val data = JSONObject(String(event.data, Charsets.UTF_8))
            require(data.optInt("protocol") == 2)
            val action = when (data.optString("action")) {
                "start" -> TimerActionReceiver.ACTION_START
                "pause" -> TimerActionReceiver.ACTION_PAUSE
                "reset" -> TimerActionReceiver.ACTION_RESET
                else -> return
            }
            WidgetTimerWorker.receive(this, Intent().apply {
                putExtra("origin", "watch")
                putExtra("action", action)
                putExtra("gameId", data.optString("gameId"))
                putExtra("viewerId", data.optString("userId"))
                putExtra("timerRoundId", data.optString("roundId"))
                putExtra("widgetSession", data.optLong("sessionGeneration", -1))
                putExtra("commandId", data.optString("commandId"))
                putExtra("issuedAtMs", data.optLong("issuedAtMs", 0))
                putExtra("sourceNodeId", event.sourceNodeId)
                putExtra("resetConfirmed", data.optBoolean("resetConfirmed", false))
            })
        } catch (_: Exception) {
            // An old watch must update before it can issue a destructive command.
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        if (!SportsActivity.ENABLED) return
        for (event in events) {
            val item = event.dataItem
            if(event.type==DataEvent.TYPE_CHANGED && item.uri.path?.startsWith("/teamder/standalone-activity/")==true) {
                try {
                    val raw=DataMapItem.fromDataItem(item).dataMap.getString("json") ?: continue
                    if(raw.toByteArray().size>80_000) continue
                    val chunk=JSONObject(raw);val session=chunk.optString("sessionId");val revision=chunk.optLong("revision")
                    if(!session.matches(Regex("[A-Za-z0-9-]{1,80}")) || revision<=0 || item.uri.path!="/teamder/standalone-activity/$session/$revision") continue
                    if(chunk.optInt("protocol")!=1 || chunk.optString("mode")!="standalone" || chunk.optString("source")!="wear-health-services") continue
                    val uid=FirebaseAuth.getInstance().currentUser?.takeUnless{it.isAnonymous}?.uid ?: continue
                    if(chunk.optString("userId")!=uid || !ActivitySourceStore.matches(this,chunk)) continue
                    if(chunk.optJSONArray("samples")==null || chunk.getJSONArray("samples").length()>200) continue
                    val p=getSharedPreferences(StandaloneActivityInbox.PREFS,0);val key="$uid:$session:$revision"
                    synchronized(ACTIVITY_LOCK){
                        if(p.getString(key,null)==null) check(p.edit().putString(key,raw).commit())
                    }
                    com.studiogameslime.soccerapp.widget.PersonalActivityUploadWorker.enqueue(this,uid)
                } catch(_:Exception) { }
                continue
            }
            if (event.type != DataEvent.TYPE_CHANGED || item.uri.path?.startsWith("/teamder/activity/") != true) continue
            try {
                val json = DataMapItem.fromDataItem(item).dataMap.getString("json") ?: continue
                if (json.toByteArray().size > 80_000) continue
                val body = JSONObject(json)
                val session = body.optString("sessionId")
                if (!session.matches(Regex("[A-Za-z0-9-]{1,80}")) || item.uri.path != "/teamder/activity/$session/${body.optLong("revision")}") continue
                if (body.optInt("protocol") != 1 || body.optString("source") != "wear-health-services" || body.optString("mode") == "standalone") continue
                if (body.optString("userId") != FirebaseAuth.getInstance().currentUser?.uid ||
                    body.optString("userId") != com.studiogameslime.soccerapp.widget.WidgetStateStore.owner(com.studiogameslime.soccerapp.widget.WidgetStateStore.read(this))) continue
                val rows = body.optJSONArray("samples") ?: continue
                if (rows.length() > 200 || body.optLong("revision") <= 0) continue
                val prefs = getSharedPreferences("TeamderActivityInbox", MODE_PRIVATE)
                val owner = body.optString("userId")
                val key = "$owner:$session:${body.optLong("revision")}"
                synchronized(ACTIVITY_LOCK) {
                    val old = prefs.getString(key, null)?.let { JSONObject(it) }
                    if (old == null) {
                        prefs.edit().putString(key, json).commit()
                        com.studiogameslime.soccerapp.widget.PersonalActivityUploadWorker.enqueue(this, owner)
                    }
                }
            } catch (_: Exception) { }
        }
    }

    companion object { private val SOURCE_PENDING=java.util.concurrent.atomic.AtomicBoolean(false); val ACTIVITY_LOCK = Any(); private val CLOCK_EXECUTOR = java.util.concurrent.Executors.newSingleThreadExecutor() }
}

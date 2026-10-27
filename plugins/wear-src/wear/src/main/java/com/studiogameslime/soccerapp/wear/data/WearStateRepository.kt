package com.studiogameslime.soccerapp.wear.data

import android.content.Context
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import android.os.Handler
import android.os.Looper
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.studiogameslime.soccerapp.wear.ongoing.LiveOngoingActivity
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.studiogameslime.soccerapp.wear.model.WearGameState
import com.studiogameslime.soccerapp.wear.model.parseWearStateFresh

/** Data Layer path the phone publishes the current state to. */
private const val STATE_PATH = "/teamder/state"
private const val KEY_JSON = "json"
private const val KEY_TS = "ts"

/**
 * Listens to the Data Layer item the phone publishes and exposes it as a
 * Compose-observable [WearGameState]. DataItems persist, so on app open we
 * also pull the last-known value immediately. When nothing has ever been
 * published (phone not paired / app never ran) we report [Disconnected].
 */
class WearStateRepository(private val appContext: Context) :
    DataClient.OnDataChangedListener, MessageClient.OnMessageReceivedListener {

    val state: MutableState<WearGameState> = mutableStateOf(WearGameState.Loading)

    private val dataClient: DataClient by lazy { Wearable.getDataClient(appContext) }

    /** Reset each start(); set when onDataChanged delivers a fresh item. Guards
     *  the resume-fetch downgrade below against the add-between-fetch-and-event
     *  race (don't clobber a Live that onDataChanged just delivered). */
    @Volatile
    private var sawChangeSinceStart = false
    private var generation = 0
    private var latestTs = 0L
    private var latestJson = ""
    private var latestSession = -1L
    private var latestOrderingAt = 0L
    private var lastRequestRt = -30_000L
    fun currentJson(): String = latestJson
    private val handler = Handler(Looper.getMainLooper())
    private val freshnessTick = object : Runnable {
        override fun run() {
            com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.request(appContext)
            if (latestJson.isNotBlank()) {
                val live = state.value as? WearGameState.Live
                if (live != null && android.os.SystemClock.elapsedRealtime() - lastRequestRt >= 30_000 && WearCommandSender.phoneNodeId.isNotBlank()) {
                    lastRequestRt = android.os.SystemClock.elapsedRealtime()
                    com.google.android.gms.wearable.Wearable.getMessageClient(appContext).sendMessage(WearCommandSender.phoneNodeId,
                        "/teamder/request-state", org.json.JSONObject().put("userId", live.viewerId).toString().toByteArray())
                }
                val refreshed = parse(latestJson, latestTs)
                if (live != null && refreshed is WearGameState.Live && live.stale != refreshed.stale) {
                    state.value = refreshed
                    LiveOngoingActivity.update(appContext, state.value)
                }
            }
            handler.postDelayed(this, 5_000)
        }
    }

    private fun accept(json: String, at: Long, node: String?) {
        val session = try { org.json.JSONObject(json).optLong("sessionGeneration", -1) } catch (_: Exception) { -1L }
        if (session < latestSession) return
        if (session > latestSession) { latestTs = 0; latestOrderingAt = 0; latestSession = session }
        val phoneOffset = try { org.json.JSONObject(json).optLong("clockOffsetMs") } catch (_: Exception) { 0L }
        val orderAt = at + phoneOffset
        if (orderAt < latestOrderingAt) return
        if (at == latestTs && json == latestJson) return
        latestTs = at; latestOrderingAt = orderAt; latestJson = json
        val owner = try { org.json.JSONObject(json).optJSONObject("viewer")?.optString("id").orEmpty() } catch (_: Exception) { "" }
        com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(json)
        com.studiogameslime.soccerapp.wear.activity.ActivityJournal(appContext).publish()
        WearCommandSender.phoneNodeId = node.orEmpty()
        state.value = parse(json, at)
        val live = state.value as? WearGameState.Live
        val viewer = live?.viewerId.orEmpty()
        WearCommandSender.bindContext(viewer, live?.gameId.orEmpty(), live?.roundId.orEmpty(), session)
        com.studiogameslime.soccerapp.wear.activity.WearClockSync.request(appContext, node.orEmpty(), viewer)
        LiveOngoingActivity.update(appContext, state.value)
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == "/teamder/clock-result" && (event.sourceNodeId == WearCommandSender.phoneNodeId || event.sourceNodeId==com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.phoneNode)) {
            com.studiogameslime.soccerapp.wear.activity.WearClockSync.accept(appContext, String(event.data, Charsets.UTF_8))
            if (latestJson.isNotBlank()) {
                state.value = parse(latestJson, latestTs)
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(latestJson)
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal(appContext).publish()
            }
        }
        if (event.path == "/teamder/timer-result" && event.sourceNodeId == WearCommandSender.phoneNodeId) {
            WearCommandSender.receiveResult(String(event.data, Charsets.UTF_8))
        }
    }

    fun start() {
        val requestGeneration = ++generation
        sawChangeSinceStart = false
        com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.restore(appContext)
        com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.announce(appContext)
        com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.request(appContext)
        dataClient.addListener(this)
        Wearable.getMessageClient(appContext).addListener(this)
        handler.removeCallbacks(freshnessTick)
        handler.post(freshnessTick)
        dataClient.dataItems.addOnSuccessListener { buffer ->
            try {
                if (requestGeneration != generation || sawChangeSinceStart) return@addOnSuccessListener
                var found = false
                for (item in buffer) {
                    if(item.uri.path==com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.PATH){
                        com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.accept(appContext,DataMapItem.fromDataItem(item).dataMap.getString("json"),item.uri.host.orEmpty())
                    }
                    if (item.uri.path == STATE_PATH) {
                        val dataMap = DataMapItem.fromDataItem(item).dataMap
                        val json = dataMap.getString(KEY_JSON)
                        if (json != null) {
                            accept(json, dataMap.getLong(KEY_TS, 0L), item.uri.host)
                            found = true
                        }
                    }
                }
                // The item is gone (unpaired / signed out while we were detached,
                // so the TYPE_DELETED event never reached us). Downgrade the stale
                // Live/Upcoming to Disconnected — but ONLY if onDataChanged hasn't
                // just delivered a fresh item, which would mean the item was added
                // between this fetch's snapshot and now (clobbering it would flash
                // "אין משחק רשום" over a live match).
                if (!found && !sawChangeSinceStart) {
                    latestJson = ""; latestTs = 0
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(null)
                state.value = WearGameState.Disconnected
                }
            } finally {
                buffer.release()
            }
        }.addOnFailureListener {
            if (requestGeneration != generation || sawChangeSinceStart) return@addOnFailureListener
            if (state.value is WearGameState.Loading) {
                latestJson = ""; latestTs = 0
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(null)
                state.value = WearGameState.Disconnected
            }
        }
    }

    fun stop() {
        generation++
        dataClient.removeListener(this)
        Wearable.getMessageClient(appContext).removeListener(this)
        handler.removeCallbacks(freshnessTick)
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if(event.dataItem.uri.path==com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.PATH){
                val raw=if(event.type==DataEvent.TYPE_CHANGED)DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json") else null
                com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.accept(appContext,raw,event.dataItem.uri.host.orEmpty())
                continue
            }
            if (event.dataItem.uri.path != STATE_PATH) continue
            if (event.type == DataEvent.TYPE_CHANGED) {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val json = dataMap.getString(KEY_JSON)
                if (json != null) {
                    sawChangeSinceStart = true
                    accept(json, dataMap.getLong(KEY_TS, 0L), event.dataItem.uri.host)
                }
            } else if (event.type == DataEvent.TYPE_DELETED) {
                sawChangeSinceStart = true
                latestJson = ""; latestTs = 0
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(null)
                state.value = WearGameState.Disconnected
            }
        }
    }

    private fun parse(json: String, tsMs: Long): WearGameState =
        parseWearStateFresh(json, tsMs, com.studiogameslime.soccerapp.wear.activity.WearClockSync.calibration?.takeIf { it.fresh(System.currentTimeMillis()) }?.offsetMs?.toLong())
}

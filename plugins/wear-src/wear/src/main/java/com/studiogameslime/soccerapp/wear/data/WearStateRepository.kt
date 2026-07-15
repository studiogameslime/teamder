package com.studiogameslime.soccerapp.wear.data

import android.content.Context
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
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
    DataClient.OnDataChangedListener {

    val state: MutableState<WearGameState> = mutableStateOf(WearGameState.Loading)

    private val dataClient: DataClient by lazy { Wearable.getDataClient(appContext) }

    /** Reset each start(); set when onDataChanged delivers a fresh item. Guards
     *  the resume-fetch downgrade below against the add-between-fetch-and-event
     *  race (don't clobber a Live that onDataChanged just delivered). */
    @Volatile
    private var sawChangeSinceStart = false

    fun start() {
        sawChangeSinceStart = false
        dataClient.addListener(this)
        dataClient.dataItems.addOnSuccessListener { buffer ->
            try {
                var found = false
                for (item in buffer) {
                    if (item.uri.path == STATE_PATH) {
                        val dataMap = DataMapItem.fromDataItem(item).dataMap
                        val json = dataMap.getString(KEY_JSON)
                        if (json != null) {
                            state.value = parse(json, dataMap.getLong(KEY_TS, 0L))
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
                    state.value = WearGameState.Disconnected
                }
            } finally {
                buffer.release()
            }
        }.addOnFailureListener {
            if (state.value is WearGameState.Loading) {
                state.value = WearGameState.Disconnected
            }
        }
    }

    fun stop() {
        dataClient.removeListener(this)
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.dataItem.uri.path != STATE_PATH) continue
            if (event.type == DataEvent.TYPE_CHANGED) {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val json = dataMap.getString(KEY_JSON)
                if (json != null) {
                    sawChangeSinceStart = true
                    state.value = parse(json, dataMap.getLong(KEY_TS, 0L))
                }
            } else if (event.type == DataEvent.TYPE_DELETED) {
                state.value = WearGameState.Disconnected
            }
        }
    }

    private fun parse(json: String, tsMs: Long): WearGameState =
        parseWearStateFresh(json, tsMs)
}

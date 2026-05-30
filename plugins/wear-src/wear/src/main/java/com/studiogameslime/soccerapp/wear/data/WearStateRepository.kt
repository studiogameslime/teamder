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
import com.studiogameslime.soccerapp.wear.model.parseWearState

/** Data Layer path the phone publishes the current state to. */
private const val STATE_PATH = "/teamder/state"
private const val KEY_JSON = "json"

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

    fun start() {
        dataClient.addListener(this)
        dataClient.dataItems.addOnSuccessListener { buffer ->
            try {
                var found = false
                for (item in buffer) {
                    if (item.uri.path == STATE_PATH) {
                        val json = DataMapItem.fromDataItem(item).dataMap.getString(KEY_JSON)
                        if (json != null) {
                            state.value = parse(json)
                            found = true
                        }
                    }
                }
                if (!found) state.value = WearGameState.Disconnected
            } finally {
                buffer.release()
            }
        }.addOnFailureListener {
            state.value = WearGameState.Disconnected
        }
    }

    fun stop() {
        dataClient.removeListener(this)
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type == DataEvent.TYPE_CHANGED &&
                event.dataItem.uri.path == STATE_PATH
            ) {
                val json = DataMapItem.fromDataItem(event.dataItem).dataMap.getString(KEY_JSON)
                if (json != null) state.value = parse(json)
            }
        }
    }

    private fun parse(json: String): WearGameState = parseWearState(json)
}

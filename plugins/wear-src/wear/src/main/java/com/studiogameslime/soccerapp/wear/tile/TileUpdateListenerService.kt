package com.studiogameslime.soccerapp.wear.tile

import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import com.studiogameslime.soccerapp.wear.model.WearGameState
import com.studiogameslime.soccerapp.wear.model.parseWearStateFresh
import com.studiogameslime.soccerapp.wear.ongoing.LiveOngoingActivity

/**
 * Pushes a tile refresh whenever the phone publishes a new
 * `/teamder/state` payload — without it the tile would only refresh on
 * its declared freshness interval (60s+), and start/pause on the phone
 * would look frozen on the tile.
 *
 * Also drives the Ongoing Activity: while the payload is a LIVE match it
 * updates the ongoing-activity notification (watch-face indicator + recents
 * chip — a Wear App Quality requirement); once it's no longer live it clears
 * it. Runs even when the app isn't open, which is exactly when the ongoing
 * activity must still appear.
 */
class TileUpdateListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        super.onDataChanged(events)
        var refresh = false
        var latestJson: String? = null
        var latestTs = 0L
        var deleted = false
        for (event in events) {
            if (event.dataItem.uri.path != STATE_PATH) continue
            if (event.type == DataEvent.TYPE_CHANGED) {
                refresh = true
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                latestJson = dataMap.getString(KEY_JSON)
                latestTs = dataMap.getLong(KEY_TS, 0L)
            } else if (event.type == DataEvent.TYPE_DELETED) {
                deleted = true
            }
        }
        if (refresh) {
            TileService.getUpdater(applicationContext)
                .requestUpdate(TeamderTileService::class.java)
            latestJson?.let {
                // Fresh-parse (age out a stale LIVE payload if the Data Layer
                // redelivers a long-dead item on reconnect) so the ongoing
                // activity never resurrects a finished match's clock.
                LiveOngoingActivity.update(applicationContext, parseWearStateFresh(it, latestTs))
            }
        }
        // The state item was removed (session ended / signed out) → drop the
        // ongoing activity.
        if (deleted) {
            LiveOngoingActivity.update(applicationContext, WearGameState.Disconnected)
        }
    }

    companion object {
        private const val STATE_PATH = "/teamder/state"
        private const val KEY_JSON = "json"
        private const val KEY_TS = "ts"
    }
}

package com.studiogameslime.soccerapp.wear.tile

import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService

/**
 * Pushes a tile refresh whenever the phone publishes a new
 * `/teamder/state` payload — without it the tile would only refresh on
 * its declared freshness interval (60s+), and start/pause on the phone
 * would look frozen on the tile.
 *
 * The watch app's `WearStateRepository` listens independently for the
 * in-app screen; this service runs even when the app isn't open, which
 * is the whole point of a tile.
 */
class TileUpdateListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        super.onDataChanged(events)
        var refresh = false
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            if (event.dataItem.uri.path == STATE_PATH) {
                refresh = true
                break
            }
        }
        if (refresh) {
            TileService.getUpdater(applicationContext)
                .requestUpdate(TeamderTileService::class.java)
        }
    }

    companion object {
        private const val STATE_PATH = "/teamder/state"
    }
}

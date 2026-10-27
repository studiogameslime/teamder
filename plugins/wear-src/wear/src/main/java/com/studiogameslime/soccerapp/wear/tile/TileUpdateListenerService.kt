package com.studiogameslime.soccerapp.wear.tile

import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.MessageEvent
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
            val path = event.dataItem.uri.path.orEmpty()
            if(path==com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.PATH){
                val raw=if(event.type==DataEvent.TYPE_CHANGED)DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json") else null
                com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.accept(applicationContext,raw,event.dataItem.uri.host.orEmpty())
                continue
            }
            if(path.startsWith("/teamder/standalone-activity-ack/") && event.type==DataEvent.TYPE_CHANGED){
                val parts=path.split("/");val revision=parts.getOrNull(4)?.toLongOrNull()
                if(parts.size==5 && revision!=null)com.studiogameslime.soccerapp.wear.activity.ActivityJournal(applicationContext).acknowledgeStandalone(parts[3],revision,DataMapItem.fromDataItem(event.dataItem).dataMap)
                continue
            }
            if (path.startsWith("/teamder/activity-ack/") && event.type == DataEvent.TYPE_CHANGED) {
                val parts = path.split("/")
                val data = DataMapItem.fromDataItem(event.dataItem).dataMap
                val revision = parts.getOrNull(4)?.toLongOrNull()
                if (parts.size == 5 && revision != null && revision == data.getLong("revision", -1)) {
                    com.studiogameslime.soccerapp.wear.activity.ActivityJournal(applicationContext)
                        .acknowledge(parts[3], revision, data.getString("userId").orEmpty())
                }
                continue
            }
            if (path != STATE_PATH) continue
            if (event.type == DataEvent.TYPE_CHANGED) {
                refresh = true
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                latestJson = dataMap.getString(KEY_JSON)
                val owner = try { org.json.JSONObject(latestJson ?: "{}").optJSONObject("viewer")?.optString("id").orEmpty() } catch (_: Exception) { "" }
                applicationContext.getSharedPreferences("WearLastState", MODE_PRIVATE).edit()
                    .putString("json", latestJson).putLong("ts", dataMap.getLong(KEY_TS, 0L)).putString("node", event.dataItem.uri.host).apply()
                com.studiogameslime.soccerapp.wear.activity.WearClockSync.request(applicationContext, event.dataItem.uri.host.orEmpty(), owner)
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(latestJson)
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal(applicationContext).publish()
                latestTs = dataMap.getLong(KEY_TS, 0L)
            } else if (event.type == DataEvent.TYPE_DELETED) {
                deleted = true
                com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(null)
            }
        }
        if (refresh) {
            TileService.getUpdater(applicationContext)
                .requestUpdate(TeamderTileService::class.java)
            latestJson?.let {
                // Fresh-parse (age out a stale LIVE payload if the Data Layer
                // redelivers a long-dead item on reconnect) so the ongoing
                // activity never resurrects a finished match's clock.
                LiveOngoingActivity.update(applicationContext, parseWearStateFresh(it, latestTs, com.studiogameslime.soccerapp.wear.activity.WearClockSync.calibration?.takeIf { anchor -> anchor.fresh(System.currentTimeMillis()) }?.offsetMs?.toLong()))
            }
        }
        // The state item was removed (session ended / signed out) → drop the
        // ongoing activity AND re-render the tile to its placeholder immediately
        // (otherwise the stale live/upcoming card lingers up to the freshness
        // interval — ~5 min for an idle tile).
        if (deleted) {
            TileService.getUpdater(applicationContext)
                .requestUpdate(TeamderTileService::class.java)
            LiveOngoingActivity.update(applicationContext, WearGameState.Disconnected)
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/teamder/clock-result") return
        val prefs = applicationContext.getSharedPreferences("WearLastState", MODE_PRIVATE)
        if (event.sourceNodeId != prefs.getString("node", null)) return
        com.studiogameslime.soccerapp.wear.activity.WearClockSync.accept(applicationContext, String(event.data, Charsets.UTF_8))
        val json = prefs.getString("json", null) ?: return
        com.studiogameslime.soccerapp.wear.activity.ActivityJournal.authorizePayload(json)
        com.studiogameslime.soccerapp.wear.activity.ActivityJournal(applicationContext).publish()
        val clock = com.studiogameslime.soccerapp.wear.activity.WearClockSync.calibration?.takeIf { it.fresh(System.currentTimeMillis()) }
        LiveOngoingActivity.update(applicationContext, parseWearStateFresh(json, prefs.getLong("ts", 0), clock?.offsetMs?.toLong()))
        TileService.getUpdater(applicationContext).requestUpdate(TeamderTileService::class.java)
    }

    companion object {
        private const val STATE_PATH = "/teamder/state"
        private const val KEY_JSON = "json"
        private const val KEY_TS = "ts"
    }
}

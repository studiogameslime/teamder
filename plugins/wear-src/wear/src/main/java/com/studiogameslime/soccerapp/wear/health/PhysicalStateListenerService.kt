package com.studiogameslime.soccerapp.wear.health

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import com.studiogameslime.soccerapp.wear.model.WearGameState
import com.studiogameslime.soccerapp.wear.model.parseWearState

/**
 * Drives [ExerciseRecorderService] off the phone's `/teamder/state` publishes —
 * even while the watch app is closed (Play Services starts a
 * WearableListenerService on a Data-Layer change).
 *
 *   • state == Live (with a gameId) → start recording (idempotent; the phone
 *     re-publishes a live match every ~60s, so this also RE-starts the recorder
 *     if the system killed it mid-match).
 *   • any other state / deletion    → stop recording (flush + send the session).
 *
 * We deliberately start on Live regardless of the timer's running flag: the
 * stopwatch pauses between mini-games, but the evening's totals (distance,
 * steps, calories) should span the whole session, breaks included. The match
 * END is "no longer Live"; a phone that dies without publishing a terminal
 * state is covered by the recorder's own 4h hard cap.
 *
 * The in-app [com.studiogameslime.soccerapp.wear.MainActivity] does the same
 * start/stop while it's open (and owns the one-time runtime-permission prompt) —
 * this service is the background belt-and-suspenders.
 */
class PhysicalStateListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.dataItem.uri.path != STATE_PATH) continue
            if (event.type == DataEvent.TYPE_DELETED) {
                ExerciseRecorderService.stop(this)
                continue
            }
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val json = try {
                DataMapItem.fromDataItem(event.dataItem).dataMap.getString(KEY_JSON)
            } catch (_: Exception) {
                null
            } ?: continue

            when (val state = parseWearState(json)) {
                is WearGameState.Live ->
                    if (state.gameId.isNotBlank()) {
                        ExerciseRecorderService.start(this, state.gameId)
                    }
                // Genuine terminal states → match over → flush + stop.
                is WearGameState.Upcoming,
                is WearGameState.Scheduled,
                WearGameState.NotRegistered ->
                    ExerciseRecorderService.stop(this)
                // Loading / Disconnected = "no data yet" (a malformed or transient
                // publish parses to Disconnected). Do NOT stop — that would flush a
                // partial session mid-match and the next live republish would
                // restart recording from zero. Mirror MainActivity. stop() is also
                // a no-op unless something is actually recording.
                else -> Unit
            }
        }
    }

    companion object {
        private const val STATE_PATH = "/teamder/state"
        private const val KEY_JSON = "json"
    }
}

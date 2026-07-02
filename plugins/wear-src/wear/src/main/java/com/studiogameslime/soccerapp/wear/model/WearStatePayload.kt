package com.studiogameslime.soccerapp.wear.model

import android.os.SystemClock
import org.json.JSONObject

/**
 * Parses the JSON payload the phone publishes at `/teamder/state` into a
 * [WearGameState]. Extracted here so BOTH the watch app
 * (`WearStateRepository`, real-time listener) AND the Tile / Complication
 * services share the exact same shape — adding a new state or a new field
 * only happens once.
 *
 * Defensive: a malformed payload degrades to [WearGameState.Disconnected]
 * rather than throwing — the tile must always render something.
 */
fun parseWearState(json: String): WearGameState = try {
    val o = JSONObject(json)
    when (o.optString("kind")) {
        "live" -> {
            // Defensive: a live payload without a timer object degrades to a
            // zeroed timer instead of throwing → Disconnected (which would
            // wrongly show the "no game" placeholder during a live game).
            val t = o.optJSONObject("timer") ?: JSONObject()
            WearGameState.Live(
                title = o.optString("title"),
                timer = TimerState(
                    running = t.optBoolean("running"),
                    lastStartedAt = t.optLong("lastStartedAt"),
                    accumulatedMs = t.optLong("accumulatedMs"),
                    // clockOffsetMs lives at the payload root, not inside timer.
                    clockOffsetMs = o.optLong("clockOffsetMs", 0L),
                    // Device-independent resolved elapsed + the watch's own
                    // monotonic receive anchor. -1 = old phone (legacy path).
                    baseElapsedMs = t.optLong("baseElapsedMs", -1L),
                    parseAnchorRealtimeMs = SystemClock.elapsedRealtime(),
                ),
                gameId = o.optString("gameId"),
            )
        }
        "upcoming" -> {
            val arr = o.optJSONArray("players")
            val players = buildList {
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        val p = arr.getJSONObject(i)
                        add(
                            WearPlayer(
                                name = p.optString("name"),
                                photoUrl = p.optString("photo"),
                                role = p.optString("role", "member"),
                            ),
                        )
                    }
                }
            }
            WearGameState.Upcoming(
                title = o.optString("title"),
                startsAtMs = o.optLong("startsAt"),
                fieldName = o.optString("fieldName"),
                city = o.optString("city"),
                playersCount = o.optInt("playersCount"),
                maxPlayers = o.optInt("maxPlayers"),
                players = players,
            )
        }
        "scheduled" -> WearGameState.Scheduled(
            title = o.optString("title"),
            registrationOpensAtMs = o.optLong("registrationOpensAt"),
            startsAtMs = o.optLong("startsAt"),
            fieldName = o.optString("fieldName"),
            city = o.optString("city"),
        )
        "notRegistered" -> WearGameState.NotRegistered
        else -> WearGameState.Disconnected
    }
} catch (_: Exception) {
    WearGameState.Disconnected
}

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
/** Freshness controls authority, not whether the last known match exists. */
fun parseWearStateFresh(json: String, tsMs: Long, watchServerOffsetMs: Long? = null): WearGameState {
    val state = parseWearState(json, watchServerOffsetMs)
    if (state is WearGameState.Live) {
        val phoneOffset = try { JSONObject(json).optLong("clockOffsetMs") } catch (_: Exception) { 0L }
        val age = if (watchServerOffsetMs != null) System.currentTimeMillis() + watchServerOffsetMs - (tsMs + phoneOffset)
            else System.currentTimeMillis() - tsMs
        // Keep the last known match visible; a missing phone is not a finished match.
        return state.copy(publishedAtMs = tsMs, stale = watchServerOffsetMs == null || tsMs <= 0 || age < -60_000 || age > 90_000,
            canControl = state.canControl && watchServerOffsetMs != null && tsMs > 0 && age in -60_000..90_000)
    }
    return state
}

fun parseWearState(json: String, watchServerOffsetMs: Long? = null): WearGameState = try {
    val o = JSONObject(json)
    when (o.optString("kind")) {
        "live" -> {
            // Defensive: a live payload without a timer object degrades to a
            // zeroed timer instead of throwing → Disconnected (which would
            // wrongly show the "no game" placeholder during a live game).
            val t = o.optJSONObject("timer") ?: JSONObject()
            val running = t.optBoolean("running")
            // clockOffsetMs + serverNowMs live at the payload ROOT, not inside timer.
            val clockOffsetMs = watchServerOffsetMs ?: o.optLong("clockOffsetMs", 0L)
            val serverNowMs = o.optLong("serverNowMs", 0L)
            val rawBase = t.optLong("baseElapsedMs", -1L)
            val accumulatedMs = t.optLong("accumulatedMs")
            val lastStartedAt = t.optLong("lastStartedAt")

            // ── The fix for the "timer stuck / reset to publish-time" bug ──
            // baseElapsedMs is frozen by the phone at the PUBLISH instant. Every
            // consumer that re-reads a persisted/cached payload (cold app open,
            // tile re-render, Data-Layer reconnect) must add the time that has
            // passed SINCE publish — otherwise it shows the publish-time value.
            // The watch's wall clock is Wear-synced to the phone; clockOffsetMs
            // corrects phone-local → server, so (wallClock + clockOffsetMs) is the
            // watch's estimate of server-now; minus serverNowMs = elapsed-since-
            // publish. We fold that into the base ONCE here, so all three surfaces
            // (app / tile / ongoing) inherit a base that is correct at parse time.
            val watchServerNow = System.currentTimeMillis() + clockOffsetMs
            val resolvedBase = when {
                running && watchServerOffsetMs == null -> if (rawBase >= 0L) rawBase else accumulatedMs
                !running ->
                    // Paused: whatever base we were given (or accumulated).
                    if (rawBase >= 0L) rawBase else accumulatedMs
                rawBase >= 0L ->
                    // Modern payload: fold elapsed-since-publish onto the frozen base.
                    rawBase + (if (serverNowMs > 0L) (watchServerNow - serverNowMs).coerceAtLeast(0L) else 0L)
                lastStartedAt > 0L ->
                    // Legacy payload (no baseElapsedMs): reconstruct from the server
                    // epoch the same way the phone screen does.
                    accumulatedMs + (watchServerNow - lastStartedAt).coerceAtLeast(0L)
                else -> accumulatedMs
            }

            WearGameState.Live(
                title = o.optString("title"),
                timer = TimerState(
                    running = running,
                    lastStartedAt = lastStartedAt,
                    accumulatedMs = accumulatedMs,
                    clockOffsetMs = clockOffsetMs,
                    // Now ALWAYS resolved (>= 0) and current as of parse time; the
                    // monotonic anchor carries it forward while this parse is alive.
                    baseElapsedMs = resolvedBase.coerceAtLeast(0L),
                    parseAnchorRealtimeMs = SystemClock.elapsedRealtime(),
                    clockReady = watchServerOffsetMs != null,
                ),
                gameId = o.optString("gameId"),
                canControl = o.optBoolean("canControl"),
                viewerId = o.optString("viewerId").ifBlank { o.optJSONObject("viewer")?.optString("id").orEmpty() },
                roundId = o.optString("timerRoundId"),
                sessionGeneration = o.optLong("sessionGeneration", -1L),
                players = parsePlayers(o),
                registration = o.optString("registration", "registered"),
            )
        }
        "upcoming" -> {
            val arr = o.optJSONArray("players")
            val players = buildList {
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        val p = arr.optJSONObject(i) ?: continue
                        add(
                            WearPlayer(
                                name = p.optString("name"),
                                photoUrl = p.optString("photo"),
                                role = p.optString("role", "member"),
                                id = p.optString("id"),
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
                registration = o.optString("registration", "registered"),
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

private fun parsePlayers(o: JSONObject): List<WearPlayer> = buildList {
    val rows = o.optJSONArray("players") ?: return@buildList
    for (i in 0 until rows.length()) {
        val row = rows.optJSONObject(i) ?: continue
        val name = row.optString("name")
        if (name.isBlank()) continue
        add(WearPlayer(name, row.optString("photo"), row.optString("role", "member"), row.optString("id")))
    }
}

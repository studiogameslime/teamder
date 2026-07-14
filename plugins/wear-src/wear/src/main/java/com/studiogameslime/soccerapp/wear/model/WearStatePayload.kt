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
/** ms after which a persisted LIVE payload is treated as a dead phone — the
 *  match is surely over and the phone was killed without ever publishing a
 *  terminal state. Only LIVE ages out; upcoming/scheduled are valid for hours.
 *  The phone re-publishes a live match every ~60s, so a genuinely-live payload
 *  is never anywhere near this old. */
private const val LIVE_STALE_MS = 3L * 60L * 60L * 1000L // 3h

/**
 * Like [parseWearState] but ages out a STALE live payload using the phone's
 * publish timestamp (Data Layer "ts" key — the phone's wall clock, which Wear OS
 * keeps in sync with the watch's). Without this the watch shows a forever-
 * counting timer for a match whose phone died mid-game. `tsMs <= 0` (no ts)
 * keeps the payload as-is.
 */
fun parseWearStateFresh(json: String, tsMs: Long): WearGameState {
    val state = parseWearState(json)
    if (
        state is WearGameState.Live &&
        tsMs > 0L &&
        System.currentTimeMillis() - tsMs > LIVE_STALE_MS
    ) {
        return WearGameState.Disconnected
    }
    return state
}

fun parseWearState(json: String): WearGameState = try {
    val o = JSONObject(json)
    when (o.optString("kind")) {
        "live" -> {
            // Defensive: a live payload without a timer object degrades to a
            // zeroed timer instead of throwing → Disconnected (which would
            // wrongly show the "no game" placeholder during a live game).
            val t = o.optJSONObject("timer") ?: JSONObject()
            val running = t.optBoolean("running")
            // clockOffsetMs + serverNowMs live at the payload ROOT, not inside timer.
            val clockOffsetMs = o.optLong("clockOffsetMs", 0L)
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
                ),
                gameId = o.optString("gameId"),
                canControl = o.optBoolean("canControl"),
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

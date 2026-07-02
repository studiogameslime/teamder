package com.studiogameslime.soccerapp.wear.model

/**
 * The live-match timer, mirrored from the phone. These are the SAME three
 * primitives stored on the game's `liveMatch` in Firestore that every
 * phone listens to; the watch recomputes the displayed time locally from
 * them + the wall clock, so it shows the identical stopwatch.
 */
data class TimerState(
    val running: Boolean,
    val lastStartedAt: Long, // epoch ms (SERVER time); 0 when never started — LEGACY
    val accumulatedMs: Long,
    /** serverNow - localNow (ms) measured on the PHONE. LEGACY/fallback only —
     *  it corrects the phone's clock, not the watch's, so it can't be trusted
     *  on the watch. Kept for old payloads that lack `baseElapsedMs`. */
    val clockOffsetMs: Long = 0L,
    /** Fully-resolved elapsed ms at the moment the phone PUBLISHED this payload,
     *  in NO device's clock base. -1 = absent (old phone → use the legacy path). */
    val baseElapsedMs: Long = -1L,
    /** The watch's OWN monotonic uptime (SystemClock.elapsedRealtime) captured
     *  when this payload was parsed/received. Displayed elapsed while running =
     *  baseElapsedMs + (elapsedRealtime() - parseAnchorRealtimeMs) — depends only
     *  on the watch's monotonic clock, immune to wall-clock skew vs the phone. */
    val parseAnchorRealtimeMs: Long = 0L,
)

/** One registered player, for the players-list drill-down. */
data class WearPlayer(
    val name: String,
    val photoUrl: String, // "" when the player has no photo → show initial
    val role: String,     // "admin" | "guest" | "member"
)

/**
 * What the watch shows, driven by the user's status (relayed from the
 * phone). Three "real" states map to the product spec, plus Loading and
 * Disconnected for when the phone hasn't sent anything yet.
 */
sealed interface WearGameState {
    /** Waiting for the first state from the phone. */
    object Loading : WearGameState

    /** Phone unreachable / app not running — nothing to show. */
    object Disconnected : WearGameState

    /** Registered to a game happening NOW → big stopwatch.
     *  `gameId` lets the watch send timer commands back to the phone (the
     *  watch is a control surface now, not just a mirror). Defaults to ""
     *  for demo/preview states, where commands are a no-op. */
    data class Live(
        val title: String,
        val timer: TimerState,
        val gameId: String = "",
    ) : WearGameState

    /** Registered to an UPCOMING game → next-game card + details, with a
     *  drill-down to the registered players. */
    data class Upcoming(
        val title: String,
        val startsAtMs: Long,
        val fieldName: String,
        val city: String,
        val playersCount: Int,
        val maxPlayers: Int,
        val players: List<WearPlayer>,
    ) : WearGameState

    /** Game visible to the viewer but registration hasn't opened yet
     *  (Game.status == 'scheduled'). UI shows
     *  "המשחק יפתח להרשמה ב{date}" — same message on Tile + phone widgets
     *  + watch app screen. */
    data class Scheduled(
        val title: String,
        val registrationOpensAtMs: Long,
        val startsAtMs: Long,
        val fieldName: String,
        val city: String,
    ) : WearGameState

    /** Not registered to any game → prompt + "create from phone". */
    object NotRegistered : WearGameState
}

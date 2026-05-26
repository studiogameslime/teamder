package com.studiogameslime.soccerapp.wear.model

/**
 * The live-match timer, mirrored from the phone. These are the SAME three
 * primitives stored on the game's `liveMatch` in Firestore that every
 * phone listens to; the watch recomputes the displayed time locally from
 * them + the wall clock, so it shows the identical stopwatch.
 */
data class TimerState(
    val running: Boolean,
    val lastStartedAt: Long, // epoch ms; 0 when never started
    val accumulatedMs: Long,
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

    /** Registered to a game happening NOW → big stopwatch. */
    data class Live(
        val title: String,
        val timer: TimerState,
    ) : WearGameState

    /** Registered to an UPCOMING game → next-game card + details. */
    data class Upcoming(
        val title: String,
        val startsAtMs: Long,
        val fieldName: String,
        val city: String,
        val playersCount: Int,
        val maxPlayers: Int,
    ) : WearGameState

    /** Not registered to any game → prompt + "create from phone". */
    object NotRegistered : WearGameState
}

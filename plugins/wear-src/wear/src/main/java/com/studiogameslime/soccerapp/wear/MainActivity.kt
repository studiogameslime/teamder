package com.studiogameslime.soccerapp.wear

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.studiogameslime.soccerapp.wear.data.WearStateRepository
import com.studiogameslime.soccerapp.wear.model.TimerState
import com.studiogameslime.soccerapp.wear.model.WearGameState
import com.studiogameslime.soccerapp.wear.model.WearPlayer
import com.studiogameslime.soccerapp.wear.ui.WearApp

/**
 * Entry point for the Wear OS app.
 *
 * Shows the live state relayed from the phone via [WearStateRepository].
 * Until the phone publishes anything (e.g. before pairing, or during dev),
 * the state is Disconnected/Loading — in that case we let a tap cycle
 * through the three demo states so the UI can be previewed on the watch.
 */
class MainActivity : ComponentActivity() {

    private lateinit var repo: WearStateRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repo = WearStateRepository(applicationContext)
        setContent {
            val real by repo.state
            var demo by remember { mutableIntStateOf(0) }
            val demoStates = remember { demoStates() }
            val useReal =
                real !is WearGameState.Disconnected && real !is WearGameState.Loading
            val shown = if (useReal) real else demoStates[demo % demoStates.size]
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clickable(enabled = !useReal) { demo++ },
            ) {
                WearApp(
                    state = shown,
                    onCreateOnPhone = ::openCreateOnPhone,
                )
            }
        }
    }

    /**
     * Opens the Teamder app on the paired phone via the `teamder://` deep
     * link (the phone's MainActivity claims that scheme). This is the
     * "create game from phone" action — the user finishes creating on the
     * phone where the full wizard lives.
     */
    private fun openCreateOnPhone() {
        try {
            val intent = Intent(Intent.ACTION_VIEW)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setData(Uri.parse("teamder://create"))
            RemoteActivityHelper(this).startRemoteActivity(intent)
        } catch (e: Exception) {
            // best-effort — nothing else to do on the watch if it fails
        }
    }

    override fun onResume() {
        super.onResume()
        repo.start()
    }

    override fun onPause() {
        super.onPause()
        repo.stop()
    }
}

private fun demoStates(): List<WearGameState> = listOf(
    // 1. Live — game running, big stopwatch.
    WearGameState.Live(
        title = "חמישי כדורגל",
        timer = TimerState(
            running = true,
            // ~12 minutes in — a clear elapsed time for the store screenshot.
            lastStartedAt = System.currentTimeMillis() - 728_000L,
            accumulatedMs = 0L,
        ),
    ),
    // 2. Live — paused (e.g. half-time). Same elapsed, but frozen.
    WearGameState.Live(
        title = "חמישי כדורגל",
        timer = TimerState(
            running = false,
            lastStartedAt = 0L,
            // 45 minutes locked in.
            accumulatedMs = 2_700_000L,
        ),
    ),
    // 3. Upcoming — registered, game ahead. Drill-down to players.
    WearGameState.Upcoming(
        title = "חמישי כדורגל",
        startsAtMs = System.currentTimeMillis() + 3 * 3_600_000L,
        fieldName = "המגרש הקבוע",
        city = "תל אביב",
        playersCount = 8,
        maxPlayers = 10,
        players = listOf(
            WearPlayer("דניאל", "https://i.pravatar.cc/150?img=12", "admin"),
            WearPlayer("יוסי", "https://i.pravatar.cc/150?img=33", "member"),
            WearPlayer("אורי", "", "member"),
            WearPlayer("נועם", "https://i.pravatar.cc/150?img=51", "member"),
            WearPlayer("איתי", "", "guest"),
            WearPlayer("רון", "https://i.pravatar.cc/150?img=68", "member"),
            WearPlayer("גיא", "", "member"),
            WearPlayer("עומר", "https://i.pravatar.cc/150?img=14", "guest"),
        ),
    ),
    // 4. Scheduled — registration opens later. Date string.
    WearGameState.Scheduled(
        title = "חמישי כדורגל",
        // Opens tomorrow noon.
        registrationOpensAtMs = System.currentTimeMillis() + 24 * 3_600_000L,
        startsAtMs = System.currentTimeMillis() + 7 * 24 * 3_600_000L,
        fieldName = "המגרש הקבוע",
        city = "תל אביב",
    ),
    // 5. NotRegistered — empty state + "create on phone".
    WearGameState.NotRegistered,
)

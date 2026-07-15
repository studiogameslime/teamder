package com.studiogameslime.soccerapp.wear

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.studiogameslime.soccerapp.wear.data.WearCommandSender
import com.studiogameslime.soccerapp.wear.data.WearStateRepository
import com.studiogameslime.soccerapp.wear.health.ExerciseRecorderService
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
        // Ask once for the permissions the app needs:
        //   • POST_NOTIFICATIONS — the live-match Ongoing Activity (watch-face
        //     indicator + recents chip) + the recorder's foreground notification.
        //   • BODY_SENSORS / ACTIVITY_RECOGNITION — Health Services match
        //     recording (heart-rate / steps / step-derived distance / calories).
        //     NORMAL sensor runtime permissions, NOT the android.permission.health.*
        //     Health-Connect ones — no Play health gate. GPS is off, so no
        //     ACCESS_FINE_LOCATION and no Location-declaration gate either.
        val wanted = mutableListOf(
            android.Manifest.permission.BODY_SENSORS,
            android.Manifest.permission.ACTIVITY_RECOGNITION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            wanted += android.Manifest.permission.POST_NOTIFICATIONS
        }
        val toRequest = wanted.filter {
            checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (toRequest.isNotEmpty()) requestPermissions(toRequest.toTypedArray(), 1)
        repo = WearStateRepository(applicationContext)
        // Demo/preview states (tap to cycle) are DEBUG-ONLY. In a release build a
        // real un-paired user must see the genuine Disconnected/Loading screen —
        // NOT a fake running "חמישי כדורגל" match they can tap-cycle through.
        val debuggable =
            (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        setContent {
            val real by repo.state
            var demo by remember { mutableIntStateOf(0) }
            val demoStates = remember { demoStates() }
            val realReady =
                real !is WearGameState.Disconnected && real !is WearGameState.Loading
            // Show demo only in a debug build when there's no real state yet.
            val useReal = realReady || !debuggable
            val shown = if (useReal) real else demoStates[demo % demoStates.size]
            // Drive the Health Services recorder off the DISPLAYED state. In a
            // release build this is ALWAYS the real relayed state (useReal is
            // always true when !debuggable), so behaviour is unchanged in prod;
            // in a debug build it also lets the demo Live state exercise the
            // recorder, so the foreground-service is demonstrable on an emulator
            // with no paired phone (Play FGS-permissions video). Live → record;
            // a real non-live state → stop; Loading/Disconnected → leave as-is.
            LaunchedEffect(shown) {
                when (val s = shown) {
                    is WearGameState.Live ->
                        if (s.gameId.isNotBlank()) {
                            ExerciseRecorderService.start(applicationContext, s.gameId)
                        }
                    is WearGameState.Upcoming,
                    is WearGameState.Scheduled,
                    WearGameState.NotRegistered ->
                        ExerciseRecorderService.stop(applicationContext)
                    else -> Unit // Loading / Disconnected → leave as-is
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clickable(enabled = debuggable && !useReal) { demo++ },
            ) {
                WearApp(
                    state = shown,
                    onCreateOnPhone = ::openCreateOnPhone,
                    onTimerCommand = { action, gameId ->
                        WearCommandSender.sendTimerCommand(
                            applicationContext, action, gameId,
                        )
                    },
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
    // 1. Live — game running, big stopwatch. gameId set so the (debug-only)
    //    demo also drives the Health Services recorder → the FGS notification
    //    shows for the Play "Foreground service permissions" demo video.
    WearGameState.Live(
        title = "חמישי כדורגל",
        timer = TimerState(
            running = true,
            // ~12 minutes in — a clear elapsed time for the store screenshot.
            lastStartedAt = System.currentTimeMillis() - 728_000L,
            accumulatedMs = 0L,
        ),
        gameId = "DEMOGAME",
        canControl = true,
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

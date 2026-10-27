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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.studiogameslime.soccerapp.wear.data.WearCommandSender
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
    private var resumePersonalAfterPermission = false
    private var requestedActivitySource: com.studiogameslime.soccerapp.wear.activity.ActivitySourceBinding? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Ask once for notification permission so the live-match Ongoing Activity
        // (watch-face indicator + recents chip) can actually post on Wear OS 4+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
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
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clickable(enabled = debuggable && !useReal) { demo++ },
            ) {
                WearApp(
                    state = shown,
                    onCreateOnPhone = ::openCreateOnPhone,
                    onStartPersonalActivity = ::requestPersonalActivity,
                    onStopPersonalActivity = {
                        startService(Intent(this@MainActivity, com.studiogameslime.soccerapp.wear.activity.PersonalExerciseService::class.java).setAction("stop"))
                    },
                    onTimerCommand = { action, gameId ->
                        WearCommandSender.sendTimerCommand(
                            applicationContext, action, (shown as? WearGameState.Live) ?: return@WearApp,
                        )
                    },
                )
            }
        }
    }

    private fun requestPersonalActivity() {
        if (!SportsActivity.ENABLED) return
        val selected=com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.binding.value
        if(selected==null){
            com.studiogameslime.soccerapp.wear.activity.PersonalExerciseService.feedback.value="בחרו את השעון הזה כמקור הפעילות במסך הפעילות שלי בטלפון"
            return
        }
        requestedActivitySource=selected
        val hr = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else "android.permission.BODY_SENSORS"
        val missing = arrayOf("android.permission.ACTIVITY_RECOGNITION", hr).filter {
            checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            resumePersonalAfterPermission = true
            requestPermissions(missing.toTypedArray(), 2)
        } else startPersonalActivity()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 2 && resumePersonalAfterPermission) {
            resumePersonalAfterPermission = false
            if (checkSelfPermission("android.permission.ACTIVITY_RECOGNITION") == android.content.pm.PackageManager.PERMISSION_GRANTED) startPersonalActivity()
            else {
                requestedActivitySource=null
                com.studiogameslime.soccerapp.wear.activity.PersonalExerciseService.feedback.value = "נדרשת הרשאת פעילות גופנית למדידה. אפשר לשנות אותה בהגדרות השעון"
            }
        }
        if (requestCode == 1) com.studiogameslime.soccerapp.wear.ongoing.LiveOngoingActivity.update(this, repo.state.value)
    }

    private fun startPersonalActivity() {
        if (!SportsActivity.ENABLED) return
        val source=com.studiogameslime.soccerapp.wear.activity.StandaloneSourceStore.binding.value
        val expected=requestedActivitySource
        requestedActivitySource=null
        if(source==null || expected?.sameSource(source)!=true){
            com.studiogameslime.soccerapp.wear.activity.PersonalExerciseService.feedback.value="בחרו את השעון הזה כמקור הפעילות במסך הפעילות שלי בטלפון"
            return
        }
        try {
            androidx.core.content.ContextCompat.startForegroundService(this, Intent(this,
                com.studiogameslime.soccerapp.wear.activity.PersonalExerciseService::class.java).apply {
                putExtra("mode","standalone");putExtra("userId",source.userId);putExtra("phoneNodeId",source.phoneNodeId)
                putExtra("connectionId",source.connectionId);putExtra("sourceGeneration",source.sourceGeneration)
                putExtra("readerInstallationId",source.readerInstallationId);putExtra("deviceId",source.deviceId)
            })
        } catch (_: Exception) {
            com.studiogameslime.soccerapp.wear.activity.PersonalExerciseService.feedback.value = "לא ניתן להתחיל מדידה. בדקו הרשאות ואת גרסת השעון"
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
                .setData(Uri.parse("teamder://open/create-game"))
            RemoteActivityHelper(this).startRemoteActivity(intent)
        } catch (e: Exception) {
            // best-effort — nothing else to do on the watch if it fails
        }
    }

    override fun onResume() {
        super.onResume()
        repo.start()
        com.studiogameslime.soccerapp.wear.activity.ActivityJournal(applicationContext).publish()
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

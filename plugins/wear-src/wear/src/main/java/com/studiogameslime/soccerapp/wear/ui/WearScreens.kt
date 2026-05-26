package com.studiogameslime.soccerapp.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.LocalContentColor
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.TimeTextDefaults
import com.studiogameslime.soccerapp.wear.R
import com.studiogameslime.soccerapp.wear.model.TimerState
import com.studiogameslime.soccerapp.wear.model.WearGameState
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Teamder brand on the watch: WHITE background with the brand blue
// (#1E40AF, highly readable on white) for the timer + accents, and dark
// ink for primary text — matching the phone's blue-on-light look.
private val TeamderBlue = Color(0xFF1E40AF)
private val TeamderInk = Color(0xFF1F2A44)
private val TeamderWearColors = Colors(
    primary = TeamderBlue,
    onPrimary = Color.White,
    background = Color(0xFFF9FAFB),
    onBackground = TeamderInk,
    surface = Color.White,
    onSurface = TeamderInk,
)

/**
 * Root of the watch UI. Wraps every state in a Wear [Scaffold] (so the
 * time is always shown at the top) and routes to the matching screen.
 */
@Composable
fun WearApp(
    state: WearGameState,
    onCreateOnPhone: () -> Unit,
) {
    MaterialTheme(colors = TeamderWearColors) {
        // Wear's Scaffold doesn't paint the theme background, so the window
        // stays black by default. Draw the white brand background ourselves.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colors.background),
        ) {
        Scaffold(
            timeText = {
                TimeText(
                    timeTextStyle = TimeTextDefaults.timeTextStyle(color = TeamderInk),
                )
            },
        ) {
            CompositionLocalProvider(LocalContentColor provides TeamderInk) {
                when (state) {
                    is WearGameState.Loading -> CenteredMessage(loading = true, text = "טוען…")
                    is WearGameState.Disconnected ->
                        CenteredMessage(text = "פתח את האפליקציה בטלפון כדי לראות את המשחקים שלך")
                    is WearGameState.Live -> StopwatchScreen(state)
                    is WearGameState.Upcoming -> NextGameScreen(state)
                    is WearGameState.NotRegistered -> NotRegisteredScreen(onCreateOnPhone)
                }
            }
        }
        }
    }
}

// ─── State 1: live stopwatch ───────────────────────────────────────────
@Composable
private fun StopwatchScreen(state: WearGameState.Live) {
    val elapsed = rememberElapsedMs(state.timer)
    ScreenColumn {
        BrandLogo()
        Text(
            text = state.title,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.title3,
            maxLines = 2,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = formatStopwatch(elapsed),
            textAlign = TextAlign.Center,
            fontSize = 44.sp,
            style = MaterialTheme.typography.display1,
            color = MaterialTheme.colors.primary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = if (state.timer.running) "המשחק רץ" else "מושהה",
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.caption1,
            color = MaterialTheme.colors.primary,
        )
    }
}

// ─── State 2: upcoming game ────────────────────────────────────────────
@Composable
private fun NextGameScreen(state: WearGameState.Upcoming) {
    ScreenColumn {
        BrandLogo()
        Text(
            text = "המשחק הקרוב",
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.caption1,
            color = MaterialTheme.colors.primary,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = state.title,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.title3,
            maxLines = 2,
        )
        Spacer(Modifier.height(8.dp))
        DetailLine("מתי", formatWhen(state.startsAtMs))
        if (state.fieldName.isNotBlank()) DetailLine("מגרש", state.fieldName)
        if (state.city.isNotBlank()) DetailLine("עיר", state.city)
        DetailLine("שחקנים", "${state.playersCount}/${state.maxPlayers}")
    }
}

@Composable
private fun DetailLine(label: String, value: String) {
    Text(
        text = "$label: $value",
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.body2,
        modifier = Modifier.padding(vertical = 2.dp),
    )
}

// ─── State 3: not registered ───────────────────────────────────────────
@Composable
private fun NotRegisteredScreen(onCreateOnPhone: () -> Unit) {
    ScreenColumn {
        BrandLogo()
        Text(
            text = "עדיין לא נרשמת למשחק",
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.title3,
            maxLines = 3,
        )
        Spacer(Modifier.height(12.dp))
        Chip(
            onClick = onCreateOnPhone,
            label = {
                Text(
                    "צור משחק מהטלפון",
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            colors = ChipDefaults.primaryChipColors(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

// ─── Shared building blocks ────────────────────────────────────────────
/** The Teamder logo, gently pulsing — shown at the top of every screen
 *  (the same "breathing" feel as the phone splash). */
@Composable
private fun BrandLogo() {
    val transition = rememberInfiniteTransition(label = "logo")
    val scale by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.07f,
        animationSpec = infiniteRepeatable(
            animation = tween(1100, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "logoScale",
    )
    Image(
        painter = painterResource(R.drawable.teamder_logo),
        contentDescription = "Teamder",
        modifier = Modifier
            .size(34.dp)
            .scale(scale)
            .clip(CircleShape),
    )
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun ScreenColumn(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) { content() }
}

@Composable
private fun CenteredMessage(text: String, loading: Boolean = false) {
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BrandLogo()
        if (loading) {
            CircularProgressIndicator()
            Spacer(Modifier.height(10.dp))
        }
        Text(text = text, textAlign = TextAlign.Center, style = MaterialTheme.typography.body1)
    }
}

/**
 * Ticks the displayed elapsed time while the timer is running, recomputing
 * from the three relayed primitives + the wall clock — the exact same
 * formula the phone's `useSyncedTimer` uses, so the watch stays in lockstep.
 */
@Composable
private fun rememberElapsedMs(timer: TimerState): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(timer.running, timer.lastStartedAt, timer.accumulatedMs) {
        while (timer.running) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }
    return if (timer.running && timer.lastStartedAt > 0) {
        timer.accumulatedMs + (now - timer.lastStartedAt).coerceAtLeast(0)
    } else {
        timer.accumulatedMs
    }
}

private fun formatStopwatch(ms: Long): String {
    val totalSec = (ms / 1000).coerceAtLeast(0)
    return "%02d:%02d".format(totalSec / 60, totalSec % 60)
}

private fun formatWhen(epochMs: Long): String =
    SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(epochMs))

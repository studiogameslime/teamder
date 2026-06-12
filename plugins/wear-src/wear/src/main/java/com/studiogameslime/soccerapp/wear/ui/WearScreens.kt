package com.studiogameslime.soccerapp.wear.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.LocalContentColor
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.TimeTextDefaults
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import coil.compose.AsyncImage
import com.studiogameslime.soccerapp.wear.R
import com.studiogameslime.soccerapp.wear.model.TimerState
import com.studiogameslime.soccerapp.wear.model.WearGameState
import com.studiogameslime.soccerapp.wear.model.WearPlayer
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Teamder brand on the watch: BLACK background per the Wear OS app
// quality guideline ("backgrounds should be predominantly black/very
// dark to save battery on OLED displays and match the AOD"). Google
// rejected the white-background build (vc1004) and the policy team
// re-flagged it on the next submission too, so this is non-negotiable
// going forward.
//
// We keep the brand identity through:
//   • the lighter sky-blue (#60A5FA) for the timer + accent text —
//     #1E40AF (deep brand blue) is hard to read on black, but #60A5FA
//     still reads as "Teamder blue"
//   • the deep brand blue (#1E40AF) for small filled chips (admin
//     tag, first-letter avatar) where white text sits on top — those
//     pop nicely against black
//   • title / labels in near-white (#E2E8F0) — pure white can feel
//     harsh on AMOLED, slate-200 softens it without losing contrast
private val TeamderBlue = Color(0xFF1E40AF)        // deep brand — chip fills only
private val TeamderBlueOnDark = Color(0xFF60A5FA)  // sky-400 — readable on black
private val TeamderInk = Color(0xFFE2E8F0)         // slate-200 — soft white text
private val TeamderWearColors = Colors(
    primary = TeamderBlueOnDark,
    onPrimary = Color.Black,
    background = Color.Black,
    onBackground = TeamderInk,
    surface = Color.Black,
    onSurface = TeamderInk,
)

/**
 * Root of the watch UI. Paints the brand background and routes to the
 * matching screen. Each screen builds its own [Scaffold] so scrollable
 * screens get a [PositionIndicator] (scrollbar) tied to their own list
 * state — required by the Wear OS app-quality guidelines.
 */
@Composable
fun WearApp(
    state: WearGameState,
    onCreateOnPhone: () -> Unit,
    onTimerCommand: (action: String, gameId: String) -> Unit = { _, _ -> },
) {
    MaterialTheme(colors = TeamderWearColors) {
        // Wear's Scaffold doesn't paint the theme background, so the window
        // stays black by default. Draw the white brand background ourselves.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colors.background),
        ) {
            CompositionLocalProvider(
                LocalContentColor provides TeamderInk,
                // Hebrew-first app → lay rows/lists out right-to-left.
                LocalLayoutDirection provides LayoutDirection.Rtl,
            ) {
                when (state) {
                    is WearGameState.Loading ->
                        CenteredScaffold { CenteredContent(loading = true, text = "טוען…") }
                    is WearGameState.Disconnected ->
                        CenteredScaffold {
                            CenteredContent(
                                text = "פתח את האפליקציה בטלפון כדי לראות את המשחקים שלך",
                            )
                        }
                    is WearGameState.Live -> StopwatchScreen(state, onTimerCommand)
                    is WearGameState.Upcoming -> NextGameScreen(state)
                    is WearGameState.Scheduled ->
                        CenteredScaffold {
                            val whenStr = SimpleDateFormat("d.M HH:mm", Locale.getDefault())
                                .format(Date(state.registrationOpensAtMs))
                            CenteredContent(
                                text = "${state.title}\nיפתח להרשמה ב־$whenStr",
                            )
                        }
                    is WearGameState.NotRegistered -> NotRegisteredScreen(onCreateOnPhone)
                }
            }
        }
    }
}

// ─── State 1: live stopwatch (fits on screen → centered, no scroll) ─────
@Composable
private fun StopwatchScreen(
    state: WearGameState.Live,
    onTimerCommand: (action: String, gameId: String) -> Unit,
) {
    val elapsed = rememberElapsedMs(state.timer)
    // No BrandLogo here — on a round watch the logo + big time + status
    // pushed the control row off the bottom of the screen. The controls are
    // the whole point of the live screen, so we drop the logo and tighten the
    // layout to guarantee Play/Pause/Reset are always visible without scroll.
    CenteredScaffold {
        Text(
            text = state.title,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.caption1,
            color = TeamderInk,
            maxLines = 1,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = formatStopwatch(elapsed),
            textAlign = TextAlign.Center,
            fontSize = 40.sp,
            style = MaterialTheme.typography.display1,
            color = MaterialTheme.colors.primary,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = if (state.timer.running) "המשחק רץ" else "מושהה",
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.caption2,
            color = MaterialTheme.colors.primary,
        )
        // Control row — mirrors the phone widget's button logic exactly:
        //   running        → [Pause]
        //   paused w/ time  → [Play] [Reset]
        //   never started   → [Play]
        // Each tap sends a MessageClient command to the phone, which runs
        // the same Firestore mutation as the widget / in-app controls.
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.timer.running) {
                TimerButton(PauseIcon, "השהה") {
                    onTimerCommand("pause", state.gameId)
                }
            } else {
                TimerButton(Icons.Filled.PlayArrow, "הפעל") {
                    onTimerCommand("start", state.gameId)
                }
                if (elapsed > 0L) {
                    TimerButton(Icons.Filled.Refresh, "אפס") {
                        onTimerCommand("reset", state.gameId)
                    }
                }
            }
        }
    }
}

// Material's "Pause" glyph lives only in material-icons-EXTENDED (a huge
// dependency we don't want on a watch). PlayArrow + Refresh ship in
// material-icons-core, so we hand-roll just the two-bar pause here to keep
// the icon set consistent without the bloat.
private val PauseIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "Pause",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        path(fill = SolidColor(Color.White)) {
            // Left bar.
            moveTo(6f, 5f)
            horizontalLineToRelative(4f)
            verticalLineToRelative(14f)
            horizontalLineToRelative(-4f)
            close()
            // Right bar.
            moveTo(14f, 5f)
            horizontalLineToRelative(4f)
            verticalLineToRelative(14f)
            horizontalLineToRelative(-4f)
            close()
        }
    }.build()
}

/** Round control button for the watch stopwatch (play / pause / reset). */
@Composable
private fun TimerButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = Modifier.size(48.dp),
        colors = ButtonDefaults.primaryButtonColors(),
    ) {
        Icon(imageVector = icon, contentDescription = label)
    }
}

// ─── State 2: upcoming game ────────────────────────────────────────────
@Composable
private fun NextGameScreen(state: WearGameState.Upcoming) {
    // Local drill-down: the upcoming card flips to the registered-players
    // list when the user taps the chip, and back via the list's "חזרה".
    var showPlayers by remember { mutableStateOf(false) }
    if (showPlayers) {
        PlayersScreen(
            players = state.players,
            count = state.playersCount,
            max = state.maxPlayers,
            onBack = { showPlayers = false },
        )
        return
    }
    ScrollScreen {
        item { BrandLogo() }
        item {
            Text(
                text = "המשחק הקרוב",
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.caption1,
                color = MaterialTheme.colors.primary,
            )
        }
        item {
            Text(
                text = state.title,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.title3,
                maxLines = 2,
            )
        }
        item { Spacer(Modifier.height(4.dp)) }
        item { DetailLine("מתי", formatWhen(state.startsAtMs)) }
        if (state.fieldName.isNotBlank()) item { DetailLine("מגרש", state.fieldName) }
        if (state.city.isNotBlank()) item { DetailLine("עיר", state.city) }
        item { Spacer(Modifier.height(6.dp)) }
        item {
            Chip(
                onClick = { showPlayers = true },
                label = {
                    Text(
                        "רשימת שחקנים (${state.playersCount}/${state.maxPlayers})",
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// ─── State 2b: registered players (drill-down from the upcoming card) ───
@Composable
private fun PlayersScreen(
    players: List<WearPlayer>,
    count: Int,
    max: Int,
    onBack: () -> Unit,
) {
    ScrollScreen {
        item { BrandLogo() }
        item {
            Text(
                text = "שחקנים ($count/$max)",
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.title3,
                color = MaterialTheme.colors.primary,
            )
        }
        if (players.isEmpty()) {
            item {
                Text(
                    text = "אין עדיין שחקנים רשומים",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.body2,
                )
            }
        } else {
            items(players) { PlayerRow(it) }
        }
        item { Spacer(Modifier.height(4.dp)) }
        item {
            Chip(
                onClick = onBack,
                label = {
                    Text(
                        "חזרה",
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** One player row: avatar (photo, else initial) + name + role tag.
 *  Wrapped in a surface chip-like row; ScalingLazyColumn already insets
 *  items from the round display edge so nothing clips. */
@Composable
private fun PlayerRow(player: WearPlayer) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (player.photoUrl.isNotBlank()) {
            AsyncImage(
                model = player.photoUrl,
                contentDescription = player.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(30.dp)
                    .clip(CircleShape),
            )
        } else {
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(TeamderBlue),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = player.name.take(1),
                    color = Color.White,
                    style = MaterialTheme.typography.button,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = player.name,
            style = MaterialTheme.typography.body2,
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        RoleTag(player.role)
    }
}

/** Small pill marking a player's role; plain members get no tag. */
@Composable
private fun RoleTag(role: String) {
    val (label, color) = when (role) {
        "admin" -> "מנהל" to TeamderBlue
        "guest" -> "אורח" to Color(0xFF6B7280)
        else -> return
    }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color)
            .padding(horizontal = 7.dp, vertical = 2.dp),
    ) {
        Text(
            text = label,
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
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
    ScrollScreen {
        item { BrandLogo() }
        item {
            Text(
                text = "עדיין לא נרשמת למשחק",
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.title3,
                maxLines = 3,
            )
        }
        item { Spacer(Modifier.height(8.dp)) }
        item {
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
}

// ─── Shared building blocks ────────────────────────────────────────────
/**
 * Scrollable screen shell: a [ScalingLazyColumn] (which insets + scales
 * items away from the round display edge so nothing clips) inside a
 * [Scaffold] that shows the time, a curved [PositionIndicator] scrollbar,
 * and a top/bottom [Vignette]. The last two satisfy the Wear OS
 * app-quality guidelines (visible scrollbar + no edge clipping).
 */
@Composable
private fun ScrollScreen(content: ScalingLazyListScope.() -> Unit) {
    val listState = rememberScalingLazyListState()
    Scaffold(
        timeText = {
            TimeText(timeTextStyle = TimeTextDefaults.timeTextStyle(color = TeamderInk))
        },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            content = content,
        )
    }
}

/** Centered, non-scrolling screen shell (stopwatch / status messages). */
@Composable
private fun CenteredScaffold(content: @Composable ColumnScope.() -> Unit) {
    Scaffold(
        timeText = {
            TimeText(timeTextStyle = TimeTextDefaults.timeTextStyle(color = TeamderInk))
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 22.dp, vertical = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            content = content,
        )
    }
}

@Composable
private fun ColumnScope.CenteredContent(text: String, loading: Boolean = false) {
    BrandLogo()
    if (loading) {
        CircularProgressIndicator()
        Spacer(Modifier.height(10.dp))
    }
    Text(text = text, textAlign = TextAlign.Center, style = MaterialTheme.typography.body1)
}

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

/**
 * Ticks the displayed elapsed time while the timer is running, recomputing
 * from the three relayed primitives + the wall clock — the exact same
 * formula the phone's `useSyncedTimer` uses, so the watch stays in lockstep.
 */
@Composable
private fun rememberElapsedMs(timer: TimerState): Long {
    // Tick on server time (local clock + relayed offset) so the watch app
    // stays in lockstep with the phone even when the watch clock is skewed.
    var now by remember {
        mutableLongStateOf(System.currentTimeMillis() + timer.clockOffsetMs)
    }
    LaunchedEffect(timer.running, timer.lastStartedAt, timer.accumulatedMs) {
        while (timer.running) {
            now = System.currentTimeMillis() + timer.clockOffsetMs
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

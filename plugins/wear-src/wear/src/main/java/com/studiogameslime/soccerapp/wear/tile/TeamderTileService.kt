package com.studiogameslime.soccerapp.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.Box
import androidx.wear.protolayout.LayoutElementBuilders.Column
import androidx.wear.protolayout.LayoutElementBuilders.FontStyle
import androidx.wear.protolayout.LayoutElementBuilders.Image
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement
import androidx.wear.protolayout.LayoutElementBuilders.Spacer
import androidx.wear.protolayout.LayoutElementBuilders.Text
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.studiogameslime.soccerapp.wear.MainActivity
import com.studiogameslime.soccerapp.wear.R
import com.studiogameslime.soccerapp.wear.model.TimerState
import com.studiogameslime.soccerapp.wear.model.WearGameState
import com.studiogameslime.soccerapp.wear.model.parseWearState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Teamder Wear Tile — adaptive swipe-away surface that mirrors the
 * in-app state:
 *
 *   • [WearGameState.Live]      → big elapsed mm:ss + title + running/paused
 *   • [WearGameState.Upcoming]  → next-game card (title, relative time, field, players)
 *   • else                      → branded "no game" placeholder
 *
 * Reads from the SAME `/teamder/state` Data Layer item the watch app
 * consumes — written by the phone's `watchSyncService.publishWatchState`.
 * One source of truth feeds: phone widget, watch app screen, AND this
 * tile. Adding a new state means changing the JS payload + the parser
 * once.
 *
 * The tile does NOT tick second-by-second (Wear OS limits tile refresh
 * cadence to ~1 minute for battery). For live state we render the
 * elapsed value at request time; tap to open the app for the precise
 * ticking display. The companion [TileUpdateListenerService] requests a
 * re-render whenever the data item changes, so start/pause from any
 * paired device flips the tile within a couple of seconds.
 */
class TeamderTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        val state = loadCurrentState()
        val root = buildLayout(state)
        // While live, ask the system to refresh after a minute even if no
        // push comes — keeps the displayed minute count honest if the
        // listener service is killed. Idle/Upcoming refresh slower.
        val freshness =
            if (state is WearGameState.Live) RUNNING_FRESHNESS_MS else IDLE_FRESHNESS_MS

        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setTileTimeline(
                TimelineBuilders.Timeline.Builder()
                    .addTimelineEntry(
                        TimelineBuilders.TimelineEntry.Builder()
                            .setLayout(
                                LayoutElementBuilders.Layout.Builder()
                                    .setRoot(root)
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .setFreshnessIntervalMillis(freshness)
            .build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> {
        val resources = ResourceBuilders.Resources.Builder()
            .setVersion(RESOURCES_VERSION)
            .addIdToImageMapping(
                RES_LOGO,
                ResourceBuilders.ImageResource.Builder()
                    .setAndroidResourceByResId(
                        ResourceBuilders.AndroidImageResourceByResId.Builder()
                            .setResourceId(R.drawable.teamder_logo)
                            .build()
                    )
                    .build()
            )
            .build()
        return Futures.immediateFuture(resources)
    }

    // ── State load ────────────────────────────────────────────────────────

    /**
     * Synchronously read the latest `/teamder/state` data item and parse.
     * DataItems persist across phone-app restarts, so this returns the
     * last-known state even if the phone is currently offline.
     */
    private fun loadCurrentState(): WearGameState = try {
        val buffer = Tasks.await(
            Wearable.getDataClient(this).dataItems,
            DATA_TIMEOUT_S, TimeUnit.SECONDS,
        )
        var result: WearGameState = WearGameState.Disconnected
        try {
            for (i in 0 until buffer.count) {
                val item = buffer[i]
                if (item.uri.path == STATE_PATH) {
                    val json = DataMapItem.fromDataItem(item)
                        .dataMap.getString(KEY_JSON)
                    if (json != null) result = parseWearState(json)
                }
            }
        } finally {
            buffer.release()
        }
        result
    } catch (_: Exception) {
        WearGameState.Disconnected
    }

    // ── Layouts ───────────────────────────────────────────────────────────

    private fun buildLayout(state: WearGameState): LayoutElement = when (state) {
        is WearGameState.Live -> liveLayout(state)
        is WearGameState.Upcoming -> upcomingLayout(state)
        is WearGameState.Scheduled -> scheduledLayout(state)
        else -> placeholderLayout()
    }

    private fun scheduledLayout(s: WearGameState.Scheduled): LayoutElement {
        val whenLabel = formatOpenAt(s.registrationOpensAtMs)
        return cardBox(
            Column.Builder()
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .addContent(brandLogo(DP_LOGO_SMALL))
                .addContent(spacer(DP_4))
                .addContent(textLine(s.title, TEXT_SP_TITLE, true, COLOR_INK, 1))
                .addContent(spacer(DP_4))
                .addContent(textLine(SCHEDULED_LABEL, TEXT_SP_LINE, false, COLOR_INK_SOFT, 2))
                .addContent(spacer(DP_2))
                .addContent(textLine(whenLabel, TEXT_SP_BLUE_LABEL, true, COLOR_BLUE, 1))
                .build()
        )
    }

    /** "d.M HH:mm" in the device locale — kept compact for the tile's
     *  round face. e.g. "1.6 19:00". */
    private fun formatOpenAt(ms: Long): String {
        if (ms <= 0) return ""
        return SimpleDateFormat("d.M HH:mm", Locale.getDefault())
            .format(Date(ms))
    }

    private fun liveLayout(s: WearGameState.Live): LayoutElement {
        val elapsed = computeElapsedMs(s.timer)
        val timerColor = if (s.timer.running) COLOR_BLUE else COLOR_INK
        val statusText = if (s.timer.running) STATUS_RUNNING else STATUS_PAUSED

        return cardBox(
            Column.Builder()
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .addContent(brandLogo(DP_LOGO_SMALL))
                .addContent(spacer(DP_4))
                .addContent(textLine(s.title, TEXT_SP_TITLE, true, COLOR_INK, 1))
                .addContent(spacer(DP_4))
                .addContent(textLine(formatMmSs(elapsed), TEXT_SP_TIMER, true, timerColor, 1))
                .addContent(spacer(DP_4))
                .addContent(textLine(statusText, TEXT_SP_STATUS, false, COLOR_BLUE, 1))
                .build()
        )
    }

    private fun upcomingLayout(s: WearGameState.Upcoming): LayoutElement {
        val place = s.fieldName.ifEmpty { s.city }.ifEmpty { "" }

        return cardBox(
            Column.Builder()
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .addContent(brandLogo(DP_LOGO_SMALL))
                .addContent(spacer(DP_4))
                .addContent(textLine(s.title, TEXT_SP_TITLE, true, COLOR_INK, 1))
                .addContent(spacer(DP_2))
                .addContent(textLine(relativeTime(s.startsAtMs), TEXT_SP_BLUE_LABEL, true, COLOR_BLUE, 1))
                .apply {
                    if (place.isNotEmpty()) {
                        addContent(spacer(DP_2))
                        addContent(textLine(place, TEXT_SP_LINE, false, COLOR_INK_SOFT, 1))
                    }
                }
                .addContent(spacer(DP_2))
                .addContent(
                    textLine(
                        "${s.playersCount}/${s.maxPlayers} שחקנים",
                        TEXT_SP_LINE, false, COLOR_INK_SOFT, 1,
                    )
                )
                .build()
        )
    }

    private fun placeholderLayout(): LayoutElement = cardBox(
        Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(brandLogo(DP_LOGO_LARGE))
            .addContent(spacer(DP_8))
            .addContent(textLine(PLACEHOLDER_TEXT, TEXT_SP_BODY, false, COLOR_INK_SOFT, 2))
            .build()
    )

    // ── Building blocks ───────────────────────────────────────────────────

    /**
     * Card container — paints the brand background and makes the whole
     * tile tap-to-open-app. Same gesture on every state so the user
     * doesn't have to learn where to tap.
     */
    private fun cardBox(inner: LayoutElement): LayoutElement =
        Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(COLOR_BG))
                            .build()
                    )
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId(CLICK_ID_OPEN)
                            .setOnClick(
                                ActionBuilders.LaunchAction.Builder()
                                    .setAndroidActivity(
                                        ActionBuilders.AndroidActivity.Builder()
                                            .setClassName(MainActivity::class.java.name)
                                            .setPackageName(packageName)
                                            .build()
                                    )
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .addContent(inner)
            .build()

    private fun brandLogo(sizeDp: Float): LayoutElement =
        Image.Builder()
            .setResourceId(RES_LOGO)
            .setWidth(dp(sizeDp))
            .setHeight(dp(sizeDp))
            .build()

    private fun spacer(heightDp: Float): LayoutElement =
        Spacer.Builder().setHeight(dp(heightDp)).build()

    private fun textLine(
        text: String,
        sizeSp: Float,
        bold: Boolean,
        color: Int,
        maxLines: Int,
    ): LayoutElement = Text.Builder()
        .setText(text)
        .setFontStyle(
            FontStyle.Builder()
                .setSize(sp(sizeSp))
                .setColor(argb(color))
                .apply {
                    if (bold) setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
                }
                .build()
        )
        .setMaxLines(maxLines)
        .build()

    // ── Formatting ────────────────────────────────────────────────────────

    /** Reconstruct the displayed elapsed using the same formula every
     *  device uses — phone, watch app, this tile — so they're identical. */
    private fun computeElapsedMs(t: TimerState): Long =
        if (t.running && t.lastStartedAt > 0) {
            // Compare against SERVER time (local clock + relayed offset) so
            // the tile matches the phone even if the watch clock is skewed.
            t.accumulatedMs +
                (System.currentTimeMillis() + t.clockOffsetMs - t.lastStartedAt)
        } else {
            t.accumulatedMs
        }

    private fun formatMmSs(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        return "%02d:%02d".format(total / 60, total % 60)
    }

    /** Human relative time for an upcoming game's startsAt. */
    private fun relativeTime(startsAtMs: Long): String {
        val diffMs = startsAtMs - System.currentTimeMillis()
        if (diffMs <= 0) return "עכשיו"
        val mins = diffMs / 60_000
        val hours = mins / 60
        val days = hours / 24
        return when {
            mins < 60 -> "בעוד $mins דק׳"
            hours < 24 -> "בעוד $hours שע׳"
            days < 7 -> "בעוד $days ימים"
            else -> SimpleDateFormat("dd/MM HH:mm", Locale.getDefault())
                .format(Date(startsAtMs))
        }
    }

    companion object {
        // Data layer
        private const val STATE_PATH = "/teamder/state"
        private const val KEY_JSON = "json"
        private const val DATA_TIMEOUT_S = 5L

        // Tile bookkeeping
        private const val RESOURCES_VERSION = "1"
        private const val RES_LOGO = "logo"
        private const val CLICK_ID_OPEN = "open_app"
        // Wear OS clamps refresh to ~60s; we still hint at 60s while live
        // so a stale tile self-refreshes if the listener service is killed.
        private val RUNNING_FRESHNESS_MS = TimeUnit.SECONDS.toMillis(60)
        // Safety net: if the push-driven TileUpdateListenerService refresh is
        // missed, the idle tile still self-corrects within 5 min instead of
        // looking frozen on a stale "no game" for a quarter hour.
        private val IDLE_FRESHNESS_MS = TimeUnit.MINUTES.toMillis(5)

        // Brand — matches WearScreens.kt (TeamderBlue / TeamderInk / white bg)
        private const val COLOR_BG = 0xFFF9FAFB.toInt()
        private const val COLOR_BLUE = 0xFF1E40AF.toInt()
        private const val COLOR_INK = 0xFF1F2A44.toInt()
        private const val COLOR_INK_SOFT = 0xFF64748B.toInt()

        // Dimensions
        private const val DP_2 = 2f
        private const val DP_4 = 4f
        private const val DP_8 = 8f
        private const val DP_LOGO_SMALL = 18f
        private const val DP_LOGO_LARGE = 42f

        // Type scale
        private const val TEXT_SP_TITLE = 14f
        private const val TEXT_SP_TIMER = 32f
        private const val TEXT_SP_STATUS = 11f
        private const val TEXT_SP_BLUE_LABEL = 13f
        private const val TEXT_SP_LINE = 11f
        private const val TEXT_SP_BODY = 12f

        // Hebrew strings (kept inline — the wear module has its own
        // strings.xml but the tile package is small enough to inline)
        private const val STATUS_RUNNING = "● רץ"
        private const val STATUS_PAUSED = "מושהה"
        private const val PLACEHOLDER_TEXT = "אין משחק רשום"
        private const val SCHEDULED_LABEL = "יפתח להרשמה ב־"
    }
}

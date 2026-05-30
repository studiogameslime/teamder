package com.studiogameslime.soccerapp.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import com.studiogameslime.soccerapp.R
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Phone home-screen widget — adaptive surface that mirrors the watch
 * Tile and the in-app live screen:
 *
 *   • live      → ticking elapsed timer + tappable play/pause/reset
 *                  buttons (each natively mutates Firestore via
 *                  [TimerActionReceiver]) + "מופעל ע״י X" hint when
 *                  someone else is controlling the clock
 *   • upcoming  → next-game card (title + relative time + field + players)
 *   • else      → branded "no game" placeholder
 *
 * Reads the same payload the watch app + tile consume — written by
 * `watchSyncService.publishWatchState` via the bridge module's
 * SharedPreferences side-effect. One source of truth feeds three
 * surfaces; adding a state means changing the JS payload once.
 *
 * Live-timer ticking: we use Chronometer (a RemoteViews-supported view
 * that ticks itself in the launcher process). We translate the phone's
 * epoch `lastStartedAt` into a SystemClock-relative `base`, so the
 * widget ticks on its own — we don't need a per-second update from the
 * app. Updates are pushed on transitions (start/pause/resume/finish)
 * by [requestRefresh], called from `WatchBridgeModule.publishState`
 * AND from [TimerActionReceiver] after each button-driven mutation.
 */
class TeamderWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        manager: AppWidgetManager,
        ids: IntArray,
    ) {
        val views = buildViews(context)
        for (id in ids) manager.updateAppWidget(id, views)
    }

    private fun buildViews(context: Context): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_teamder)

        // Default: tapping the TITLE / TIMER / TEXT areas opens the app.
        // We deliberately do NOT setOnClickPendingIntent on widget_root —
        // Samsung One UI's launcher swallows child button clicks when the
        // root container has a pending intent, even though stock Android
        // routes child clicks correctly. Wiring the launchPi onto each
        // text view individually keeps the "tap anywhere to open" feel
        // while leaving the button area free for the per-button intents
        // set below.
        val launchIntent = Intent().apply {
            component = ComponentName(context.packageName, MAIN_ACTIVITY_NAME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val launchPi = PendingIntent.getActivity(
            context, REQ_LAUNCH, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        listOf(
            R.id.widget_title,
            R.id.widget_timer,
            R.id.widget_controller,
            R.id.widget_relative_time,
            R.id.widget_sub1,
            R.id.widget_sub2,
            R.id.widget_placeholder,
        ).forEach { id -> views.setOnClickPendingIntent(id, launchPi) }

        // Reset visibility — each renderer turns on only what it needs.
        listOf(
            R.id.widget_timer,
            R.id.widget_controller,
            R.id.widget_relative_time,
            R.id.widget_sub1,
            R.id.widget_sub2,
            R.id.widget_buttons,
            R.id.widget_btn_play,
            R.id.widget_btn_pause,
            R.id.widget_btn_reset,
            R.id.widget_placeholder,
        ).forEach { views.setViewVisibility(it, View.GONE) }

        val state = loadState(context)
        when (state?.optString("kind")) {
            "live" -> renderLive(context, views, state)
            "upcoming" -> renderUpcoming(views, state)
            "scheduled" -> renderScheduled(views, state)
            else -> renderPlaceholder(views)
        }
        return views
    }

    /**
     * Game is visible but registration hasn't opened yet. Shows the
     * title + a clear "יפתח להרשמה ב־{date}" line — reusing the
     * relative_time TextView so we don't bloat the layout.
     */
    private fun renderScheduled(views: RemoteViews, o: JSONObject) {
        views.setTextViewText(R.id.widget_title, o.optString("title"))

        val opensAt = o.optLong("registrationOpensAt")
        val when_ = formatOpenAt(opensAt)
        // sub1 carries the static label, relative_time the date in brand
        // blue — keeps the date as the strongest visual anchor.
        views.setTextViewText(R.id.widget_sub1, SCHEDULED_LABEL)
        views.setViewVisibility(R.id.widget_sub1, View.VISIBLE)
        views.setTextViewText(R.id.widget_relative_time, when_)
        views.setViewVisibility(R.id.widget_relative_time, View.VISIBLE)
    }

    // ── Per-state rendering ───────────────────────────────────────────────

    private fun renderLive(context: Context, views: RemoteViews, o: JSONObject) {
        views.setTextViewText(R.id.widget_title, o.optString("title"))

        val timer = o.optJSONObject("timer")
        val running = timer?.optBoolean("running") == true
        val lastStartedAt = timer?.optLong("lastStartedAt") ?: 0L
        val accumulatedMs = timer?.optLong("accumulatedMs") ?: 0L
        val gameId = o.optString("gameId")
        val controlledBy = o.optString("controlledBy")
        val controlledByName = o.optString("controlledByName")
        val viewer = o.optJSONObject("viewer")
        val viewerId = viewer?.optString("id") ?: ""
        val viewerName = viewer?.optString("name") ?: ""

        // Chronometer base — translate the server's epoch lastStartedAt
        // into a SystemClock-relative reference so the view ticks itself.
        val nowEpoch = System.currentTimeMillis()
        val elapsedNow = if (running && lastStartedAt > 0) {
            accumulatedMs + (nowEpoch - lastStartedAt)
        } else {
            accumulatedMs
        }
        val base = SystemClock.elapsedRealtime() - elapsedNow
        views.setChronometer(R.id.widget_timer, base, null, running)
        views.setViewVisibility(R.id.widget_timer, View.VISIBLE)

        // Controller hint — only shown when the OTHER admin is touching
        // the timer (so the user understands changes they didn't make).
        if (controlledBy.isNotEmpty() &&
            controlledBy != viewerId &&
            controlledByName.isNotEmpty()
        ) {
            views.setTextViewText(R.id.widget_controller, "מופעל ע״י $controlledByName")
            views.setViewVisibility(R.id.widget_controller, View.VISIBLE)
        }

        // Buttons — visible only when we have a gameId we can target.
        if (gameId.isNotEmpty()) {
            views.setViewVisibility(R.id.widget_buttons, View.VISIBLE)
            val started = running || accumulatedMs > 0L || lastStartedAt > 0L
            when {
                running -> {
                    // Running → just PAUSE.
                    views.setViewVisibility(R.id.widget_btn_pause, View.VISIBLE)
                    views.setOnClickPendingIntent(
                        R.id.widget_btn_pause,
                        actionPi(context, REQ_PAUSE, TimerActionReceiver.ACTION_PAUSE, gameId, viewerName),
                    )
                }
                started -> {
                    // Paused with elapsed time → PLAY (resume) + RESET.
                    views.setViewVisibility(R.id.widget_btn_play, View.VISIBLE)
                    views.setViewVisibility(R.id.widget_btn_reset, View.VISIBLE)
                    views.setOnClickPendingIntent(
                        R.id.widget_btn_play,
                        actionPi(context, REQ_PLAY, TimerActionReceiver.ACTION_START, gameId, viewerName),
                    )
                    views.setOnClickPendingIntent(
                        R.id.widget_btn_reset,
                        actionPi(context, REQ_RESET, TimerActionReceiver.ACTION_RESET, gameId, viewerName),
                    )
                }
                else -> {
                    // Fresh live (liveMatch exists but timer never started) → PLAY.
                    views.setViewVisibility(R.id.widget_btn_play, View.VISIBLE)
                    views.setOnClickPendingIntent(
                        R.id.widget_btn_play,
                        actionPi(context, REQ_PLAY, TimerActionReceiver.ACTION_START, gameId, viewerName),
                    )
                }
            }
        }
    }

    private fun renderUpcoming(views: RemoteViews, o: JSONObject) {
        views.setTextViewText(R.id.widget_title, o.optString("title"))

        views.setTextViewText(R.id.widget_relative_time, relativeTime(o.optLong("startsAt")))
        views.setViewVisibility(R.id.widget_relative_time, View.VISIBLE)

        val place = o.optString("fieldName").ifEmpty { o.optString("city") }
        if (place.isNotEmpty()) {
            views.setTextViewText(R.id.widget_sub1, place)
            views.setViewVisibility(R.id.widget_sub1, View.VISIBLE)
        }

        val pc = o.optInt("playersCount")
        val mp = o.optInt("maxPlayers")
        views.setTextViewText(R.id.widget_sub2, "$pc/$mp שחקנים")
        views.setViewVisibility(R.id.widget_sub2, View.VISIBLE)
    }

    private fun renderPlaceholder(views: RemoteViews) {
        views.setTextViewText(R.id.widget_title, BRAND)
        views.setTextViewText(R.id.widget_placeholder, PLACEHOLDER)
        views.setViewVisibility(R.id.widget_placeholder, View.VISIBLE)
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun actionPi(
        context: Context,
        requestCode: Int,
        action: String,
        gameId: String,
        userName: String,
    ): PendingIntent {
        // Explicit component → guaranteed routing to our receiver, no
        // ambiguity even if another package registered the same action.
        val intent = Intent(context, TimerActionReceiver::class.java).apply {
            this.action = action
            putExtra(TimerActionReceiver.EXTRA_ACTION, action)
            putExtra(TimerActionReceiver.EXTRA_GAME_ID, gameId)
            putExtra(TimerActionReceiver.EXTRA_USER_NAME, userName)
        }
        return PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun loadState(context: Context): JSONObject? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_JSON, null) ?: return null
        return try { JSONObject(json) } catch (_: Exception) { null }
    }

    private fun relativeTime(startsAtMs: Long): String {
        if (startsAtMs <= 0) return ""
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

    /** Absolute "d.M HH:mm" — used by the scheduled state where the
     *  user cares about the WHEN, not a relative countdown. */
    private fun formatOpenAt(ms: Long): String {
        if (ms <= 0) return ""
        return SimpleDateFormat("d.M HH:mm", Locale.getDefault())
            .format(Date(ms))
    }

    companion object {
        /** SharedPreferences keys — referenced by `WatchBridgeModule` and
         *  `TimerActionReceiver` so all three sides stay in lockstep. */
        const val PREFS = "TeamderWidgetState"
        const val KEY_JSON = "state_json"

        private const val MAIN_ACTIVITY_NAME = "com.studiogameslime.soccerapp.MainActivity"
        private const val BRAND = "Teamder"
        private const val PLACEHOLDER = "אין משחק רשום"
        private const val SCHEDULED_LABEL = "יפתח להרשמה ב־"

        // PendingIntent request codes — must be distinct per (widget,
        // button) pair, otherwise extras would clobber across instances.
        private const val REQ_LAUNCH = 1
        private const val REQ_PLAY = 2
        private const val REQ_PAUSE = 3
        private const val REQ_RESET = 4

        /**
         * Called by the bridge (on every state write) and by
         * [TimerActionReceiver] (after each button-driven mutation) to
         * push the latest payload into every placed widget instance.
         */
        fun requestRefresh(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(
                ComponentName(context, TeamderWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            val intent = Intent(context, TeamderWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }
    }
}

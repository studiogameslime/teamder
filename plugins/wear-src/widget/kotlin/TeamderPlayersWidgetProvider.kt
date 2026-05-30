package com.studiogameslime.soccerapp.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.studiogameslime.soccerapp.R
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Phone home-screen widget — players roster for the user's NEXT upcoming
 * game. Companion to [TeamderWidgetProvider] (the timer widget): both
 * read the same `TeamderWidgetState` SharedPreferences payload, just
 * project different slices of it.
 *
 * Scrollable list is backed by [PlayersRemoteViewsService] (the
 * RemoteViewsService pattern that AppWidgets use for true scrollable
 * adapters in the launcher process).
 *
 * States rendered:
 *   • upcoming   → header (count + title) + subtitle + scrolling roster
 *   • else       → placeholder ("אין משחק קרוב")
 */
class TeamderPlayersWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        manager: AppWidgetManager,
        ids: IntArray,
    ) {
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_players)

            // Whole widget tap → open the app.
            val launchIntent = Intent().apply {
                component = ComponentName(context.packageName, MAIN_ACTIVITY_NAME)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val launchPi = PendingIntent.getActivity(
                context, REQ_LAUNCH, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.players_root, launchPi)

            val state = loadState(context)
            when (state?.optString("kind")) {
                "upcoming" -> renderUpcoming(context, views, state, id)
                "scheduled" -> renderScheduled(views, state)
                else -> renderPlaceholder(views)
            }

            manager.updateAppWidget(id, views)
            // Tell the launcher to reload the adapter's items so the
            // RemoteViewsFactory's onDataSetChanged fires and the list
            // pulls the fresh roster from prefs.
            manager.notifyAppWidgetViewDataChanged(id, R.id.players_list)
        }
    }

    private fun renderUpcoming(
        context: Context,
        views: RemoteViews,
        o: JSONObject,
        widgetId: Int,
    ) {
        views.setViewVisibility(R.id.players_placeholder, View.GONE)
        views.setViewVisibility(R.id.players_list, View.VISIBLE)

        views.setTextViewText(R.id.players_title, o.optString("title"))

        val pc = o.optInt("playersCount")
        val mp = o.optInt("maxPlayers")
        views.setTextViewText(R.id.players_count, "$pc/$mp")

        val rel = relativeTime(o.optLong("startsAt"))
        val place = o.optString("fieldName").ifEmpty { o.optString("city") }
        val subtitle = listOf(rel, place).filter { it.isNotEmpty() }.joinToString(" · ")
        views.setTextViewText(R.id.players_subtitle, subtitle)

        // Bind the ListView to the RemoteViewsService. Each widget
        // instance gets its own intent (via setData with the widgetId)
        // so Android doesn't dedup adapters across instances.
        val svcIntent = Intent(context, PlayersRemoteViewsService::class.java).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
        views.setRemoteAdapter(R.id.players_list, svcIntent)
    }

    private fun renderPlaceholder(views: RemoteViews) {
        views.setTextViewText(R.id.players_title, BRAND)
        views.setTextViewText(R.id.players_count, "")
        views.setViewVisibility(R.id.players_count, View.GONE)
        views.setTextViewText(R.id.players_subtitle, "")
        views.setViewVisibility(R.id.players_list, View.GONE)
        views.setTextViewText(R.id.players_placeholder, PLACEHOLDER)
        views.setViewVisibility(R.id.players_placeholder, View.VISIBLE)
    }

    /**
     * Scheduled game — registration not yet open, so no roster to show.
     * Render the title + a clear "יפתח להרשמה ב{date}" message centered,
     * via the placeholder TextView. Hide the count chip and list.
     */
    private fun renderScheduled(views: RemoteViews, o: JSONObject) {
        views.setTextViewText(R.id.players_title, o.optString("title"))
        views.setTextViewText(R.id.players_count, "")
        views.setViewVisibility(R.id.players_count, View.GONE)

        // Tuck the kickoff context into the subtitle when we have it.
        val place = o.optString("fieldName").ifEmpty { o.optString("city") }
        views.setTextViewText(R.id.players_subtitle, place)

        views.setViewVisibility(R.id.players_list, View.GONE)

        val whenStr = formatOpenAt(o.optLong("registrationOpensAt"))
        views.setTextViewText(
            R.id.players_placeholder,
            if (whenStr.isNotEmpty()) "$SCHEDULED_LABEL$whenStr" else SCHEDULED_LABEL,
        )
        views.setViewVisibility(R.id.players_placeholder, View.VISIBLE)
    }

    /** Absolute "d.M HH:mm". */
    private fun formatOpenAt(ms: Long): String {
        if (ms <= 0) return ""
        return SimpleDateFormat("d.M HH:mm", Locale.getDefault())
            .format(Date(ms))
    }

    private fun loadState(context: Context): JSONObject? {
        val prefs = context.getSharedPreferences(
            TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE,
        )
        val json = prefs.getString(TeamderWidgetProvider.KEY_JSON, null) ?: return null
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

    companion object {
        private const val MAIN_ACTIVITY_NAME = "com.studiogameslime.soccerapp.MainActivity"
        private const val BRAND = "Teamder"
        private const val PLACEHOLDER = "אין משחק קרוב"
        private const val SCHEDULED_LABEL = "יפתח להרשמה ב־"
        private const val REQ_LAUNCH = 1001

        /** Called by the bridge fan-out and by anything else that
         *  changes the upstream payload — pushes APPWIDGET_UPDATE to
         *  every placed instance of this widget. */
        fun requestRefresh(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(
                ComponentName(context, TeamderPlayersWidgetProvider::class.java),
            )
            if (ids.isEmpty()) return
            val intent = Intent(context, TeamderPlayersWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }
    }
}

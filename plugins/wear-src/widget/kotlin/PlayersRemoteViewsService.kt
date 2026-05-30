package com.studiogameslime.soccerapp.widget

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.studiogameslime.soccerapp.R
import org.json.JSONObject

/**
 * RemoteViewsService backing the players-list widget's ListView. The
 * standard Android pattern for scrollable adapter views in a widget:
 *
 *   AppWidgetProvider.onUpdate
 *     → setRemoteAdapter(R.id.players_list, intent → this service)
 *     → notifyAppWidgetViewDataChanged(widgetId, R.id.players_list)
 *         → factory.onDataSetChanged() re-reads SharedPreferences
 *         → factory.getViewAt(i) builds each row
 *
 * Reads the same `TeamderWidgetState` SharedPreferences payload the
 * timer widget uses — projecting just the `players` array of the
 * `upcoming` state into rows.
 */
class PlayersRemoteViewsService : RemoteViewsService() {

    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        PlayersFactory(applicationContext)

    /** One row in the roster. */
    private data class Row(val name: String, val role: String)

    private class PlayersFactory(private val context: Context) : RemoteViewsFactory {
        private var rows: List<Row> = emptyList()

        override fun onCreate() = Unit

        override fun onDataSetChanged() {
            rows = loadRows()
        }

        override fun onDestroy() {
            rows = emptyList()
        }

        override fun getCount(): Int = rows.size

        override fun getViewAt(position: Int): RemoteViews {
            val row = rows.getOrNull(position) ?: return RemoteViews(
                context.packageName, R.layout.widget_player_item,
            )
            val views = RemoteViews(context.packageName, R.layout.widget_player_item)
            views.setTextViewText(R.id.player_name, row.name)

            val badge = when (row.role) {
                "admin" -> "מנהל"
                "guest" -> "אורח"
                else -> null
            }
            if (badge != null) {
                views.setTextViewText(R.id.player_role, badge)
                views.setViewVisibility(R.id.player_role, View.VISIBLE)
            } else {
                views.setViewVisibility(R.id.player_role, View.GONE)
            }
            return views
        }

        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount(): Int = 1
        override fun getItemId(position: Int): Long = position.toLong()
        override fun hasStableIds(): Boolean = true

        private fun loadRows(): List<Row> {
            val prefs = context.getSharedPreferences(
                TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE,
            )
            val json = prefs.getString(TeamderWidgetProvider.KEY_JSON, null) ?: return emptyList()
            return try {
                val o = JSONObject(json)
                if (o.optString("kind") != "upcoming") return emptyList()
                val arr = o.optJSONArray("players") ?: return emptyList()
                buildList {
                    for (i in 0 until arr.length()) {
                        val p = arr.getJSONObject(i)
                        add(
                            Row(
                                name = p.optString("name"),
                                role = p.optString("role", "member"),
                            ),
                        )
                    }
                }
            } catch (_: Exception) {
                emptyList()
            }
        }
    }
}

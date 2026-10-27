package com.studiogameslime.soccerapp.widget

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.*
import com.studiogameslime.soccerapp.R
import org.json.JSONObject

/** Real production RemoteViews and rows, hosted locally; no production account. */
class WidgetAuditActivity : Activity() {
    private val fixture = """{"viewer":{"id":"qa-owner","name":"מנהל הבדיקה"},"kind":"live","gameId":"qa-game","title":"מחזור בדיקה מנותק","timerRoundId":"plain:1","canControl":true,"registration":"organizer","clockOffsetMs":0,"timer":{"running":false,"lastStartedAt":0,"accumulatedMs":754000,"baseElapsedMs":754000},"playersCount":3,"maxPlayers":12,"fieldName":"מגרש הבדיקה","players":[{"id":"qa-owner","name":"מנהל הבדיקה","role":"admin"},{"id":"qa-one","name":"שחקן ראשון","role":"member"},{"id":"qa-guest","name":"אורח הבדיקה","role":"guest"}]}"""
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra("scene") ?: "before"
        val state = JSONObject(fixture).put("startsAt", System.currentTimeMillis() + 3600000).put("widgetUpdatedAtMs", System.currentTimeMillis())
        if (mode == "member") { state.put("canControl", false).put("viewer", JSONObject().put("id", "qa-one")); }
        WidgetStateStore.write(this, state)
        if (mode == "after") getSharedPreferences(TeamderWidgetProvider.PREFS, MODE_PRIVATE).edit()
            .putString("widgetResetArm", JSONObject().put("uid", "qa-owner").put("gameId", "qa-game").put("round", "plain:1").put("at", System.currentTimeMillis()).toString()).apply()
        else getSharedPreferences(TeamderWidgetProvider.PREFS, MODE_PRIVATE).edit().remove("widgetResetArm").apply()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(14), dp(40), dp(14), dp(20)); setBackgroundColor(0xffe9edf4.toInt()) }
        root.addView(TextView(this).apply { text = "בדיקת ווידגטים מנותקת מהשרת"; textSize = 16f; setTextColor(0xff1f2a44.toInt()); gravity = android.view.Gravity.CENTER })
        val timerMethod = TeamderWidgetProvider::class.java.getDeclaredMethod("buildViews", Context::class.java).apply { isAccessible = true }
        val timer = timerMethod.invoke(TeamderWidgetProvider(), this) as RemoteViews
        root.addView(timer.apply(this, root), LinearLayout.LayoutParams(-1, dp(235)).apply { topMargin = 16 })
        val roster = JSONObject(state.toString()).put("kind", "upcoming")
        val provider = TeamderPlayersWidgetProvider()
        val views = RemoteViews(packageName, R.layout.widget_players)
        TeamderPlayersWidgetProvider::class.java.getDeclaredMethod("renderPlaceholder", RemoteViews::class.java).apply { isAccessible = true }.invoke(provider, views)
        TeamderPlayersWidgetProvider::class.java.getDeclaredMethod("renderUpcoming", Context::class.java, RemoteViews::class.java, JSONObject::class.java, Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(provider, this, views, roster, 0)
        val rendered = views.apply(this, root)
        val list = rendered.findViewById<ListView>(R.id.players_list)
        list.adapter = object : BaseAdapter() {
            val rows = roster.getJSONArray("players")
            override fun getCount() = rows.length()
            override fun getItem(position: Int): Any = rows.getJSONObject(position)
            override fun getItemId(position: Int) = position.toLong()
            override fun getView(position: Int, convert: View?, parent: ViewGroup): View {
                val row = rows.getJSONObject(position)
                val remote = RemoteViews(packageName, R.layout.widget_player_item)
                remote.setTextViewText(R.id.player_name, row.getString("name"))
                remote.setViewVisibility(R.id.player_role, if (row.optString("role") == "member") View.GONE else View.VISIBLE)
                remote.setTextViewText(R.id.player_role, if (row.optString("role") == "admin") "מנהל" else "אורח")
                return remote.apply(this@WidgetAuditActivity, parent)
            }
        }
        root.addView(rendered, LinearLayout.LayoutParams(-1, dp(250)).apply { topMargin = 18 })
        setContentView(root)
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}

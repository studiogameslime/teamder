package com.studiogameslime.soccerapp.widget

import android.app.Instrumentation
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews
import android.view.View
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.google.firebase.messaging.RemoteMessage
import com.studiogameslime.soccerapp.R
import org.json.JSONObject

/** Isolated local-server fixtures through the real Android Worker/receiver/store path. */
class WidgetAuditInstrumentation : Instrumentation() {
    private var passed = 0
    private var cold = false
    private var activity = false
    override fun onCreate(arguments: Bundle?) { cold = arguments?.getString("stage") == "cold"; activity = arguments?.getString("stage") == "activity"; super.onCreate(arguments); start() }
    override fun onStart() {
        val context = targetContext
        fun test(name: String, body: () -> Unit) { body(); passed++; sendStatus(0, Bundle().apply { putString("stream", "PASS $name\n") }) }
        try {
            if (activity) {
                val total = ActivityUploadAudit.run(this, context)
                finish(0, Bundle().apply { putString("stream", "$total activity upload instrumentation tests passed\n") })
                return
            }
            val server = context.getSharedPreferences("WidgetAuditServer", Context.MODE_PRIVATE)
            val prefs = WidgetStateStore.prefs(context)
            if (cold) {
                check(prefs.getInt("qaPassed", 0) >= 10)
                check(WidgetStateStore.owner(WidgetStateStore.read(context)) == "qa-owner")
                val old = WidgetStateStore.read(context)!!.optLong("widgetUpdatedAtMs")
                WidgetRosterWorker.enqueue(context, null, "qa-owner", true)
                val deadline = System.currentTimeMillis() + 60_000
                while (System.currentTimeMillis() < deadline && WidgetStateStore.read(context)!!.optLong("widgetUpdatedAtMs") <= old) Thread.sleep(100)
                check(WidgetStateStore.read(context)!!.optLong("widgetUpdatedAtMs") > old)
                finish(0, Bundle().apply { putString("stream", "PASS persisted session and background refresh after process restart\n") })
                return
            }
            WorkManager.getInstance(context).cancelAllWork()
            Thread.sleep(250)
            server.edit().putString("uid", "qa-owner").putBoolean("fail", false).putBoolean("failMutation", false)
                .putBoolean("delayRead", false).putBoolean("reading", false).apply()
            prefs.edit().putLong("widgetSession", 10).remove("widgetPending").apply()
            prefs.edit().remove("qaPassed").apply()
            fun source(status: String = "open", live: Boolean = false, players: List<String> = listOf("qa-owner", "qa-one")): JSONObject =
                JSONObject().put("createdBy", "qa-owner").put("status", status).put("title", "מחזור בדיקה")
                    .put("startsAt", System.currentTimeMillis() + 3600000).put("maxPlayers", 12)
                    .put("players", org.json.JSONArray(players)).put("participantIds", org.json.JSONArray(players))
                    .put("guests", org.json.JSONArray().put(JSONObject().put("id", "guest").put("name", "אורח"))
                        .put(JSONObject().put("id", "wait").put("name", "אורח בהמתנה").put("waitlisted", true)))
                    .apply { if (live) put("liveMatch", JSONObject().put("phase", "live").put("roundNumber", 1)
                        .put("timerRunning", false).put("timerAccumulatedMs", 12000).put("scoreA", 0).put("scoreB", 0)) }
            fun seed(game: JSONObject) { server.edit().putString("games", JSONObject().put("qa-game", game).toString()).apply() }
            fun waitFor(name: String, condition: () -> Boolean) {
                val deadline = System.currentTimeMillis() + 60_000
                while (System.currentTimeMillis() < deadline) { if (condition()) return; Thread.sleep(100) }
                error("timeout: $name")
            }
            fun state() = WidgetStateStore.read(context) ?: error("missing state")
            fun finished(name: String): Boolean {
                // Reflection only avoids a compile-only Guava class omitted by this app's existing dependency resolution.
                val future = WorkManager::class.java.getMethod("getWorkInfosForUniqueWork", String::class.java)
                    .invoke(WorkManager.getInstance(context), name) as java.util.concurrent.Future<*>
                val infos = future.get(5, java.util.concurrent.TimeUnit.SECONDS) as List<*>
                return infos.all { it is WorkInfo && it.state.isFinished }
            }
            fun refresh() {
                val old = state().optLong("widgetUpdatedAtMs")
                WidgetRosterWorker.enqueue(context, "qa-game", "qa-owner", true)
                waitFor("refresh") { state().optLong("widgetUpdatedAtMs") > old }
                waitFor("refresh completion") { finished("widget-state:qa-owner") }
            }
            fun action(action: String, round: String = state().optString("timerRoundId")) {
                val intent = Intent().putExtra("action", action).putExtra("origin", "widget")
                    .putExtra("gameId", state().optString("gameId")).putExtra("viewerId", "qa-owner")
                    .putExtra("timerRoundId", round).putExtra("widgetSession", WidgetStateStore.generation(context))
                TimerActionReceiver().onReceive(context, intent)
            }
            fun waitAction() { waitFor("action") { WidgetStateStore.pending(context) == null && finished("widget-action:qa-owner:qa-game") } }
            WidgetStateStore.write(context, JSONObject().put("viewer", JSONObject().put("id", "qa-owner").put("name", "מנהל בדיקה"))
                .put("kind", "notRegistered").put("widgetProtocol", 2))
            seed(source())
            test("background worker populates roster while no app screen is open") {
                refresh(); check(state().optString("kind") == "upcoming" && state().optInt("playersCount") == 3)
                check(state().getJSONArray("players").getJSONObject(0).getString("name") == "מנהל הבדיקה")
            }
            test("the data-message handler dispatches a roster-only change") {
                seed(source(players = listOf("qa-owner", "qa-one", "qa-two")))
                val service = TeamderMessagingService()
                android.content.ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java)
                    .apply { isAccessible = true }.invoke(service, context)
                service.onMessageReceived(RemoteMessage.Builder("local-fixture").setData(mapOf("type" to "widgetRosterSync", "gameId" to "qa-game", "viewerId" to "qa-owner")).build())
                waitFor("FCM dispatch") { state().optInt("playersCount") == 4 }
            }
            test("actual collection service reloads rows from persisted roster") {
                val service = PlayersRemoteViewsService()
                android.content.ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java)
                    .apply { isAccessible = true }.invoke(service, context)
                val factory = service.onGetViewFactory(Intent())
                factory.onCreate(); factory.onDataSetChanged(); check(factory.count == 4)
                runOnMainSync {
                    val root = android.widget.FrameLayout(context)
                    val row = factory.getViewAt(0).apply(context, root)
                    check(row.findViewById<android.widget.TextView>(R.id.player_name).text == "מנהל הבדיקה")
                }
                factory.onDestroy()
            }
            test("transient failure preserves the real roster") {
                server.edit().putBoolean("fail", true).apply()
                WidgetRosterWorker.enqueue(context, "qa-game", "qa-owner", true)
                waitFor("error") { state().optString("widgetError").isNotEmpty() }
                check(state().optInt("playersCount") == 4)
                server.edit().putBoolean("fail", false).apply(); refresh()
            }
            test("ending the displayed evening selects the next one") {
                server.edit().putString("games", JSONObject().put("qa-game", source("finished"))
                    .put("qa-next", source().put("title", "המחזור הבא")).toString()).apply()
                refresh(); check(state().optString("gameId") == "qa-next")
            }
            test("a genuine empty result clears both widget states") {
                server.edit().putString("games", "{}").apply(); refresh()
                check(state().optString("kind") == "notRegistered" && !state().has("players"))
            }
            seed(source("active", true)); refresh()
            test("a late background response cannot restore the previous account") {
                server.edit().putBoolean("delayRead", true).apply()
                WidgetRosterWorker.enqueue(context, null, "qa-owner", true)
                waitFor("delayed read") { server.getBoolean("reading", false) }
                prefs.edit().putLong("widgetSession", WidgetStateStore.generation(context) + 1).apply()
                WidgetStateStore.write(context, JSONObject().put("viewer", JSONObject().put("id", "qa-other")).put("kind", "notRegistered"))
                waitFor("read returned") { !server.getBoolean("reading", false) }
                waitFor("old account work completed") { finished("widget-state:qa-owner") }
                check(WidgetStateStore.owner(state()) == "qa-other" && state().optString("kind") == "notRegistered")
                server.edit().putBoolean("delayRead", false).apply()
                prefs.edit().putLong("widgetSession", WidgetStateStore.generation(context) + 1).apply()
                WidgetStateStore.write(context, JSONObject().put("viewer", JSONObject().put("id", "qa-owner")).put("kind", "notRegistered"))
                refresh()
            }
            test("compact widget renders the timer and suppresses cramped controls") {
                runOnMainSync {
                    val method = TeamderWidgetProvider::class.java.getDeclaredMethod("buildViews", Context::class.java, Int::class.javaPrimitiveType).apply { isAccessible = true }
                    val remote = method.invoke(TeamderWidgetProvider(), context, 110) as RemoteViews
                    val view = remote.apply(context, android.widget.FrameLayout(context))
                    check(view.findViewById<View>(R.id.widget_timer).visibility == View.VISIBLE)
                    check(view.findViewById<View>(R.id.widget_buttons).visibility == View.GONE)
                    check(view.findViewById<android.widget.TextView>(R.id.widget_controller).text.toString().contains("הגדילו"))
                }
            }
            test("start uses the real durable command path") {
                action(TimerActionReceiver.ACTION_START); waitAction()
                check(JSONObject(server.getString("games", "{}")!!).getJSONObject("qa-game").getJSONObject("liveMatch").getBoolean("timerRunning"))
            }
            test("pause retains elapsed time and clears pending state") {
                action(TimerActionReceiver.ACTION_PAUSE); waitAction()
                val live = JSONObject(server.getString("games", "{}")!!).getJSONObject("qa-game").getJSONObject("liveMatch")
                check(!live.getBoolean("timerRunning") && live.getLong("timerAccumulatedMs") >= 12000)
            }
            test("reset first tap is non-destructive and second tap confirms") {
                val before = server.getString("games", "{}")
                action(TimerActionReceiver.ACTION_RESET)
                check(server.getString("games", "{}") == before && WidgetStateStore.armed(context, state()))
                action(TimerActionReceiver.ACTION_RESET); waitAction()
                val live = JSONObject(server.getString("games", "{}")!!).getJSONObject("qa-game").getJSONObject("liveMatch")
                check(live.getLong("timerAccumulatedMs") == 0L && live.has("lastWidgetCommandId"))
            }
            test("a failed action retains the timer and leaves visible feedback after refresh") {
                val before = server.getString("games", "{}")
                server.edit().putBoolean("failMutation", true).apply()
                action(TimerActionReceiver.ACTION_START); waitAction()
                server.edit().putBoolean("failMutation", false).apply()
                refresh()
                check(server.getString("games", "{}") == before && state().optString("widgetError").isNotBlank())
            }
            test("a stale round intent cannot mutate a new round") {
                val previous = state().getString("timerRoundId")
                val changed = source("active", true).apply { getJSONObject("liveMatch").put("roundNumber", 2) }
                seed(changed)
                action(TimerActionReceiver.ACTION_START, previous); waitAction()
                check(!JSONObject(server.getString("games", "{}")!!).getJSONObject("qa-game").getJSONObject("liveMatch").getBoolean("timerRunning"))
            }
            refresh()
            test("non-controller cannot issue a widget action") {
                val current = state().put("canControl", false); WidgetStateStore.write(context, current)
                val before = server.getString("games", "{}")
                action(TimerActionReceiver.ACTION_START)
                check(WidgetStateStore.pending(context) == null && server.getString("games", "{}") == before)
                runOnMainSync {
                    val method = TeamderWidgetProvider::class.java.getDeclaredMethod("buildViews", Context::class.java).apply { isAccessible = true }
                    val view = (method.invoke(TeamderWidgetProvider(), context) as RemoteViews).apply(context, android.widget.FrameLayout(context))
                    check(view.findViewById<View>(R.id.widget_buttons).visibility == View.GONE)
                }
            }
            test("integration result is persisted for a separate cold process check") {
                check(state().optString("viewer").isNotBlank())
                check(prefs.edit().putInt("qaPassed", passed + 1).commit())
            }
            finish(0, Bundle().apply { putString("stream", "$passed Android widget integration tests passed\n"); putInt("passed", passed) })
        } catch (failure: Throwable) {
            finish(1, Bundle().apply { putString("stream", "FAIL: ${failure.stackTraceToString()}\n"); putInt("passed", passed) })
        }
    }
}

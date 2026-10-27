package com.studiogameslime.soccerapp.widget

import android.app.Application
import android.content.Context
import androidx.work.*
import org.json.JSONObject

/** Included only by scripts/tests/widget_debug_harness.py, never by prebuild. */
class WidgetAuditApplication : Application(), Configuration.Provider {
    override fun getWorkManagerConfiguration(): Configuration = Configuration.Builder().setWorkerFactory(object : WorkerFactory() {
        override fun createWorker(context: Context, name: String, params: WorkerParameters): ListenableWorker? = when (name) {
            WidgetRosterWorker::class.java.name -> WidgetRosterWorker(context, params, WidgetAuditBackend(context))
            PersonalActivityUploadWorker::class.java.name -> PersonalActivityUploadWorker(context, params, ActivityAuditBackend(context))
            WidgetTimerWorker::class.java.name -> WidgetTimerWorker(context, params, WidgetAuditBackend(context))
            else -> null
        }
    }).build()
}

class WidgetAuditBackend(private val context: Context) : WidgetBackend {
    private fun prefs() = context.getSharedPreferences("WidgetAuditServer", Context.MODE_PRIVATE)
    override fun userId(): String? = prefs().getString("uid", "qa-owner")
    override fun games(uid: String, floor: Long): List<WidgetGameModel.Game> {
        if (prefs().getBoolean("fail", false)) throw IllegalStateException("QA network failure")
        if (prefs().getBoolean("delayRead", false)) {
            prefs().edit().putBoolean("reading", true).apply()
            Thread.sleep(750)
            prefs().edit().putBoolean("reading", false).apply()
        }
        val root = JSONObject(prefs().getString("games", "{}")!!)
        return root.keys().asSequence().map { id -> WidgetGameModel.Game(id, map(root.getJSONObject(id))) }.toList()
    }
    override fun identities(ids: List<String>) = ids.associateWith { mapOf<String, Any?>("name" to when (it) {
        "qa-owner" -> "מנהל הבדיקה"
        "qa-one" -> "שחקן ראשון"
        "qa-two" -> "שחקן שני"
        else -> "שחקן חדש"
    }) }
    override fun mutate(gameId: String, uid: String, round: String, action: String, name: String, command: String, now: () -> Long): Map<String, Any?> {
        if (prefs().getBoolean("fail", false) || prefs().getBoolean("failMutation", false)) throw IllegalStateException("QA network failure")
        val games = JSONObject(prefs().getString("games", "{}")!!)
        val game = map(games.getJSONObject(gameId))
        val at = now()
        val fields = WidgetTimerModel.mutate(game, uid, round, action, at, command) ?: emptyMap()
        val live = game["liveMatch"] as? Map<*, *> ?: emptyMap<Any, Any>()
        val result = game + mapOf("liveMatch" to (live + fields), "updatedAt" to at)
        games.put(gameId, JSONObject(result))
        prefs().edit().putString("games", games.toString()).apply()
        return result
    }
    private fun value(value: Any?): Any? = when (value) {
        is JSONObject -> map(value)
        is org.json.JSONArray -> (0 until value.length()).map { value(value.opt(it)) }
        JSONObject.NULL -> null
        else -> value
    }
    private fun map(o: JSONObject): Map<String, Any?> = o.keys().asSequence().associateWith { value(o.opt(it)) }
}

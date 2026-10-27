package com.studiogameslime.soccerapp.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One lock, session fence, and full payload schema for both phone widgets. */
object WidgetStateStore {
    fun prefs(context: Context) = context.getSharedPreferences(TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE)
    fun read(context: Context): JSONObject? = try {
        prefs(context).getString(TeamderWidgetProvider.KEY_JSON, null)?.let { JSONObject(it) }
    } catch (_: Exception) { null }
    fun owner(state: JSONObject?): String = state?.optJSONObject("viewer")?.optString("id").orEmpty()
    fun generation(context: Context): Long = prefs(context).getLong("widgetSession", 0)
    fun actionSerial(context: Context): Long = prefs(context).getLong("widgetActionSerial", 0)
    fun write(context: Context, state: JSONObject) {
        state.put("viewerId", owner(state)).put("sessionGeneration", generation(context))
        prefs(context).edit().putString(TeamderWidgetProvider.KEY_JSON, state.toString()).apply()
    }
    fun refresh(context: Context) {
        TeamderWidgetProvider.requestRefresh(context)
        TeamderPlayersWidgetProvider.requestRefresh(context)
    }

    /** Native server reads own updates after bootstrap, avoiding stale JS results. */
    fun acceptPhone(context: Context, json: String, nativeUid: String?) {
        val incoming = JSONObject(json)
        val signature = JSONObject(json).apply {
            remove("serverNowMs"); remove("clockOffsetMs"); remove("baseElapsedMs")
            optJSONObject("timer")?.remove("baseElapsedMs")
        }.toString()
        var fetch = false
        synchronized(TeamderWidgetProvider.STATE_LOCK) {
            val old = read(context)
            val uid = owner(incoming)
            fetch = prefs(context).getString("widgetPhoneSignature", null) != signature
            prefs(context).edit().putString("widgetPhoneSignature", signature).apply()
            if (owner(old) != uid || old == null) {
                prefs(context).edit().putLong("widgetSession", generation(context) + 1)
                    .remove("widgetPending").remove("widgetResetArm").apply()
                incoming.put("widgetProtocol", 2).put("widgetUpdatedAtMs", System.currentTimeMillis())
                write(context, incoming)
            } else if (uid.isBlank() || nativeUid != uid || old.optInt("widgetProtocol") < 2) {
                incoming.put("widgetProtocol", 2).put("widgetUpdatedAtMs", System.currentTimeMillis())
                write(context, incoming)
            } else {
                old.put("viewer", incoming.optJSONObject("viewer"))
                old.put("clockOffsetMs", incoming.optLong("clockOffsetMs"))
                write(context, old)
            }
        }
        refresh(context)
        if (fetch && owner(incoming).isNotBlank()) WidgetRosterWorker.enqueue(context, incoming.optString("gameId"), owner(incoming), true)
    }

    fun payload(base: JSONObject, selected: WidgetGameModel.Game?, identities: Map<String, Map<String, Any?>>, now: Long): JSONObject {
        val uid = owner(base)
        val result = JSONObject().put("viewer", base.optJSONObject("viewer"))
            .put("clockOffsetMs", base.optLong("clockOffsetMs")).put("serverNowMs", now)
            .put("widgetProtocol", 2).put("widgetUpdatedAtMs", System.currentTimeMillis())
        if (selected == null) return result.put("kind", "notRegistered")
        val game = selected.data
        val cached = mutableMapOf<String, WidgetRosterModel.Player>()
        base.optJSONArray("players")?.let { rows -> for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("id")
            if (id.isNotBlank()) cached[id] = WidgetRosterModel.Player(id, row.optString("name"), row.optString("photo"), row.optString("role"))
        } }
        val roster = WidgetRosterModel.project(game, uid, identities, cached, nowMs = now)
        if (roster.clear) return result.put("kind", "notRegistered")
        result.put("gameId", selected.id).put("title", roster.title).put("startsAt", roster.startsAt)
            .put("fieldName", roster.fieldName).put("city", roster.city).put("maxPlayers", roster.maxPlayers)
            .put("playersCount", roster.players.size).put("registration", WidgetGameModel.registration(game, uid))
            .put("timerRoundId", WidgetGameModel.roundId(game))
            .put("activity", JSONObject().put("protocol", 1).put("userId", uid).put("gameId", selected.id)
                .put("roundId", WidgetGameModel.roundId(game)).put("eligible", WidgetGameModel.activityEligible(game, uid, now))
                .put("confirmedAtMs", now).put("validUntilMs", now + 90_000))
            .put("players", JSONArray().apply { roster.players.forEach { row ->
                put(JSONObject().put("id", row.id).put("name", row.name).put("photo", row.photo).put("role", row.role))
            } })
        if (WidgetGameModel.live(game)) {
            val live = game["liveMatch"] as? Map<*, *> ?: emptyMap<Any, Any>()
            val running = live["timerRunning"] == true
            val acc = ((live["timerAccumulatedMs"] as? Number)?.toLong() ?: 0).coerceAtLeast(0)
            val started = (live["timerLastStartedAt"] as? Number)?.toLong() ?: 0
            val elapsed = acc + if (running && started > 0) (now - started).coerceAtLeast(0) else 0
            val rotation = game["rotation"] as? Map<*, *>
            val committed = rotation != null && game["lastCommittedRoundId"] == WidgetGameModel.roundId(game).removePrefix("rotation:")
            result.put("kind", "live").put("canControl", roster.canControl && !committed)
                .put("controlledBy", live["timerControlledBy"] ?: "").put("controlledByName", live["timerControlledByName"] ?: "")
                .put("baseElapsedMs", elapsed).put("timer", JSONObject().put("running", running)
                    .put("lastStartedAt", started).put("accumulatedMs", acc).put("baseElapsedMs", elapsed))
        } else if (roster.scheduled) {
            result.put("kind", "scheduled").put("registrationOpensAt", roster.registrationOpensAt)
        } else result.put("kind", "upcoming")
        val feedbackAt = base.optLong("widgetFeedbackAtMs")
        if (base.optString("gameId") == selected.id && base.optString("timerRoundId") == result.optString("timerRoundId") &&
            System.currentTimeMillis() - feedbackAt in 0..30_000) {
            result.put("widgetFeedbackAtMs", feedbackAt)
            listOf("widgetError", "widgetNotice").forEach { key -> if (base.has(key)) result.put(key, base.get(key)) }
        }
        return result
    }

    fun pending(context: Context): JSONObject? = try { prefs(context).getString("widgetPending", null)?.let { JSONObject(it) } } catch (_: Exception) { null }
    fun validPending(context: Context, state: JSONObject): Boolean {
        val p = pending(context) ?: return false
        val age = System.currentTimeMillis() - p.optLong("at")
        return age in 0..120_000 && p.optString("gameId") == state.optString("gameId") && p.optString("uid") == owner(state)
    }
    fun armed(context: Context, state: JSONObject): Boolean = try {
        val p = prefs(context).getString("widgetResetArm", null)?.let { JSONObject(it) }
        p != null && System.currentTimeMillis() - p.optLong("at") in 0..8_000 &&
            p.optString("uid") == owner(state) && p.optString("gameId") == state.optString("gameId") &&
            p.optString("round") == state.optString("timerRoundId")
    } catch (_: Exception) { false }
}

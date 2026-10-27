package com.studiogameslime.soccerapp.widget

/** Shared native contract: a round is not the evening's game document. */
object WidgetGameModel {
    /** Current lineup only. The server independently verifies historical eligibility. */
    fun activityPlayerIds(game: Map<String, Any?>): Set<String> {
        if (!live(game)) return emptySet()
        val draft = game["draftTeams"] as? Map<*, *>
        val left = (draft?.get("leftHome") as? List<*>)?.mapNotNull { (it as? Map<*, *>)?.get("playerId") as? String }?.toSet().orEmpty()
        val rotation = game["rotation"] as? Map<*, *>
        val result = mutableSetOf<String>()
        if (rotation != null && draft != null) {
            val playing = (rotation["playing"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }.orEmpty()
            if (playing.size != 2 || playing[0] == playing[1]) return emptySet()
            val teams = (draft["teams"] as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()
            if (playing.any { index -> teams.none { (it["index"] as? Number)?.toInt() == index } }) return emptySet()
            val loans = (rotation["loans"] as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()
            for (index in playing) {
                val home = teams.first { (it["index"] as? Number)?.toInt() == index }
                val borrowedOut = loans.filter { (it["homeTeam"] as? Number)?.toInt() == index }.mapNotNull { it["playerId"] as? String }.toSet()
                result.addAll((home["playerIds"] as? List<*>)?.filterIsInstance<String>().orEmpty().filter { it !in borrowedOut })
                result.addAll(loans.filter { (it["filledTeam"] as? Number)?.toInt() == index }.mapNotNull { it["playerId"] as? String })
            }
        } else {
            val live = game["liveMatch"] as? Map<*, *>
            val assignments = live?.get("assignments") as? Map<*, *> ?: emptyMap<Any, Any>()
            result.addAll(assignments.entries.filter { it.value in listOf("teamA", "teamB", "gkA", "gkB") }.mapNotNull { it.key as? String })
        }
        return result.filter { it.isNotBlank() && it !in left }.toSet()
    }

    fun activityEligible(game: Map<String, Any?>, uid: String, now: Long): Boolean {
        val live = game["liveMatch"] as? Map<*, *> ?: return false
        val start = (live["timerLastStartedAt"] as? Number)?.toLong() ?: return false
        return uid.isNotBlank() && live["timerRunning"] == true && start in 0..now && uid in activityPlayerIds(game)
    }
    const val RECENT_MS = 6L * 60L * 60L * 1000L
    data class Game(val id: String, val data: Map<String, Any?>)

    fun roundId(game: Map<String, Any?>): String {
        val rotation = game["rotation"] as? Map<*, *>
        if (rotation != null) return "rotation:" + (rotation["roundInstanceId"] as? String
            ?: "${rotation["round"] ?: "r"}:${rotation["updatedAt"] ?: 0}")
        return "plain:${(game["liveMatch"] as? Map<*, *>)?.get("roundNumber") ?: 0}"
    }

    fun belongsTo(game: Map<String, Any?>, uid: String): Boolean = uid.isNotBlank() &&
        (game["createdBy"] == uid || listOf("participantIds", "players", "waitlist", "pending").any {
            (game[it] as? List<*>)?.contains(uid) == true
        })

    fun live(game: Map<String, Any?>): Boolean = game["status"] !in listOf("finished", "cancelled") &&
        (game["liveMatch"] as? Map<*, *>)?.let { it["phase"] != "finished" } == true

    fun selectable(game: Map<String, Any?>, uid: String, now: Long): Boolean {
        if (!belongsTo(game, uid) || game["status"] !in listOf("scheduled", "open", "locked", "active")) return false
        val starts = (game["startsAt"] as? Number)?.toLong() ?: return false
        return live(game) || starts >= now - RECENT_MS
    }

    fun select(games: List<Game>, uid: String, now: Long): Game? = games
        .filter { selectable(it.data, uid, now) }
        .sortedWith(compareBy<Game> { if (live(it.data)) 0 else 1 }
            .thenBy { (it.data["startsAt"] as? Number)?.toLong() ?: Long.MAX_VALUE }.thenBy { it.id })
        .firstOrNull()

    fun registration(game: Map<String, Any?>, uid: String): String = when {
        game["createdBy"] == uid -> "organizer"
        (game["waitlist"] as? List<*>)?.contains(uid) == true -> "waitlist"
        (game["pending"] as? List<*>)?.contains(uid) == true -> "pending"
        (game["players"] as? List<*>)?.contains(uid) == true -> "registered"
        else -> "participant"
    }
}

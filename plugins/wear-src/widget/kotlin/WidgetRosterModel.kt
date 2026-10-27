package com.studiogameslime.soccerapp.widget

/** Pure projection shared by background work and JVM regression tests. */
object WidgetRosterModel {
    data class Player(val id: String, val name: String, val photo: String, val role: String)
    data class Patch(
        val clear: Boolean,
        val players: List<Player> = emptyList(),
        val title: String = "",
        val startsAt: Long = 0L,
        val fieldName: String = "",
        val city: String = "",
        val maxPlayers: Int = 0,
        val canControl: Boolean = false,
        val scheduled: Boolean = false,
        val registrationOpensAt: Long = 0L,
    )

    fun memberIds(game: Map<String, Any?>): List<String> =
        (game["players"] as? List<*>)?.filterIsInstance<String>()?.filter { it.isNotBlank() }?.distinct()
            ?: emptyList()

    fun project(
        game: Map<String, Any?>?, viewerId: String,
        identities: Map<String, Map<String, Any?>>, cachedNames: Map<String, Player> = emptyMap(),
        nowMs: Long = System.currentTimeMillis(),
    ): Patch {
        if (game == null || game["status"] == "finished" || game["status"] == "cancelled") return Patch(clear = true)
        val creator = game["createdBy"] as? String ?: ""
        val audience = listOf("participantIds", "players", "waitlist", "pending").flatMap {
            (game[it] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
        }
        if (viewerId.isEmpty() || (creator != viewerId && viewerId !in audience)) return Patch(clear = true)
        val players = memberIds(game).map { id ->
            val identity = identities[id]
            Player(id,
                (identity?.get("name") as? String)?.trim()?.takeIf { it.isNotEmpty() }
                    ?: cachedNames[id]?.name ?: "שחקן",
                identity?.get("photoUrl") as? String ?: cachedNames[id]?.photo ?: "",
                if (id == creator) "admin" else "member")
        }.toMutableList()
        for (value in game["guests"] as? List<*> ?: emptyList<Any?>()) {
            val guest = value as? Map<*, *> ?: continue
            if (guest["waitlisted"] == true) continue
            players.add(Player(guest["id"] as? String ?: "", guest["name"] as? String ?: "אורח", "", "guest"))
        }
        val opensAt = (game["registrationOpensAt"] as? Number)?.toLong() ?: 0L
        return Patch(false, players, game["title"] as? String ?: "",
            (game["startsAt"] as? Number)?.toLong() ?: 0L,
            game["fieldName"] as? String ?: "", game["city"] as? String ?: "",
            (game["maxPlayers"] as? Number)?.toInt() ?: 0, creator == viewerId,
            game["status"] == "scheduled" && opensAt > nowMs, opensAt)
    }
}

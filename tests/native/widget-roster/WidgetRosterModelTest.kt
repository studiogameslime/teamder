package com.studiogameslime.soccerapp.widget

fun main() {
    var passed = 0
    fun test(name: String, body: () -> Unit) { body(); passed++; println("PASS $name") }
    val base = mapOf<String, Any?>("createdBy" to "owner", "players" to listOf("owner", "p1"),
        "participantIds" to listOf("owner", "p1"), "status" to "open", "title" to "מחזור", "maxPlayers" to 12)
    val names = mapOf("owner" to mapOf<String, Any?>("name" to "מנהל"), "p1" to mapOf("name" to "שחקן ראשון", "photoUrl" to "photo"))
    test("registered roster has names, roles and exact count") {
        val p = WidgetRosterModel.project(base, "owner", names)
        check(!p.clear && p.canControl && p.players.size == 2 && p.players[0].role == "admin")
        check(p.players[1].name == "שחקן ראשון" && p.players[1].photo == "photo")
    }
    test("active guest included; waitlisted guest excluded") {
        val p = WidgetRosterModel.project(base + ("guests" to listOf(
            mapOf("id" to "guest1", "name" to "אורח"), mapOf("id" to "guest2", "name" to "ממתין", "waitlisted" to true))), "owner", names)
        check(p.players.size == 3 && p.players.last().role == "guest")
    }
    test("removed player is removed from rows without falsifying an empty roster") {
        val p = WidgetRosterModel.project(base + ("players" to listOf("owner")), "owner", names)
        check(!p.clear && p.players.map { it.id } == listOf("owner"))
    }
    test("removed viewer clears the inaccessible roster") {
        check(WidgetRosterModel.project(base + mapOf("players" to listOf("owner"), "participantIds" to listOf("owner")), "p1", names).clear)
    }
    test("deleted game clears") { check(WidgetRosterModel.project(null, "owner", names).clear) }
    for (status in listOf("finished", "cancelled")) test("terminal $status clears") {
        check(WidgetRosterModel.project(base + ("status" to status), "owner", names).clear)
    }
    test("creator is eligible without a player slot") {
        val p = WidgetRosterModel.project(base + mapOf("players" to emptyList<String>(), "participantIds" to emptyList<String>()), "owner", names)
        check(!p.clear && p.players.isEmpty())
    }
    test("waiting viewer is not counted as a registered player") {
        val p = WidgetRosterModel.project(base + ("waitlist" to listOf("waiting")), "waiting", names)
        check(!p.clear && p.players.size == 2 && p.players.none { it.id == "waiting" })
    }
    test("missing public identity retains row with fallback name") {
        val p = WidgetRosterModel.project(base, "owner", emptyMap())
        check(p.players.size == 2 && p.players.all { it.name == "שחקן" })
    }
    test("stable cached identity used when public mirror absent") {
        val p = WidgetRosterModel.project(base, "owner", emptyMap(), mapOf("p1" to WidgetRosterModel.Player("p1", "שם קודם", "photo", "member")))
        check(p.players[1].name == "שם קודם")
    }
    test("malformed rows and duplicate ids cannot inflate membership count") {
        val p = WidgetRosterModel.project(base + mapOf("players" to listOf("owner", null, 3, "", "owner"), "guests" to listOf(null, "bad")), "owner", names)
        check(p.players.size == 1)
    }
    test("metadata updated without copying private source fields") {
        val p = WidgetRosterModel.project(base + mapOf("startsAt" to 1234L, "city" to "עיר", "secret" to "private"), "owner", names)
        check(p.startsAt == 1234L && p.city == "עיר" && !p.toString().contains("private"))
    }
    test("registration opening stops hiding the roster") {
        val scheduled = base + mapOf("status" to "scheduled", "registrationOpensAt" to 150L)
        check(WidgetRosterModel.project(scheduled, "owner", names, nowMs = 100L).scheduled)
        check(!WidgetRosterModel.project(scheduled, "owner", names, nowMs = 160L).scheduled)
    }
    println("$passed native model tests passed")
}

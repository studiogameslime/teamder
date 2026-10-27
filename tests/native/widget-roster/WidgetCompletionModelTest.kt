package com.studiogameslime.soccerapp.widget

fun main() {
    var passed = 0
    fun test(name: String, body: () -> Unit) { body(); passed++; println("PASS $name") }
    fun game(extra: Map<String, Any?> = emptyMap()) = mapOf<String, Any?>("createdBy" to "owner", "players" to listOf("owner", "p1"),
        "startsAt" to 1000L, "status" to "active", "liveMatch" to mapOf("phase" to "live", "roundNumber" to 1,
        "timerRunning" to false, "timerAccumulatedMs" to 100L, "scoreA" to 0L, "scoreB" to 0L)) + extra
    fun live(g: Map<String, Any?>) = g["liveMatch"] as Map<*, *>
    test("start and pause are idempotent") {
        val g = game()
        val started = WidgetTimerModel.mutate(g, "owner", "plain:1", "start", 2000L)!!
        check(started["timerLastStartedAt"] == 2000L)
        val running = g + ("liveMatch" to (live(g) + started))
        check(WidgetTimerModel.mutate(running, "owner", "plain:1", "start", 3000L) == null)
        val paused = WidgetTimerModel.mutate(running, "owner", "plain:1", "pause", 2500L)!!
        check(paused["timerAccumulatedMs"] == 600L)
        check(WidgetTimerModel.mutate(g + ("liveMatch" to (live(g) + paused)), "owner", "plain:1", "pause", 2600L) == null)
    }
    test("a delayed command cannot cross plain rounds") {
        try { WidgetTimerModel.mutate(game(), "owner", "plain:0", "reset", 100L); error("accepted") } catch (_: WidgetTimerModel.Changed) {}
    }
    test("a delayed command cannot cross rotation instances") {
        val g = game(mapOf("rotation" to mapOf("roundInstanceId" to "new", "round" to 1)))
        try { WidgetTimerModel.mutate(g, "owner", "rotation:old", "start", 100L); error("accepted") } catch (_: WidgetTimerModel.Changed) {}
    }
    test("saved rotation round is immutable") {
        val g = game(mapOf("rotation" to mapOf("roundInstanceId" to "saved"), "lastCommittedRoundId" to "saved"))
        try { WidgetTimerModel.mutate(g, "owner", "rotation:saved", "pause", 100L); error("accepted") } catch (_: WidgetTimerModel.Changed) {}
    }
    for (status in listOf("finished", "cancelled")) test("terminal $status rejects all actions") {
        for (action in listOf("start", "pause", "reset")) {
            try { WidgetTimerModel.mutate(game(mapOf("status" to status)), "owner", "plain:1", action, 100L); error("accepted") } catch (_: WidgetTimerModel.Changed) {}
        }
    }
    test("non-controller cannot forge widget control") {
        try { WidgetTimerModel.mutate(game(), "p1", "plain:1", "reset", 100L); error("accepted") } catch (_: WidgetTimerModel.NotController) {}
    }
    test("reset only subtracts discarded credited goals and clears penalties") {
        val g = game(mapOf("liveMatch" to (live(game()) + mapOf("scoreA" to 3L, "scoreB" to 1L,
            "goals" to listOf(mapOf("scorerId" to "p1"), mapOf("scorerId" to "guest"), mapOf("scorerId" to "p1", "ownGoal" to true)),
            "goalTally" to mapOf("p1" to 4L, "guest" to 1L), "inPlayPenalties" to listOf(mapOf("id" to "penalty"))))))
        val result = WidgetTimerModel.mutate(g, "owner", "plain:1", "reset", 2000L)!!
        check(result["goalTally"] == mapOf("p1" to 3L))
        check(result["scoreA"] == 0L && result["scoreB"] == 0L)
        check((result["goals"] as List<*>).isEmpty() && (result["inPlayPenalties"] as List<*>).isEmpty())
    }
    test("a resumed durable command cannot erase newly added goals") {
        val g = game()
        val reset = WidgetTimerModel.mutate(g, "owner", "plain:1", "reset", 2000L, "command")!!
        val newer = g + ("liveMatch" to (live(g) + reset + mapOf("scoreA" to 1L, "goals" to listOf(mapOf("scorerId" to "p1")))))
        check(WidgetTimerModel.mutate(newer, "owner", "plain:1", "reset", 3000L, "command") == null)
    }
    test("negative active intervals are never appended") {
        val g = game(mapOf("liveMatch" to (live(game()) + mapOf("timerRunning" to true, "timerLastStartedAt" to 3000L))))
        val result = WidgetTimerModel.mutate(g, "owner", "plain:1", "pause", 2000L)!!
        check(result["timerAccumulatedMs"] == 100L && "activeIntervals" !in result)
    }
    test("live wins selection even when kickoff is old") {
        val candidates = listOf(WidgetGameModel.Game("upcoming", game(mapOf("startsAt" to 2000L, "liveMatch" to null))), WidgetGameModel.Game("live", game()))
        check(WidgetGameModel.select(candidates, "owner", 40_000_000L)?.id == "live")
    }
    test("finishing current evening selects the next one") {
        val candidates = listOf(WidgetGameModel.Game("old", game(mapOf("status" to "finished"))),
            WidgetGameModel.Game("next", game(mapOf("startsAt" to 3000L, "liveMatch" to null))))
        check(WidgetGameModel.select(candidates, "owner", 2000L)?.id == "next")
    }
    test("late kickoff stays visible for the six-hour lifecycle grace") {
        val g = WidgetGameModel.Game("late", game(mapOf("liveMatch" to null)))
        check(WidgetGameModel.select(listOf(g), "owner", 2000L)?.id == "late")
        check(WidgetGameModel.select(listOf(g), "owner", WidgetGameModel.RECENT_MS + 2000L) == null)
    }
    test("waitlist and pending are distinct from registration") {
        val g = game(mapOf("waitlist" to listOf("p1"), "pending" to listOf("p2")))
        check(WidgetGameModel.registration(g, "p1") == "waitlist" && WidgetGameModel.registration(g, "p2") == "pending")
    }
    test("selection never discovers another account's evening") {
        check(WidgetGameModel.select(listOf(WidgetGameModel.Game("g", game())), "other", 2000L) == null)
    }
    test("activity requires actual lineup membership and a valid running anchor") {
        val g = game(mapOf("liveMatch" to (live(game()) + mapOf("timerRunning" to true, "timerLastStartedAt" to 500L,
            "assignments" to mapOf("p1" to "teamA", "gk" to "gkB", "bench" to "waiting")))))
        check(WidgetGameModel.activityEligible(g, "p1", 1000L))
        check(WidgetGameModel.activityEligible(g, "gk", 1000L))
        check(!WidgetGameModel.activityEligible(g, "owner", 1000L))
        check(!WidgetGameModel.activityEligible(g, "bench", 1000L))
        check(!WidgetGameModel.activityEligible(g, "p1", 499L))
        for (start in listOf(null, -1L, 1001L)) check(!WidgetGameModel.activityEligible(g + ("liveMatch" to (live(g) + ("timerLastStartedAt" to start))), "p1", 1000L))
        check(!WidgetGameModel.activityEligible(g + ("liveMatch" to (live(g) + ("timerRunning" to false))), "p1", 1000L))
    }
    test("activity rotation follows loans, playing teams, left-home and terminal states") {
        val g = game(mapOf("draftTeams" to mapOf("teams" to listOf(
            mapOf("index" to 0, "playerIds" to listOf("a", "out")), mapOf("index" to 1, "playerIds" to listOf("b", "left")),
            mapOf("index" to 2, "playerIds" to listOf("c", "in"))), "leftHome" to listOf(mapOf("playerId" to "left"))),
            "rotation" to mapOf("playing" to listOf(0, 1), "loans" to listOf(mapOf("playerId" to "out", "homeTeam" to 0, "filledTeam" to 2),
                mapOf("playerId" to "in", "homeTeam" to 2, "filledTeam" to 0)))))
        check(WidgetGameModel.activityPlayerIds(g) == setOf("a", "b", "in"))
        check(WidgetGameModel.activityPlayerIds(g + ("status" to "finished")).isEmpty())
        check(WidgetGameModel.activityPlayerIds(g + ("rotation" to mapOf("playing" to listOf(0, 0)))).isEmpty())
        check(WidgetGameModel.activityPlayerIds(g + ("rotation" to mapOf("playing" to listOf(0, 9)))).isEmpty())
    }
    println("$passed widget completion model tests passed")
}

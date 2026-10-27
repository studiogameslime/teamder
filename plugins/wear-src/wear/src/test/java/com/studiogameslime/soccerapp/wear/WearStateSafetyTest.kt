package com.studiogameslime.soccerapp.wear.safety
import com.studiogameslime.soccerapp.wear.model.*

fun main() {
    var n = 0
    fun verify(label: String, condition: Boolean) { check(condition) { label }; n++; println("PASS $label") }
    val upcoming = parseWearState("""{"kind":"upcoming","registration":"waitlisted","players":[false,{"id":"u1","name":"אורי","photo":"","role":"member"}],"maxPlayers":0}""") as WearGameState.Upcoming
    verify("malformed roster row isolated", upcoming.players.size == 1)
    verify("stable player identity", upcoming.players[0].id == "u1")
    verify("waiting status preserved", upcoming.registration == "waitlisted")
    val raw = """{"kind":"live","viewer":{"id":"u1"},"timerRoundId":"plain:2","sessionGeneration":5,"canControl":true,"players":[{"id":"u1","name":"אורי"}],"timer":{"running":false,"accumulatedMs":1000,"baseElapsedMs":1000}}"""
    val live = parseWearStateFresh(raw, System.currentTimeMillis()) as WearGameState.Live
    verify("context preserved", live.viewerId == "u1" && live.roundId == "plain:2" && live.sessionGeneration == 5L)
    verify("live roster available", live.players.single().id == "u1")
    val stale = parseWearStateFresh(raw, System.currentTimeMillis() - 90_001) as WearGameState.Live
    verify("old state remains visible and not authoritative", stale.stale && !stale.canControl)
    val absent = parseWearStateFresh(raw, 0) as WearGameState.Live
    verify("missing state stamp fails closed", absent.stale && !absent.canControl)
    val future = parseWearStateFresh(raw, System.currentTimeMillis() + 120_000) as WearGameState.Live
    verify("future state stamp fails closed", future.stale && !future.canControl)
    verify("paused time remains exact", live.timer.baseElapsedMs == 1000L)
    val skewed = raw.dropLast(1) + ",\"clockOffsetMs\":5000}"
    val translated = parseWearStateFresh(skewed, System.currentTimeMillis() - 6000, -1000L) as WearGameState.Live
    verify("freshness translates each device clock separately", !translated.stale)
    val timer = parseWearState("""{"kind":"live","clockOffsetMs":120000,"serverNowMs":${System.currentTimeMillis()},"timer":{"running":true,"baseElapsedMs":1000}}""", 0L) as WearGameState.Live
    verify("elapsed uses measured watch offset rather than phone offset", timer.timer.baseElapsedMs in 1000..3000)
    println("$n watch state safety assertions passed")
}

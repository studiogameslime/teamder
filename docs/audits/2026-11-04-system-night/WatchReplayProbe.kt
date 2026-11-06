import com.studiogameslime.soccerapp.widget.WidgetTimerModel

/** Offline game model probe; no phone, account, credentials or network. */
fun main() {
    var live = mapOf<String, Any?>("phase" to "live", "roundNumber" to 1,
        "timerRunning" to false, "timerAccumulatedMs" to 100L, "scoreA" to 0L, "scoreB" to 0L)
    val base = mapOf<String, Any?>("createdBy" to "owner", "players" to listOf("owner"), "status" to "active")
    fun run(action: String, at: Long, key: String): Boolean {
        val patch = WidgetTimerModel.mutate(base + ("liveMatch" to live), "owner", "plain:1", action, at, key)
        if (patch != null) live = live + patch
        return patch != null
    }
    check(run("reset", 2000L, "watch-a"))
    check(run("start", 3000L, "phone-b"))
    live = live + mapOf("scoreA" to 1L, "goals" to listOf(mapOf("scorerId" to "owner")))
    val applied = run("reset", 4000L, "watch-a")
    println("replayed=$applied, resultingScore=" + live["scoreA"])
}

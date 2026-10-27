package com.studiogameslime.soccerapp.widget

/** Pure transaction decision, exercised directly on the JVM and on Android. */
object WidgetTimerModel {
    class Changed : IllegalStateException("המשחק התחלף. רעננו את הווידגט ונסו שוב")
    class NotController : IllegalStateException("רק יוצר המחזור יכול לשלוט מהווידגט")

    fun mutate(game: Map<String, Any?>?, uid: String, expectedRound: String, action: String, now: Long, command: String = ""): Map<String, Any?>? {
        if (game == null || !WidgetGameModel.live(game) || expectedRound.isBlank() || WidgetGameModel.roundId(game) != expectedRound) throw Changed()
        if (game["createdBy"] != uid) throw NotController()
        val rotation = game["rotation"] as? Map<*, *>
        if (rotation != null && game["lastCommittedRoundId"] == expectedRound.removePrefix("rotation:")) throw Changed()
        @Suppress("UNCHECKED_CAST")
        val live = game["liveMatch"] as? Map<String, Any?> ?: throw Changed()
        if (command.isNotBlank() && live["lastWidgetCommandId"] == command) return null
        val running = live["timerRunning"] == true
        val acc = ((live["timerAccumulatedMs"] as? Number)?.toLong() ?: 0).coerceAtLeast(0)
        val started = (live["timerLastStartedAt"] as? Number)?.toLong() ?: 0
        val events = (live["timerEvents"] as? List<*>)?.toMutableList() ?: mutableListOf()
        val fields = mutableMapOf<String, Any?>()
        when (action) {
            "start" -> {
                if (running) return null
                fields["timerRunning"] = true
                fields["timerLastStartedAt"] = now
                fields["timerAccumulatedMs"] = acc
                events.add(mapOf("type" to if (acc == 0L && events.isEmpty()) "start" else "resume", "at" to now))
                fields["timerEvents"] = events
            }
            "pause" -> {
                if (!running) return null
                fields["timerRunning"] = false
                fields["timerLastStartedAt"] = null
                fields["timerAccumulatedMs"] = acc + if (started > 0) (now - started).coerceAtLeast(0) else 0
                events.add(mapOf("type" to "pause", "at" to now))
                fields["timerEvents"] = events
            }
            "reset" -> {
                if (!running && started == 0L && acc == 0L && events.isEmpty() &&
                    (live["goals"] as? List<*>)?.isNotEmpty() != true &&
                    (live["inPlayPenalties"] as? List<*>)?.isNotEmpty() != true &&
                    ((live["scoreA"] as? Number)?.toLong() ?: 0) == 0L &&
                    ((live["scoreB"] as? Number)?.toLong() ?: 0) == 0L) return null
                fields.putAll(mapOf("timerRunning" to false, "timerLastStartedAt" to null,
                    "timerAccumulatedMs" to 0L, "timerEvents" to emptyList<Any>(), "scoreA" to 0L, "scoreB" to 0L,
                    "goals" to emptyList<Any>(), "inPlayPenalties" to emptyList<Any>()))
                val tally = (live["goalTally"] as? Map<*, *>)?.entries?.mapNotNull { (id, value) ->
                    if (id is String && value is Number) id to value.toLong() else null
                }?.toMap()?.toMutableMap() ?: mutableMapOf()
                for (entry in live["goals"] as? List<*> ?: emptyList<Any>()) {
                    val goal = entry as? Map<*, *> ?: continue
                    val scorer = goal["scorerId"] as? String ?: continue
                    if (scorer.isBlank() || goal["ownGoal"] == true) continue
                    val left = (tally[scorer] ?: 0L) - 1
                    if (left > 0) tally[scorer] = left else tally.remove(scorer)
                }
                fields["goalTally"] = tally
            }
            else -> throw IllegalArgumentException("פעולת שעון לא מוכרת")
        }
        if (action != "start" && running && started > 0 && now >= started) {
            fields["activeIntervals"] = (live["activeIntervals"] as? List<*> ?: emptyList<Any>()) + mapOf("s" to started, "e" to now)
        }
        fields["timerControlledBy"] = uid
        if (command.isNotBlank()) fields["lastWidgetCommandId"] = command
        return fields
    }
}

package com.studiogameslime.soccerapp.phoneactivity

/** No Android dependencies: all durations use the monotonic sensor clock. */
class PhoneMovement {
    data class Sample(val time: Long, val speed: Double, val accuracy: Double, val speedAccuracy: Double)
    var distance = 0.0; private set
    var measuredMs = 0L; private set
    var peak: Double? = null; private set
    var sprints = 0; private set
    var sprintMs = 0L; private set
    var last: Sample? = null; private set
    var accepted = 0; private set
    var rejected = 0; private set
    private var sprintRun = 0L
    private var counted = false
    private var latestTime = Long.MIN_VALUE
    val graph = ArrayList<Double?>()

    private fun breakRun() { last = null; sprintRun = 0; counted = false }
    fun add(sample: Sample, now: Long) {
        // Replayed/old fixes must never modify an already measured interval.
        if (sample.time <= latestTime || now - sample.time !in 0..5000) { rejected++; return }
        latestTime = sample.time
        if (!sample.speed.isFinite() || sample.speed !in 0.0..12.0 ||
            !sample.accuracy.isFinite() || sample.accuracy !in 0.0..20.0 ||
            !sample.speedAccuracy.isFinite() || sample.speedAccuracy !in 0.0..1.5) {
            rejected++; breakRun(); append(null); return
        }
        accepted++
        val before = last
        val gap = if (before == null) 0L else sample.time - before.time
        if (before != null && gap in 1..3000) {
            measuredMs += gap
            distance += (before.speed + sample.speed) / 2 * gap / 1000
            // Peak requires confirmation by a neighbouring fix, not one GPS spike.
            peak = maxOf(peak ?: 0.0, minOf(before.speed, sample.speed))
            if (before.speed * 3.6 >= 19 && sample.speed * 3.6 >= 19) {
                sprintRun += gap
                if (!counted && sprintRun >= 2000) {
                    sprints++; counted = true; sprintMs += sprintRun
                } else if (counted) sprintMs += gap
            } else { sprintRun = 0; counted = false }
        } else { sprintRun = 0; counted = false; if (before != null) append(null) }
        last = sample
        append(sample.speed * 3.6)
    }
    private fun append(value: Double?) { graph.add(value); if (graph.size > 120) graph.removeAt(0) }
    fun current(now: Long): Double? = last?.takeIf { now - it.time in 0..3000 }?.speed?.times(3.6)
    fun sprinting(now: Long) = current(now) != null && counted
}

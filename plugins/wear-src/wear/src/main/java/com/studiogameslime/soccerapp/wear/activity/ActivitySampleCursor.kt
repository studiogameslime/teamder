package com.studiogameslime.soccerapp.wear.activity

/** Bounded per-metric cursor in server time; recalibration cannot replay an earlier interval. */
class ActivitySampleCursor {
    private val ends = mutableMapOf<String, Double>()
    fun claim(metric: String, from: Double, to: Double, point: Boolean): Boolean {
        if (!from.isFinite() || !to.isFinite() || to < from) return false
        val previous = ends[metric]
        if (previous != null && (if (point) to <= previous else from < previous)) return false
        ends[metric] = to
        return true
    }
}

package com.studiogameslime.soccerapp.wear.activity

/** Mirrors the documented wire limits. Reject outliers; never clamp or invent a value. */
object ActivitySampleProtocol {
    fun valid(start: Long, end: Long, metric: String, value: Number): Boolean {
        val amount = value.toDouble()
        if (!amount.isFinite() || start <= 0 || end < start || end - start > 300_000) return false
        val seconds = (end - start) / 1000.0
        return when (metric) {
            "speedMps" -> start == end && amount in 0.0..12.0
            "heartRateBpm" -> amount in 25.0..240.0
            "distanceM" -> end > start && amount in 0.0..4000.0 && amount <= seconds * 12
            "steps" -> end > start && amount in 0.0..2000.0 && amount % 1.0 == 0.0 && amount <= seconds * 5
            "calories" -> end > start && amount in 0.0..300.0 && amount <= seconds
            else -> false
        }
    }
}

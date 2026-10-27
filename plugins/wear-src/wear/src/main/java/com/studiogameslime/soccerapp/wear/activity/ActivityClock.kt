package com.studiogameslime.soccerapp.wear.activity

/** NTP-style four timestamps. The phone timestamps are already in server time. */
data class ActivityClock(val offsetMs: Double, val uncertaintyMs: Double, val measuredAtMs: Long) {
    fun uncertaintyAt(now: Long): Double = uncertaintyMs + (now - measuredAtMs).coerceAtLeast(0) * 0.0001
    fun fresh(now: Long): Boolean = now - measuredAtMs in 0..300_000 && uncertaintyAt(now) in 0.0..2_000.0
    companion object {
        fun resolve(sent: Long, phoneReceived: Long, phoneSent: Long, received: Long, phoneUncertaintyMs: Double): ActivityClock? {
            if (received < sent || phoneSent < phoneReceived || !phoneUncertaintyMs.isFinite() || phoneUncertaintyMs < 0) return null
            val wire = (received - sent) - (phoneSent - phoneReceived)
            if (wire < 0 || wire > 4_000) return null
            val offset = ((phoneReceived - sent).toDouble() + (phoneSent - received).toDouble()) / 2
            // Both hops contribute their measured half-RTT uncertainty.
            return ActivityClock(offset, wire / 2.0 + phoneUncertaintyMs, received)
        }
    }
}

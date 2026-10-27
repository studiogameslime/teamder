package com.studiogameslime.soccerapp.wear.activity

/** Half-open eligibility windows. Never interpolate values across bench or pause gaps. */
class ActivityGate {
    data class Window(val start: Long, var end: Long)
    private val windows = mutableListOf<Window>()
    private var open: Window? = null
    private var round = ""
    fun update(at: Long, eligible: Boolean, validUntil: Long, roundId: String) {
        val current = open
        if (current != null) current.end = minOf(current.end, at)
        open = null
        if (eligible && roundId.isNotBlank() && validUntil > at) {
            val next = Window(at, validUntil)
            if (current != null && current.end == at && round == roundId) {
                current.end = validUntil; open = current
            } else { windows.add(next); open = next }
        }
        round = roundId
    }
    fun accepts(start: Long, end: Long, point: Boolean = false): Boolean {
        if (end < start || (!point && end == start)) return false
        return windows.any { start >= it.start && if (point) end < it.end else end <= it.end }
    }
    fun close(at: Long) { update(at, false, at, "") }
}

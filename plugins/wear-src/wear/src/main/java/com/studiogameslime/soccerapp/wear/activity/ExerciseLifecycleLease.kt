package com.studiogameslime.soccerapp.wear.activity

/** One recorder owns the process until its asynchronous Health Services cleanup completes. */
class ExerciseLifecycleLease {
    private var sequence = 0L
    private var owner: Long? = null
    @Synchronized fun acquire(): Long? {
        if (owner != null) return null
        sequence += 1
        owner = sequence
        return sequence
    }
    @Synchronized fun owns(token: Long?): Boolean = token != null && owner == token
    @Synchronized fun release(token: Long?): Boolean {
        if (!owns(token)) return false
        owner = null
        return true
    }
}

/** A journal instance can mutate only the persisted session it created. */
class ActivitySessionBinding {
    private var sessionId: String? = null
    fun bind(id: String): Boolean {
        if (sessionId != null || id.isBlank()) return false
        sessionId = id
        return true
    }
    fun matches(id: String?): Boolean = sessionId != null && sessionId == id
    fun unbound(): Boolean = sessionId == null
}

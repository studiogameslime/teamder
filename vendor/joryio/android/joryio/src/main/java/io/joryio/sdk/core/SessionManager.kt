package io.joryio.sdk.core

import io.joryio.sdk.models.SessionInfo
import java.util.Date
import java.util.UUID

/**
 * Manages user sessions with automatic timeout
 */
internal class SessionManager(
    private val storage: StorageManager,
    private val logger: Logger,
    private val sessionTimeout: Long = 1800000 // 30 minutes
) {
    // Guards every read-modify-write of currentSession. Session state is touched
    // from the RN module thread, Dispatchers.Main, and the lifecycle observer, so
    // the id could otherwise diverge under concurrent rotation.
    private val lock = Any()

    @Volatile
    private var currentSession: SessionInfo? = null

    init {
        // Try to restore previous session
        val savedSession = storage.getSession()
        if (savedSession != null) {
            if (isSessionValid(savedSession)) {
                currentSession = savedSession
                logger.debug("Restored previous session: ${savedSession.sessionId}")
            } else {
                logger.debug("Previous session expired, will create new session")
            }
        }
    }

    /**
     * Get or create current session
     */
    fun getSession(): SessionInfo = synchronized(lock) {
        val session = currentSession

        // Create new session if needed
        if (session == null || !isSessionValid(session)) {
            return@synchronized startNewSessionLocked()
        }

        // Update last activity
        session.lastActivity = Date()
        storage.setSession(session)
        currentSession = session

        session
    }

    /**
     * Get current session ID
     */
    fun getSessionId(): String {
        return getSession().sessionId
    }

    /**
     * Start a new session
     */
    fun startNewSession(): SessionInfo = synchronized(lock) {
        startNewSessionLocked()
    }

    // Caller must hold [lock].
    private fun startNewSessionLocked(): SessionInfo {
        val sessionId = UUID.randomUUID().toString()
        val now = Date()

        val session = SessionInfo(
            sessionId = sessionId,
            sessionStart = now,
            lastActivity = now
        )

        currentSession = session
        storage.setSession(session)

        logger.info("Started new session: $sessionId")
        return session
    }

    /**
     * End current session
     */
    fun endSession() = synchronized(lock) {
        val session = currentSession
        if (session != null) {
            logger.info("Ending session: ${session.sessionId}")
            currentSession = null
            storage.clearSession()
        }
    }

    /**
     * Update last activity timestamp
     */
    fun updateActivity() = synchronized(lock) {
        val session = currentSession ?: return@synchronized
        session.lastActivity = Date()
        storage.setSession(session)
    }

    /**
     * Check if session is still valid
     */
    private fun isSessionValid(session: SessionInfo): Boolean {
        val now = Date()
        val timeSinceLastActivity = now.time - session.lastActivity.time
        return timeSinceLastActivity < sessionTimeout
    }

    /**
     * Get time until session expires
     */
    fun getTimeUntilExpiration(): Long? = synchronized(lock) {
        val session = currentSession ?: return@synchronized null
        val now = Date()
        val timeSinceLastActivity = now.time - session.lastActivity.time
        val remaining = sessionTimeout - timeSinceLastActivity
        if (remaining > 0) remaining else null
    }
}

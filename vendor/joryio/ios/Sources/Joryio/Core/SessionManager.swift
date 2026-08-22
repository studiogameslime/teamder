import Foundation

/// Manages user session lifecycle
class SessionManager {
    private let storage: StorageManager
    private let logger: Logger
    private let sessionTimeout: TimeInterval
    private var currentSession: SessionInfo

    init(storage: StorageManager, logger: Logger, sessionTimeout: TimeInterval) {
        self.storage = storage
        self.logger = logger
        self.sessionTimeout = sessionTimeout

        // Load existing session or create new one
        if let session = storage.getSession(), !session.isExpired(timeout: sessionTimeout) {
            self.currentSession = session
            logger.info("Resumed existing session: \(session.sessionId)")
        } else {
            self.currentSession = SessionInfo()
            storage.setSession(currentSession)
            logger.info("Started new session: \(currentSession.sessionId)")
        }
    }

    // MARK: - Session Access

    func getSession() -> SessionInfo {
        return currentSession
    }

    func getSessionId() -> String {
        return currentSession.sessionId
    }

    // MARK: - Session Lifecycle

    func updateActivity() {
        currentSession.updateActivity()
        storage.setSession(currentSession)
    }

    func checkAndRenewSession() {
        if currentSession.isExpired(timeout: sessionTimeout) {
            logger.info("Session expired, starting new session")
            startNewSession()
        } else {
            updateActivity()
        }
    }

    func startNewSession() {
        logger.info("Starting new session")

        currentSession = SessionInfo()
        storage.setSession(currentSession)

        logger.debug("New session started: \(currentSession.sessionId)")
    }

    func resetSession() {
        logger.info("Manually resetting session")

        storage.clearSession()
        currentSession = SessionInfo()
        storage.setSession(currentSession)

        logger.debug("Session reset: \(currentSession.sessionId)")
    }

    // MARK: - Session Info

    func getSessionDuration() -> TimeInterval {
        return Date().timeIntervalSince(currentSession.sessionStart)
    }

    func getTimeSinceLastActivity() -> TimeInterval {
        return Date().timeIntervalSince(currentSession.lastActivity)
    }

    func isSessionActive() -> Bool {
        return !currentSession.isExpired(timeout: sessionTimeout)
    }
}

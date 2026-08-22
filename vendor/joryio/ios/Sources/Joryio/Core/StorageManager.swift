import Foundation
import SQLite

/// Manages local storage for events, user data, and SDK state
class StorageManager {
    private let sdkKey: String
    private let logger: Logger
    private let userDefaults: UserDefaults
    private let keychain: KeychainHelper
    private let kcPendingAttributesAccount = "pending_attributes"
    private var db: Connection?

    // Keychain account names for the identity-linking secrets. These are stored
    // in the Keychain (device-only, after-first-unlock) rather than UserDefaults.
    // See getUserId/getDeviceToken below for the rationale on WHY only these two
    // move to the Keychain while anonymousId/session/deviceId stay in UserDefaults.
    private let kcUserIdAccount = "user_id"
    private let kcDeviceTokenAccount = "device_token"

    // Legacy UserDefaults key for the APNs token (was global/unprefixed in
    // PushNotificationManager). Kept only so we can migrate + clean it up.
    private let legacyDeviceTokenKey = "jry_device_token"

    // Serial queue that owns ALL SQLite access. SQLite.swift's Connection is not
    // safe for concurrent use; funnelling every DB operation through one serial
    // queue both serializes access and keeps the work off the main thread (the
    // queue manager's flush now runs off the main actor and blocks on this
    // queue instead of blocking the UI thread). Only LEAF db methods enter this
    // queue — never call one wrapped method from inside another (would deadlock).
    private let dbQueue = DispatchQueue(label: "com.joryio.sdk.storage")

    // UserDefaults keys
    private let anonymousIdKey: String
    private let userIdKey: String
    private let sessionKey: String
    private let attributesKey: String
    private let deviceIdKey: String

    init(sdkKey: String, logger: Logger) {
        self.sdkKey = sdkKey
        self.logger = logger
        self.userDefaults = UserDefaults.standard
        self.keychain = KeychainHelper(sdkKey: sdkKey, logger: logger)

        // Prefix keys with SDK key for multi-instance support
        let prefix = "hip_\(sdkKey)"
        self.anonymousIdKey = "\(prefix)_anonymous_id"
        self.userIdKey = "\(prefix)_user_id"
        self.sessionKey = "\(prefix)_session"
        self.attributesKey = "\(prefix)_attributes"
        self.deviceIdKey = "\(prefix)_device_id"

        initializeDatabase()

        // One-time migration of the identity-linking secrets out of UserDefaults
        // and into the Keychain. UserDefaults is already Data-Protection encrypted
        // at rest, so this is defense-in-depth + consistency: existing installs'
        // plaintext-in-UserDefaults copies are copied to the Keychain and then
        // removed from UserDefaults.
        migrateSecretToKeychain(userDefaultsKey: userIdKey, keychainAccount: kcUserIdAccount)
        migrateSecretToKeychain(userDefaultsKey: legacyDeviceTokenKey, keychainAccount: kcDeviceTokenAccount)
    }

    // MARK: - Database Setup

    private func initializeDatabase() {
        // Create the connection + tables on the DB queue so the Connection is
        // only ever touched from that queue. createTables() runs INSIDE this
        // block and must not re-enter dbQueue.
        dbQueue.sync {
            do {
                let dbURL = try getDatabaseURL()

                // Migrate an existing DB from the old Documents location before
                // we open the connection, so queued events survive the move.
                migrateLegacyDatabaseIfNeeded(to: dbURL)

                let connection = try Connection(dbURL.path)
                self.db = connection
                try createTables()

                // Encrypt at rest with an explicit protection class and keep the
                // DB out of device backups. Done AFTER the file exists on disk.
                applyAtRestProtection(to: dbURL)

                logger.debug("Database initialized at \(dbURL.path)")
            } catch {
                logger.error("Failed to initialize database: \(error.localizedDescription)")
            }
        }
    }

    /// Directory that holds the SQLite DB: Application Support/Joryio.
    ///
    /// Application Support (rather than Documents) keeps the event DB out of the
    /// user-visible Documents area. Combined with the explicit
    /// isExcludedFromBackup flag set in applyAtRestProtection(), the queue DB
    /// never lands in an iCloud/iTunes backup.
    private func getDatabaseDirectory() throws -> URL {
        let appSupport = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = appSupport.appendingPathComponent("Joryio", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private func getDatabaseURL() throws -> URL {
        return try getDatabaseDirectory().appendingPathComponent("joryio.db")
    }

    /// Old (pre-hardening) location: Documents/joryio.db.
    private func legacyDatabaseURL() -> URL? {
        guard let documents = try? FileManager.default.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        ) else {
            return nil
        }
        return documents.appendingPathComponent("joryio.db")
    }

    /// If a DB exists at the legacy Documents path and none exists at the new
    /// Application Support path, MOVE it so existing installs keep their queued
    /// events. Falls back gracefully (log + continue with a fresh DB) if the
    /// move fails.
    private func migrateLegacyDatabaseIfNeeded(to newURL: URL) {
        let fm = FileManager.default
        guard let legacyURL = legacyDatabaseURL() else { return }
        guard fm.fileExists(atPath: legacyURL.path) else { return }
        guard !fm.fileExists(atPath: newURL.path) else { return }

        do {
            try fm.moveItem(at: legacyURL, to: newURL)
            // Move any SQLite sidecar files (WAL/SHM) alongside the DB if present.
            for suffix in ["-wal", "-shm"] {
                let oldSidecar = URL(fileURLWithPath: legacyURL.path + suffix)
                let newSidecar = URL(fileURLWithPath: newURL.path + suffix)
                if fm.fileExists(atPath: oldSidecar.path) && !fm.fileExists(atPath: newSidecar.path) {
                    try? fm.moveItem(at: oldSidecar, to: newSidecar)
                }
            }
            logger.info("Migrated event DB from Documents to Application Support")
        } catch {
            // Non-fatal: a new empty DB will be created at newURL.
            logger.error("Failed to migrate legacy event DB, starting fresh: \(error.localizedDescription)")
        }
    }

    /// Exclude the DB directory from backups and set the file protection class.
    private func applyAtRestProtection(to dbURL: URL) {
        let fm = FileManager.default

        // Exclude the whole Joryio directory (and thus the DB + its WAL/SHM
        // sidecar files) from iCloud/iTunes device backups.
        if let dir = try? getDatabaseDirectory() {
            var dirURL = dir
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            do {
                try dirURL.setResourceValues(values)
            } catch {
                logger.error("Failed to exclude DB directory from backup: \(error.localizedDescription)")
            }
        }

        #if os(iOS)
        // Explicit protection class: completeUntilFirstUserAuthentication.
        //
        // NOT .complete: the SDK writes events from background / app-terminate
        // flushes when the device may be locked. .complete would make the file
        // inaccessible while locked and break those background writes.
        // .completeUntilFirstUserAuthentication keeps the file encrypted at rest
        // yet readable/writable once the device has been unlocked at least once
        // since boot — the right trade-off for a background event queue.
        do {
            try fm.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: dbURL.path
            )
        } catch {
            logger.error("Failed to set DB file protection: \(error.localizedDescription)")
        }
        #endif
    }

    private func createTables() throws {
        guard let db = db else { return }

        // Events queue table
        let events = Table("events")
        let id = Expression<Int64>("id")
        let eventData = Expression<String>("event_data")
        let createdAt = Expression<Date>("created_at")

        try db.run(events.create(ifNotExists: true) { t in
            t.column(id, primaryKey: .autoincrement)
            t.column(eventData)
            t.column(createdAt)
        })

        // In-app campaigns cache
        let campaigns = Table("in_app_campaigns")
        let campaignId = Expression<String>("campaign_id")
        let campaignData = Expression<String>("campaign_data")
        let cachedAt = Expression<Date>("cached_at")

        try db.run(campaigns.create(ifNotExists: true) { t in
            t.column(campaignId, primaryKey: true)
            t.column(campaignData)
            t.column(cachedAt)
        })

        logger.debug("Database tables created")
    }

    // MARK: - Anonymous ID

    func getAnonymousId() -> String {
        if let existingId = userDefaults.string(forKey: anonymousIdKey) {
            return existingId
        }

        let newId = UUID().uuidString
        userDefaults.set(newId, forKey: anonymousIdKey)
        logger.debug("Generated new anonymous ID: \(newId)")
        return newId
    }

    // MARK: - Device ID

    func getDeviceId() -> String {
        if let existingId = userDefaults.string(forKey: deviceIdKey) {
            return existingId
        }

        let newId = UUID().uuidString
        userDefaults.set(newId, forKey: deviceIdKey)
        logger.debug("Generated new device ID: \(newId)")
        return newId
    }

    // MARK: - User ID
    //
    // The userId is an identity-linking secret, so it lives in the Keychain
    // (encrypted at rest, device-only, available after first unlock) rather than
    // UserDefaults. anonymousId / session / deviceId deliberately STAY in
    // UserDefaults: they are already encrypted at rest by Data Protection, and
    // moving anonymous ids to the Keychain would change reinstall-persistence
    // semantics — Keychain items can survive an app uninstall, which would leak
    // an "anonymous" id across installs.

    func getUserId() -> String? {
        return keychain.getString(forKey: kcUserIdAccount)
    }

    func setUserId(_ userId: String?) {
        if let userId = userId {
            keychain.setString(userId, forKey: kcUserIdAccount)
            logger.debug("User ID set: \(userId)")
        } else {
            keychain.removeItem(forKey: kcUserIdAccount)
            logger.debug("User ID cleared")
        }
    }

    // MARK: - Registered push token

    /// The token+identity pair last CONFIRMED registered by the backend.
    ///
    /// Written only after a successful response: an optimistic marker would
    /// remember a FAILED registration as done and leave the device silently
    /// unreachable by push.
    func getRegisteredPushKey() -> String? {
        UserDefaults.standard.string(forKey: "joryio_registered_push_key")
    }

    func setRegisteredPushKey(_ value: String) {
        UserDefaults.standard.set(value, forKey: "joryio_registered_push_key")
    }

    // MARK: - Reported push permission

    /// The push-permission value most recently reported to the backend.
    ///
    /// Kept so the attribute is sent only when it CHANGES. Reporting on every
    /// launch and foreground would spend a request per app open restating a
    /// value that moves maybe twice in an install's lifetime. UserDefaults, not
    /// the Keychain: it is not a secret, and it should die with the app.
    func getReportedPushPermission() -> String? {
        UserDefaults.standard.string(forKey: "joryio_reported_push_permission")
    }

    func setReportedPushPermission(_ value: String) {
        UserDefaults.standard.set(value, forKey: "joryio_reported_push_permission")
    }

    // MARK: - APNs Device Token
    //
    // The APNs device token is an identity-linking, per-device secret and is
    // stored in the Keychain with ThisDeviceOnly accessibility (never synced to
    // iCloud Keychain, never migrated to another device via backup).

    // MARK: - Tracking opt-out
    //
    // PERSISTED. optOut() used to flip an in-memory flag only, so the next app
    // launch read the flag from config and the user was silently opted back in
    // - a consent bug, not a hygiene one. A withdrawal of consent has to
    // outlive the process that received it.
    //
    // Not PII (a boolean), so UserDefaults rather than the Keychain, and read
    // at init before anything is collected.
    private var optOutKey: String { "hip_\(sdkKey)_opted_out" }

    func getOptedOut() -> Bool {
        return userDefaults.bool(forKey: optOutKey)
    }

    func setOptedOut(_ value: Bool) {
        userDefaults.set(value, forKey: optOutKey)
    }

    // MARK: - Pending attribute writes (outbound queue)
    //
    // DELIBERATELY separate from the trait bag, which is never persisted. This
    // is not a cache of who the user is - it is UNDELIVERED WORK: the few keys
    // the app wrote that the server has not acknowledged. Lose it and the write
    // never happens; lose the trait bag and the server already has it.
    //
    // Keychain (device-only, after-first-unlock) rather than UserDefaults, for
    // the same reason the identity-linking secrets moved there. Cleared the
    // moment the server acks and purged on reset/opt-out, so it holds PII only
    // between a failed send and the next successful one.
    func getPendingAttributes() -> String? {
        return keychain.getString(forKey: kcPendingAttributesAccount)
    }

    func setPendingAttributes(_ json: String?) {
        guard let json, !json.isEmpty else {
            _ = keychain.setString("", forKey: kcPendingAttributesAccount)
            return
        }
        _ = keychain.setString(json, forKey: kcPendingAttributesAccount)
    }

    func clearPendingAttributes() {
        _ = keychain.setString("", forKey: kcPendingAttributesAccount)
    }

    func getDeviceToken() -> String? {
        return keychain.getString(forKey: kcDeviceTokenAccount)
    }

    func setDeviceToken(_ token: String) {
        keychain.setString(token, forKey: kcDeviceTokenAccount)
    }

    func clearDeviceToken() {
        keychain.removeItem(forKey: kcDeviceTokenAccount)
    }

    // MARK: - Secret Migration

    /// Copy a secret from UserDefaults into the Keychain once, then remove the
    /// UserDefaults copy. No-op if the value is absent or already in the Keychain.
    private func migrateSecretToKeychain(userDefaultsKey: String, keychainAccount: String) {
        guard let legacyValue = userDefaults.string(forKey: userDefaultsKey) else { return }
        if keychain.getString(forKey: keychainAccount) == nil {
            keychain.setString(legacyValue, forKey: keychainAccount)
        }
        userDefaults.removeObject(forKey: userDefaultsKey)
        logger.debug("Migrated secret '\(keychainAccount)' from UserDefaults to Keychain")
    }

    // MARK: - Session

    func getSession() -> SessionInfo? {
        guard let data = userDefaults.data(forKey: sessionKey),
              let session = try? JSONDecoder().decode(SessionInfo.self, from: data) else {
            return nil
        }
        return session
    }

    func setSession(_ session: SessionInfo) {
        guard let data = try? JSONEncoder().encode(session) else {
            logger.error("Failed to encode session")
            return
        }
        userDefaults.set(data, forKey: sessionKey)
        logger.debug("Session saved: \(session.sessionId)")
    }

    func clearSession() {
        userDefaults.removeObject(forKey: sessionKey)
        logger.debug("Session cleared")
    }

    // MARK: - User Attributes
    //
    // The user-attribute trait bag (email/phone/name/custom) is PII and is
    // NEVER persisted at rest — it is held in memory by IdentityManager for the
    // session only. The only durable operation kept here is a purge, used both
    // as a one-time cleanup on init and on reset()/logout, so any bag written
    // by an older SDK build is removed from existing installs.

    func clearUserAttributes() {
        userDefaults.removeObject(forKey: attributesKey)
        logger.debug("User attributes cleared")
    }

    // MARK: - Event Queue

    func enqueueEvent(_ event: Event) throws {
        // Encode off the queue (pure work), then do the write on the DB queue.
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let jsonData = try encoder.encode(event)
        guard let jsonString = String(data: jsonData, encoding: .utf8) else {
            throw StorageError.encodingFailed
        }

        try dbQueue.sync {
            guard let db = db else {
                throw StorageError.databaseNotInitialized
            }

            let events = Table("events")
            let eventData = Expression<String>("event_data")
            let createdAt = Expression<Date>("created_at")

            try db.run(events.insert(
                eventData <- jsonString,
                createdAt <- Date()
            ))

            logger.debug("Event enqueued: \(event.type)")
        }
    }

    func dequeueEvents(limit: Int) throws -> [Event] {
        return try dbQueue.sync {
            guard let db = db else {
                throw StorageError.databaseNotInitialized
            }

            let events = Table("events")
            let id = Expression<Int64>("id")
            let eventData = Expression<String>("event_data")

            var result: [Event] = []
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601

            for row in try db.prepare(events.order(id).limit(limit)) {
                if let data = row[eventData].data(using: .utf8),
                   let event = try? decoder.decode(Event.self, from: data) {
                    result.append(event)
                }
            }

            logger.debug("Dequeued \(result.count) events")
            return result
        }
    }

    func deleteEvents(count: Int) throws {
        try dbQueue.sync {
            guard let db = db else {
                throw StorageError.databaseNotInitialized
            }

            let events = Table("events")
            let id = Expression<Int64>("id")

            // Get IDs of the first N events, then delete them in ONE statement
            // (WHERE id IN (...)) instead of N separate DELETEs.
            let idsToDelete = try db.prepare(events.select(id).order(id).limit(count)).map { $0[id] }
            guard !idsToDelete.isEmpty else { return }
            try db.run(events.filter(idsToDelete.contains(id)).delete())

            logger.debug("Deleted \(idsToDelete.count) events from queue")
        }
    }

    func getQueueSize() -> Int {
        return dbQueue.sync {
            guard let db = db else { return 0 }

            let events = Table("events")
            return (try? db.scalar(events.count)) ?? 0
        }
    }

    func clearQueue() throws {
        try dbQueue.sync {
            guard let db = db else {
                throw StorageError.databaseNotInitialized
            }

            let events = Table("events")
            try db.run(events.delete())
            logger.debug("Event queue cleared")
        }
    }

    // MARK: - In-App Campaigns Cache

    func cacheCampaign(_ campaign: InAppCampaign) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let jsonData = try encoder.encode(campaign)
        guard let jsonString = String(data: jsonData, encoding: .utf8) else {
            throw StorageError.encodingFailed
        }

        try dbQueue.sync {
            guard let db = db else {
                throw StorageError.databaseNotInitialized
            }

            let campaigns = Table("in_app_campaigns")
            let campaignId = Expression<String>("campaign_id")
            let campaignData = Expression<String>("campaign_data")
            let cachedAt = Expression<Date>("cached_at")

            try db.run(campaigns.insert(or: .replace,
                campaignId <- campaign.id,
                campaignData <- jsonString,
                cachedAt <- Date()
            ))

            logger.debug("Campaign cached: \(campaign.id)")
        }
    }

    func getCachedCampaigns() throws -> [InAppCampaign] {
        return try dbQueue.sync {
            guard let db = db else {
                throw StorageError.databaseNotInitialized
            }

            let campaigns = Table("in_app_campaigns")
            let campaignData = Expression<String>("campaign_data")

            var result: [InAppCampaign] = []
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601

            for row in try db.prepare(campaigns) {
                if let data = row[campaignData].data(using: .utf8),
                   let campaign = try? decoder.decode(InAppCampaign.self, from: data) {
                    result.append(campaign)
                }
            }

            logger.debug("Retrieved \(result.count) cached campaigns")
            return result
        }
    }

    /// Get cached campaigns (returns empty array on error, for convenience)
    func getCachedCampaignsSafe() -> [InAppCampaign] {
        do {
            return try getCachedCampaigns()
        } catch {
            logger.error("Failed to get cached campaigns: \(error.localizedDescription)")
            return []
        }
    }

    /// Cache multiple campaigns at once
    func cacheCampaigns(_ campaigns: [InAppCampaign]) {
        for campaign in campaigns {
            do {
                try cacheCampaign(campaign)
            } catch {
                logger.error("Failed to cache campaign \(campaign.id): \(error.localizedDescription)")
            }
        }
    }

    func clearCampaignCache() throws {
        try dbQueue.sync {
            guard let db = db else {
                throw StorageError.databaseNotInitialized
            }

            let campaigns = Table("in_app_campaigns")
            try db.run(campaigns.delete())
            logger.debug("Campaign cache cleared")
        }
    }

    // MARK: - Clear All Data

    func clearAllData() {
        // Clear UserDefaults
        userDefaults.removeObject(forKey: anonymousIdKey)
        userDefaults.removeObject(forKey: userIdKey)
        userDefaults.removeObject(forKey: sessionKey)
        userDefaults.removeObject(forKey: attributesKey)

        // Clear Keychain-stored secrets (userId + APNs device token)
        keychain.removeItem(forKey: kcUserIdAccount)
        keychain.removeItem(forKey: kcDeviceTokenAccount)

        // Clear database
        do {
            try clearQueue()
            try clearCampaignCache()
        } catch {
            logger.error("Failed to clear database: \(error.localizedDescription)")
        }

        logger.info("All SDK data cleared")
    }

    // MARK: - Errors

    enum StorageError: Error {
        case databaseNotInitialized
        case encodingFailed
        case decodingFailed
    }
}

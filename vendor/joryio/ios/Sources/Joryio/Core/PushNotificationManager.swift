import Foundation
import UIKit
import UserNotifications

/// Manages push notifications (APNS)
class PushNotificationManager: NSObject {
    private let networkClient: NetworkClient
    private let identityManager: IdentityManager
    private let storage: StorageManager
    private let logger: Logger
    private weak var inAppMessaging: InAppMessagingManager?

    private var deviceToken: String?
    private var isRegistered = false

    init(
        networkClient: NetworkClient,
        identityManager: IdentityManager,
        storage: StorageManager,
        logger: Logger,
        inAppMessaging: InAppMessagingManager? = nil
    ) {
        self.networkClient = networkClient
        self.identityManager = identityManager
        self.storage = storage
        self.logger = logger
        self.inAppMessaging = inAppMessaging
        super.init()

        loadStoredDeviceToken()
    }

    // MARK: - Device Token Management

    /// Load stored device token from the Keychain (via StorageManager).
    /// The token is an identity-linking secret and is kept in the Keychain, not
    /// UserDefaults; see StorageManager for the accessibility/at-rest rationale.
    private func loadStoredDeviceToken() {
        if let token = storage.getDeviceToken() {
            self.deviceToken = token
            logger.debug("Loaded stored device token: \(token.prefix(20))...")
        }
    }

    /// Save device token to the Keychain (via StorageManager).
    private func saveDeviceToken(_ token: String) {
        self.deviceToken = token
        storage.setDeviceToken(token)
        logger.debug("Saved device token: \(token.prefix(20))...")
    }

    /// Get current device token
    func getDeviceToken() -> String? {
        return deviceToken
    }

    // MARK: - Push Registration

    /// Request push notification permissions
    func requestPermissions() async -> Bool {
        let center = UNUserNotificationCenter.current()

        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])

            // Register EITHER WAY. Alert authorization and remote-notification
            // registration are separate on iOS: registering yields a device
            // token without user consent, and that token can only ever deliver
            // BACKGROUND (content-available) pushes - it cannot display
            // anything without the authorization above.
            //
            // Gating registration on `granted` meant a user who declined the
            // prompt had no token, so the in-app sync nudge could never reach
            // them - typically a large share of an iOS audience, silently. It
            // also meant that if they later enabled notifications in Settings,
            // we still held no token until the next prompt.
            //
            // Airship and OneSignal both register unconditionally for the same
            // reasons. Disclose it in the privacy policy.
            await registerForRemoteNotifications()

            if granted {
                logger.info("Push notification permission granted")
                return true
            } else {
                logger.warn("Push notification permission denied")
                return false
            }
        } catch {
            logger.error("Failed to request push permissions: \(error.localizedDescription)")
            return false
        }
    }

    /// Register for remote notifications
    @MainActor
    private func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
        logger.debug("Registered for remote notifications")
    }

    /// Handle successful device token registration
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        // Convert token to string
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()

        logger.info("Received device token: \(tokenString.prefix(20))...")

        saveDeviceToken(tokenString)

        // Register with backend
        Task {
            await registerDeviceWithBackend(tokenString)
        }
    }

    /// Handle failed device token registration
    func didFailToRegisterForRemoteNotifications(error: Error) {
        logger.error("Failed to register for remote notifications: \(error.localizedDescription)")
    }

    /// Register a device token supplied directly as a hex string (used by the
    /// cross-platform bridge, which already has the token as a string).
    func registerDeviceToken(_ token: String) {
        logger.info("Registering supplied device token: \(token.prefix(20))...")
        saveDeviceToken(token)
        isRegistered = false
        Task {
            await registerDeviceWithBackend(token)
        }
    }

    /// Re-register the currently stored device token against the current
    /// identity. Called on identify()/reset() so a token captured under one
    /// identity is re-bound to the new one instead of staying with the old user.
    func reregisterDeviceToken() {
        guard let token = deviceToken else {
            logger.debug("No stored device token to re-register")
            return
        }
        isRegistered = false
        Task {
            await registerDeviceWithBackend(token, force: true)
        }
    }

    /// Retry a registration the backend never confirmed.
    ///
    /// Called on foreground. Transient failures are already retried inside the
    /// request, and a sustained outage is retried at the next init - but an app
    /// that STAYS OPEN after one would otherwise remain unreachable by push
    /// until relaunch, which for a long-lived session can be days.
    ///
    /// Cheap by construction: with a confirmed registration the guard inside
    /// registerDeviceWithBackend returns immediately without touching the network.
    func retryRegistrationIfUnconfirmed() {
        guard let token = deviceToken ?? storage.getDeviceToken() else { return }
        Task { await registerDeviceWithBackend(token) }
    }

    /// Track a push-notification click by tracking id (public entry point).
    func handlePushClick(trackingId: String) {
        Task {
            await trackPushClick(trackingId: trackingId)
        }
    }

    /// Register device token with backend
    private func registerDeviceWithBackend(_ token: String, force: Bool = false) async {
        let userId = identityManager.getUserId()
        let anonymousId = identityManager.getAnonymousId()

        // Skip a registration the backend already has. Apple's guidance is to
        // call registerForRemoteNotifications() on EVERY launch, so the delegate
        // fires each time and without this every app open spent a request
        // restating an unchanged token.
        //
        // Keyed by token+identity: the same token under a new user is a
        // different registration, which is what makes reset() work.
        let key = "\(token)|\(userId ?? anonymousId)"
        if !force, storage.getRegisteredPushKey() == key {
            logger.debug("Push token already registered for this identity; skipping")
            return
        }

        // Gather device info
        let deviceInfo = DeviceInfo.getDeviceInfo()

        do {
            try await networkClient.registerPushToken(
                userId: userId,
                anonymousId: anonymousId,
                deviceToken: token,
                // The same identity the track path sends, so the server joins
                // this token to the existing device row instead of inserting a
                // second one.
                deviceId: storage.getDeviceId(),
                deviceInfo: deviceInfo
            )

            isRegistered = true
            // Mark AFTER the backend confirms. Marking before would remember a
            // FAILED registration as done and leave the device permanently
            // unreachable by push.
            storage.setRegisteredPushKey(key)
            logger.info("Device token registered with backend successfully")
        } catch {
            logger.error("Failed to register device token with backend: \(error.localizedDescription)")
        }
    }

    // MARK: - Push Notification Handling

    /// Handle received push notification
    func didReceiveRemoteNotification(
        _ userInfo: [AnyHashable: Any],
        completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        logger.debug("Received remote notification: \(userInfo)")

        // A Joryio push is EITHER a campaign message or a silent sync nudge.
        // Gating on jry_campaign_id alone dropped every nudge before it reached
        // the handler below - so the sync branch could not have run even once.
        let campaignId = userInfo["jry_campaign_id"] as? String
        let syncType = userInfo["jry_sync"] as? String
        guard campaignId != nil || syncType != nil else {
            logger.debug("Not a Joryio notification, ignoring")
            completionHandler(.noData)
            return
        }

        // A silent nudge is not a delivered message: counting it as one would
        // add a phantom "received" to whatever campaign the tester was checking.
        if campaignId != nil {
            trackNotificationEvent(userInfo: userInfo, action: "received")
        }

        // Handle notification content
        handleNotificationContent(userInfo: userInfo)

        completionHandler(.newData)
    }

    /// Handle notification tap/interaction
    func didReceiveNotificationResponse(
        _ response: UNNotificationResponse,
        completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo

        logger.debug("User interacted with notification: \(response.actionIdentifier)")

        // Track push click if tracking ID is present
        if let trackingId = userInfo["trackingId"] as? String {
            Task {
                await trackPushClick(trackingId: trackingId)
            }
        } else {
            // Fallback to old tracking method
            trackNotificationEvent(userInfo: userInfo, action: "opened")
        }

        // Show anything triggered by the tap. Fire-and-forget: a
        // push_notification_tap campaign is a bonus on top of the tap, and a
        // failure here must not affect the deep link below.
        Task { await Joryio.shared.handlePushTapped() }

        // Handle deep link if present
        if let deepLink = userInfo["jry_deep_link"] as? String {
            handleDeepLink(deepLink)
        } else if let url = userInfo["jry_url"] as? String {
            handleURL(url)
        }

        completionHandler()
    }

    /// Track push notification click via backend endpoint
    private func trackPushClick(trackingId: String) async {
        do {
            try await networkClient.trackPushClick(trackingId: trackingId)
            logger.info("Tracked push click successfully")

            // Trigger in-app campaign sync after push click
            // This allows showing related in-app messages (e.g., coupon details after push about 20% off)
            await inAppMessaging?.syncCampaigns()
            logger.debug("Triggered in-app sync after push click")
        } catch {
            logger.error("Failed to track push click: \(error.localizedDescription)")
        }
    }

    /// Track notification event
    private func trackNotificationEvent(userInfo: [AnyHashable: Any], action: String) {
        guard let campaignId = userInfo["jry_campaign_id"] as? String else {
            return
        }

        // Track via network client
        // Note: This would need to be integrated with the main SDK's track method
        logger.debug("Tracked notification \(action) for campaign: \(campaignId)")
    }

    /// Handle notification content (for silent push or background processing)
    private func handleNotificationContent(userInfo: [AnyHashable: Any]) {
        // Check for silent push data sync
        if let syncType = userInfo["jry_sync"] as? String {
            logger.debug("Processing silent push sync: \(syncType)")

            switch syncType {
            case "campaigns", "in_app":
                // This branch used to log "Syncing campaigns" and DO NOTHING -
                // the comment said trigger, and there was no call. A silent
                // push woke the app and it went straight back to sleep.
                logger.debug("Silent push: syncing in-app campaigns")
                Task { await Joryio.shared.syncInAppCampaigns() }
            case "user_attributes":
                // Still a no-op, and now says so rather than implying a sync.
                logger.debug("Silent push: user_attributes sync is not implemented")
            default:
                logger.debug("Unknown sync type: \(syncType)")
            }
        }
    }

    /// Handle deep link
    private func handleDeepLink(_ deepLink: String) {
        guard let url = URL(string: deepLink) else {
            logger.error("Invalid deep link URL: \(deepLink)")
            return
        }

        logger.info("Opening deep link: \(deepLink)")

        Task { @MainActor in
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            } else {
                logger.error("Cannot open deep link: \(deepLink)")
            }
        }
    }

    /// Allowed URL schemes for push-driven navigation.
    /// Restricting to web schemes prevents open-redirect / intent-injection via
    /// crafted `jry_url` payloads (e.g. `file:`, `tel:`, custom app schemes).
    private static let allowedURLSchemes: Set<String> = ["http", "https"]

    /// Handle URL
    private func handleURL(_ urlString: String) {
        guard let url = URL(string: urlString) else {
            logger.error("Invalid URL: \(urlString)")
            return
        }

        guard let scheme = url.scheme?.lowercased(),
              Self.allowedURLSchemes.contains(scheme) else {
            logger.error("Rejected push URL with disallowed scheme: \(urlString)")
            return
        }

        logger.info("Opening URL: \(urlString)")

        Task { @MainActor in
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            } else {
                logger.error("Cannot open URL: \(urlString)")
            }
        }
    }

    // MARK: - Badge Management

    /// Update app badge count
    func updateBadgeCount(_ count: Int) {
        Task { @MainActor in
            UIApplication.shared.applicationIconBadgeNumber = count
            logger.debug("Updated badge count to: \(count)")
        }
    }

    /// Clear app badge
    func clearBadge() {
        updateBadgeCount(0)
    }

    // MARK: - Public API

    /// Check if push notifications are enabled
    func isPushEnabled() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        return settings.authorizationStatus == .authorized
    }

    /// Get notification settings
    func getNotificationSettings() async -> UNNotificationSettings {
        let center = UNUserNotificationCenter.current()
        return await center.notificationSettings()
    }

    /// Unregister from push notifications
    func unregister() {
        Task { @MainActor in
            UIApplication.shared.unregisterForRemoteNotifications()
            deviceToken = nil
            isRegistered = false
            storage.clearDeviceToken()
            logger.info("Unregistered from push notifications")
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushNotificationManager: UNUserNotificationCenterDelegate {
    /// Handle notification when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo

        logger.debug("Will present notification in foreground")

        // Track notification received
        trackNotificationEvent(userInfo: userInfo, action: "received_foreground")

        // Show notification even when app is in foreground
        completionHandler([.banner, .sound, .badge])
    }

    /// Handle notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        didReceiveNotificationResponse(response, completionHandler: completionHandler)
    }
}

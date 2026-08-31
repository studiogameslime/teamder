import Foundation
import UIKit
import UserNotifications

/// Manages push notifications (APNS)
/// The outcome of a push-token registration.
///
/// Mirrors Android's `PushRegistrationResult` exactly - same name, same fields,
/// same meanings - so an integrator reads one document for both platforms.
///
/// registerPushToken used to be pure fire-and-forget: its only reaction to a
/// rejection was a logger call, which is gated behind debug logging. A release
/// build could therefore fail to register on every single launch with nothing,
/// anywhere, saying so - the device was simply never reachable. An integrator
/// worked around it by polling diagnostics a few seconds later and comparing
/// timestamps against a global last-error, which is a lot of machinery to learn
/// something this function already knew and threw away.
public struct PushRegistrationResult {
    public let success: Bool
    /// Provider or transport message on failure; nil on success.
    public let message: String?
    /// A bad or missing SDK key - retrying will not fix it.
    public let isUnauthorized: Bool
    /// Transient (network, 5xx): the SDK will try again on next launch.
    public let isRetryable: Bool

    public init(
        success: Bool,
        message: String? = nil,
        isUnauthorized: Bool = false,
        isRetryable: Bool = false
    ) {
        self.success = success
        self.message = message
        self.isUnauthorized = isUnauthorized
        self.isRetryable = isRetryable
    }
}

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
    func registerDeviceToken(
        _ token: String,
        onResult: ((PushRegistrationResult) -> Void)? = nil
    ) {
        logger.info("Registering supplied device token: \(token.prefix(20))...")
        saveDeviceToken(token)
        isRegistered = false
        Task {
            await registerDeviceWithBackend(token, onResult: onResult)
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
    private func registerDeviceWithBackend(
        _ token: String,
        force: Bool = false,
        onResult: ((PushRegistrationResult) -> Void)? = nil
    ) async {
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
            // Already registered IS success. A caller that heard nothing here
            // would read a no-op as a silent failure - the very ambiguity this
            // callback removes.
            onResult?(PushRegistrationResult(success: true))
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
            onResult?(PushRegistrationResult(success: true))
        } catch {
            logger.error("Failed to register device token with backend: \(error.localizedDescription)")
            // Classified from THIS call's error.
            //
            // It used to read `networkClient.lastTransportError`, which does not
            // exist on NetworkClient - the property lives on JoryioSDK - so the
            // SDK did not compile. Pointing it at the SDK's copy would have
            // compiled and still been wrong: that property is shared, so a
            // concurrent request completing between the throw and the read
            // makes this callback describe someone else's failure. The caught
            // error IS this registration's outcome.
            let (message, isUnauthorized) = Self.describe(error)
            onResult?(
                PushRegistrationResult(
                    success: false,
                    message: message,
                    isUnauthorized: isUnauthorized,
                    // Anything not an auth rejection is worth another launch.
                    isRetryable: !isUnauthorized
                )
            )
        }
    }

    /// Turn a registration failure into something an integrator can act on.
    ///
    /// `isUnauthorized` is the one distinction that matters to a host app: a
    /// rejected SDK key is a thing they can FIX (wrong key, or a key for
    /// another workspace), everything else is worth retrying on next launch.
    /// NetworkError does not conform to LocalizedError, so localizedDescription
    /// alone would report "The operation couldn't be completed" for every one
    /// of these.
    static func describe(_ error: Error) -> (message: String, isUnauthorized: Bool) {
        guard let netError = error as? NetworkClient.NetworkError else {
            return (error.localizedDescription, false)
        }
        switch netError {
        case .unauthorized:
            return ("SDK key rejected by the server (401)", true)
        case let .sdkAuthError(reason, endpoint, _):
            return ("SDK authentication failed (\(reason)) at \(endpoint)", true)
        case let .httpError(code):
            // 403 is an authorization refusal too - retrying it forever without
            // saying so is how a mis-scoped key looks like a flaky network.
            return ("Server returned HTTP \(code)", code == 401 || code == 403)
        case let .rateLimited(retryAfter):
            let suffix = retryAfter.map { " - retry after \(Int($0))s" } ?? ""
            return ("Rate limited by the server\(suffix)", false)
        case .invalidURL:
            return ("Invalid API endpoint configured", false)
        case .invalidResponse:
            return ("Unreadable response from the server", false)
        case .unknown:
            return ("Network request failed", false)
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
            // The delivery RECEIPT - distinct from the analytics event above.
            // This one becomes `message.delivered`, the only push delivery
            // signal with evidence behind it: APNs answers a send with
            // "accepted" and never reports what reached the handset.
            reportDelivered(userInfo: userInfo)
        }

        // Handle notification content
        handleNotificationContent(userInfo: userInfo)

        completionHandler(.newData)
    }

    /// Fire-and-forget delivery receipt.
    ///
    /// Never throws into the notification path: this method's job is to handle
    /// a message, and telemetry must not be able to stop it.
    ///
    /// COVERAGE, stated plainly: this fires when the app process is running -
    /// foreground, or backgrounded with content-available. A notification
    /// delivered while the app is fully suspended is handled by the
    /// Notification Service Extension, which runs in a SEPARATE process without
    /// the SDK's endpoint or key, so it cannot report from there today. Closing
    /// that gap needs an App Group the host app configures, so the SDK can
    /// share its config with the extension. Until then iOS delivery is a
    /// LOWER BOUND, and undercounting is the right direction for a metric whose
    /// whole purpose is to stop overstating delivery.
    private func reportDelivered(userInfo: [AnyHashable: Any]) {
        guard let trackingId = userInfo["trackingId"] as? String,
              !trackingId.isEmpty else { return }
        reportDelivered(trackingId: trackingId)
    }

    /// Report a delivery by trackingId, for a host that received the push itself.
    ///
    /// Split out of the userInfo variant above rather than duplicated: an app
    /// with its own notification handling never routes through ours, so it has
    /// the trackingId but not our extraction. Android has exposed exactly this
    /// (Joryio.reportPushDelivered) all along; iOS had the capability and no
    /// public way in.
    func reportDelivered(trackingId: String) {
        guard !trackingId.isEmpty else { return }
        Task { [weak self] in
            do {
                try await self?.networkClient.reportPushDelivered(trackingId: trackingId)
            } catch {
                self?.logger.debug("Delivery receipt failed: \(error.localizedDescription)")
            }
        }
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

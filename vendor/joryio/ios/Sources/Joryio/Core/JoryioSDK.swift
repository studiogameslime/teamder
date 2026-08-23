import Foundation
import UIKit
import UserNotifications

/// Main Joryio SDK class
public class Joryio {
    // Singleton instance
    public static let shared = Joryio()

    private var sdkKey: String!
    private var apiEndpoint: String!
    private var config: JoryioConfig!
    private var logger: Logger!
    private var storage: StorageManager!
    private var identity: IdentityManager!
    private var session: SessionManager!
    private var network: NetworkClient!
    private var queue: QueueManager!
    private var inAppMessaging: InAppMessagingManager!
    private var pushNotifications: PushNotificationManager!
    /// Thread-safe holder for the optional SDK-authentication token + handler.
    /// Created at initialize() from config; shared with NetworkClient.
    private var authStore: SdkAuthTokenStore!

    /// Coalescing window for attribute writes; see scheduleAttributeFlush().
    private static let attributeFlushDebounceMs: UInt64 = 800
    private var attributeFlushTask: Task<Void, Never>?
    /// Serializes attribute flushes so a burst of setAttributes becomes one
    /// request rather than several overlapping ones.
    private let flushLock = NSLock()
    private var isFlushingAttributes = false
    private var flushAgainRequested = false

    private var isInitialized = false
    private var isOptedOut = false

    /**
     How in-app messages get drawn. Base names no view class - that is what
     lets the rendering layer ship as a separate product an app can omit.

     Discovered from `JoryioUI` at initialize() when that product is linked, so
     adding it is the whole integration step and there is no register() call to
     forget. Nil means no UI product and no host callback: messages are simply
     not displayed, which is correct for an analytics-and-push-only app.
     */
    #if canImport(UIKit)
    public var inAppPresenter: InAppMessagePresenter?
    #endif

    /**
     Look for the optional UI product.

     `NSClassFromString` rather than a compile-time reference, because a
     compile-time reference is exactly the coupling the split removes. The name
     is module-qualified, which is how Swift exposes classes to the Objective-C
     runtime. Absence is expected and logged at debug: "no UI product" is a
     deliberate integration, not an error.
     */
    #if canImport(UIKit)
    internal func discoverInAppPresenter() -> InAppMessagePresenter? {
        // The module name DIFFERS BY PACKAGE MANAGER, which is easy to miss:
        //
        //   SwiftPM    JoryioUI is its own target  -> "JoryioUI.Default…"
        //   CocoaPods  Joryio/UI is a SUBSPEC of the Joryio pod, and subspecs
        //              share one module -> "Joryio.Default…"
        //
        // Looking up only the SwiftPM name meant every CocoaPods integration -
        // which is every React Native app - found no presenter and displayed
        // nothing, silently, because the "not linked" branch logs at debug.
        let candidates = [
            "JoryioUI.DefaultInAppMessagePresenter",
            "Joryio.DefaultInAppMessagePresenter",
        ]

        for name in candidates {
            if let cls = NSClassFromString(name) as? NSObject.Type,
               let presenter = cls.init() as? InAppMessagePresenter {
                logger?.info("In-app rendering available (\(name))")
                return presenter
            }
        }

        // WARN, not debug. An app that linked the UI product and still gets no
        // messages needs to see this; an analytics-only app can ignore it.
        logger?.warn(
            "No in-app presenter found - the UI product is not linked, so in-app "
                + "messages will NOT be displayed. Add JoryioUI (SwiftPM) or "
                + "pod 'Joryio/UI' (CocoaPods) if you want them."
        )
        return nil
    }
    #endif

    /// Cached e-commerce tracker, so repeated `ecommerce()` calls do not each
    /// build a new one. Replaced when a caller passes a fresh config.
    private var _ecommerce: EcommerceTracker?

    private init() {
        // Private initializer for singleton
    }

    /// Log a "not initialized" message safely.
    /// `logger` is nil until `initialize()` runs, so a pre-init API call must
    /// not touch it — otherwise the guard's else branch crashes on nil-deref.
    /// This keeps pre-init calls a safe no-op, matching the Android/web SDKs.
    private func logNotInitialized(_ method: String = #function) {
        if let logger = logger {
            logger.error("SDK not initialized. Call initialize() first. [\(method)]")
        } else {
            print("[Joryio] SDK not initialized. Call initialize() first. [\(method)]")
        }
    }

    // MARK: - Initialization

    /// Initialize the SDK with SDK key and API host
    /// - Parameters:
    ///   - sdkKey: Your SDK key (e.g., "jry_sdk_ios_abc123...")
    ///   - apiHost: API host (e.g., "api-eu1.joryio.com")
    ///   - config: Optional configuration for additional settings
    /// Show enough of a key to compare two, without printing a credential.
    private static func maskKey(_ key: String?) -> String {
        guard let key, key.count > 8 else { return key ?? "nil" }
        return "\(key.prefix(12))…\(key.suffix(4))"
    }

    /// The most recent transport failure, or nil if the last request succeeded.
    ///
    /// The SDK knew it was being rejected and only wrote it to the log, so a
    /// host app's status display could show a confident "initialized" while
    /// every single request came back 401. A status indicator that cannot see
    /// the transport is vouching for something it has no knowledge of.
    public private(set) var lastTransportError: JoryioTransportError?

    /// The endpoint this SDK is ACTUALLY sending to.
    ///
    /// Exposed so a host app can display the live value instead of the config
    /// it believes it set. Those two diverge the moment `initialize` is called
    /// twice, and a console that shows intent rather than reality turns a
    /// one-line misconfiguration into a long debugging session - which is
    /// exactly what happened on 2026-08-12.
    public var currentApiEndpoint: String? { apiEndpoint }

    public func initialize(sdkKey: String, apiHost: String, config: JoryioConfig? = nil) {
        guard !isInitialized else {
            // Re-initialisation is NOT supported: managers, timers, the queue
            // and the session are all built at init, and swapping the endpoint
            // underneath them would leave half the SDK talking to the old host.
            //
            // But say so LOUDLY when the caller asked for something different.
            // This used to `print` and return, so an app that changed its API
            // host kept sending to the previous one and looked broken with no
            // explanation - the SDK reported "initialized", the app displayed
            // the new host, and every request failed against the old one.
            let requested = apiHost.hasPrefix("http://") || apiHost.hasPrefix("https://")
                ? apiHost
                : "https://\(apiHost)"
            // Name WHAT differs. Reporting only the endpoint printed two
            // identical hosts when it was the KEY that changed, which told the
            // reader nothing - that happened on 2026-08-12 and sent the
            // debugging in the wrong direction for twenty minutes.
            var differences: [String] = []
            if requested != apiEndpoint {
                differences.append("apiHost (using \(apiEndpoint ?? "nil"), not \(requested))")
            }
            if sdkKey != self.sdkKey {
                differences.append("sdkKey (using \(Self.maskKey(self.sdkKey)), not \(Self.maskKey(sdkKey)))")
            }
            if !differences.isEmpty {
                let message = "initialize() called again with a different "
                    + differences.joined(separator: " and ")
                    + ". The new values are IGNORED - restart the app to apply them."
                if let logger { logger.error(message) } else { print("[Joryio] ERROR: \(message)") }
            } else {
                logger?.debug("initialize() called again with the same configuration; ignoring")
            }
            return
        }

        // Validate SDK key.
        //
        // Loudly, but WITHOUT crashing: fatalError here killed the host app on
        // launch, for every user, over a copy-paste mistake in a configuration
        // string. An analytics SDK must never be the reason an app cannot start.
        // Android already took this position deliberately ("log a prominent
        // error and stay in a no-send state"), so iOS was also the odd one out.
        //
        // `isInitialized` stays false, which every tracking entry point already
        // guards on, so the SDK sends nothing and the app runs normally.
        guard sdkKey.hasPrefix("jry_sdk_ios_") else {
            print(
                "[Joryio] ERROR: Invalid SDK key format: keys must start with "
                    + "'jry_sdk_ios_'. The SDK will NOT send any data. Copy your SDK key "
                    + "from the Joryio dashboard."
            )
            return
        }

        // Validate API host — same posture.
        guard !apiHost.isEmpty else {
            print(
                "[Joryio] ERROR: apiHost is empty. The SDK will NOT send any data. "
                    + "Pass your API host to initialize()."
            )
            return
        }

        // Store SDK key and construct endpoint
        self.sdkKey = sdkKey

        // Build full API endpoint URL
        if apiHost.hasPrefix("http://") || apiHost.hasPrefix("https://") {
            self.apiEndpoint = apiHost
        } else {
            self.apiEndpoint = "https://\(apiHost)"
        }

        // Use provided config or create default
        self.config = config ?? JoryioConfig()

        // Initialize logger
        self.logger = Logger(enabled: self.config.enableDebug, logLevel: self.config.logLevel)
        logger.info("Initializing Joryio SDK v\(SDK_VERSION)")
        logger.debug("SDK Key: \(sdkKey)")
        logger.debug("API Host: \(apiHost)")
        logger.debug("API Endpoint: \(self.apiEndpoint ?? "unknown")")

        // Build the SDK-authentication token store from config (opt-in).
        self.authStore = SdkAuthTokenStore(
            enabled: self.config.enableSdkAuthentication,
            initialToken: self.config.sdkAuthenticationToken
        )
        if self.config.enableSdkAuthentication {
            logger.info("SDK authentication enabled; attaching X-Joryio-Auth to ingest requests")
        }

        // Initialize core components
        self.storage = StorageManager(sdkKey: sdkKey, logger: logger)

        // Check opt-out status. The PERSISTED flag wins on its own: a user who
        // called optOut() last run must stay opted out even if the host app
        // still passes the default config, which is the common case and used to
        // silently opt them back in on every launch.
        //
        // MUST come after `storage` is assigned. It used to sit ~15 lines
        // earlier, where `self.storage` is still nil - and being an implicitly
        // unwrapped optional, reading it there crashed the HOST APP on every
        // fresh launch rather than failing soft. Keep this below the assignment.
        if self.storage.getOptedOut() || self.config.optOut || self.config.trackingConsent == .denied {
            logger.warn("User has opted out of tracking")
            isOptedOut = true
        }
        self.identity = IdentityManager(
            storage: storage,
            logger: logger,
            initialUserId: self.config.userId
        )
        self.session = SessionManager(
            storage: storage,
            logger: logger,
            sessionTimeout: self.config.sessionTimeout
        )
        self.network = NetworkClient(
            sdkKey: sdkKey,
            apiEndpoint: self.apiEndpoint,
            logger: logger,
            maxRetries: self.config.maxRetries,
            retryBackoffMs: self.config.retryBackoffMs,
            requestTimeout: self.config.requestTimeout,
            authStore: authStore
        )
        self.queue = QueueManager(
            storage: storage,
            network: network,
            logger: logger,
            batchSize: self.config.batchSize,
            flushInterval: self.config.flushInterval,
            maxQueueSize: self.config.maxQueueSize,
            sendImmediately: self.config.sendImmediately
        )
        self.inAppMessaging = InAppMessagingManager(
            networkClient: network,
            storage: storage,
            identityManager: identity,
            sessionManager: session,
            logger: logger,
            allowHtmlJsInAppMessages: config?.inApp.allowHtmlJsInAppMessages ?? false
        )
        self.pushNotifications = PushNotificationManager(
            networkClient: network,
            identityManager: identity,
            storage: storage,
            logger: logger,
            inAppMessaging: inAppMessaging
        )

        // Set push notification delegate
        UNUserNotificationCenter.current().delegate = pushNotifications

        isInitialized = true

        // Report the permission state now the SDK is live. Cheap: it only sends
        // when the value differs from the last one reported.
        Task { await reportPushPermissionIfChanged() }

        // Recover a device token the OS delivered before we existed.
        registerPendingDeviceTokenIfAny()

        // Opt-in auto-prompt. Unlike Android this needs no Activity, so it can
        // fire straight away rather than waiting for a foreground. Still opt-in:
        // see JoryioConfig.requestPushPermissionAtLaunch for why the default is
        // off. requestPushPermission() reports the outcome itself.
        if self.config.requestPushPermissionAtLaunch {
            logger.info("requestPushPermissionAtLaunch is on; asking now")
            Task { _ = await self.requestPushPermission() }
        }

        // Find JoryioUI if it is linked. Without this call the property stays
        // nil and NO in-app message is ever displayed on iOS - a declared-but-
        // uncalled function is exactly the failure this codebase has produced
        // five times now, so InAppPresenterDiscoveryTests asserts the wiring
        // rather than trusting it.
        #if canImport(UIKit)
        if inAppPresenter == nil {
            inAppPresenter = discoverInAppPresenter()
        }
        #endif

        // Track session start if enabled
        if self.config.trackSessionStart {
            trackSessionStartEvent()
        }

        // Route transport outcomes to `lastTransportError`, so a host app can
        // display what the SDK is EXPERIENCING rather than only that it was
        // configured. `initialized` and `the server accepts us` are different
        // claims, and conflating them is what made a 401 loop look healthy.
        network.onTransportFailure = { [weak self] error in
            let unauthorized: Bool
            if let netError = error as? NetworkClient.NetworkError {
                switch netError {
                case .unauthorized, .sdkAuthError: unauthorized = true
                case .httpError(let code): unauthorized = code == 401 || code == 403
                default: unauthorized = false
                }
            } else {
                unauthorized = false
            }
            self?.lastTransportError = JoryioTransportError(
                message: error.localizedDescription,
                isUnauthorized: unauthorized,
            )
        }
        network.onTransportSuccess = { [weak self] in
            self?.lastTransportError = nil
        }

        // Setup lifecycle observers
        setupLifecycleObservers()

        // Sync in-app campaigns for this SESSION START.
        //
        // Without this, the only sync triggers were willEnterForeground and a
        // received push - and willEnterForeground does NOT fire on a cold
        // launch, only on a background->foreground transition. So an app that
        // was killed and reopened never fetched campaigns at all, and an in-app
        // message would appear only if the user happened to background the app
        // and come back. Session start is when every comparable SDK syncs.
        Task { [weak self] in
            await self?.inAppMessaging.syncCampaigns()
        }

        logger.info("SDK initialized successfully")
    }

    // MARK: - Event Tracking

    /// Track a custom event
    public func track(_ eventName: String, properties: EventProperties = [:]) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping event tracking")
            return
        }

        // Update session activity
        session.checkAndRenewSession()

        // Create event
        let event = Event(
            type: eventName,
            properties: properties,
            timestamp: Date(),
            userId: identity.getUserId(),
            anonymousId: identity.getAnonymousId(),
            sessionId: session.getSessionId()
        )

        // Enqueue event
        queue.enqueue(event)

        logger.debug("Event tracked: \(eventName)")

        // Show anything waiting on this event - locally, no round trip. AFTER
        // the event is queued: the event is data and must be recorded whether
        // or not it triggers a message. Triggering is a display decision, not
        // a substitute for analytics.
        inAppMessaging?.onEventTracked(eventName, properties: properties)
    }

    /// Track a screen view
    public func trackScreen(_ screenName: String, properties: EventProperties = [:]) {
        var props = properties
        props["screen_name"] = screenName
        track("Screen Viewed", properties: props)
    }

    // MARK: - User Identification

    /// Identify a user
    public func identify(_ userId: String) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping identification")
            return
        }

        // Update local identity
        identity.identify(userId: userId)

        // Re-register the stored device token against the new identity so a
        // token first captured while anonymous becomes bound to this user.
        pushNotifications.reregisterDeviceToken()

        // Send to server
        Task {
            do {
                let request = IdentifyRequest(userId: userId, attributes: [:])
                try await network.identify(request)
                logger.info("User identified on server: \(userId)")
            } catch {
                logger.error("Failed to identify user on server: \(error.localizedDescription)")
            }
        }

        // Track identify event
        track("$identify")
    }

    /// Alias anonymous user to identified user
    public func alias(_ userId: String) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping alias")
            return
        }

        let anonymousId = identity.getAnonymousId()

        // Update local identity
        identity.alias(userId: userId)

        // Send to server
        Task {
            do {
                let request = AliasRequest(anonymousId: anonymousId, userId: userId)
                try await network.alias(request)
                logger.info("User aliased on server: \(anonymousId) -> \(userId)")
            } catch {
                logger.error("Failed to alias user on server: \(error.localizedDescription)")
            }
        }

        // Track alias event
        track("$alias", properties: [
            "anonymous_id": anonymousId,
            "user_id": userId
        ])
    }

    /// Reset user identity (on logout)
    public func reset() {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        logger.info("Resetting SDK state")

        // Flush pending events for the outgoing identity first.
        flush()

        // Reset identity
        identity.reset()

        // Start new session
        session.resetSession()

        // Clear in-app displayed/impression state so the next user never sees
        // the previous user's campaigns (matches web/Android reset semantics).
        inAppMessaging.clear()

        // Re-associate the device token with the fresh anonymous identity so a
        // new user does not inherit the previous user's token association.
        pushNotifications.reregisterDeviceToken()

        logger.info("SDK state reset complete")
    }

    // MARK: - User Attributes

    /// Set multiple user attributes
    public func setAttributes(_ attributes: UserAttributes) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping setAttributes")
            return
        }

        // Save locally
        identity.setAttributes(attributes)

        // A differential-sync campaign may be waiting on one of these. Cheap:
        // returns immediately unless a campaign actually watches the key.
        inAppMessaging?.attributesDidChange(Array(attributes.keys))

        // Not acknowledged until the server says so. Recorded BEFORE the
        // attempt so a failure needs no special handling - the value is
        // already queued, and the flush below either clears it or leaves it
        // for the next trigger.
        identity.pending.mark(attributes)

        scheduleAttributeFlush()
    }

    /**
     Send everything the server has not acknowledged, and clear what it took.

     Retried rather than dropped: this is called after every `setAttributes`,
     on foreground, and before an in-app sync. A failure leaves the values
     queued, so the next trigger picks them up - which is what makes an
     attribute set while offline survive.

     Sends the whole pending set, not just the newest call: if three writes
     failed while offline, reconnecting must deliver all three.
     */
    /**
     Coalesce a burst of writes into one request.

     An app that sets six attributes on launch should produce ONE request, not
     six - the cost on a phone is the radio, and six round trips inside a second
     is the shape the queue exists to avoid. Braze and CleverTap batch profile
     updates for the same reason.

     A debounce rather than a fixed interval: a single write - the common case -
     still goes out promptly, and only a burst is held. The window is short
     enough to be invisible next to sync latency, and nothing waits on it: the
     foreground and pre-sync paths flush IMMEDIATELY, bypassing this entirely,
     so an attribute set while offline is never held back by a timer.
     */
    private func scheduleAttributeFlush() {
        attributeFlushTask?.cancel()
        attributeFlushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.attributeFlushDebounceMs * 1_000_000)
            guard !Task.isCancelled else { return }
            await self?.flushPendingAttributes()
        }
    }

    func flushPendingAttributes() async {
        // Serialize + coalesce. Without this, an app calling setAttributes
        // several times in a row fires that many overlapping requests, each
        // carrying the same growing pending set - the radio cost the queue was
        // meant to reduce. A request arriving mid-flight sets a flag instead,
        // and one follow-up flush covers everything it added.
        flushLock.lock()
        if isFlushingAttributes {
            flushAgainRequested = true
            flushLock.unlock()
            return
        }
        isFlushingAttributes = true
        flushLock.unlock()

        defer {
            flushLock.lock()
            isFlushingAttributes = false
            let again = flushAgainRequested
            flushAgainRequested = false
            flushLock.unlock()
            if again { Task { await flushPendingAttributes() } }
        }

        let toSend = identity.pending.pendingAttributes()
        guard !toSend.isEmpty else { return }

        do {
            let request = SetAttributesRequest(
                userId: identity.getUserId(),
                anonymousId: identity.getAnonymousId(),
                attributes: toSend
            )
            try await network.setAttributes(request)
            // Clears only keys whose value is still the one we sent, so a
            // write that landed mid-flight stays pending instead of being
            // acked away.
            identity.pending.acknowledge(toSend)
            logger.info("Attributes sent to server (\(toSend.count))")
        } catch {
            logger.error(
                "Failed to send attributes, will retry: \(error.localizedDescription)"
            )
        }
    }

    /// Set a single user attribute
    public func setAttribute(_ key: String, value: Any) {
        setAttributes([key: value])
    }

    /// Increment a numeric attribute
    public func incrementAttribute(_ key: String, by value: Double = 1.0) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping incrementAttribute")
            return
        }

        // In-memory optimistic echo only (for in-session getAttribute read-back).
        identity.incrementAttribute(key, by: value)

        // Send the DELTA as an atomic `$inc` op — never a locally-computed
        // absolute — so concurrent devices don't clobber the counter.
        Task {
            do {
                let request = SetAttributesRequest(
                    userId: identity.getUserId(),
                    anonymousId: identity.getAnonymousId(),
                    increment: [key: value]
                )
                try await network.setAttributes(request)
            } catch {
                logger.error("Failed to send incremented attribute: \(error.localizedDescription)")
            }
        }
    }

    /// Remove a user attribute
    public func unsetAttribute(_ key: String) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping unsetAttribute")
            return
        }

        identity.unsetAttribute(key)

        // Send an atomic `$unset` op.
        Task {
            do {
                let request = SetAttributesRequest(
                    userId: identity.getUserId(),
                    anonymousId: identity.getAnonymousId(),
                    unset: [key]
                )
                try await network.setAttributes(request)
            } catch {
                logger.error("Failed to send unset attribute: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Privacy Controls

    /// Opt out of tracking
    public func optOut() {
        // Record the withdrawal on the profile BEFORE stopping, while sending
        // is still permitted. Looks contradictory - it is a consent RECORD, not
        // tracking, and it is the only way the server learns the user opted out
        // on this device (CleverTap does the same). Best-effort: it must never
        // block the opt-out itself.
        //
        // A record, not enforcement: it lands as a profile attribute that
        // targeting can exclude on. Server-side suppression is a separate
        // decision.
        if !isOptedOut, isInitialized {
            let ack = identity.pending.pendingAttributes()
            Task { [weak self] in
                guard let self else { return }
                let request = SetAttributesRequest(
                    userId: self.identity.getUserId(),
                    anonymousId: self.identity.getAnonymousId(),
                    attributes: ["$tracking_opted_out": true]
                )
                try? await self.network.setAttributes(request)
                _ = ack
            }
        }

        isOptedOut = true
        storage?.setOptedOut(true)

        // Everything collected BEFORE consent was withdrawn but not yet sent is
        // dropped, not delivered later. An opt-out that still uploads what was
        // queued a moment earlier is not an opt-out.
        attributeFlushTask?.cancel()
        identity?.pending.clear()
        queue?.clearQueue()

        logger.info("User opted out of tracking")
    }

    /**
     Delete everything this SDK has stored on the device.

     Deliberately SEPARATE from optOut(). "Stop collecting" and "delete what you
     already have" are different requests - Braze splits them the same way - and
     conflating them means neither can be done precisely. This is the one an
     erasure request needs.

     Does not opt the user out: call optOut() as well if that is also intended.
     */
    public func wipeData() {
        attributeFlushTask?.cancel()
        queue?.clearQueue()
        identity?.pending.clear()
        identity?.reset()
        storage?.clearUserAttributes()
        storage?.clearPendingAttributes()
        storage?.clearSession()
        storage?.clearDeviceToken()
        inAppMessaging?.clear()
        logger.info("Local SDK data wiped")
    }

    /// Opt back in to tracking
    public func optIn() {
        isOptedOut = false
        storage?.setOptedOut(false)
        logger.info("User opted in to tracking")
    }

    /// Get current opt-out status
    public func isUserOptedOut() -> Bool {
        return isOptedOut
    }

    // MARK: - SDK Authentication

    /// Supply/replace the customer-minted SDK-authentication JWT.
    ///
    /// Call this once after `initialize()` (or seed via
    /// `JoryioConfig.sdkAuthenticationToken`), and again from inside your
    /// `setSdkAuthenticationErrorHandler` closure whenever the SDK reports a
    /// rejected token. Thread-safe: the token is stored under a lock and read
    /// on the network thread, so a value set here is picked up by in-flight and
    /// future ingest requests. No-op unless `enableSdkAuthentication` is set.
    public func setSdkAuthenticationToken(_ token: String) {
        guard isInitialized else {
            logNotInitialized()
            return
        }
        if !config.enableSdkAuthentication {
            logger.warn("setSdkAuthenticationToken called but enableSdkAuthentication is false; ignoring")
            return
        }
        authStore.setToken(token)
        logger.debug("SDK authentication token updated")
    }

    /// Register a handler invoked when an ingest request is rejected with an
    /// SDK-authentication error. The handler receives the reason + endpoint
    /// context; respond by minting a fresh JWT and calling
    /// `setSdkAuthenticationToken(_:)`. The SDK then retries the failed request
    /// once with the new token. No-op unless `enableSdkAuthentication` is set.
    public func setSdkAuthenticationErrorHandler(_ handler: @escaping (SdkAuthError) -> Void) {
        guard isInitialized else {
            logNotInitialized()
            return
        }
        authStore.setHandler(handler)
    }

    // MARK: - Queue Management

    /// Manually flush the event queue
    /// E-commerce tracking helper - the standard product / cart / checkout /
    /// purchase events, with a default currency applied to each.
    ///
    /// This accessor is what the e-commerce documentation has always shown
    /// (`Joryio.shared.ecommerce(...)`), but it did not exist: `EcommerceTracker`
    /// was public and constructible, and nothing on this class returned one, so
    /// every documented iOS snippet failed to compile.
    ///
    /// - Parameter config: pass to change the currency or auto-tracking flags.
    ///   Omit to reuse the existing tracker.
    ///
    /// ```swift
    /// let ecommerce = Joryio.shared.ecommerce(config: EcommerceConfig(currency: "USD"))
    /// ecommerce.viewProduct(EcommerceProduct(productId: "SKU123", name: "Blue Shirt", price: 29.99))
    /// ```
    @discardableResult
    public func ecommerce(config: EcommerceConfig? = nil) -> EcommerceTracker {
        // Deliberately usable before initialize(): the tracker only forwards to
        // track(), which already queues and warns when uninitialised. Throwing
        // here would punish an app that builds its tracker in a property
        // initialiser - a very ordinary thing to do.
        if let config {
            let tracker = EcommerceTracker(sdk: self, config: config)
            _ecommerce = tracker
            return tracker
        }
        if let existing = _ecommerce { return existing }
        let tracker = EcommerceTracker(sdk: self)
        _ecommerce = tracker
        return tracker
    }

    public func flush() {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        queue.flushSync()
    }

    /// Get current queue size
    public func getQueueSize() -> Int {
        guard isInitialized else { return 0 }
        return queue.getQueueSize()
    }

    // MARK: - Identity Access

    /// Get current user ID
    public func getUserId() -> String? {
        guard isInitialized else { return nil }
        return identity.getUserId()
    }

    /// Get anonymous ID
    public func getAnonymousId() -> String {
        guard isInitialized else { return "" }
        return identity.getAnonymousId()
    }

    /// Get user identity
    public func getIdentity() -> (userId: String?, anonymousId: String) {
        guard isInitialized else { return (nil, "") }
        return (identity.getUserId(), identity.getAnonymousId())
    }

    // MARK: - Session Access

    /// Get current session ID
    public func getSessionId() -> String {
        guard isInitialized else { return "" }
        return session.getSessionId()
    }

    /// Get session info
    public func getSessionInfo() -> (sessionId: String, sessionStart: Date, duration: TimeInterval) {
        guard isInitialized else { return ("", Date(), 0) }
        let sessionInfo = session.getSession()
        return (
            sessionInfo.sessionId,
            sessionInfo.sessionStart,
            session.getSessionDuration()
        )
    }

    // MARK: - In-App Messaging

    /// Manually sync in-app campaigns from server
    /// Show any in-app waiting on a push tap. Called by PushNotificationManager.
    internal func handlePushTapped() async {
        await inAppMessaging?.onPushTapped()
    }

    public func syncInAppCampaigns() async {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping campaign sync")
            return
        }

        await inAppMessaging.syncCampaigns()
    }

    /// Manually trigger campaign evaluation
    public func evaluateInAppCampaigns() async {
        guard isInitialized else {
            logNotInitialized()
            return
        }
        guard requireDebug("evaluateInAppCampaigns") else { return }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping campaign evaluation")
            return
        }

        await inAppMessaging.evaluateCampaigns()
    }

    /// Reset displayed campaigns (for testing/debugging)
    /// Take over in-app display: the SDK hands you the campaign and draws
    /// nothing itself, so a host app can render messages with its own UI.
    ///
    /// Matches Android's `setInAppMessageCallback`. Without it an iOS app had no
    /// way to render in-app messages itself - the SDK either drew them or
    /// nothing happened.
    ///
    /// A host that renders its own UI MUST report what happened via
    /// `trackInAppImpression`, or frequency caps and reporting never see the
    /// message.
    /// - Parameter capabilities: what YOUR renderer can draw, e.g.
    ///   `["content.native"]` for a game canvas, adding `"content.html"` only if
    ///   you host a WebView. Nil keeps the SDK describing its OWN renderer,
    ///   which is what every existing caller gets and is wrong only in the sense
    ///   that it describes views that will not run. Declaring is strictly
    ///   better: the server targets campaigns on this, and its rollup resolves
    ///   an absent capability to "no" rather than to "unknown". Matches Android.
    public func setInAppMessageCallback(
        _ callback: @escaping (InAppCampaign) -> Void,
        capabilities: [String]? = nil
    ) {
        guard isInitialized else {
            logNotInitialized()
            return
        }
        inAppMessaging.hostCapabilities = capabilities
        // Wrapped to count handoffs, so the SDK can say something when a host
        // takes messages and reports none of them. Matches Android.
        inAppMessaging.onMessageReady = { [weak self] campaign in
            self?.inAppHandedOff += 1
            callback(campaign)
            self?.warnIfInAppNeverReported()
        }
    }

    // Host-rendered in-app messages report nothing unless the host calls
    // trackInAppImpression, and the failure is silent: the campaign spends its
    // frequency budget, emits no in_app.displayed, and reads as delivered to
    // nobody. Nothing else in the system can notice - the server sees an SDK
    // that synced campaigns and never showed one, which is indistinguishable
    // from an audience nobody matched.
    private var inAppHandedOff = 0
    private var inAppReported = 0
    private var warnedAboutUnreportedInApp = false

    /// Warn once when a host takes in-app messages and reports none.
    ///
    /// Threshold of 3 rather than 1: a host may legitimately decline to show a
    /// particular message, and one unreported handoff proves nothing. Three is
    /// an integration that has not wired reporting at all. Logged rather than
    /// thrown, and once rather than per message - this is a correctness hint for
    /// a developer, not a runtime fault.
    private func warnIfInAppNeverReported() {
        guard !warnedAboutUnreportedInApp, inAppReported == 0, inAppHandedOff >= 3 else { return }
        warnedAboutUnreportedInApp = true
        logger.warn(
            "\(inAppHandedOff) in-app messages were handed to your callback and none were reported. "
                + "Call trackInAppImpression(campaignId:action:) with \"displayed\"/\"clicked\"/\"dismissed\" "
                + "when you render one, or campaign analytics will show zero displays while these "
                + "messages still consume the frequency budget."
        )
    }

    /// Report an in-app impression for a message YOU rendered.
    ///
    /// `action` is `displayed`, `clicked` or `dismissed`. Matches Android's
    /// method of the same name. Only needed alongside
    /// `setInAppMessageCallback`; the SDK reports its own rendering.
    public func trackInAppImpression(campaignId: String, action: String) {
        guard isInitialized else {
            logNotInitialized()
            return
        }
        inAppReported += 1
        inAppMessaging.trackHostImpression(campaignId: campaignId, action: action)
    }

    public func resetDisplayedCampaigns() {
        guard isInitialized else {
            logNotInitialized()
            return
        }
        guard requireDebug("resetDisplayedCampaigns") else { return }
        inAppMessaging.resetDisplayedCampaigns()
    }

    /// Gate for the QA-only calls that CHANGE behaviour.
    ///
    /// Only the mutating ones are gated. `resetDisplayedCampaigns` wipes real
    /// frequency caps and `evaluateInAppCampaigns` can force a message on
    /// screen; called in production - a stray line, or a snippet copied from a
    /// QA guide - they corrupt capping and reporting for real users.
    ///
    /// The read-only diagnostics (getQueueSize, getSessionInfo, getIdentity,
    /// getDeviceToken, currentApiEndpoint, lastTransportError) are deliberately
    /// NOT gated: they cannot damage anything, and a support screen wants them
    /// most in production - where gating would also force verbose logging on
    /// just to read a session id.
    private func requireDebug(_ method: String) -> Bool {
        guard config?.enableDebug == true else {
            logger?.warn(
                "\(method) is a testing API and is ignored unless enableDebug is on. It changes "
                    + "live state (frequency caps / message display), so it must not run in a "
                    + "production build."
            )
            return false
        }
        return true
    }

    // MARK: - Push Notifications

    /// Request push notification permissions
    @discardableResult
    public func requestPushPermission() async -> Bool {
        guard isInitialized else {
            logNotInitialized()
            return false
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping push permissions")
            return false
        }

        let granted = await pushNotifications.requestPermissions()
        await reportPushPermissionIfChanged()
        return granted
    }

    /// Where the user stands on notifications, without asking them anything.
    ///
    /// Check this BEFORE showing a primer. `notDetermined` is the only state in
    /// which the system prompt can still appear - iOS allows exactly one ask, and
    /// a denial is recoverable only in Settings - so a primer shown to an already
    /// denied user spends their goodwill on a prompt that can never be displayed.
    ///
    /// Values match the Android SDK's `PushPermissionStatus` so cross-platform
    /// code can branch on one vocabulary: `granted`, `denied`, `notDetermined`.
    public func getPushPermissionStatus() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .authorized, .provisional, .ephemeral:
            return "granted"
        @unknown default:
            // A status Apple adds later is not automatically "safe to prompt":
            // treating an unknown as notDetermined would burn the one ask.
            return "denied"
        }
    }

    /// Reserved attribute carrying the notification-permission state.
    ///
    /// No `$` prefix: contact attributes are written to Mongo as
    /// `attributes.<key>` dotted paths, where a `$`-prefixed key breaks.
    public static let pushPermissionAttribute = "push_permission"

    /// Report the notification-permission state as a user attribute, but ONLY
    /// when it changed since we last reported it.
    ///
    /// This is what makes a push primer measurable: without it a marketer cannot
    /// target "has never been asked" - the only audience a primer can help - nor
    /// tell whether primers move opt-in. Change-detection is not an optimisation:
    /// attributes are not deduplicated server-side, so unconditional reporting
    /// would cost a request per launch and per foreground.
    private func reportPushPermissionIfChanged() async {
        guard isInitialized, !isOptedOut else { return }
        // snake_case on the wire, deliberately. getPushPermissionStatus returns
        // "notDetermined" because that is the vocabulary of the JS/Swift API,
        // but the ATTRIBUTE must read identically on every platform or a
        // marketer segmenting on it needs one value per SDK. Android reports
        // NOT_DETERMINED.lowercase() = "not_determined"; iOS matches it here.
        let api = await getPushPermissionStatus()
        let current = api == "notDetermined" ? "not_determined" : api
        guard storage.getReportedPushPermission() != current else { return }
        storage.setReportedPushPermission(current)
        logger.debug("Push permission changed to \(current); reporting")
        setAttribute(Joryio.pushPermissionAttribute, value: current)
    }

    /// Register a push token supplied as a hex string (e.g. from a
    /// cross-platform bridge that already has the APNs token as a string).
    /// Mirrors the Android SDK's `registerPushToken(String)`.
    public func registerPushToken(_ token: String) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        guard !isOptedOut else {
            logger.debug("User opted out, skipping push token registration")
            return
        }

        pushNotifications.registerDeviceToken(token)

        // Refresh push_permission: ARRIVING HERE IS EVIDENCE. iOS does not hand
        // out a device token without authorisation, so a token in hand settles
        // the question regardless of what was last reported.
        //
        // Otherwise the attribute refreshes on init and on foreground, and a
        // host app that grants permission after init and registers its own
        // token - every React Native integration using Firebase Messaging, for
        // instance - can sit on a stale not_determined until the next
        // foreground. That is the common path: the prompt is deliberately
        // deferred until after sign-up in most apps, and init always runs
        // first. A segment on push_permission = granted then excludes real,
        // reachable users. Matches Android.
        Task { await reportPushPermissionIfChanged() }
    }

    /// Track a push-notification click by tracking id.
    /// Mirrors the Android SDK's `trackPushClick(String)`.
    public func trackPushClick(trackingId: String) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        pushNotifications.handlePushClick(trackingId: trackingId)
    }

    /// Handle device token registration (call from AppDelegate)
    public func didRegisterForRemoteNotifications(deviceToken: Data) {
        guard isInitialized else {
            // Do NOT drop it. iOS delivers this from the OS, and an app that
            // calls initialize() after (or whose init is slow) would otherwise
            // lose the token entirely - the device then never registers for push
            // until the NEXT token event, which may be weeks away. Android has
            // always persisted it (PendingTokenStore) and recovered it at init;
            // iOS simply logged "not initialized" and returned.
            Joryio.stashPendingDeviceToken(deviceToken.map { String(format: "%02.2hhx", $0) }.joined())
            return
        }

        pushNotifications.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    /// Holds a device token that arrived before initialize().
    ///
    /// UserDefaults rather than the Keychain: at this point there is no SDK, no
    /// logger and no storage manager - the whole point is that nothing is set up
    /// yet. It is moved into the Keychain by registerPushToken as soon as init
    /// completes, and cleared immediately so it cannot linger.
    private static let pendingDeviceTokenKey = "joryio_pending_device_token"

    private static func stashPendingDeviceToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: pendingDeviceTokenKey)
        print("[Joryio] Device token arrived before initialize(); stored for registration at init.")
    }

    /// Register (and clear) a token captured before initialize(). Mirrors
    /// Android's PushNotificationManager.bootstrapToken.
    private func registerPendingDeviceTokenIfAny() {
        guard let token = UserDefaults.standard.string(forKey: Joryio.pendingDeviceTokenKey) else { return }
        UserDefaults.standard.removeObject(forKey: Joryio.pendingDeviceTokenKey)
        logger.info("Registering push token captured before init")
        pushNotifications.registerDeviceToken(token)
    }

    /// Handle failed device token registration (call from AppDelegate)
    public func didFailToRegisterForRemoteNotifications(error: Error) {
        guard isInitialized else {
            logNotInitialized()
            return
        }

        pushNotifications.didFailToRegisterForRemoteNotifications(error: error)
    }

    /// Handle received push notification (call from AppDelegate)
    public func didReceiveRemoteNotification(
        _ userInfo: [AnyHashable: Any],
        completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard isInitialized else {
            logNotInitialized()
            completionHandler(.noData)
            return
        }

        pushNotifications.didReceiveRemoteNotification(userInfo, completionHandler: completionHandler)
    }

    /// Get current device token
    public func getDeviceToken() -> String? {
        guard isInitialized else { return nil }
        return pushNotifications.getDeviceToken()
    }

    /// Check if push notifications are enabled
    public func isPushEnabled() async -> Bool {
        guard isInitialized else { return false }
        return await pushNotifications.isPushEnabled()
    }

    /// Update app badge count
    public func updateBadgeCount(_ count: Int) {
        guard isInitialized else { return }
        pushNotifications.updateBadgeCount(count)
    }

    /// Clear app badge
    public func clearBadge() {
        guard isInitialized else { return }
        pushNotifications.clearBadge()
    }

    /// Unregister from push notifications
    public func unregisterPush() {
        guard isInitialized else { return }
        pushNotifications.unregister()
    }

    // MARK: - Lifecycle Observers

    private func setupLifecycleObservers() {
        // App entering background
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.onAppBackgrounded()
        }

        // App entering foreground
        NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.onAppForegrounded()
        }

        // App terminating
        NotificationCenter.default.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.onAppTerminating()
        }
    }

    private func onAppBackgrounded() {
        logger.debug("App backgrounded")
        // Send what we have, then stop the periodic timer. Nothing stopped it
        // before: harmless for an app iOS suspends, but an app with a background
        // mode (audio, navigation, VoIP) keeps running, and there the SDK woke
        // every 5 seconds indefinitely to inspect an empty queue. Events tracked
        // while backgrounded are still queued and go out on the next foreground.
        flush()
        queue?.suspendPeriodicFlush()
    }

    private func onAppForegrounded() {
        logger.debug("App foregrounded")
        // Resume periodic flushing (stopped on background).
        queue?.resumePeriodicFlush()
        // Settings changes happen while we are backgrounded; foreground is the
        // only moment we can notice one.
        Task { await reportPushPermissionIfChanged() }

        // No-op when the backend already confirmed this token; retries only a
        // registration that failed.
        pushNotifications.retryRegistrationIfUnconfirmed()
        session.checkAndRenewSession()

        if let config = config, config.trackSessionStart {
            let timeSinceLastActivity = session.getTimeSinceLastActivity()
            if timeSinceLastActivity > config.sessionTimeout {
                trackSessionStartEvent()
            }
        }

        // Retry attributes BEFORE syncing: anything set while offline should
        // be in the profile by the time targeting is evaluated, otherwise the
        // sync decides on data we know to be stale and the message appears one
        // foreground later than it should.
        Task {
            await flushPendingAttributes()
            await inAppMessaging.syncCampaigns()
        }
    }

    private func onAppTerminating() {
        logger.debug("App terminating")
        flush()
    }

    private func trackSessionStartEvent() {
        let deviceId = storage.getDeviceId()
        let properties = DeviceInfo.getTrackingProperties(deviceId: deviceId)
        track("Session Start", properties: properties)
    }
}

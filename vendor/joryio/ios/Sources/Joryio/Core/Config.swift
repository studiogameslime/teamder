import Foundation

/// SDK version
public let SDK_VERSION = "1.1.0"

/// Default configuration constants
public struct ConfigDefaults {
    public static let batchSize = 50
    public static let flushInterval: TimeInterval = 5.0
    public static let maxQueueSize = 1000
    public static let maxRetries = 3
    public static let retryBackoffMs = 1000.0
    public static let requestTimeout: TimeInterval = 10.0
    public static let sessionTimeout: TimeInterval = 30 * 60 // 30 minutes
}

// MARK: - In-App Messaging Configuration

/// Display options for in-app messages
public struct InAppDisplayOptions {
    public let defaultPosition: MessagePosition
    public let defaultAnimation: MessageAnimation
    public let backdropColor: String
    public let closeButtonColor: String
    public let zIndex: Int

    public enum MessagePosition: String {
        case top
        case center
        case bottom
    }

    public enum MessageAnimation: String {
        case fade
        case slide
        case none
    }

    public init(
        defaultPosition: MessagePosition = .center,
        defaultAnimation: MessageAnimation = .fade,
        backdropColor: String = "rgba(0, 0, 0, 0.5)",
        closeButtonColor: String = "#333333",
        zIndex: Int = 999999
    ) {
        self.defaultPosition = defaultPosition
        self.defaultAnimation = defaultAnimation
        self.backdropColor = backdropColor
        self.closeButtonColor = closeButtonColor
        self.zIndex = zIndex
    }
}

/// Evaluation mode for in-app campaigns
///
/// `client-side` was removed. It served one response shared across users, so it
/// could not carry per-user content, and it was the DEFAULT here - so any
/// integration that did not set this explicitly got the one mode that could not
/// personalise. Both surviving modes still trigger locally, with no round trip.
public enum EvaluationMode: String {
    case differentialSync = "differential-sync"
    case sessionStartOnly = "session-start-only"
}

/// In-app messaging configuration
public struct InAppConfig {
    public let enabled: Bool

    /// Allow in-app messages authored as HTML, which can execute JavaScript
    /// inside your app.
    ///
    /// OFF BY DEFAULT.
    ///
    /// The server strips `<script>` and every `on*` handler before sending, so
    /// author JavaScript does not run in normal operation. The document is
    /// still rendered in a web view that can execute script - this SDK's own
    /// bridge runs there - so the residual risk is a sanitiser bypass, where a
    /// compromised marketing account would mean code executing in every user's
    /// session. Hence opt-in, and hence the `Js` in the name.
    ///
    /// Leaving this off does NOT disable in-app messaging: native messages
    /// still display, because they are data rendered by this SDK's own views
    /// with no interpreter involved. Only HTML campaigns are skipped.
    public let allowHtmlJsInAppMessages: Bool

    public let evaluationMode: EvaluationMode
    public let syncInterval: TimeInterval
    public let displayOptions: InAppDisplayOptions
    public let onMessageDisplay: ((InAppMessage) -> Void)?
    public let onMessageClick: ((InAppMessage, String) -> Void)?
    public let onMessageDismiss: ((InAppMessage) -> Void)?

    public init(
        enabled: Bool = true,
        allowHtmlJsInAppMessages: Bool = false,
        evaluationMode: EvaluationMode = .differentialSync,
        syncInterval: TimeInterval = 60.0,
        displayOptions: InAppDisplayOptions = InAppDisplayOptions(),
        onMessageDisplay: ((InAppMessage) -> Void)? = nil,
        onMessageClick: ((InAppMessage, String) -> Void)? = nil,
        onMessageDismiss: ((InAppMessage) -> Void)? = nil
    ) {
        self.enabled = enabled
        self.allowHtmlJsInAppMessages = allowHtmlJsInAppMessages
        self.evaluationMode = evaluationMode
        self.syncInterval = syncInterval
        self.displayOptions = displayOptions
        self.onMessageDisplay = onMessageDisplay
        self.onMessageClick = onMessageClick
        self.onMessageDismiss = onMessageDismiss
    }
}

// MARK: - Main Configuration

/// Main SDK configuration
/// NOTE: `captureUTM`, `persistQueue`, `resetSessionOnNewCampaign` and
/// `trackPageProperties` were REMOVED (2026-08-16). They were declared, stored
/// and read by nothing - web-SDK concepts (URL parameters, page views) copied
/// into the mobile config and never implemented. Leaving them was worse than a
/// gap: an app setting `captureUTM: false` believed it had switched something
/// off that had never been on. If mobile deep-link attribution is built later,
/// add the flag back at that point and wire it.
public struct JoryioConfig {
    // User Identification
    public let userId: String?
    public let anonymousId: String?

    // Batching & Performance
    public let batchSize: Int
    public let flushInterval: TimeInterval
    public let sendImmediately: Bool
    public let maxQueueSize: Int

    // Session Management
    public let sessionTimeout: TimeInterval
    /// Ask for notification permission automatically, right after `initialize()`.
    ///
    /// **Off by default, and that default is the recommendation.** iOS shows the
    /// system prompt exactly once; a refusal is permanent short of a trip to
    /// Settings. Firing it at launch - before the user has any reason to want
    /// notifications from you - is how apps spend their single ask for nothing.
    /// Braze exposes the same capability behind the same kind of flag, and both
    /// Braze and OneSignal document the soft-prompt-first pattern as the way to
    /// use it.
    ///
    /// Turn it on only when notifications ARE the product (a messaging or alerts
    /// app, where a user who declines has no reason to be there). Otherwise show
    /// a primer - the `request_push_permission` in-app button action - and call
    /// `requestPushPermission()` when the user says yes.
    public let requestPushPermissionAtLaunch: Bool

    public let trackSessionStart: Bool

    // UTM Tracking

    // In-App Messaging
    public let inApp: InAppConfig

    // Storage

    // Network & Retry
    public let maxRetries: Int
    public let retryBackoffMs: Double
    public let requestTimeout: TimeInterval

    // SDK Authentication (JWT-based, opt-in)
    /// When true, the app supplies a customer-minted JWT that the SDK attaches
    /// as `X-Joryio-Auth` to every ingest request and refreshes on a 401.
    /// Disabled by default — leaving this false keeps behaviour unchanged.
    public let enableSdkAuthentication: Bool
    /// Optional initial JWT to seed the token store at initialization. The app
    /// may also (or instead) call `setSdkAuthenticationToken(_:)` after init.
    public let sdkAuthenticationToken: String?

    // Privacy & GDPR
    public let respectDoNotTrack: Bool
    public let optOut: Bool
    public let trackingConsent: TrackingConsent

    // Debugging
    public let enableDebug: Bool
    public let logLevel: LogLevel

    public enum TrackingConsent: String {
        case granted
        case denied
        case pending
    }

    public enum LogLevel: String {
        case error
        case warn
        case info
        case debug
    }

    public init(
        userId: String? = nil,
        anonymousId: String? = nil,
        batchSize: Int = ConfigDefaults.batchSize,
        flushInterval: TimeInterval = ConfigDefaults.flushInterval,
        sendImmediately: Bool = false,
        maxQueueSize: Int = ConfigDefaults.maxQueueSize,
        sessionTimeout: TimeInterval = ConfigDefaults.sessionTimeout,
        trackSessionStart: Bool = true,
        requestPushPermissionAtLaunch: Bool = false,
        inApp: InAppConfig = InAppConfig(),
        maxRetries: Int = ConfigDefaults.maxRetries,
        retryBackoffMs: Double = ConfigDefaults.retryBackoffMs,
        requestTimeout: TimeInterval = ConfigDefaults.requestTimeout,
        enableSdkAuthentication: Bool = false,
        sdkAuthenticationToken: String? = nil,
        respectDoNotTrack: Bool = true,
        optOut: Bool = false,
        trackingConsent: TrackingConsent = .granted,
        enableDebug: Bool = false,
        logLevel: LogLevel = .error
    ) {
        self.userId = userId
        self.anonymousId = anonymousId
        self.batchSize = batchSize
        self.flushInterval = flushInterval
        self.sendImmediately = sendImmediately
        self.maxQueueSize = maxQueueSize
        self.sessionTimeout = sessionTimeout
        self.trackSessionStart = trackSessionStart
        self.requestPushPermissionAtLaunch = requestPushPermissionAtLaunch
        self.inApp = inApp
        self.maxRetries = maxRetries
        self.retryBackoffMs = retryBackoffMs
        self.requestTimeout = requestTimeout
        self.enableSdkAuthentication = enableSdkAuthentication
        self.sdkAuthenticationToken = sdkAuthenticationToken
        self.respectDoNotTrack = respectDoNotTrack
        self.optOut = optOut
        self.trackingConsent = trackingConsent
        self.enableDebug = enableDebug
        self.logLevel = logLevel
    }
}

// MARK: - User Attributes

/// User attributes/traits
public typealias UserAttributes = [String: Any]

/// Event properties
public typealias EventProperties = [String: Any]

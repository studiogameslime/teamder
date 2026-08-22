package io.joryio.sdk

/**
 * Configuration for Joryio SDK
 */
data class JoryioConfig(
    // User Identification
    val userId: String? = null,
    val anonymousId: String? = null,

    // Batching & Performance
    val batchSize: Int = 50,
    val flushInterval: Long = 5000, // milliseconds
    val sendImmediately: Boolean = false,
    val maxQueueSize: Int = 1000,

    // Session Management
    val sessionTimeout: Long = 1800000, // 30 minutes in milliseconds
    val trackSessionStart: Boolean = true,

    // Network & Retry
    val maxRetries: Int = 3,
    val retryBackoffMs: Long = 1000,
    val requestTimeout: Long = 10000, // milliseconds

    // SDK Authentication (optional, JWT-based) — fully opt-in.
    // When enabled, the host app supplies a customer-minted JWT (here at init
    // and/or at runtime via Joryio.setSdkAuthenticationToken(...)), and the SDK
    // attaches it as the `X-Joryio-Auth` header on every ingest request. On an
    // HTTP 401 `sdk_authentication_error` the SDK asks the app for a fresh token
    // (see Joryio.setSdkAuthenticationErrorHandler) and retries once. Disabled by
    // default → behaviour is completely unchanged unless opted in.
    val enableSdkAuthentication: Boolean = false,
    val sdkAuthenticationToken: String? = null,


    /**
     * Allow in-app messages authored as HTML, which can execute JavaScript
     * inside your app.
     *
     * OFF BY DEFAULT. The name carries both halves on purpose: `Html…
     * InAppMessages` so the option is findable by someone who wants the
     * feature, and `Js` so nobody enables it thinking HTML is just markup.
     * Braze takes the same position for the same reason: HTML in-app messages
     * let dashboard users run JavaScript in your app, so a maintainer has to
     * opt in.
     *
     * What it protects against: the server strips `<script>` and every `on*`
     * handler before sending, so author JavaScript does not run in normal
     * operation. The document is still rendered in a WebView that can execute
     * script, so the residual risk is a sanitiser bypass - and because the
     * document is authored server-side, a compromised marketing account would
     * then mean code running in every user's session, not merely data exposure
     * in a dashboard. Regulated apps frequently prohibit that outright.
     *
     * Leaving this off does NOT disable in-app messaging. Native messages still
     * display; they are data (title, body, image, buttons) rendered by this
     * SDK's own views, with no interpreter involved. Only HTML campaigns are
     * skipped.
     */
    val allowHtmlJsInAppMessages: Boolean = false,

    // Privacy & GDPR
    val respectDoNotTrack: Boolean = true,
    val optOut: Boolean = false,
    val trackingConsent: TrackingConsent = TrackingConsent.GRANTED,

    /**
     * Ask for notification permission automatically, at the first opportunity
     * after initialize().
     *
     * **Off by default, and that default is the recommendation.** The system
     * prompt can be shown exactly once; a "no" is permanent short of a trip to
     * Settings. Firing it at launch - before the user has any reason to want
     * notifications from you - is how apps burn their single ask. Braze exposes
     * the same capability behind the same kind of flag, and both Braze and
     * OneSignal document the soft-prompt-first pattern as the way to use it.
     *
     * Turn it on only when notifications ARE the product (a messaging or alerts
     * app, where a user who declines has no reason to be there). Otherwise show
     * a primer - see the `request_push_permission` in-app button action - and
     * call requestPushPermission() when the user says yes.
     *
     * Requires an Activity, so it takes effect at the first foreground rather
     * than inside initialize() itself.
     */
    val requestPushPermissionAtLaunch: Boolean = false,

    // Debugging
    val enableDebug: Boolean = false,
    /**
     * Explicit log level. `null` means "not specified" — see [effectiveLogLevel],
     * which then derives it from [enableDebug].
     *
     * This used to default to [LogLevel.ERROR], which made `enableDebug = true`
     * INERT on Android: Logger gates every call on BOTH `enabled` and the level,
     * so turning debugging on still suppressed every debug/info/warn line and the
     * SDK stayed completely silent. iOS has always derived the level from the
     * flag (`enableDebug ? .debug : .error`); Android never got that line, so the
     * one switch an integrator reaches for did nothing on one of the two
     * platforms. Nullable rather than defaulting to DEBUG so that an explicit
     * `logLevel = LogLevel.ERROR` is still honoured.
     */
    val logLevel: LogLevel? = null
) {
    /**
     * The level the Logger actually runs at: an explicit [logLevel] if given,
     * otherwise derived from [enableDebug]. Matches iOS.
     */
    val effectiveLogLevel: LogLevel
        get() = logLevel ?: if (enableDebug) LogLevel.DEBUG else LogLevel.ERROR
}

enum class TrackingConsent {
    GRANTED,
    DENIED,
    PENDING
}

enum class LogLevel {
    VERBOSE,
    DEBUG,
    INFO,
    WARN,
    ERROR
}

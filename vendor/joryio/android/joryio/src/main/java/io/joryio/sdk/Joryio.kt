package io.joryio.sdk

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import io.joryio.sdk.core.*
import io.joryio.sdk.messaging.InAppMessagingManager
import io.joryio.sdk.models.*
import io.joryio.sdk.network.IdentifyRequest
import io.joryio.sdk.network.JoryioTransportError
import io.joryio.sdk.network.NetworkClient
import io.joryio.sdk.network.NetworkResult
import io.joryio.sdk.network.SetAttributesRequest
import io.joryio.sdk.push.PendingTokenStore
import io.joryio.sdk.push.PushPermission
import io.joryio.sdk.push.PushPermissionStatus
import io.joryio.sdk.push.PushNotificationManager
import io.joryio.sdk.queue.QueueManager
import io.joryio.sdk.ecommerce.EcommerceConfig
import io.joryio.sdk.ecommerce.EcommerceTracker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.Date

/**
 * Main Joryio SDK class
 */
class Joryio private constructor(
    context: Context,
    internal val sdkKey: String,
    /**
     * The host this SDK is ACTUALLY sending to.
     *
     * A property rather than a bare constructor parameter so the companion can
     * compare it on a repeat initialize(), and so a host app can display the
     * live value instead of the config it believes it set. Those two diverge
     * the moment initialize() runs twice, and a console showing intent rather
     * than reality turns a one-line misconfiguration into a long debugging
     * session.
     */
    val apiHost: String,
    config: JoryioConfig
) {
    private val appContext: Context = context.applicationContext

    /**
     * The Activity currently in the foreground, or null.
     *
     * The SDK cannot display an in-app message without one - a Dialog needs an
     * Activity, not an application Context. The renderer shipped unwired
     * because this was missing, so in-app messages only appeared in apps that
     * implemented their own host via setInAppMessageCallback.
     *
     * Weakly held: a strong reference here would leak every Activity the user
     * ever visited.
     */
    private var currentActivity: java.lang.ref.WeakReference<android.app.Activity>? = null

    /**
     * How messages get drawn. Base names no view class - that is what lets the
     * rendering layer ship as a separate artifact an app can omit.
     *
     * Discovered reflectively from `joryio-android-ui` if it is on the
     * classpath, so adding that dependency is the whole integration step and
     * there is no register() call to forget. Null means no UI artifact and no
     * host callback: messages are then simply not displayed, which is the
     * correct outcome for an analytics-and-push-only integration.
     */
    /**
     * Captured from the constructor's `config`, which is a parameter rather
     * than a property and so is not visible from member functions. The old
     * `by lazy` renderer read it directly because property initialisers DO run
     * in constructor scope.
     */
    private val allowHtmlJsInAppMessages: Boolean = config.allowHtmlJsInAppMessages
    private val debugEnabled: Boolean = config.enableDebug
    private val requestPushPermissionAtLaunch: Boolean = config.requestPushPermissionAtLaunch
    /** One attempt per process; a refused prompt must not be re-fired every foreground. */
    private var launchPromptAttempted = false

    private var inAppPresenter: InAppMessagePresenter? = null

    /**
     * Supply a presenter explicitly.
     *
     * Rarely needed - the UI artifact is found on its own. Useful for tests, or
     * for an app that wants the SDK's display lifecycle but its own drawing.
     */
    fun setInAppPresenter(presenter: InAppMessagePresenter?) {
        inAppPresenter = presenter
    }

    /**
     * Look for the optional UI artifact.
     *
     * Reflection rather than a compile-time reference, because a compile-time
     * reference is exactly the coupling the split removes. Failure is expected
     * and silent at debug level: "no UI artifact" is a valid, deliberate
     * integration, not an error.
     */
    private fun discoverInAppPresenter(): InAppMessagePresenter? = try {
        val cls = Class.forName("io.joryio.sdk.ui.DefaultInAppMessagePresenter")
        cls.getDeclaredConstructor(Boolean::class.javaPrimitiveType, Boolean::class.javaPrimitiveType)
            .newInstance(allowHtmlJsInAppMessages, debugEnabled) as InAppMessagePresenter
    } catch (e: ClassNotFoundException) {
        logger.debug("joryio-android-ui not on the classpath; in-app messages will not be displayed by the SDK")
        null
    } catch (e: Throwable) {
        logger.warn("Found joryio-android-ui but could not initialise it: ${e.message}")
        null
    }
    private val logger: Logger
    private val storage: StorageManager
    private val identityManager: IdentityManager
    private val sessionManager: SessionManager
    private val networkClient: NetworkClient
    private val queueManager: QueueManager
    private val inAppMessagingManager: InAppMessagingManager
    internal val pushManager: PushNotificationManager?

    /**
     * Every coroutine the SDK launches runs here.
     *
     * The CoroutineExceptionHandler is not optional politeness: without one, an
     * uncaught throwable inside any `scope.launch { }` reaches the thread's default
     * handler and CRASHES THE HOST APP. An analytics SDK must never do that — a
     * failed in-app sync or a malformed response is our problem, not the app's.
     * SupervisorJob alone does not give this: it stops siblings being cancelled, it
     * does not stop the crash.
     */
    private val scope = CoroutineScope(
        Dispatchers.Main + SupervisorJob() +
            kotlinx.coroutines.CoroutineExceptionHandler { _, t ->
                // android.util.Log, not `logger`: this property initializer runs
                // BEFORE logger is assigned (the compiler rejects capturing it), and
                // a last-resort safety net must not depend on SDK state that may not
                // exist yet — the moment it is needed most is a half-built SDK.
                android.util.Log.e("Joryio", "Unhandled error in a Joryio coroutine (contained)", t)
            }
    )
    /** Coalescing window for attribute writes; see scheduleAttributeFlush(). */
    private var attributeFlushJob: kotlinx.coroutines.Job? = null
    /** Serializes attribute flushes; see flushPendingAttributes(). */
    private val flushLock = Any()
    private var isFlushingAttributes = false
    private var flushAgainRequested = false

    private var isOptedOut = false
    private var isInitialized = false

    init {
        // Initialize logger
        logger = Logger(
            enabled = config.enableDebug,
            // effectiveLogLevel, not logLevel: an unset level must follow
            // enableDebug, or turning debugging on logs nothing. See JoryioConfig.
            logLevel = config.effectiveLogLevel
        )

        logger.info("Initializing Joryio SDK v1.0.0")

        // Kick off the push store's keystore setup NOW so it runs alongside the
        // main store's rather than after it. Android Keystore initialisation is
        // by far the most expensive thing in init (~163ms measured for the first
        // store), and bootstrapToken() reads this second file on the caller's
        // thread later in this same constructor.
        PendingTokenStore.prewarm(appContext)

        // Initialize storage
        storage = StorageManager(
            context = context,
            sdkKey = sdkKey,
            logger = logger
        )

        // Consent, as early as storage allows - before any collection path can
        // run. The PERSISTED flag wins on its own: a user who called optOut()
        // last run must stay opted out even when the host app passes its
        // default config, which is the common case.
        isOptedOut = config.optOut || storage.getOptedOut()
        if (isOptedOut) logger.warn("User has opted out of tracking")

        // Initialize identity manager
        identityManager = IdentityManager(
            storage = storage,
            logger = logger,
            initialUserId = config.userId
        )

        // Initialize session manager
        sessionManager = SessionManager(
            storage = storage,
            logger = logger,
            sessionTimeout = config.sessionTimeout
        )

        // Initialize network client
        networkClient = NetworkClient(
            context = context,
            sdkKey = sdkKey,
            apiHost = apiHost,
            logger = logger,
            maxRetries = config.maxRetries,
            retryBackoffMs = config.retryBackoffMs,
            enableDebug = config.enableDebug,
            enableSdkAuthentication = config.enableSdkAuthentication,
            sdkAuthenticationToken = config.sdkAuthenticationToken
        )

        // Initialize queue manager
        queueManager = QueueManager(
            context = context,
            sdkKey = sdkKey,
            logger = logger,
            batchSize = config.batchSize,
            flushInterval = config.flushInterval,
            maxRetries = config.maxRetries
        )

        // Set flush callback
        queueManager.onFlush = { batch ->
            when (networkClient.trackBatch(batch)) {
                is NetworkResult.Success -> true
                is NetworkResult.Error -> false
            }
        }

        // Initialize in-app messaging
        inAppMessagingManager = InAppMessagingManager(
            networkClient = networkClient,
            identityManager = identityManager,
            sessionManager = sessionManager,
            storage = storage,
            logger = logger,
            allowHtmlJsInAppMessages = allowHtmlJsInAppMessages
        )

        // In-app display. Registered here so an integrating app gets working
        // in-app messaging without writing its own host - a setInAppMessageCallback
        // later overrides this rather than duplicating it.
        //
        // MUST come after `inAppMessagingManager` is constructed: this assigns
        // its `onMessageReady`. It used to run ~60 lines earlier, before the
        // manager existed, so initialize() died with a NullPointerException on
        // EVERY launch - which the RN bridge turned into a rejected promise and
        // in-app messaging never worked on Android at all.
        setupDefaultInAppDisplay(context)

        // Initialize push notifications (if FCM is available).
        //
        // Throwable, not Exception: firebase-messaging is compileOnly, so "not
        // available" arrives as NoClassDefFoundError — an Error. See
        // PushNotificationManager.bootstrapToken for the full note.
        pushManager = try {
            PushNotificationManager(
                context = appContext,
                networkClient = networkClient,
                identityManager = identityManager,
                storage = storage,
                logger = logger
            )
        } catch (t: Throwable) {
            logger.warn("FCM not available, push notifications disabled")
            null
        }

        // Validate the SDK-key format. A wrong/legacy key silently 401s every
        // request, so match the severity of the web SDK (which throws) WITHOUT
        // crashing the host app: log a prominent error and stay in a no-send state
        // (isInitialized stays false → every tracking call warn-drops).
        if (!sdkKey.startsWith(SDK_KEY_PREFIX)) {
            android.util.Log.e(
                "Joryio",
                "Invalid SDK key format: keys must start with '$SDK_KEY_PREFIX'. " +
                    "The SDK will NOT send any data. Copy your SDK key from the Joryio dashboard."
            )
            logger.error("Invalid SDK key format; SDK running in no-send mode")
        } else {
            // Setup lifecycle observer
            setupLifecycleObserver(context)

            // Mark ready BEFORE emitting the first event so trackSessionStart() is
            // not dropped by the isInitialized guard.
            isInitialized = true

            // Track session start if enabled
            if (config.trackSessionStart) {
                trackSessionStart()
            }

            // Sync in-app messages
            scope.launch {
                inAppMessagingManager.sync()
            }

            // Recover any FCM token captured before init and proactively register
            // the current token so onNewToken-before-init is never lost.
            //
            // Guarded because push is an OPTIONAL subsystem and this is the last
            // statement of initialize(): anything it throws would abort init after
            // isInitialized was already set, leaving a half-built SDK. This exact
            // call did that (NoClassDefFoundError from the compileOnly Firebase
            // artifact) in every app without push. No optional subsystem gets to
            // take down initialization.
            try {
                pushManager?.bootstrapToken()
            } catch (t: Throwable) {
                logger.warn("Push bootstrap failed, continuing without push: ${t.message}")
            }

            // Report the permission state once the SDK is live. Cheap: only
            // sends when it differs from the last reported value.
            reportPushPermissionIfChanged()

            logger.info("Joryio SDK initialized successfully")
        }
    }

    /**
     * Setup app lifecycle observer
     */
    private fun setupLifecycleObserver(context: Context) {
        if (context !is Application) return

        // ProcessLifecycleOwner requires the MAIN thread. initialize() is not
        // guaranteed to run there - the React Native bridge calls it from a
        // background thread - and the resulting IllegalStateException aborted
        // initialize() entirely, so the SDK never started on RN Android.
        // Hop to the main looper rather than demanding callers know this.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Handler(Looper.getMainLooper()).post { setupLifecycleObserver(context) }
            return
        }

        run {
            ProcessLifecycleOwner.get().lifecycle.addObserver(
                LifecycleEventObserver { _, event ->
                    when (event) {
                        Lifecycle.Event.ON_START -> {
                            logger.debug("App came to foreground")
                            sessionManager.updateActivity()
                            // Resume periodic flushing (stopped on ON_STOP).
                            queueManager.startAutoFlush()
                            // A user can revoke notifications in system Settings
                            // while we are backgrounded; foreground is the only
                            // moment we can notice.
                            reportPushPermissionIfChanged()
                            maybeRequestPushPermissionAtLaunch()
                            // No-op when the backend already confirmed this
                            // token; retries only a registration that failed.
                            pushManager?.retryRegistrationIfUnconfirmed()
                            scope.launch {
                                // Retry attributes BEFORE syncing: anything set
                                // while offline should be in the profile by the
                                // time targeting is evaluated, otherwise the
                                // sync decides on data we know to be stale and
                                // the message appears one foreground late.
                                flushPendingAttributes()
                                inAppMessagingManager.sync()
                            }
                        }
                        Lifecycle.Event.ON_STOP -> {
                            logger.debug("App went to background")
                            scope.launch {
                                // Send what we have, THEN stop the periodic loop.
                                //
                                // The loop is `while (isActive) { delay(5s); flush() }`
                                // and nothing used to stop it, so a backgrounded app
                                // kept waking every 5 seconds for as long as the
                                // process lived — each tick running a SQLite
                                // getCount() against an empty queue. That is roughly
                                // 17k disk reads a day spent to discover there is
                                // nothing to do, on a device the user is not even
                                // using. Events tracked while backgrounded still
                                // persist to Room and go out on the next foreground
                                // (or immediately, when a batch fills).
                                queueManager.flush()
                                queueManager.stopAutoFlush()
                            }
                        }
                        else -> {}
                    }
                }
            )
        }
    }

    /**
     * Track session start event
     */
    private fun trackSessionStart() {
        val deviceId = storage.getDeviceId()
        val deviceProperties = DeviceInfo.getTrackingProperties(appContext, deviceId)
        val properties = deviceProperties.toMutableMap()
        properties["session_id"] = sessionManager.getSessionId()
        track("Session Start", properties)
    }

    // MARK: - Event Tracking

    /**
     * Track an event
     */
    fun track(eventName: String, properties: Map<String, Any?> = emptyMap()) {
        if (!isInitialized) {
            logger.warn("SDK not initialized, cannot track event")
            return
        }
        if (isOptedOut) {
            logger.debug("User opted out, skipping track")
            return
        }


        scope.launch {
            try {
                val event = Event(
                    type = eventName,
                    properties = properties,
                    timestamp = Date(),
                    userId = identityManager.getUserId(),
                    anonymousId = identityManager.getAnonymousId(),
                    sessionId = sessionManager.getSessionId()
                )

                queueManager.enqueue(event)
                sessionManager.updateActivity()
            } catch (e: Exception) {
                logger.error("Failed to track event: ${e.message}", e)
            }
        }

        // Show anything waiting on this event - locally, no round trip. AFTER
        // the event is queued: the event is data and must be recorded whether
        // or not it triggers a message.
        try {
            inAppMessagingManager.onEventTracked(eventName, properties)
        } catch (e: Exception) {
            logger.error("In-app trigger evaluation failed: ${e.message}", e)
        }
    }

    /**
     * Track screen view
     */
    fun trackScreen(screenName: String, properties: Map<String, Any?> = emptyMap()) {
        val enrichedProperties = properties.toMutableMap()
        enrichedProperties["screen_name"] = screenName

        track("Screen Viewed", enrichedProperties)
    }

    // MARK: - User Identity

    /**
     * Identify a user
     */
    fun identify(userId: String) {
        if (!isInitialized) {
            logger.warn("SDK not initialized, cannot identify user")
            return
        }
        if (isOptedOut) {
            logger.debug("User opted out, skipping identify")
            return
        }


        scope.launch {
            try {
                identityManager.identify(userId)

                // Send identify call to backend
                val request = IdentifyRequest(
                    userId = userId,
                    anonymousId = identityManager.getAnonymousId(),
                    attributes = emptyMap()
                )

                networkClient.identify(request)
                sessionManager.updateActivity()
            } catch (e: Exception) {
                logger.error("Failed to identify user: ${e.message}", e)
            }
        }
    }

    /**
     * Alias a user (link anonymous ID to user ID)
     */
    fun alias(userId: String) {
        if (!isInitialized) {
            logger.warn("SDK not initialized, cannot alias user")
            return
        }

        scope.launch {
            try {
                identityManager.alias(userId)

                // Send alias call to backend
                val request = io.joryio.sdk.network.AliasRequest(
                    userId = userId,
                    anonymousId = identityManager.getAnonymousId()
                )

                networkClient.alias(request)
                sessionManager.updateActivity()
            } catch (e: Exception) {
                logger.error("Failed to alias user: ${e.message}", e)
            }
        }
    }

    /**
     * Reset user identity (on logout)
     */
    fun reset() {
        if (!isInitialized) {
            logger.warn("SDK not initialized, cannot reset")
            return
        }

        scope.launch {
            try {
                identityManager.reset()
                sessionManager.startNewSession()
                inAppMessagingManager.clear()

                // Re-associate the device token with the fresh anonymous
                // identity so a new user does not inherit the previous user's
                // token association. The backend keys devices by userId, so
                // skipping this leaves the row pointing at the person who just
                // logged out - the next user of the phone would receive their
                // notifications. iOS already did this; Android did not.
                pushManager?.reregisterToken()

                logger.info("User identity reset")
            } catch (e: Exception) {
                logger.error("Failed to reset user: ${e.message}", e)
            }
        }
    }

    // MARK: - User Attributes

    /**
     * Set user attributes
     */
    fun setAttributes(attributes: UserAttributes) {
        if (!isInitialized) {
            logger.warn("SDK not initialized, cannot set attributes")
            return
        }
        if (isOptedOut) {
            logger.debug("User opted out, skipping setAttributes")
            return
        }


        // Save locally
        identityManager.setAttributes(attributes)

        // A differential-sync campaign may be waiting on one of these. Cheap:
        // returns immediately unless a campaign actually watches the key.
        inAppMessagingManager.attributesDidChange(attributes.keys)

        // Not acknowledged until the server says so. Recorded BEFORE the
        // attempt so a failure needs no special handling - the value is already
        // queued, and the flush below either clears it or leaves it for the
        // next trigger.
        identityManager.pending.mark(attributes)

        scheduleAttributeFlush()
    }

    /**
     * Send everything the server has not acknowledged, and clear what it took.
     *
     * Retried rather than dropped: called after every [setAttributes], on
     * foreground, and before an in-app sync. A failure leaves the values
     * queued, so the next trigger picks them up - which is what makes an
     * attribute set while offline survive.
     *
     * Sends the whole pending set, not just the newest call: if three writes
     * failed while offline, reconnecting must deliver all three.
     */
    /**
     * Coalesce a burst of writes into one request - see the iOS twin.
     *
     * A debounce, not a fixed interval: a single write still goes out promptly
     * and only a burst is held. The foreground and pre-sync paths call
     * [flushPendingAttributes] directly, bypassing this, so nothing set while
     * offline waits on a timer.
     */
    private fun scheduleAttributeFlush() {
        attributeFlushJob?.cancel()
        attributeFlushJob = scope.launch {
            kotlinx.coroutines.delay(ATTRIBUTE_FLUSH_DEBOUNCE_MS)
            flushPendingAttributes()
        }
    }

    internal suspend fun flushPendingAttributes() {
        // Serialize + coalesce - see the iOS twin. A burst of setAttributes
        // must not become a burst of overlapping requests.
        synchronized(flushLock) {
            if (isFlushingAttributes) {
                flushAgainRequested = true
                return
            }
            isFlushingAttributes = true
        }

        try {
            val toSend = identityManager.pending.pending()
            if (toSend.isEmpty()) return

            try {
                val request = SetAttributesRequest(
                    userId = identityManager.getUserId(),
                    anonymousId = identityManager.getAnonymousId(),
                    attributes = toSend
                )
                networkClient.setAttributes(request)
                // Clears only keys whose value is still the one we sent, so a
                // write that landed mid-flight stays pending, not acked away.
                identityManager.pending.acknowledge(toSend)
                logger.info("Attributes sent to server (${toSend.size})")
            } catch (e: Exception) {
                logger.error("Failed to send attributes, will retry: ${e.message}", e)
            }
        } finally {
            val again = synchronized(flushLock) {
                isFlushingAttributes = false
                val a = flushAgainRequested
                flushAgainRequested = false
                a
            }
            if (again) flushPendingAttributes()
        }
    }

    /**
     * Set a single user attribute
     */
    // MARK: - Tracking consent

    /**
     * Stop collecting. PERSISTED, so it survives a restart.
     *
     * Records the withdrawal on the profile first, while sending is still
     * permitted - a consent RECORD, not tracking, and the only way the server
     * learns the user opted out on this device (CleverTap does the same). It is
     * a record, not enforcement: it lands as a profile attribute targeting can
     * exclude on.
     *
     * Then everything collected before consent was withdrawn but not yet sent
     * is DROPPED, not delivered later.
     */
    fun optOut() {
        if (!isOptedOut) {
            scope.launch {
                try {
                    networkClient.setAttributes(
                        SetAttributesRequest(
                            userId = identityManager.getUserId(),
                            anonymousId = identityManager.getAnonymousId(),
                            attributes = mapOf("\$tracking_opted_out" to true)
                        )
                    )
                } catch (e: Exception) {
                    // Best-effort: a failed record must never block the opt-out.
                }
            }
        }

        isOptedOut = true
        storage.setOptedOut(true)

        attributeFlushJob?.cancel()
        identityManager.pending.clear()
        scope.launch { queueManager.clear() }

        logger.info("User opted out of tracking")
    }

    fun optIn() {
        isOptedOut = false
        storage.setOptedOut(false)
        logger.info("User opted in to tracking")
    }

    fun isUserOptedOut(): Boolean = isOptedOut

    /**
     * Delete everything this SDK stored on the device.
     *
     * Deliberately SEPARATE from [optOut]. "Stop collecting" and "delete what
     * you have" are different requests - Braze splits them the same way - and
     * conflating them means neither can be done precisely. This is the one an
     * erasure request needs. Does not opt the user out.
     */
    fun wipeData() {
        attributeFlushJob?.cancel()
        identityManager.pending.clear()
        scope.launch { queueManager.clear() }
        identityManager.reset()
        storage.clearAllData()
        logger.info("Local SDK data wiped")
    }

    fun setAttribute(key: String, value: Any) {
        setAttributes(mapOf(key to value))
    }

    /**
     * Increment a numeric user attribute
     */
    fun incrementAttribute(key: String, by: Number = 1) {
        if (!isInitialized) {
            logger.warn("SDK not initialized, cannot increment attribute")
            return
        }

        // In-memory optimistic echo only (for in-session read-back).
        identityManager.incrementAttribute(key, by)

        // Send the DELTA as an atomic `$inc` op — never a locally-computed
        // absolute — so concurrent devices don't clobber the counter.
        scope.launch {
            try {
                val request = SetAttributesRequest(
                    userId = identityManager.getUserId(),
                    anonymousId = identityManager.getAnonymousId(),
                    increment = mapOf(key to by)
                )
                networkClient.setAttributes(request)
            } catch (e: Exception) {
                logger.error("Failed to send incremented attribute: ${e.message}", e)
            }
        }
    }

    /**
     * Unset a user attribute
     */
    fun unsetAttribute(key: String) {
        if (!isInitialized) {
            logger.warn("SDK not initialized, cannot unset attribute")
            return
        }

        identityManager.unsetAttribute(key)

        // Send an atomic `$unset` op.
        scope.launch {
            try {
                val request = SetAttributesRequest(
                    userId = identityManager.getUserId(),
                    anonymousId = identityManager.getAnonymousId(),
                    unset = listOf(key)
                )
                networkClient.setAttributes(request)
            } catch (e: Exception) {
                logger.error("Failed to send unset attribute: ${e.message}", e)
            }
        }
    }

    // MARK: - In-App Messaging

    /**
     * Set callback for in-app messages
     */
    /**
     * Take over in-app display.
     *
     * Setting a callback OVERRIDES the SDK's own rendering - the SDK will not
     * also display the message, so a host app that renders its own UI does not
     * get two copies. Leave it unset and the SDK displays messages itself.
     */
    fun setInAppMessageCallback(callback: (InAppCampaign) -> Unit) {
        // Wrapped so the cross-campaign gap is stamped on handoff. The host owns
        // rendering from here, so handing the message over IS the display as far
        // as the SDK can tell. Without this wrapper the gap would never be
        // stamped for host-rendered apps (React Native included) and every
        // eligible campaign would fire back-to-back.
        inAppMessagingManager.onMessageReady = { campaign ->
            inAppMessagingManager.noteDisplayed()
            callback(campaign)
        }
        hostHandlesDisplay = true
    }

    /** True once the host app has claimed display via setInAppMessageCallback. */
    private var hostHandlesDisplay = false

    /** Cached e-commerce tracker, replaced when a caller passes a fresh config. */
    private var ecommerceTracker: EcommerceTracker? = null

    /**
     * Display in-app messages using the SDK's own renderer.
     *
     * Registered at init so an integrating app gets working in-app messaging
     * without writing a host, matching iOS - which has always rendered its own.
     * Android previously handed every message to the app and displayed nothing
     * on its own, so the same campaign worked on one platform and silently did
     * nothing on the other.
     */
    private fun setupDefaultInAppDisplay(context: Context) {
        if (inAppPresenter == null) inAppPresenter = discoverInAppPresenter()

        (context.applicationContext as? Application)?.registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityResumed(activity: android.app.Activity) {
                    currentActivity = java.lang.ref.WeakReference(activity)
                }
                override fun onActivityPaused(activity: android.app.Activity) {
                    if (currentActivity?.get() === activity) currentActivity = null
                }
                override fun onActivityCreated(a: android.app.Activity, b: android.os.Bundle?) {}
                override fun onActivityStarted(a: android.app.Activity) {}
                override fun onActivityStopped(a: android.app.Activity) {}
                override fun onActivitySaveInstanceState(a: android.app.Activity, b: android.os.Bundle) {}
                override fun onActivityDestroyed(a: android.app.Activity) {}
            },
        )

        inAppMessagingManager.onMessageReady = { campaign ->
            // A host callback wins; the SDK must not double-render.
            if (!hostHandlesDisplay) {
                val presenter = inAppPresenter
                val activity = currentActivity?.get()
                when {
                    presenter == null ->
                        logger.debug("No in-app presenter; not displaying ${campaign.id}")
                    activity == null ->
                        // Common during a cold start: sync finishes before the
                        // first Activity is resumed. Deliberately does NOT stamp
                        // the cross-campaign gap (see noteDisplayed) — a message
                        // nobody saw must not spend the budget, and leaving the
                        // gap alone lets the next sync retry this campaign.
                        logger.debug("No foreground Activity; not displaying ${campaign.id}")
                    else -> activity.runOnUiThread {
                        inAppMessagingManager.noteDisplayed()
                        // Only track when the presenter says it actually drew.
                        // Counting an impression for a message that failed to
                        // display is how a channel looks healthier than it is.
                        presenter.present(activity, campaign) { action, _ ->
                            trackInAppImpression(campaign.id, action)
                        }
                    }
                }
            }
        }
    }

    /**
     * Pull in-app campaigns now.
     *
     * Public for parity with iOS's `syncInAppCampaigns()`, and because a silent
     * push nudge needs a way to say "sync now" from outside the SDK. Without it
     * the only sync points were init and foreground, so a queued message could
     * not appear until the app was reopened.
     */
    fun syncInAppCampaigns() {
        scope.launch {
            inAppMessagingManager.sync()
        }
    }

    /**
     * Track in-app message impression
     */
    fun trackInAppImpression(campaignId: String, action: String) {
        scope.launch {
            inAppMessagingManager.trackImpression(campaignId, action)
        }
    }

    /**
     * Forget which in-app campaigns have already been shown.
     *
     * A TESTING affordance, matching iOS: frequency state is held locally (that
     * is what lets a trigger fire instantly and offline), so without this the
     * only way to re-test a campaign on Android was to uninstall the app.
     * Changing the campaign server-side does not help, because the client half
     * of the state still suppresses the repeat.
     */
    fun resetDisplayedCampaigns() {
        if (!requireDebug("resetDisplayedCampaigns")) return
        inAppMessagingManager.resetDisplayedCampaigns()
    }

    /**
     * Re-evaluate the campaigns already synced, without going to the network.
     *
     * Matches iOS. Useful after changing attributes locally, when you want the
     * decision re-made against what the SDK already holds rather than waiting
     * for the next sync.
     */
    fun evaluateInAppCampaigns() {
        if (!requireDebug("evaluateInAppCampaigns")) return
        inAppMessagingManager.evaluateNow()
    }

    /**
     * Gate for the QA-only calls that CHANGE behaviour.
     *
     * Only the mutating ones are gated. `resetDisplayedCampaigns` wipes real
     * frequency caps and `evaluateInAppCampaigns` can force a message on screen -
     * called in production (a stray line, or a snippet copied from a QA guide)
     * they corrupt capping and reporting for real users.
     *
     * The read-only diagnostics (getQueueSize, getSessionInfo, getIdentity,
     * getDeviceToken, currentApiEndpoint, lastTransportError) are deliberately
     * NOT gated: they cannot damage anything, and a support screen wants them
     * most in production - where gating would also force verbose logging on just
     * to read a session id.
     */
    private fun requireDebug(method: String): Boolean {
        if (debugEnabled) return true
        logger.warn(
            "$method is a testing API and is ignored unless enableDebug is on. " +
                "It changes live state (frequency caps / message display), so it must not run " +
                "in a production build.",
        )
        return false
    }

    /**
     * The push token this device is registered with, or null if none yet.
     *
     * Matches iOS's getDeviceToken(). Diagnostic: it answers "is this device
     * actually reachable by push?" without needing the dashboard.
     */
    fun getDeviceToken(): String? = storage.getDeviceToken()

    /** Current session id, when it started, and how long it has been running. */
    fun getSessionInfo(): SessionInfo = sessionManager.getSession()

    /** The identifiers this device is currently reporting under. */
    fun getIdentity(): Pair<String?, String> =
        identityManager.getUserId() to identityManager.getAnonymousId()

    /**
     * How many events are waiting to be sent.
     *
     * Suspending because the queue is a Room table, not an in-memory list -
     * counting it is a database read and must not block the caller's thread.
     */
    suspend fun getQueueSize(): Int = queueManager.getQueueSize()

    // MARK: - Push Notifications

    /**
     * Register push notification token
     */
    fun registerPushToken(token: String) {
        pushManager?.registerToken(token)
    }

    /**
     * Unregister push notifications
     */
    fun unregisterPush() {
        pushManager?.unregisterToken()
    }

    /**
     * Check if push is enabled
     */
    fun isPushEnabled(): Boolean {
        return pushManager?.isPushEnabled() ?: false
    }

    /**
     * Where the user stands on notifications, without asking them anything.
     *
     * Check this BEFORE showing a primer. `NOT_DETERMINED` is the only state in
     * which the system prompt can still appear - on Android 13+ a denial is
     * permanent short of a trip to Settings - so a primer shown to an already
     * denied user spends their goodwill on a prompt that can never be displayed.
     */
    fun getPushPermissionStatus(): PushPermissionStatus = PushPermission.status(appContext)

    /**
     * Report the notification-permission state as a user attribute, but ONLY when
     * it has changed since we last reported it.
     *
     * This is what makes a push primer measurable: without it a marketer cannot
     * target "has never been asked" (the only audience for whom a primer is even
     * possible), nor tell whether primers are moving opt-in. Reserved key
     * `push_permission`, values matching PushPermissionStatus lowercased.
     *
     * No `$` prefix: contact attributes are written to Mongo as
     * `attributes.<key>` dotted paths, and a key starting with `$` breaks there.
     *
     * Change-detection is not an optimisation. Attributes are not deduplicated
     * server-side, so reporting unconditionally would spend a request on every
     * launch and every foreground to restate a value that changes maybe twice in
     * the lifetime of an install.
     */
    /**
     * Opt-in auto-prompt (JoryioConfig.requestPushPermissionAtLaunch).
     *
     * Runs at the first foreground because the system prompt needs an Activity,
     * and only ONCE per process: re-firing it every foreground would do nothing
     * on Android (the prompt is spent) while looking like it might.
     */
    private fun maybeRequestPushPermissionAtLaunch() {
        if (!requestPushPermissionAtLaunch || launchPromptAttempted) return
        val activity = currentActivity?.get() ?: return
        launchPromptAttempted = true
        logger.info("requestPushPermissionAtLaunch is on; asking now")
        requestPushPermission(activity)
    }

    private fun reportPushPermissionIfChanged() {
        if (!isInitialized || isOptedOut) return
        try {
            val current = PushPermission.status(appContext).name.lowercase()
            if (storage.getReportedPushPermission() == current) return
            storage.setReportedPushPermission(current)
            logger.debug("Push permission changed to $current; reporting")
            setAttribute(PUSH_PERMISSION_ATTRIBUTE, current)
        } catch (t: Throwable) {
            logger.warn("Could not report push permission: ${t.message}")
        }
    }

    /**
     * Show the system notification prompt, reporting the outcome on the main thread.
     *
     * The SDK never calls this for you. The prompt is one-shot, and neither
     * `initialize()` nor a dashboard toggle can know when your app has earned the
     * right to ask - so the moment is yours to choose. Ask after a booking, a
     * purchase, or from a notifications settings screen; not on first launch.
     *
     * On a grant, the FCM token is registered automatically, so a caller does not
     * have to remember to follow up with [registerPushToken].
     *
     * Below API 33 there is no runtime permission: the callback reports whether
     * notifications are enabled in Settings, without showing anything.
     */
    @JvmOverloads
    fun requestPushPermission(
        activity: android.app.Activity,
        callback: ((PushPermissionStatus) -> Unit)? = null,
    ) {
        PushPermission.request(activity) { status ->
            logger.info("Push permission result: $status")
            reportPushPermissionIfChanged()
            if (status == PushPermissionStatus.GRANTED) {
                // The token may have been withheld while permission was missing.
                try {
                    pushManager?.bootstrapToken()
                } catch (t: Throwable) {
                    logger.warn("Token bootstrap after permission grant failed: ${t.message}")
                }
            }
            callback?.invoke(status)
        }
    }

    /**
     * Track push notification click
     */
    fun trackPushClick(trackingId: String) {
        scope.launch {
            try {
                networkClient.trackPushClick(trackingId)
                logger.info("Push click tracked successfully")

                // Show anything triggered by the tap. Syncs internally, so
                // this replaces the bare sync() that used to be here - that
                // refreshed the campaign list but displayed nothing, because
                // a push_notification_tap campaign is not eligible on an
                // ordinary sync and never was acted on anywhere.
                inAppMessagingManager.onPushTapped()
                logger.debug("Triggered in-app sync after push click")
            } catch (e: Exception) {
                logger.error("Failed to track push click: ${e.message}", e)
            }
        }
    }

    // MARK: - SDK Authentication

    /**
     * Set/replace the customer-minted JWT used for SDK Authentication. Attached as
     * `X-Joryio-Auth` on every subsequent ingest request. Thread-safe; typically
     * called after login and from within the auth-error handler to supply a fresh
     * token. Supplying a token opts the feature in even if it was left disabled in
     * [JoryioConfig].
     */
    fun setSdkAuthenticationToken(token: String) {
        networkClient.setSdkAuthenticationToken(token)
    }

    /**
     * Register a handler invoked when an ingest request is rejected with HTTP 401
     * `sdk_authentication_error`. Mint a fresh JWT and call
     * [setSdkAuthenticationToken] from the handler; doing so synchronously lets the
     * SDK retry the rejected request once. The handler runs on the SDK's network
     * thread — dispatch any heavy work elsewhere.
     */
    fun setSdkAuthenticationErrorHandler(handler: (SdkAuthError) -> Unit) {
        networkClient.setSdkAuthenticationErrorHandler(handler)
    }

    // MARK: - Utilities

    /**
     * E-commerce tracking helper - the standard product / cart / checkout /
     * purchase events, with a default currency applied to each.
     *
     * This accessor is what the e-commerce documentation has always shown
     * (`Joryio.getInstance().ecommerce(...)`), but it did not exist:
     * [EcommerceTracker] was public and constructible, and nothing on this class
     * returned one, so every documented Kotlin snippet failed to compile.
     *
     * Pass [config] to change the currency or auto-tracking flags; omit it to
     * reuse the existing tracker.
     *
     * ```kotlin
     * val ecommerce = Joryio.getInstance().ecommerce(EcommerceConfig(currency = "USD"))
     * ecommerce.viewProduct(EcommerceProduct(productId = "SKU123", name = "Blue Shirt", price = 29.99))
     * ```
     */
    @JvmOverloads
    fun ecommerce(config: EcommerceConfig? = null): EcommerceTracker {
        // Deliberately usable before initialize(): the tracker only forwards to
        // track(), which already queues and warns when uninitialised. Failing
        // here would punish an app that builds its tracker in a field
        // initialiser - a very ordinary thing to do.
        config?.let {
            val tracker = EcommerceTracker(this, it)
            ecommerceTracker = tracker
            return tracker
        }
        return ecommerceTracker ?: EcommerceTracker(this).also { ecommerceTracker = it }
    }

    /**
     * Flush event queue immediately
     */
    fun flush() {
        scope.launch {
            queueManager.flush()
        }
    }

    /**
     * Get anonymous ID
     */
    fun getAnonymousId(): String {
        return identityManager.getAnonymousId()
    }

    /**
     * Get user ID
     */
    fun getUserId(): String? {
        return identityManager.getUserId()
    }

    /**
     * Get session ID
     */
    fun getSessionId(): String {
        return sessionManager.getSessionId()
    }

    /** The API base URL actually in use. Diagnostics only. */
    val currentApiEndpoint: String
        get() = networkClient.currentApiEndpoint

    /**
     * The most recent transport failure, or null if the last call succeeded.
     *
     * "Initialized" and "the server accepts us" are different claims. Without
     * this, a wrong SDK key looks identical to a healthy integration: the SDK
     * reports itself up while every request is rejected 401. Mirrors iOS.
     */
    val lastTransportError: JoryioTransportError?
        get() = networkClient.lastTransportError

    // MARK: - Static Methods

    companion object {
        /** Coalescing window for attribute writes; see scheduleAttributeFlush(). */
        private const val ATTRIBUTE_FLUSH_DEBOUNCE_MS = 800L

        /** Reserved attribute carrying the notification-permission state. */
        const val PUSH_PERMISSION_ATTRIBUTE = "push_permission"

        /** All valid mobile SDK keys are prefixed with this. */
        private const val SDK_KEY_PREFIX = "jry_sdk_"

        @Volatile
        private var instance: Joryio? = null

        /**
         * Initialize the SDK
         */
        @JvmStatic
        fun initialize(
            context: Context,
            sdkKey: String,
            apiHost: String,
            config: JoryioConfig = JoryioConfig()
        ): Joryio {
            // Re-initialisation is NOT supported: managers, timers, the queue
            // and the session are all built here, and swapping the endpoint
            // underneath them would leave half the SDK talking to the old host.
            //
            // But say so LOUDLY when the caller asked for something different.
            // This used to return the existing instance in SILENCE - not even
            // a log line - so an app that changed its API host kept sending to
            // the previous one with no explanation anywhere. iOS had the same
            // bug and at least printed.
            instance?.let { existing ->
                if (existing.apiHost != apiHost || existing.sdkKey != sdkKey) {
                    android.util.Log.e(
                        "Joryio",
                        "initialize() called again with a DIFFERENT configuration, which is " +
                            "ignored: still sending to ${existing.apiHost}, not $apiHost. " +
                            "Restart the app to apply new settings.",
                    )
                }
                return existing
            }

            return synchronized(this) {
                instance ?: Joryio(
                    context = context.applicationContext,
                    sdkKey = sdkKey,
                    apiHost = apiHost,
                    config = config
                ).also { instance = it }
            }
        }

        /**
         * Get SDK instance
         */
        @JvmStatic
        fun getInstance(): Joryio {
            return instance ?: throw IllegalStateException(
                "Joryio SDK not initialized. Call Joryio.initialize() first."
            )
        }

        /**
         * Check if SDK is initialized
         */
        @JvmStatic
        fun isInitialized(): Boolean {
            return instance != null
        }

        /**
         * Initialize WITHOUT blocking the calling thread.
         *
         * [initialize] builds the whole SDK inline, and the expensive part is
         * Android Keystore setup for the encrypted stores — measured at ~200ms
         * on a healthy emulator, and more on a first run, where the master key
         * must actually be generated. A native app calls initialize() from
         * Application.onCreate(), i.e. on the MAIN thread, so that cost is added
         * directly to app startup before the first frame.
         *
         * This variant does the same work on a background thread and hands the
         * instance back on the main thread. Nothing is dropped in the meantime:
         * calls made through the convenience methods before the SDK is ready are
         * buffered and replayed in order (see [withSdk]).
         *
         * Prefer this from Application.onCreate(). [initialize] remains for
         * callers that genuinely need the instance synchronously.
         */
        @JvmStatic
        @JvmOverloads
        fun initializeAsync(
            context: Context,
            sdkKey: String,
            apiHost: String,
            config: JoryioConfig = JoryioConfig(),
            onReady: ((Joryio) -> Unit)? = null,
        ) {
            val appContext = context.applicationContext
            instance?.let { existing ->
                onReady?.let { cb -> mainHandler.post { cb(existing) } }
                return
            }
            Thread({
                val sdk = try {
                    initialize(appContext, sdkKey, apiHost, config)
                } catch (t: Throwable) {
                    // Never surface an init failure as a crash on a thread the
                    // host app cannot catch on.
                    android.util.Log.e("Joryio", "Asynchronous initialize failed", t)
                    null
                }
                if (sdk != null) mainHandler.post { drainPending(sdk); onReady?.invoke(sdk) }
            }, "joryio-init").apply { isDaemon = true }.start()
        }

        private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

        /**
         * Actions issued before the SDK finished initializing.
         *
         * Bounded: a host app that never completes initialization must not grow
         * this without limit. Oldest-first drop matches QueueManager.
         */
        private val pendingActions = ArrayDeque<(Joryio) -> Unit>()
        private const val MAX_PENDING_ACTIONS = 200

        /**
         * Run [action] now, or buffer it until initialization finishes.
         *
         * Every convenience method goes through here. They used to call
         * getInstance() directly, which THROWS when the SDK is not initialized —
         * so a track() that raced initialization crashed the host app. Buffering
         * is both what makes [initializeAsync] safe and the correct behaviour for
         * the synchronous path, where the same race was always possible.
         */
        /**
         * Run [action] against the SDK as soon as it is ready.
         *
         * The public form of [withSdk], for callers that hold no instance and
         * must not care whether initialization has finished — the React Native
         * bridge above all, where a throw inside a @ReactMethod surfaces as a red
         * box in development and an unhandled JS error in production.
         *
         * Use this instead of getInstance() for anything fire-and-forget.
         * getInstance() still throws by design: a caller that genuinely needs the
         * instance now should hear about it.
         */
        @JvmStatic
        fun whenReady(action: (Joryio) -> Unit) = withSdk(action)

        private fun withSdk(action: (Joryio) -> Unit) {
            val sdk = instance
            if (sdk != null) {
                action(sdk)
                return
            }
            synchronized(pendingActions) {
                if (pendingActions.size >= MAX_PENDING_ACTIONS) {
                    pendingActions.removeFirst()
                    android.util.Log.w(
                        "Joryio",
                        "Dropping the oldest pre-initialization call: more than " +
                            "$MAX_PENDING_ACTIONS were made before initialize() completed.",
                    )
                }
                pendingActions.addLast(action)
            }
        }

        /** Replay everything buffered before readiness, in the order it was called. */
        private fun drainPending(sdk: Joryio) {
            val drained = synchronized(pendingActions) {
                val copy = pendingActions.toList()
                pendingActions.clear()
                copy
            }
            drained.forEach { action ->
                try {
                    action(sdk)
                } catch (t: Throwable) {
                    android.util.Log.w("Joryio", "A buffered SDK call failed: ${t.message}")
                }
            }
        }

        // MARK: - Convenience Methods

        fun track(eventName: String, properties: Map<String, Any?> = emptyMap()) {
            withSdk { it.track(eventName, properties) }
        }

        fun trackScreen(screenName: String, properties: Map<String, Any?> = emptyMap()) {
            withSdk { it.trackScreen(screenName, properties) }
        }

        fun identify(userId: String) {
            withSdk { it.identify(userId) }
        }

        fun alias(userId: String) {
            withSdk { it.alias(userId) }
        }

        fun reset() {
            withSdk { it.reset() }
        }

        fun setAttribute(key: String, value: Any) {
            withSdk { it.setAttribute(key, value) }
        }

        fun incrementAttribute(key: String, by: Number = 1) {
            withSdk { it.incrementAttribute(key, by) }
        }

        fun flush() {
            withSdk { it.flush() }
        }

        fun setSdkAuthenticationToken(token: String) {
            withSdk { it.setSdkAuthenticationToken(token) }
        }

        fun setSdkAuthenticationErrorHandler(handler: (SdkAuthError) -> Unit) {
            withSdk { it.setSdkAuthenticationErrorHandler(handler) }
        }
    }
}

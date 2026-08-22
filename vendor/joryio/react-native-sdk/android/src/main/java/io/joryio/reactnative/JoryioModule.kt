package io.joryio.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.util.Log
import io.joryio.sdk.Joryio
import io.joryio.sdk.models.InAppContent
import io.joryio.sdk.JoryioConfig

/**
 * React Native bridge for the Joryio Android SDK.
 * Each method delegates to the native Joryio singleton.
 */
class JoryioModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "JoryioModule"

    // ─── Initialization ────────────────────────────────────────────────────

    @ReactMethod
    fun initialize(sdkKey: String, apiHost: String, config: ReadableMap, promise: Promise) {
        try {
            // Only override keys the JS caller explicitly set; leave everything else
            // to the native SDK's own defaults. Injecting JS-side defaults here would
            // silently diverge RN-Android from native + web (e.g. batchSize/flush/
            // sessionTimeout). This mirrors how the iOS bridge behaves.
            var hippConfig = JoryioConfig(
                userId = if (config.hasKey("userId")) config.getString("userId") else null,
            )
            // Off unless the app opts in - see JoryioConfig.
            if (config.hasKey("allowHtmlJsInAppMessages")) {
                hippConfig = hippConfig.copy(
                    allowHtmlJsInAppMessages = config.getBoolean("allowHtmlJsInAppMessages"),
                )
            }
            if (config.hasKey("requestPushPermissionAtLaunch")) {
                hippConfig = hippConfig.copy(
                    requestPushPermissionAtLaunch = config.getBoolean("requestPushPermissionAtLaunch"),
                )
            }
            if (config.hasKey("enableDebug")) {
                hippConfig = hippConfig.copy(enableDebug = config.getBoolean("enableDebug"))
            }
            // Explicit level, same key the iOS bridge accepts. Left unset, the
            // level follows enableDebug (JoryioConfig.effectiveLogLevel).
            if (config.hasKey("logLevel")) {
                val parsed = config.getString("logLevel")?.uppercase()?.let { raw ->
                    io.joryio.sdk.LogLevel.values().firstOrNull { it.name == raw }
                }
                if (parsed != null) hippConfig = hippConfig.copy(logLevel = parsed)
            }
            if (config.hasKey("batchSize")) {
                hippConfig = hippConfig.copy(batchSize = config.getInt("batchSize"))
            }
            if (config.hasKey("flushInterval")) {
                hippConfig = hippConfig.copy(flushInterval = config.getInt("flushInterval").toLong())
            }
            if (config.hasKey("sessionTimeout")) {
                hippConfig = hippConfig.copy(sessionTimeout = config.getInt("sessionTimeout").toLong())
            }
            if (config.hasKey("trackSessionStart")) {
                hippConfig = hippConfig.copy(trackSessionStart = config.getBoolean("trackSessionStart"))
            }
            if (config.hasKey("enableSdkAuthentication")) {
                hippConfig = hippConfig.copy(
                    enableSdkAuthentication = config.getBoolean("enableSdkAuthentication"),
                )
            }
            if (config.hasKey("sdkAuthenticationToken")) {
                hippConfig = hippConfig.copy(
                    sdkAuthenticationToken = config.getString("sdkAuthenticationToken"),
                )
            }

            Joryio.initialize(
                context = reactContext.applicationContext,
                sdkKey = sdkKey,
                apiHost = apiHost,
                config = hippConfig,
            )

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("INIT_ERROR", e.message, e)
        }
    }

    // ─── Event Tracking ────────────────────────────────────────────────────

    @ReactMethod
    fun track(eventName: String, properties: ReadableMap) {
        Joryio.track(eventName, properties.toHashMap().mapValues { it.value as Any? })
    }

    @ReactMethod
    fun trackScreen(screenName: String, properties: ReadableMap) {
        Joryio.trackScreen(screenName, properties.toHashMap().mapValues { it.value as Any? })
    }

    // ─── Identity ──────────────────────────────────────────────────────────

    @ReactMethod
    fun identify(userId: String) {
        Joryio.identify(userId)
    }

    @ReactMethod
    fun alias(userId: String) {
        Joryio.alias(userId)
    }

    @ReactMethod
    fun reset() {
        Joryio.reset()
    }

    // ─── Attributes ────────────────────────────────────────────────────────

    @ReactMethod
    fun setAttributes(attributes: ReadableMap) {
        val attrs = attributes.toHashMap().mapValues { it.value as Any }
        Joryio.whenReady { it.setAttributes(attrs) }
    }

    @ReactMethod
    fun setAttribute(key: String, value: Dynamic) {
        val resolved: Any = when (value.type) {
            ReadableType.Boolean -> value.asBoolean()
            ReadableType.Number -> value.asDouble()
            ReadableType.String -> value.asString()
            else -> value.asString()
        }
        Joryio.whenReady { it.setAttribute(key, resolved) }
    }

    @ReactMethod
    fun incrementAttribute(key: String, by: Double) {
        Joryio.whenReady { it.incrementAttribute(key, by) }
    }

    @ReactMethod
    fun unsetAttribute(key: String) {
        Joryio.whenReady { it.unsetAttribute(key) }
    }

    // ─── Push ──────────────────────────────────────────────────────────────

    @ReactMethod
    fun registerPushToken(token: String) {
        Joryio.whenReady { it.registerPushToken(token) }
    }

    @ReactMethod
    fun unregisterPush() {
        Joryio.whenReady { it.unregisterPush() }
    }

    /**
     * Show the system notification prompt (Android 13+ POST_NOTIFICATIONS).
     *
     * Resolves the resulting status rather than a bare boolean, so JS can tell
     * "denied" from "we could not ask" - the difference decides whether a primer
     * is worth showing again.
     */
    @ReactMethod
    fun requestPushPermission(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            // No Activity = nothing to attach a dialog to. Report it instead of
            // throwing: this is a normal race if JS asks during a background tick.
            promise.resolve("unavailable")
            return
        }
        if (!Joryio.isInitialized()) {
            promise.resolve("unavailable")
            return
        }
        Joryio.getInstance().requestPushPermission(activity) { status ->
            promise.resolve(status.name.lowercase().toCamel())
        }
    }

    @ReactMethod
    fun getPushPermissionStatus(promise: Promise) {
        promise.resolve(
            if (Joryio.isInitialized()) {
                Joryio.getInstance().getPushPermissionStatus().name.lowercase().toCamel()
            } else {
                "unavailable"
            },
        )
    }

    /** NOT_DETERMINED -> notDetermined, matching the iOS bridge's vocabulary. */
    private fun String.toCamel(): String =
        split('_').mapIndexed { i, part ->
            if (i == 0) part else part.replaceFirstChar { it.uppercase() }
        }.joinToString("")

    @ReactMethod
    fun isPushEnabled(promise: Promise) {
        // Answer NOW, even if the SDK is not ready. getInstance() throws when it
        // is not, and a throw inside a @ReactMethod is a red box in development
        // and an unhandled JS error in production. Deferring instead would be
        // worse: the promise would simply never settle and the caller would hang.
        promise.resolve(if (Joryio.isInitialized()) Joryio.getInstance().isPushEnabled() else false)
    }

    @ReactMethod
    fun trackPushClick(trackingId: String) {
        Joryio.whenReady { it.trackPushClick(trackingId) }
    }

    // ─── In-App Messaging ──────────────────────────────────────────────────

    /**
     * Forward in-app campaigns to JS.
     *
     * This used to read `message.html` / `message.css` / a String `message.type`
     * off the native model, and did not compile: the native model described a
     * structured message (title/body/imageUrl/buttons) the server has never
     * sent. The model now matches the wire contract, so the bridge reads the
     * resolved content.
     *
     * A campaign with no renderable document is DROPPED rather than emitted
     * with empty strings - JS would otherwise render a blank container the user
     * has to dismiss, and count an impression for it.
     */
    @ReactMethod
    fun enableInAppMessages() {
        Joryio.whenReady { sdk -> sdk.setInAppMessageCallback { campaign ->
            val content = campaign.content
            if (content == null) {
                Log.w("JoryioModule", "Campaign ${campaign.id} has no content; not emitting")
                return@setInAppMessageCallback
            }

            val params = Arguments.createMap().apply {
                putString("id", campaign.id)
                putString("name", campaign.name)
                // Wire value, not the enum name: JS types this as
                // 'modal' | 'banner' | 'slideup' | 'fullscreen' | 'custom'.
                putString("type", campaign.type.name.lowercase())
                putInt("priority", campaign.priority)

                // Both content kinds reach JS. A React Native app renders its
                // own UI, so dropping native here would mean native campaigns
                // never display in RN apps at all - while showing up as
                // delivered server-side.
                when (content) {
                    is InAppContent.Html -> {
                        putString("kind", "html")
                        putString("html", content.html)
                        putString("css", content.css)
                    }
                    is InAppContent.Native -> {
                        putString("kind", "native")
                        content.title?.let { putString("title", it) }
                        putString("body", content.body)
                        content.imageUrl?.let { putString("imageUrl", it) }
                        putBoolean("closeButton", content.closeButton)
                        putBoolean("backdropDismissible", content.backdropDismissible)
                        // Author style overrides. Forwarded rather than applied:
                        // in RN the HOST draws the message, so keeping these on
                        // the native side would resolve them and then throw them
                        // away - the campaign's colours would simply not happen.
                        content.style?.let { st ->
                            putMap(
                                "style",
                                Arguments.createMap().apply {
                                    st.backgroundColor?.let { putString("backgroundColor", it) }
                                    st.textColor?.let { putString("textColor", it) }
                                    st.primaryButtonColor?.let { putString("primaryButtonColor", it) }
                                    st.primaryButtonTextColor?.let {
                                        putString("primaryButtonTextColor", it)
                                    }
                                    st.cornerRadius?.let { putDouble("cornerRadius", it.toDouble()) }
                                    st.fontSize?.let { putDouble("fontSize", it.toDouble()) }
                                    st.titleWeight?.let { putString("titleWeight", it) }
                                    st.textAlign?.let { putString("textAlign", it) }
                                    st.fontFamily?.let { putString("fontFamily", it) }
                                },
                            )
                        }
                        putArray(
                            "buttons",
                            Arguments.createArray().apply {
                                content.buttons.forEach { b ->
                                    pushMap(
                                        Arguments.createMap().apply {
                                            putString("id", b.id)
                                            putString("text", b.text)
                                            putString("action", b.action.name.lowercase())
                                            b.url?.let { putString("url", it) }
                                        },
                                    )
                                }
                            },
                        )
                    }
                }
            }

            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("JoryioInAppMessage", params)
        } }
    }

    @ReactMethod
    fun trackInAppImpression(campaignId: String, action: String) {
        Joryio.whenReady { it.trackInAppImpression(campaignId, action) }
    }

    // ─── SDK Authentication ────────────────────────────────────────────────

    @ReactMethod
    fun setSdkAuthenticationToken(token: String) {
        Joryio.whenReady { it.setSdkAuthenticationToken(token) }
    }

    @ReactMethod
    fun enableSdkAuthenticationErrors() {
        Joryio.whenReady { sdk -> sdk.setSdkAuthenticationErrorHandler { error ->
            val params = Arguments.createMap().apply {
                // enum name (e.g. SUB_MISMATCH) → wire reason ("sub_mismatch"),
                // matching the JS SdkAuthError.reason union.
                putString("reason", error.reason.name.lowercase())
                error.rawReason?.let { putString("rawReason", it) }
            }

            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("JoryioSdkAuthError", params)
        } }
    }

    // ─── Utilities ─────────────────────────────────────────────────────────

    @ReactMethod
    fun flush() {
        Joryio.flush()
    }

    @ReactMethod
    fun getAnonymousId(promise: Promise) {
        promise.resolve(if (Joryio.isInitialized()) Joryio.getInstance().getAnonymousId() else null)
    }

    /**
     * Diagnostics: which server the SDK is talking to, and what went wrong last.
     *
     * Ported from iOS so the method exists on BOTH platforms. It was iOS-only,
     * which meant the one call you reach for when an integration is misbehaving
     * was missing on the platform more likely to be misbehaving.
     *
     * Returns `{ apiEndpoint, lastError? }`, matching the iOS payload exactly so
     * the JS type covers both.
     */
    @ReactMethod
    fun getDiagnostics(promise: Promise) {
        if (!Joryio.isInitialized()) {
            // Diagnostics is what an integrator calls when things look wrong,
            // which is exactly when the SDK may not be initialized. Report that
            // fact instead of throwing at them.
            val notReady = Arguments.createMap()
            notReady.putNull("apiEndpoint")
            promise.resolve(notReady)
            return
        }
        val sdk = Joryio.getInstance()
        val result = Arguments.createMap()
        result.putString("apiEndpoint", sdk.currentApiEndpoint)
        sdk.lastTransportError?.let { err ->
            val lastError = Arguments.createMap()
            lastError.putString("message", err.message)
            lastError.putBoolean("isUnauthorized", err.isUnauthorized)
            // Double, not Int: an epoch-ms timestamp overflows a 32-bit Int.
            lastError.putDouble("at", err.at.toDouble())
            result.putMap("lastError", lastError)
        }
        promise.resolve(result)
    }

    @ReactMethod
    fun getUserId(promise: Promise) {
        promise.resolve(if (Joryio.isInitialized()) Joryio.getInstance().getUserId() else null)
    }

    @ReactMethod
    fun getSessionId(promise: Promise) {
        promise.resolve(if (Joryio.isInitialized()) Joryio.getInstance().getSessionId() else null)
    }

    // Required for NativeEventEmitter
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}

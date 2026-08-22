package io.joryio.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.util.Log
import io.joryio.sdk.Joryio
import io.joryio.sdk.ecommerce.EcommerceCartItem
import io.joryio.sdk.ecommerce.EcommerceOrder
import io.joryio.sdk.ecommerce.EcommerceProduct
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
    // ── E-commerce ───────────────────────────────────────────────────────────

    /**
     * ONE bridge method, not nineteen.
     *
     * EcommerceTracker exposes 19 calls. Forwarding each as its own
     * @ReactMethod would mean 19 signatures here, 19 more in the iOS module and
     * 19 in JS, all of which have to agree - and this repo's recurring failure
     * is exactly that: a name one side emits and the other never branches on.
     * A single entry point with an explicit `when` puts the whole contract in
     * one readable place per platform, and a spec can compare the three lists.
     *
     * WHY FORWARD AT ALL rather than build the events in JS. The canonical
     * event names ("Product Added", not "Added to Cart") and the purchase
     * property keys live in the native tracker. Rebuilding them in JS would be
     * a FIFTH copy of the vocabulary, and there is deliberately no alias layer
     * server-side: a near-miss is stored verbatim and matches no report. Our own
     * demo app shipped "Placed Order" and recorded zero revenue while looking
     * completely healthy.
     *
     * An unknown method logs loudly rather than failing silently, because the
     * failure it guards against - a typo'd method name - would otherwise be a
     * no-op that looks like the SDK working.
     */
    @ReactMethod
    fun ecommerce(method: String, payload: ReadableMap) {
        // whenReady, not getInstance(): getInstance() THROWS before initialize()
        // and this is reachable from a module field or a first render, which is
        // earlier than initialize() resolves. The repo's own bridge-safety guard
        // caught this - the first version called getInstance() directly.
        //
        // Queuing is also the better behaviour: an e-commerce event fired during
        // startup is a real event, and dropping it would understate revenue
        // rather than fail visibly.
        Joryio.whenReady { sdk ->
        val tracker = sdk.ecommerce()
        when (method) {
            "viewProduct" -> tracker.viewProduct(product(payload.getMap("product")))
            "viewCategory" -> tracker.viewCategory(
                payload.getString("categoryId") ?: "",
                payload.getString("categoryName") ?: "",
            )
            "search" -> tracker.search(
                payload.getString("query") ?: "",
                if (payload.hasKey("resultCount")) payload.getInt("resultCount") else null,
            )
            "addToCart" -> tracker.addToCart(
                cartItem(payload.getMap("item")),
                if (payload.hasKey("cartValue")) payload.getDouble("cartValue") else null,
            )
            "removeFromCart" -> tracker.removeFromCart(
                product(payload.getMap("product")),
                if (payload.hasKey("quantity")) payload.getInt("quantity") else 1,
            )
            "cartViewed" -> tracker.cartViewed(
                cartItems(payload.getArray("items")),
                payload.getDouble("cartValue"),
            )
            "updateCart" -> tracker.updateCart(
                cartItems(payload.getArray("items")),
                payload.getDouble("cartValue"),
            )
            "startCheckout" -> tracker.startCheckout(
                cartItems(payload.getArray("items")),
                payload.getDouble("cartValue"),
            )
            "addPaymentInfo" -> tracker.addPaymentInfo(payload.getString("paymentMethod") ?: "")
            "purchase" -> tracker.purchase(order(payload.getMap("order")))
            "orderFulfilled" -> tracker.orderFulfilled(
                payload.getString("orderId") ?: "",
                payload.getString("trackingNumber"),
                payload.getString("carrier"),
            )
            "orderDelivered" -> tracker.orderDelivered(payload.getString("orderId") ?: "")
            "orderCancelled" -> tracker.orderCancelled(
                payload.getString("orderId") ?: "",
                payload.getString("reason"),
            )
            "orderRefunded" -> tracker.orderRefunded(
                payload.getString("orderId") ?: "",
                if (payload.hasKey("refundAmount")) payload.getDouble("refundAmount") else null,
                payload.getString("reason"),
            )
            "addToWishlist" -> tracker.addToWishlist(product(payload.getMap("product")))
            "removeFromWishlist" -> tracker.removeFromWishlist(product(payload.getMap("product")))
            "shareProduct" -> tracker.shareProduct(
                product(payload.getMap("product")),
                payload.getString("shareMethod") ?: "",
            )
            "applyCoupon" -> tracker.applyCoupon(
                payload.getString("couponCode") ?: "",
                if (payload.hasKey("discountAmount")) payload.getDouble("discountAmount") else null,
                payload.getString("discountType"),
            )
            "removeCoupon" -> tracker.removeCoupon(payload.getString("couponCode") ?: "")
            "submitReview" -> tracker.submitReview(
                payload.getString("productId") ?: "",
                payload.getInt("rating"),
                payload.getString("reviewText"),
            )
            else -> Log.e("JoryioModule", "Unknown ecommerce method '$method' - event NOT sent")
        }
        }
    }

    private fun product(map: ReadableMap?): EcommerceProduct {
        val m = map ?: Arguments.createMap()
        return EcommerceProduct(
            productId = m.getString("productId") ?: "",
            name = m.getString("name") ?: "",
            price = if (m.hasKey("price")) m.getDouble("price") else 0.0,
            quantity = if (m.hasKey("quantity")) m.getInt("quantity") else null,
            category = m.getString("category"),
            brand = m.getString("brand"),
            variant = m.getString("variant"),
            variantId = m.getString("variantId"),
            sku = m.getString("sku"),
            imageUrl = m.getString("imageUrl"),
            url = m.getString("url"),
        )
    }

    private fun cartItem(map: ReadableMap?): EcommerceCartItem {
        val m = map ?: Arguments.createMap()
        return EcommerceCartItem(
            productId = m.getString("productId") ?: "",
            name = m.getString("name") ?: "",
            price = if (m.hasKey("price")) m.getDouble("price") else 0.0,
            // Quantity defaults to 1, not 0: a cart line with zero quantity has
            // an item total of zero, which is a silently wrong revenue number
            // rather than an obviously wrong one.
            quantity = if (m.hasKey("quantity")) m.getInt("quantity") else 1,
            category = m.getString("category"),
            brand = m.getString("brand"),
            variant = m.getString("variant"),
            variantId = m.getString("variantId"),
            sku = m.getString("sku"),
            imageUrl = m.getString("imageUrl"),
            url = m.getString("url"),
        )
    }

    private fun cartItems(arr: ReadableArray?): List<EcommerceCartItem> {
        val a = arr ?: return emptyList()
        return (0 until a.size()).map { i -> cartItem(a.getMap(i)) }
    }

    private fun order(map: ReadableMap?): EcommerceOrder {
        val m = map ?: Arguments.createMap()
        return EcommerceOrder(
            orderId = m.getString("orderId") ?: "",
            items = cartItems(m.getArray("items")),
            value = if (m.hasKey("value")) m.getDouble("value") else 0.0,
            currency = m.getString("currency"),
            shipping = if (m.hasKey("shipping")) m.getDouble("shipping") else null,
            tax = if (m.hasKey("tax")) m.getDouble("tax") else null,
            discount = if (m.hasKey("discount")) m.getDouble("discount") else null,
            coupon = m.getString("coupon"),
        )
    }

    @ReactMethod
    fun enableInAppMessages(capabilities: ReadableArray?) {
        // What THIS app can render, declared from JS.
        //
        // The SDK's own capability list describes the SDK's own views, and those
        // views stop running the moment this callback is set - here they never
        // run at all, because React Native always renders. Worse, `content.html`
        // was derived from a NATIVE config flag describing a native renderer:
        // an RN app with react-native-webview can draw HTML and may have been
        // reporting that it cannot, while one without it may have been
        // reporting that it can. Both directions are wrong, and the server reads
        // an absent capability as "cannot" rather than "unknown".
        //
        // Null keeps the previous behaviour, so an app that does not declare is
        // unchanged.
        val declared = capabilities?.let { arr ->
            (0 until arr.size()).mapNotNull { i -> arr.getString(i) }.takeIf { it.isNotEmpty() }
        }
        Joryio.whenReady { sdk -> sdk.setInAppMessageCallback({ campaign ->
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
        }, declared) }
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

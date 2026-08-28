package io.joryio.sdk.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import io.joryio.sdk.SdkAuthError
import io.joryio.sdk.SdkAuthErrorReason
import io.joryio.sdk.core.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.Date
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Network client for API communication
 */
internal class NetworkClient(
    private val context: Context,
    private val sdkKey: String,
    private val apiHost: String,
    private val logger: Logger,
    private val maxRetries: Int = 3,
    private val retryBackoffMs: Long = 1000,
    private val enableDebug: Boolean = false,
    enableSdkAuthentication: Boolean = false,
    sdkAuthenticationToken: String? = null
) {
    private val api: JoryioApi
    private val okHttpClient: OkHttpClient

    /**
     * `Joryio-Android/<sdk> (<package>; Android <release>)` — an app-shaped
     * User-Agent, so we are never mistaken for a scripted HTTP client. Built
     * defensively: a Context that cannot report its package name must not stop
     * the SDK from making requests.
     */
    private val userAgent: String = try {
        "Joryio-Android/1.0.0 (${context.packageName}; Android ${android.os.Build.VERSION.RELEASE})"
    } catch (t: Throwable) {
        "Joryio-Android/1.0.0"
    }

    // Optional JWT-based SDK Authentication. Holds the customer-minted JWT and
    // the app's auth-error handler; read on the OkHttp thread, written from the
    // app thread. Inert unless enabled + a token is set.
    private val sdkAuthenticator = SdkAuthenticator(enableSdkAuthentication, sdkAuthenticationToken)
    private val authErrorGson = Gson()

    private companion object {
        const val MAX_BACKOFF_MS = 30_000L
        const val SDK_AUTH_HEADER = "X-Joryio-Auth"
        const val SDK_AUTH_ERROR = "sdk_authentication_error"
        // Cap on how many bytes of an error body we peek to detect the auth error.
        const val AUTH_ERROR_PEEK_BYTES = 8_192L
    }

    /** Retrofit-ready base URL derived from `apiHost` — see normalizeBaseUrl. */

    private val normalizedBaseUrl: String get() = normalizeBaseUrl(apiHost)

    /** The base URL actually in use, for diagnostics. */
    val currentApiEndpoint: String get() = normalizedBaseUrl

    /**
     * The most recent transport failure, or null if the last call succeeded.
     *
     * Mirrors iOS's `lastTransportError`. It exists because "initialized" and
     * "the server accepts us" are DIFFERENT claims, and conflating them is what
     * makes a 401 loop look healthy: the SDK reports itself up while every
     * request is rejected. Surfaced through Joryio.getDiagnostics().
     *
     * Written from executeWithRetry, the single chokepoint every API call goes
     * through, so no call site has to remember to record anything.
     */
    @Volatile
    var lastTransportError: JoryioTransportError? = null
        private set


    init {
        val gson = GsonBuilder()
            .setDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .create()

        okHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(createAuthInterceptor())
            // Added AFTER the SDK-key interceptor so this (inner) interceptor's
            // received request already carries the base headers; its one-shot
            // retry rebuilds from that request and therefore keeps them.
            .addInterceptor(createSdkAuthInterceptor())
            .apply {
                if (enableDebug) {
                    addInterceptor(createLoggingInterceptor())
                }
            }
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(normalizedBaseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()

        api = retrofit.create(JoryioApi::class.java)
        logger.debug("NetworkClient initialized with base URL: $normalizedBaseUrl")
    }

    /**
     * Turn whatever the host app passed as `apiHost` into a base URL Retrofit
     * accepts.
     *
     * This used to be `"https://" + apiHost`, which assumed a BARE host. Every
     * documented example - and the SDK's own demo config - passes a full URL
     * ("https://api.example.com/api"), which produced
     * `https://https//api.example.com/api` and made Retrofit throw
     * IllegalArgumentException inside initialize(). The SDK then never
     * initialized at all, on every Android app, for any host written the
     * documented way.
     *
     * Handles all three forms:
     *  - bare host              → https:// prepended
     *  - explicit http://       → PRESERVED, so a local dev backend
     *                             (http://10.0.2.2:3000/api on the emulator)
     *                             is not silently upgraded to https and broken
     *  - explicit https://      → left alone
     *
     * Always ends in "/" because Retrofit requires it.
     */
    private fun normalizeBaseUrl(host: String): String {
        val trimmed = host.trim()
        val withScheme = when {
            trimmed.startsWith("http://", ignoreCase = true) -> trimmed
            trimmed.startsWith("https://", ignoreCase = true) -> trimmed
            else -> "https://$trimmed"
        }
        return if (withScheme.endsWith("/")) withScheme else "$withScheme/"
    }

    /**
     * Create auth interceptor for SDK key
     */
    private fun createAuthInterceptor(): Interceptor {
        return Interceptor { chain ->
            val request = chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $sdkKey")
                .addHeader("Content-Type", "application/json")
                .addHeader("X-Joryio-SDK", "android")
                .addHeader("X-Joryio-SDK-Version", "1.0.0")
                // Identify ourselves. Without this OkHttp sends its default
                // `okhttp/4.x`, which server-side bot heuristics classify as an
                // automated HTTP client — so /v1/in-app/sync answered
                // `{success:true, campaigns:[]}` and every event was tagged
                // $is_bot (and filtered out of analytics). iOS never hit this
                // because URLSession sends an app-shaped UA. Set here as well as
                // fixed server-side, so the SDK is also correct against an older
                // backend.
                .header("User-Agent", userAgent)
                .build()
            chain.proceed(request)
        }
    }

    // MARK: - SDK Authentication

    /** Set/replace the customer-minted JWT (thread-safe; call from any thread). */
    fun setSdkAuthenticationToken(token: String) {
        sdkAuthenticator.setToken(token)
    }

    /** Register the handler invoked on a 401 `sdk_authentication_error`. */
    fun setSdkAuthenticationErrorHandler(handler: (SdkAuthError) -> Unit) {
        sdkAuthenticator.setErrorHandler(handler)
    }

    /**
     * Interceptor implementing SDK Authentication.
     *
     * 1. When enabled + a token is set, attach `X-Joryio-Auth: <jwt>` to the request.
     * 2. If the response is HTTP 401 with body `{ error: "sdk_authentication_error",
     *    reason: ... }`, notify the app handler (its chance to mint a fresh JWT) and,
     *    if the token was updated **synchronously**, retry the SAME request exactly
     *    ONCE with the new token. Never loop.
     *
     * Batch integrity: on auth failure we do NOT drop or duplicate the batch. This
     * interceptor only ever returns the original 401 (or the single retry's result)
     * to [executeWithRetry], which treats 401 as non-retryable and surfaces an
     * error — so [QueueManager] leaves the events queued and the next flush carries
     * whatever token is set by then. An async refresh (e.g. the RN bridge, where the
     * handler round-trips to JS) therefore heals on the following flush rather than
     * inline; a synchronous native handler heals inline via the one-shot retry.
     */
    private fun createSdkAuthInterceptor(): Interceptor {
        return Interceptor { chain ->
            val original = chain.request()
            val token = sdkAuthenticator.currentToken()

            // Pure pass-through when the feature isn't in use.
            if (!sdkAuthenticator.isEnabled || token == null) {
                return@Interceptor chain.proceed(original)
            }

            val firstRequest = original.newBuilder()
                .header(SDK_AUTH_HEADER, token)
                .build()
            val firstResponse = chain.proceed(firstRequest)

            // Only react to the backend's dedicated auth rejection. Any other
            // status (including a plain 401 without this body) passes straight
            // through to the existing retry/backoff logic.
            val authError = parseSdkAuthError(firstResponse) ?: return@Interceptor firstResponse

            logger.warn("SDK authentication rejected: ${authError.rawReason ?: authError.reason}")

            // Ask the host app for a fresh token. A native handler may call
            // setSdkAuthenticationToken() synchronously here.
            sdkAuthenticator.notifyError(authError)

            val refreshed = sdkAuthenticator.currentToken()
            if (refreshed == null || refreshed == token) {
                // No (new) token available synchronously → stop. Events stay queued.
                return@Interceptor firstResponse
            }

            // Retry exactly once with the refreshed token. Close the first
            // response body to release its connection.
            firstResponse.close()
            val retryRequest = original.newBuilder()
                .header(SDK_AUTH_HEADER, refreshed)
                .build()
            val retryResponse = chain.proceed(retryRequest)

            // If it STILL fails auth, surface the terminal error and stop — no loop.
            parseSdkAuthError(retryResponse)?.let {
                logger.error("SDK authentication still failing after refresh: ${it.rawReason ?: it.reason}")
                sdkAuthenticator.notifyError(it)
            }

            retryResponse
        }
    }

    /**
     * Return an [SdkAuthError] iff [response] is a 401 whose body is the backend's
     * `sdk_authentication_error`. Uses `peekBody` so the real body stays readable
     * downstream. Returns null (leaving the response untouched) on any other case.
     */
    private fun parseSdkAuthError(response: okhttp3.Response): SdkAuthError? {
        if (response.code != 401) return null

        val bodyStr = try {
            response.peekBody(AUTH_ERROR_PEEK_BYTES).string()
        } catch (e: Exception) {
            return null
        }
        if (bodyStr.isBlank()) return null

        return try {
            val body = authErrorGson.fromJson(bodyStr, SdkAuthErrorBody::class.java)
            if (body?.error != SDK_AUTH_ERROR) {
                null
            } else {
                SdkAuthError(
                    reason = SdkAuthErrorReason.fromWire(body.reason),
                    rawReason = body.reason
                )
            }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Create logging interceptor for debugging
     */
    private fun createLoggingInterceptor(): HttpLoggingInterceptor {
        return HttpLoggingInterceptor { message ->
            logger.debug("HTTP: $message")
        }.apply {
            // HEADERS (not BODY): body logging would write request bodies —
            // which carry PII (email/phone/name in identify/attributes) — to
            // Logcat. And redact the two bearer credentials so a debug build
            // can never leak a replayable token to logs.
            level = HttpLoggingInterceptor.Level.HEADERS
            redactHeader("Authorization")
            redactHeader("X-Joryio-Auth")
        }
    }

    /**
     * Check if network is available
     */
    fun isNetworkAvailable(): Boolean {
        // `as?`, not `as`: getSystemService returns null on a restricted or
        // not-yet-ready Context (and on some OEM builds), and the unchecked cast
        // then threw a NullPointerException out of this method. It is called
        // before EVERY request, so that would surface as a crash on an arbitrary
        // caller's thread. Assume "connected" when we cannot tell — the request
        // itself will fail and be retried, which is a far better outcome than
        // taking the host app down to answer a question we only use as a hint.
        val connectivityManager =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return true
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * Execute API call with retry logic
     */
    private suspend fun <T> executeWithRetry(
        operation: String,
        call: suspend () -> Response<T>
    ): NetworkResult<T> {
        if (!isNetworkAvailable()) {
            logger.warn("$operation failed: No network connection")
            lastTransportError = JoryioTransportError(
                message = "No network connection",
                isUnauthorized = false,
            )
            return NetworkResult.Error("No network connection", isRetryable = true)
        }

        var lastError: Exception? = null
        var attempt = 0

        while (attempt <= maxRetries) {
            // Server-directed delay (429 Retry-After) overrides our own backoff.
            var retryAfterMs: Long? = null
            try {
                logger.debug("$operation - Attempt ${attempt + 1}/${maxRetries + 1}")

                val response = call()

                if (response.isSuccessful) {
                    val body = response.body()
                    if (body != null) {
                        logger.debug("$operation succeeded")
                        // A success CLEARS the last error: diagnostics should say
                        // "healthy now", not "failed once, three hours ago".
                        lastTransportError = null
                        return NetworkResult.Success(body)
                    } else {
                        logger.error("$operation failed: Empty response body")
                        return NetworkResult.Error("Empty response body", isRetryable = false)
                    }
                } else {
                    val code = response.code()
                    val errorMessage = response.errorBody()?.string() ?: "Unknown error"
                    logger.warn("$operation failed: HTTP $code - $errorMessage")

                    // Only transient/rate-limit statuses are retryable. Never retry
                    // 401/403/4xx (bad key / bad request) — those won't self-heal and
                    // would just burn battery and hammer the backend.
                    val isRetryable = code in listOf(408, 429, 500, 502, 503, 504)

                    if (code == 429) {
                        retryAfterMs = parseRetryAfterMs(response.headers()["Retry-After"])
                    }

                    if (!isRetryable || attempt >= maxRetries) {
                        lastTransportError = JoryioTransportError(
                            message = "HTTP $code: $errorMessage",
                            isUnauthorized = code == 401 || code == 403,
                        )
                        return NetworkResult.Error(
                            "HTTP $code: $errorMessage",
                            isRetryable = isRetryable
                        )
                    }
                }
            } catch (e: Exception) {
                lastError = e
                logger.warn("$operation failed: ${e.message}")

                if (attempt >= maxRetries) {
                    lastTransportError = JoryioTransportError(
                        message = e.message ?: "Network request failed",
                        isUnauthorized = false,
                    )
                    return NetworkResult.Error(
                        e.message ?: "Network request failed",
                        isRetryable = true
                    )
                }
            }

            // Backoff before the next attempt: honor Retry-After when the server
            // sent one, otherwise exponential backoff off config.retryBackoffMs with
            // ±25% jitter and a cap to avoid thundering-herd retries.
            if (attempt < maxRetries) {
                val delayMs = retryAfterMs ?: computeBackoffMs(attempt)
                logger.debug("$operation - Retrying in ${delayMs}ms")
                delay(delayMs)
            }

            attempt++
        }

        return NetworkResult.Error(
            lastError?.message ?: "Max retries exceeded",
            isRetryable = true
        )
    }

    /**
     * Exponential backoff off [retryBackoffMs] with ±25% jitter, capped.
     */
    private fun computeBackoffMs(attempt: Int): Long {
        val base = (retryBackoffMs * (1L shl attempt)).coerceAtMost(MAX_BACKOFF_MS)
        val jitter = (base * 0.25).toLong()
        val low = (base - jitter).coerceAtLeast(0L)
        val high = base + jitter
        return if (high > low) Random.nextLong(low, high + 1) else base
    }

    /**
     * Parse an HTTP `Retry-After` header expressed in delta-seconds. HTTP-date
     * form is not honored (returns null → falls back to computed backoff).
     */
    private fun parseRetryAfterMs(header: String?): Long? {
        val seconds = header?.trim()?.toLongOrNull() ?: return null
        return (seconds * 1000L).coerceIn(0L, MAX_BACKOFF_MS)
    }

    // MARK: - Event Tracking

    suspend fun trackBatch(batch: io.joryio.sdk.models.EventBatch): NetworkResult<BatchResponse> {
        return executeWithRetry("trackBatch") {
            api.trackBatch(batch)
        }
    }

    suspend fun trackEvent(event: io.joryio.sdk.models.Event): NetworkResult<EventResponse> {
        return executeWithRetry("trackEvent") {
            api.trackEvent(event)
        }
    }

    // MARK: - Identity

    suspend fun identify(request: IdentifyRequest): NetworkResult<IdentifyResponse> {
        return executeWithRetry("identify") {
            api.identify(request)
        }
    }

    suspend fun alias(request: AliasRequest): NetworkResult<AliasResponse> {
        return executeWithRetry("alias") {
            api.alias(request)
        }
    }

    suspend fun setAttributes(request: SetAttributesRequest): NetworkResult<SetAttributesResponse> {
        return executeWithRetry("setAttributes") {
            api.setAttributes(request)
        }
    }

    // MARK: - Subscriptions (marketing, not tracking consent)

    suspend fun updateChannelSubscription(
        request: ChannelSubscriptionRequest
    ): NetworkResult<SubscriptionResponse> {
        return executeWithRetry("updateChannelSubscription") {
            api.updateChannelSubscription(request)
        }
    }

    suspend fun updateSubscriptionGroup(
        request: SubscriptionGroupRequest
    ): NetworkResult<SubscriptionResponse> {
        return executeWithRetry("updateSubscriptionGroup") {
            api.updateSubscriptionGroup(request)
        }
    }

    // MARK: - In-App Messaging

    suspend fun syncInAppMessages(request: io.joryio.sdk.models.SessionSyncRequest): NetworkResult<io.joryio.sdk.models.SessionSyncResponse> {
        return executeWithRetry("syncInAppMessages") {
            api.syncInAppMessages(request)
        }
    }

    /** Display-time re-check for a `reevaluateBeforeDisplay` campaign. */
    suspend fun resolveInAppCampaign(
        request: io.joryio.sdk.models.ResolveRequest,
    ): NetworkResult<io.joryio.sdk.models.ResolveResponse> {
        return executeWithRetry("resolveInAppCampaign") {
            api.resolveInAppCampaign(request)
        }
    }

    suspend fun trackImpression(request: io.joryio.sdk.models.TrackImpressionRequest): NetworkResult<ImpressionResponse> {
        return executeWithRetry("trackImpression") {
            api.trackImpression(request)
        }
    }

    // MARK: - Push Notifications

    suspend fun registerPushToken(request: PushTokenRequest): NetworkResult<PushTokenResponse> {
        return executeWithRetry("registerPushToken") {
            api.registerPushToken(request)
        }
    }

    suspend fun unregisterPushToken(request: PushTokenRequest): NetworkResult<PushTokenResponse> {
        return executeWithRetry("unregisterPushToken") {
            api.unregisterPushToken(request)
        }
    }

    /**
     * Report that a push arrived on this device.
     *
     * Retried like any other call: a receipt lost to a flaky moment of network
     * is a delivery that silently reads as undelivered, and the backend
     * deduplicates by tracking id, so a retry that actually succeeded twice
     * costs nothing.
     */
    suspend fun reportPushDelivered(
        trackingId: String,
    ): NetworkResult<PushTokenResponse> {
        return executeWithRetry("reportPushDelivered") {
            api.reportPushDelivered(trackingId)
        }
    }

    suspend fun trackPushClick(trackingId: String): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        // okHttpClient.execute() is a BLOCKING call — it must never run on the main
        // thread (callers dispatch on Dispatchers.Main), hence the withContext(IO).
        try {
            // Same normalization as the Retrofit base URL — this built
            // `https://https//…` for a full-URL apiHost too.
            val url = "${normalizedBaseUrl}track/push/click/$trackingId"
            val request = okhttp3.Request.Builder()
                .url(url)
                .get()
                .build()

            val response = okHttpClient.newCall(request).execute()

            if (response.isSuccessful) {
                logger.debug("Push click tracked successfully")
                NetworkResult.Success(Unit)
            } else {
                logger.error("Failed to track push click: ${response.code}")
                NetworkResult.Error("HTTP ${response.code}", isRetryable = response.code in 500..599)
            }
        } catch (e: Exception) {
            logger.error("Failed to track push click: ${e.message}", e)
            NetworkResult.Error(e.message ?: "Unknown error", isRetryable = true)
        }
    }
}

/**
 * Network result wrapper
 */
internal sealed class NetworkResult<out T> {
    data class Success<T>(val data: T) : NetworkResult<T>()
    data class Error(val message: String, val isRetryable: Boolean) : NetworkResult<Nothing>()
}

/**
 * Shape of the HTTP 401 SDK-authentication rejection body. Extra fields are
 * ignored by Gson; both properties are nullable to tolerate partial/legacy bodies.
 */
internal data class SdkAuthErrorBody(
    val error: String? = null,
    val reason: String? = null
)

/**
 * A transport failure the host app can display. Deliberately narrow: a message,
 * whether it was an auth rejection, and when.
 *
 * `message` carries no credentials by construction — the SDK key travels as the
 * `Authorization` / `X-App-Key` HEADERS, never in a URL, so neither an HTTP
 * error body nor an exception message can contain it.
 */
data class JoryioTransportError(
    val message: String,
    val isUnauthorized: Boolean,
    val at: Long = System.currentTimeMillis(),
)

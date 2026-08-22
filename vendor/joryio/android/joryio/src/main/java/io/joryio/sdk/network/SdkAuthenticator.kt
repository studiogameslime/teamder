package io.joryio.sdk.network

import io.joryio.sdk.SdkAuthError

/**
 * Thread-safe holder for the optional SDK-authentication JWT and the app's
 * auth-error handler.
 *
 * The token is read on the OkHttp/IO thread (from the auth interceptor) and
 * written from the app thread (via [Joryio.setSdkAuthenticationToken]); every
 * field is [Volatile] so writes are visible across threads without a lock. No
 * compound invariant spans the fields, so per-field volatility is sufficient.
 */
internal class SdkAuthenticator(
    enabled: Boolean,
    initialToken: String?
) {
    // Supplying a token is itself an opt-in signal, so a config-provided initial
    // token enables the feature even if the flag was left false.
    @Volatile
    private var enabledFlag: Boolean = enabled || initialToken != null

    @Volatile
    private var token: String? = initialToken

    @Volatile
    private var errorHandler: ((SdkAuthError) -> Unit)? = null

    /** True when a token should be attached to outgoing ingest requests. */
    val isEnabled: Boolean
        get() = enabledFlag && token != null

    /** Current JWT, or null if none set. */
    fun currentToken(): String? = token

    /** Set/replace the JWT (from the app thread). Also opts the feature in. */
    fun setToken(newToken: String) {
        token = newToken
        enabledFlag = true
    }

    fun setErrorHandler(handler: (SdkAuthError) -> Unit) {
        errorHandler = handler
    }

    /**
     * Surface an auth error to the host app. Runs on the calling (OkHttp) thread
     * and never throws — a misbehaving host callback must not crash the network
     * layer.
     */
    fun notifyError(error: SdkAuthError) {
        try {
            errorHandler?.invoke(error)
        } catch (_: Throwable) {
            // Swallow: the host handler is untrusted code on our IO thread.
        }
    }
}

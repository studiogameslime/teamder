package io.joryio.sdk

/**
 * Reason the backend rejected the SDK-authentication JWT. Mirrors the `reason`
 * field of the HTTP 401 `sdk_authentication_error` response body.
 */
enum class SdkAuthErrorReason {
    /** No `X-Joryio-Auth` header was present on the request. */
    MISSING,

    /** The JWT was malformed or its signature failed verification. */
    INVALID,

    /** The JWT's `exp` claim is in the past. */
    EXPIRED,

    /** The JWT's `sub` claim does not match the identified user. */
    SUB_MISMATCH,

    /** A `reason` value not recognized by this SDK version. */
    UNKNOWN;

    companion object {
        /** Map the backend's wire `reason` string to an enum, tolerating unknowns. */
        fun fromWire(reason: String?): SdkAuthErrorReason = when (reason) {
            "missing" -> MISSING
            "invalid" -> INVALID
            "expired" -> EXPIRED
            "sub_mismatch" -> SUB_MISMATCH
            else -> UNKNOWN
        }
    }
}

/**
 * Delivered to the handler registered via
 * [Joryio.setSdkAuthenticationErrorHandler] when an ingest request is rejected
 * with HTTP 401 `sdk_authentication_error`.
 *
 * The host app should mint a fresh JWT and call
 * [Joryio.setSdkAuthenticationToken]. If the handler does so **synchronously**,
 * the SDK retries the rejected request immediately with the new token; otherwise
 * the events stay queued and the next flush carries whatever token is set by then.
 */
data class SdkAuthError(
    val reason: SdkAuthErrorReason,
    /** The raw wire `reason` string, preserved for logging / forward-compat. */
    val rawReason: String? = null
)

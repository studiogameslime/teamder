import Foundation

/// Reason a customer-minted SDK-authentication JWT was rejected by the backend.
///
/// Mirrors the backend contract:
/// `401 { error: "sdk_authentication_error", reason: "missing"|"invalid"|"expired"|"sub_mismatch" }`.
public enum SdkAuthErrorReason: String {
    /// No `X-Joryio-Auth` header was present but the backend required one.
    case missing
    /// The token was malformed, had a bad signature, or failed verification.
    case invalid
    /// The token's `exp` has passed.
    case expired
    /// The token's `sub` does not match the identified user.
    case subMismatch = "sub_mismatch"
    /// The backend sent a reason string this SDK version does not recognise.
    case unknown

    /// Map a raw backend `reason` string onto the enum, defaulting to `.unknown`.
    init(backendReason: String?) {
        guard let raw = backendReason, let mapped = SdkAuthErrorReason(rawValue: raw) else {
            self = .unknown
            return
        }
        self = mapped
    }
}

/// Delivered to the app-supplied error handler when an ingest request is
/// rejected because of SDK authentication. The app should mint a fresh JWT and
/// call `Joryio.shared.setSdkAuthenticationToken(_:)` in response.
public struct SdkAuthError {
    /// Why the token was rejected.
    public let reason: SdkAuthErrorReason
    /// The ingest endpoint whose request was rejected (context for the app).
    public let endpoint: String
    /// Whether the SDK retried once with a refreshed token and still failed
    /// (or could not obtain a fresh token). When `true`, the request was left
    /// queued and no further automatic retry will happen for it this cycle.
    public let refreshExhausted: Bool

    public init(reason: SdkAuthErrorReason, endpoint: String, refreshExhausted: Bool) {
        self.reason = reason
        self.endpoint = endpoint
        self.refreshExhausted = refreshExhausted
    }
}

/// Thread-safe holder for the SDK-authentication token and error handler.
///
/// The token is READ on the network thread (when building each ingest request)
/// and WRITTEN from the app thread (via `setSdkAuthenticationToken`), so every
/// access is guarded by a lock. A single shared instance is owned by `Joryio`
/// and handed to `NetworkClient`, so a token set through the public API is
/// immediately visible to in-flight and future requests.
final class SdkAuthTokenStore {
    /// Whether SDK authentication is enabled at all. Immutable after init:
    /// when `false`, no header is ever attached and the refresh flow is inert.
    let enabled: Bool

    private let lock = NSLock()
    private var token: String?
    private var handler: ((SdkAuthError) -> Void)?

    init(enabled: Bool, initialToken: String?) {
        self.enabled = enabled
        self.token = initialToken
    }

    /// Current token, or nil if none set. Safe to call from any thread.
    func currentToken() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    /// Replace the token (called from the app thread when a fresh JWT is minted).
    func setToken(_ newToken: String) {
        lock.lock()
        defer { lock.unlock() }
        token = newToken
    }

    /// Register/replace the auth-error handler.
    func setHandler(_ newHandler: @escaping (SdkAuthError) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        handler = newHandler
    }

    /// Snapshot of the current handler, or nil if none registered.
    func currentHandler() -> ((SdkAuthError) -> Void)? {
        lock.lock()
        defer { lock.unlock() }
        return handler
    }
}

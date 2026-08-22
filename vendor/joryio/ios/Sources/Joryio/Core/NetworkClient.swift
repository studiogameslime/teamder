import Foundation

/// Network client for API communication
class NetworkClient {
    private let sdkKey: String
    private let apiEndpoint: String
    private let logger: Logger
    private let maxRetries: Int
    private let retryBackoffMs: Double
    private let requestTimeout: TimeInterval
    private let session: URLSession
    /// Shared, thread-safe holder for the optional SDK-authentication token and
    /// error handler. Owned by `Joryio`; nil-safe via `enabled`.
    private let authStore: SdkAuthTokenStore

    init(
        sdkKey: String,
        apiEndpoint: String,
        logger: Logger,
        maxRetries: Int,
        retryBackoffMs: Double,
        requestTimeout: TimeInterval,
        authStore: SdkAuthTokenStore
    ) {
        // Set by Joryio after construction. Without it the SDK knew it was
        // being rejected and only said so in the log, so a host app could show
        // "initialized" while every request came back 401.
        self.sdkKey = sdkKey
        self.apiEndpoint = apiEndpoint
        self.logger = logger
        self.maxRetries = maxRetries
        self.retryBackoffMs = retryBackoffMs
        self.requestTimeout = requestTimeout
        self.authStore = authStore

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = requestTimeout
        self.session = URLSession(configuration: config)
    }

    // MARK: - Event Tracking

    func trackBatch(_ batch: EventBatch) async throws {
        let endpoint = "\(apiEndpoint)/v1/track/batch"
        try await sendRequest(endpoint: endpoint, method: "POST", body: batch)
        logger.debug("Batch tracked successfully: \(batch.events.count) events")
    }

    // MARK: - User Identification

    func identify(_ request: IdentifyRequest) async throws {
        let endpoint = "\(apiEndpoint)/v1/identify"
        try await sendRequest(endpoint: endpoint, method: "POST", body: request)
        logger.debug("User identified: \(maskIdentifier(request.userId))")
    }

    func alias(_ request: AliasRequest) async throws {
        let endpoint = "\(apiEndpoint)/v1/alias"
        try await sendRequest(endpoint: endpoint, method: "POST", body: request)
        logger.debug("User aliased: \(maskIdentifier(request.anonymousId)) -> \(maskIdentifier(request.userId))")
    }

    func setAttributes(_ request: SetAttributesRequest) async throws {
        let endpoint = "\(apiEndpoint)/v1/attributes"
        try await sendRequest(endpoint: endpoint, method: "POST", body: request)
        logger.debug("Attributes set for user")
    }

    // MARK: - In-App Messaging

    /// Display-time re-check for a `reevaluateBeforeDisplay` campaign.
    func resolveInAppCampaign(_ request: ResolveRequest) async throws -> ResolveResponse {
        let endpoint = "\(apiEndpoint)/v1/in-app/resolve"
        return try await sendRequest(endpoint: endpoint, method: "POST", body: request)
    }

    func syncInAppCampaigns(_ request: SessionSyncRequest) async throws -> SessionSyncResponse {
        let endpoint = "\(apiEndpoint)/v1/in-app/sync"
        let response: SessionSyncResponse = try await sendRequest(
            endpoint: endpoint,
            method: "POST",
            body: request
        )
        logger.debug("In-app campaigns synced: \(response.campaigns.count) campaigns")
        return response
    }

    func trackImpression(_ request: TrackImpressionRequest) async throws {
        let endpoint = "\(apiEndpoint)/v1/in-app/track"
        try await sendRequest(endpoint: endpoint, method: "POST", body: request)
        logger.debug("Impression tracked: \(request.campaignId)")
    }

    // MARK: - Push Notifications

    func registerPushToken(userId: String?, anonymousId: String, deviceToken: String, deviceInfo: [String: Any]) async throws {
        let endpoint = "\(apiEndpoint)/v1/push/register"
        let body = PushTokenRequest(
            userId: userId,
            anonymousId: anonymousId,
            token: deviceToken,
            platform: "ios",
            deviceInfo: deviceInfo
        )
        try await sendRequest(endpoint: endpoint, method: "POST", body: body)
        logger.debug("Push token registered")
    }

    func trackPushClick(trackingId: String) async throws {
        let endpoint = "\(apiEndpoint)/track/push/click/\(trackingId)"

        guard let url = URL(string: endpoint) else {
            throw NetworkError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Carry the SDK-auth JWT on this beacon too when enabled. This is a
        // fire-and-forget GET, so it does not run the refresh-and-retry flow.
        if authStore.enabled, let authToken = authStore.currentToken() {
            request.setValue(authToken, forHTTPHeaderField: "X-Joryio-Auth")
        }

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        if httpResponse.statusCode != 200 {
            throw NetworkError.httpError(httpResponse.statusCode)
        }

        logger.debug("Push click tracked: \(trackingId)")
    }

    // MARK: - Generic Request Handler

    /// Max backoff cap (seconds) so exponential growth can't produce huge sleeps.
    private let maxBackoffSeconds: Double = 30.0

    private func sendRequest<T: Encodable, R: Decodable>(
        endpoint: String,
        method: String,
        body: T
    ) async throws -> R {
        var lastError: Error?

        for attempt in 0...maxRetries {
            do {
                let result: R = try await performRequestWithAuthRetry(endpoint: endpoint, method: method, body: body)
                onTransportSuccess?()
                return result
            } catch {
                lastError = error

                // Fail fast on non-retryable errors (401 and 4xx except 429).
                // Retrying these just hammers the server and never succeeds.
                guard isRetryable(error) else {
                    logger.warn("Request failed with non-retryable error, not retrying: \(error.localizedDescription)")
                    onTransportFailure?(error)
                    throw error
                }

                logger.warn("Request failed (attempt \(attempt + 1)/\(maxRetries + 1)): \(error.localizedDescription)")

                if attempt < maxRetries {
                    let delay = retryDelay(for: error, attempt: attempt)
                    logger.debug("Retrying after \(String(format: "%.2f", delay))s...")
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                }
            }
        }

        // Every retry exhausted. Report before throwing, so the host app can
        // see a sustained outage and not only a one-off blip.
        if let lastError { onTransportFailure?(lastError) }
        throw lastError ?? NetworkError.unknown
    }

    /// Whether an error is worth retrying. 401 and 4xx (except 429) are permanent.
    private func isRetryable(_ error: Error) -> Bool {
        if let netError = error as? NetworkError {
            switch netError {
            case .unauthorized, .invalidURL, .invalidResponse:
                return false
            case .sdkAuthError:
                // The one-shot refresh-and-retry already ran inside
                // performRequestWithAuthRetry; never loop the outer retry on it.
                return false
            case .rateLimited:
                return true
            case .httpError(let code):
                // Only server errors are transient; other 4xx are permanent.
                return code >= 500
            case .unknown:
                return true
            }
        }
        // Transport-level errors (timeouts, connection loss) are retryable.
        return true
    }

    /// Compute the retry delay: honor Retry-After for 429, otherwise capped
    /// exponential backoff with jitter to avoid a synchronized retry storm.
    private func retryDelay(for error: Error, attempt: Int) -> Double {
        if case NetworkError.rateLimited(let retryAfter) = error, let retryAfter = retryAfter {
            return min(retryAfter, maxBackoffSeconds)
        }
        let base = retryBackoffMs * pow(2.0, Double(attempt)) / 1000.0
        let capped = min(base, maxBackoffSeconds)
        let jitter = Double.random(in: 0...(capped * 0.3))
        return capped + jitter
    }

    private func sendRequest<T: Encodable>(
        endpoint: String,
        method: String,
        body: T
    ) async throws {
        let _: EmptyResponse = try await sendRequest(endpoint: endpoint, method: method, body: body)
    }

    /// Longest we'll wait for the app to supply a refreshed token after invoking
    /// the auth-error handler. The handler may set the token synchronously (loop
    /// returns on the first check) or asynchronously (bounded poll below).
    private let authRefreshWaitSeconds: Double = 5.0

    /// Wrap `performRequest` with the SDK-authentication one-shot refresh flow.
    ///
    /// On a 401 that decodes to `sdk_authentication_error`, invoke the app's
    /// error handler, wait (bounded) for a fresh token, and retry the request
    /// exactly ONCE with it. This is deliberately separate from the transient
    /// retry/backoff loop in `sendRequest` — an sdk-auth 401 is not a normal
    /// retry, it's a refresh-and-retry, and it never loops.
    ///
    /// Queue interaction: on failure this simply throws. The QueueManager
    /// deletes a batch only after a successful send, so the events stay queued
    /// and the next flush carries whatever token is current — we neither drop
    /// nor duplicate a batch on auth failure.
    private func performRequestWithAuthRetry<T: Encodable, R: Decodable>(
        endpoint: String,
        method: String,
        body: T
    ) async throws -> R {
        do {
            return try await performRequest(endpoint: endpoint, method: method, body: body)
        } catch let NetworkError.sdkAuthError(reason, ep) {
            // Only meaningful when SDK auth is enabled; otherwise rethrow.
            guard authStore.enabled else { throw NetworkError.sdkAuthError(reason: reason, endpoint: ep) }

            let failedToken = authStore.currentToken()

            guard let handler = authStore.currentHandler() else {
                logger.warn("SDK auth rejected (\(reason.rawValue)) at \(ep) but no error handler is set; leaving request unsent")
                throw NetworkError.sdkAuthError(reason: reason, endpoint: ep)
            }

            // Ask the app to mint a fresh token. It responds by calling
            // setSdkAuthenticationToken(_:), synchronously or asynchronously.
            handler(SdkAuthError(reason: reason, endpoint: ep, refreshExhausted: false))

            if let refreshed = await waitForRefreshedToken(differentFrom: failedToken),
               refreshed != failedToken {
                logger.debug("Retrying \(ep) once with refreshed SDK auth token")
                // performRequest re-reads the (now refreshed) token from the store.
                return try await performRequest(endpoint: endpoint, method: method, body: body)
            }

            // No fresh token arrived in time — surface exhaustion and stop (no loop).
            logger.warn("No refreshed SDK auth token after handler for \(ep); not retrying")
            handler(SdkAuthError(reason: reason, endpoint: ep, refreshExhausted: true))
            throw NetworkError.sdkAuthError(reason: reason, endpoint: ep)
        }
    }

    /// Bounded poll for the app to install a token different from the one that
    /// just failed. Returns as soon as it changes (synchronous handlers hit the
    /// first check and never sleep); returns the current token after the
    /// deadline otherwise.
    private func waitForRefreshedToken(differentFrom old: String?) async -> String? {
        let deadline = Date().addingTimeInterval(authRefreshWaitSeconds)
        while Date() < deadline {
            if let current = authStore.currentToken(), current != old {
                return current
            }
            try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
        }
        return authStore.currentToken()
    }

    private func performRequest<T: Encodable, R: Decodable>(
        endpoint: String,
        method: String,
        body: T
    ) async throws -> R {
        guard let url = URL(string: endpoint) else {
            throw NetworkError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(sdkKey, forHTTPHeaderField: "Authorization")
        request.setValue(sdkKey, forHTTPHeaderField: "X-App-Key")

        // Attach the customer-minted SDK-authentication JWT when enabled and set.
        // Read fresh on the network thread so a refreshed token is picked up.
        if authStore.enabled, let authToken = authStore.currentToken() {
            request.setValue(authToken, forHTTPHeaderField: "X-Joryio-Auth")
        }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(body)

        logger.debug("Sending \(method) request to \(endpoint)")

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        logger.debug("Response status: \(httpResponse.statusCode)")

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                // Distinguish a customer-JWT rejection (triggers refresh-and-retry)
                // from a plain unauthorized (bad SDK key — permanent).
                if let reason = Self.parseSdkAuthError(from: data) {
                    throw NetworkError.sdkAuthError(reason: reason, endpoint: endpoint)
                }
                throw NetworkError.unauthorized
            } else if httpResponse.statusCode == 429 {
                let retryAfter = Self.parseRetryAfter(httpResponse.value(forHTTPHeaderField: "Retry-After"))
                throw NetworkError.rateLimited(retryAfter: retryAfter)
            } else {
                throw NetworkError.httpError(httpResponse.statusCode)
            }
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(R.self, from: data)
    }

    // MARK: - Errors

    /// Invoked on every request the client gives up on. Set by Joryio so the
    /// facade can expose the last failure to the host app.
    var onTransportFailure: ((Error) -> Void)?

    /// Cleared on any success, so a stale failure is never shown as current.
    var onTransportSuccess: (() -> Void)?

    enum NetworkError: Error {
        case invalidURL
        case invalidResponse
        case unauthorized
        case rateLimited(retryAfter: TimeInterval?)
        case httpError(Int)
        /// A 401 whose body is `{ error: "sdk_authentication_error", reason: ... }`.
        /// Carries the reason and endpoint so the refresh flow can surface context.
        case sdkAuthError(reason: SdkAuthErrorReason, endpoint: String)
        case unknown
    }

    /// Body shape of a backend SDK-authentication rejection.
    private struct SdkAuthErrorBody: Decodable {
        let error: String
        let reason: String?
    }

    /// Decode a 401 body into an `SdkAuthErrorReason` if it is an
    /// `sdk_authentication_error`; otherwise nil (a plain unauthorized).
    private static func parseSdkAuthError(from data: Data) -> SdkAuthErrorReason? {
        guard
            let body = try? JSONDecoder().decode(SdkAuthErrorBody.self, from: data),
            body.error == "sdk_authentication_error"
        else {
            return nil
        }
        return SdkAuthErrorReason(backendReason: body.reason)
    }

    /// Parse a `Retry-After` header. Supports the delta-seconds form (e.g. "30")
    /// and the HTTP-date form; returns nil if absent or unparseable.
    private static func parseRetryAfter(_ value: String?) -> TimeInterval? {
        guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty else {
            return nil
        }
        if let seconds = TimeInterval(value) {
            return max(0, seconds)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        if let date = formatter.date(from: value) {
            return max(0, date.timeIntervalSinceNow)
        }
        return nil
    }

    private struct EmptyResponse: Decodable {
        let success: Bool?
    }
}

/// Log-safe form of an end-user identifier.
///
/// Passes an ordinary id through UNCHANGED. Our docs tell customers not to use
/// an email as the userId - among other reasons, a guessable id lets someone
/// forge another user's data - so the normal case is an opaque id that is not
/// PII, and masking it would only make a debug log useless for tracing one
/// user's problem.
///
/// Masks ONLY when the value looks like an email, i.e. when a customer ignored
/// that guidance. Defence in depth for the non-compliant case, zero cost to the
/// compliant one.
///
/// Note these logs are gated behind the debug log level, so a release build
/// emits nothing either way.
internal func maskIdentifier(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "(none)" }
    // Not an email → not PII by our own contract → log it in full.
    guard let at = value.firstIndex(of: "@"), at > value.startIndex else { return value }

    let local = String(value[value.startIndex..<at])
    let domain = String(value[value.index(after: at)...])
    let tld = domain.lastIndex(of: ".").map { String(domain[$0...]) } ?? ""
    return "\(local.first.map(String.init) ?? "?")***@\(domain.first.map(String.init) ?? "?")***\(tld)"
}

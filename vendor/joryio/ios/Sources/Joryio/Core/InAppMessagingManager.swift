import Foundation
import UIKit

/// Manages in-app messaging campaigns
class InAppMessagingManager {
    private let networkClient: NetworkClient
    private let storage: StorageManager
    private let identityManager: IdentityManager
    private let sessionManager: SessionManager
    private let logger: Logger

    // All mutable state below is shared across concurrent Tasks (foreground
    // sync + push-tap sync). Every read/write goes through `stateLock` so the
    // check-then-set of `isDisplaying` is atomic (no two messages at once) and
    // the dictionaries can't hit an exclusive-access crash.
    private let stateLock = NSLock()
    private var activeCampaigns: [InAppCampaign] = []
    private var displayedCampaigns: Set<String> = []
    private var campaignImpressions: [String: [Date]] = [:]
    private var lastSyncTime: Date?
    private var isDisplaying = false
    /**
     Is a sync IN FLIGHT right now?

     Distinct from `lastSyncTime`, and both are needed. `lastSyncTime` is only
     written once the response comes back, so it says nothing about the window
     between issuing a request and receiving it - and that window is where two
     callers collide. Two concurrent `syncCampaigns()` calls both read a stale
     `lastSyncTime`, both pass the interval check, and both go to the network.

     Observed on production 2026-08-31: every launch produced a PAIR of
     `/v1/in-app/sync` requests 40ms apart, and one queued test send was counted
     as two displays. The web SDK has always claimed an in-flight flag before
     its request (`isSyncing`); iOS and Android checked only the timestamp.
     */
    private var isSyncing = false

    // Configuration
    private let syncInterval: TimeInterval = 300 // 5 minutes
    /// Minimum gap between DIFFERENT campaigns, in seconds.
    ///
    /// A default, not a constant: the sync response carries the workspace's
    /// configured gap and overwrites this. It used to be fixed at 3 while the
    /// server sent its own hardcoded number that nothing read, so a marketer's
    /// setting reached neither.
    private var minDelayBetweenMessages: TimeInterval = 3

    /// Attributes that a differential-sync campaign is waiting on.
    private var watchedAttributes: Set<String> = []
    private var lastDisplayTime: Date?

    /// Run `body` while holding `stateLock`. NOT reentrant — never call another
    /// `withState` (or a locking method) from inside `body`.
    private func withState<T>(_ body: () -> T) -> T {
        stateLock.lock()
        defer { stateLock.unlock() }
        return body()
    }

    /// See InAppConfig.allowHtmlJsInAppMessages. Passed in rather than read
    /// from a global so the display path has no way to forget to check it.
    private let allowHtmlJsInAppMessages: Bool

    init(
        networkClient: NetworkClient,
        storage: StorageManager,
        identityManager: IdentityManager,
        sessionManager: SessionManager,
        logger: Logger,
        allowHtmlJsInAppMessages: Bool = false
    ) {
        self.networkClient = networkClient
        self.storage = storage
        self.identityManager = identityManager
        self.sessionManager = sessionManager
        self.logger = logger
        self.allowHtmlJsInAppMessages = allowHtmlJsInAppMessages

        loadCachedData()
    }

    // MARK: - Campaign Sync

    /// Sync in-app campaigns from backend
    func syncCampaigns() async {
        let sessionId = sessionManager.getSessionId()

        // Check AND CLAIM in one locked block, exactly like the display slot in
        // evaluateAndDisplay. Reading the guard and taking it in separate steps
        // is what let two callers through: `lastSyncTime` is not written until
        // the response arrives, so during the round trip the check is answering
        // with information that is already stale.
        let skipReason = withState { () -> String? in
            if isSyncing {
                return "a sync is already in flight"
            }
            if let lastSync = lastSyncTime, Date().timeIntervalSince(lastSync) < syncInterval {
                return "last sync was too recent"
            }
            isSyncing = true
            return nil
        }
        if let skipReason {
            logger.debug("Skipping sync, \(skipReason)")
            return
        }
        // Released on EVERY exit - the throw inside the do block below included.
        // A sync that fails must not wedge the flag on, or the SDK stops syncing
        // for the rest of the process and in-app messaging goes quiet with no
        // error to show for it.
        defer { withState { isSyncing = false } }

        do {
            let request = SessionSyncRequest(
                userId: identityManager.getUserId() ?? "",
                anonymousId: identityManager.getAnonymousId(),
                sessionId: sessionId,
                attributes: identityManager.getUserAttributes(),
                // Only what the server has not acknowledged. Everything else
                // is already in the stored profile, and the server should read
                // its own copy rather than trust a device's cache.
                pendingAttributes: identityManager.pending.pendingAttributes(),
                // Derived from the live flag, not hardcoded, so the server's
                // picture cannot drift from what this manager will actually do
                // when a campaign arrives. Native is unconditional - those
                // messages are drawn by this SDK's own views with no web view
                // involved; HTML appears only when the integration opted in.
                // hostCapabilities wins when a host renders: the list below
                // describes THIS SDK's views, and the moment a host sets an
                // in-app callback those views never run. See hostCapabilities.
                capabilities: hostCapabilities ?? (allowHtmlJsInAppMessages
                    ? ["content.native", "content.html"]
                    : ["content.native"])
            )

            logger.debug("Syncing in-app campaigns...")
            let response = try await networkClient.syncInAppCampaigns(request)

            if response.success {
                withState {
                    activeCampaigns = response.campaigns
                    lastSyncTime = Date()
                    // evaluationMode was decoded and never branched on, so a
                    // campaign set to differential-sync behaved as
                    // session-start-only on iOS while working on web. Collect
                    // what those campaigns watch; setAttributes re-syncs when
                    // one of them changes.
                    watchedAttributes = Set(
                        response.campaigns
                            .filter { $0.evaluationMode == "differential-sync" }
                            .flatMap { $0.watchedAttributes ?? [] }
                    )
                    // The workspace's configured gap between campaigns, in
                    // SECONDS. The field existed on this model and was never
                    // read - so the server's value and the marketer's setting
                    // both went nowhere.
                    if let gap = response.delayBetweenCampaigns, gap >= 0 {
                        minDelayBetweenMessages = TimeInterval(gap)
                    }
                }

                // Cache campaigns to storage
                storage.cacheCampaigns(response.campaigns)

                logger.info("Synced \(response.campaigns.count) in-app campaigns")

                // Evaluate and display eligible campaigns
                await evaluateAndDisplay()
            } else {
                logger.error("Campaign sync failed: \(response.error ?? "Unknown error")")
            }
        } catch {
            logger.error("Failed to sync campaigns: \(error.localizedDescription)")
        }
    }

    // MARK: - Campaign Evaluation

    /// Evaluate campaigns and display eligible ones
    private func evaluateAndDisplay() async {
        // Atomically decide whether we may display and, if so, claim the slot.
        // Doing the check-and-claim in one locked block prevents two concurrent
        // Tasks from both passing the `!isDisplaying` guard.
        let campaignToDisplay: InAppCampaign? = withState {
            guard !isDisplaying else {
                logger.debug("Already displaying a message, skipping evaluation")
                return nil
            }

            // Check minimum delay between messages
            if let lastDisplay = lastDisplayTime,
               Date().timeIntervalSince(lastDisplay) < minDelayBetweenMessages {
                logger.debug("Too soon since last message")
                return nil
            }

            // Find eligible campaigns.
            //
            // `displayedCampaigns` is a PERSISTED show-once-ever set, and it
            // used to be applied unconditionally - which silently overrode the
            // campaign's own frequency cap. A campaign configured for "3 per
            // day" displayed once per install and never again, with the cap
            // sitting underneath as dead code. The marketer's setting lost to a
            // default they could not see.
            //
            // So: when a campaign carries a frequency cap, THE CAP DECIDES.
            // The show-once-ever default applies only to campaigns that specify
            // nothing, where showing the same message on every sync forever
            // would be worse.
            let eligibleCampaigns = activeCampaigns
                .filter { $0.frequencyCap != nil || !displayedCampaigns.contains($0.id) }
                .filter { Self.displaysOnSync($0) }
                .filter { isEligibleForDisplayLocked($0) }
                .sorted { $0.priority > $1.priority }

            guard let campaign = eligibleCampaigns.first else {
                return nil
            }

            // Claim the display slot before releasing the lock.
            isDisplaying = true
            lastDisplayTime = Date()
            displayedCampaigns.insert(campaign.id)
            recordImpressionLocked(campaignId: campaign.id)
            return campaign
        }

        guard let campaign = campaignToDisplay else {
            logger.debug("No eligible campaigns to display")
            return
        }

        logger.info("Displaying campaign: \(campaign.name) (\(campaign.type.rawValue))")

        // RENDER FIRST, then count. The impression used to be tracked before
        // presentCampaign ran, which was wrong twice over:
        //
        //  1. It told the server "seen" before a view existed. Every failed
        //     render still burned an impression, so a campaign was consumed by
        //     users who saw nothing - inflating reach and, with a frequency cap
        //     of one, making the message unrepeatable after a display that
        //     never happened.
        //  2. It was AWAITED, so the message could not draw until a network
        //     round-trip completed. A slow or hanging request delayed the UI
        //     indefinitely, for no user-visible benefit.
        //
        // An impression now means what it says: the view was actually put on
        // screen.
        let presented = await presentCampaign(campaign)

        if presented {
            await trackImpression(campaignId: campaign.id, action: "impression")
        } else {
            // Undo the local bookkeeping claimed optimistically before display,
            // so a failed render does not permanently suppress the campaign.
            //
            // MUST re-save. The claim above went through recordImpressionLocked,
            // which calls saveImpressionData() - so by the time we get here the
            // id is already on DISK in `jry_displayed_campaigns`. Undoing only
            // the in-memory copy left that file holding a campaign that was
            // never shown, and loadCachedData() read it straight back on the
            // next launch. From then on the campaign was filtered out by the
            // `displayedCampaigns.contains` check before anything looked at its
            // content, so ONE failed render suppressed it on that device
            // forever, silently and unrecoverably (short of resetDisplayedCampaigns).
            //
            // Observed 2026-08-31: an in-app test send was served on three
            // consecutive syncs, chosen every time, and never displayed - the
            // server logged "1 eligible campaigns" while the device dropped it
            // at the filter. The message that finally appeared was a different
            // campaign, whose id had never been claimed.
            withState {
                displayedCampaigns.remove(campaign.id)
                campaignImpressions[campaign.id]?.removeLast()
                saveImpressionData()
            }
        }
    }

    /// Check if campaign is eligible for display based on frequency cap.
    /// Reads `campaignImpressions`; the caller MUST already hold `stateLock`.
    /**
     Does this campaign display on SYNC, or is it waiting for something?

     The sync path used to show the first eligible campaign whatever its
     triggers said, because no trigger type was evaluated at all. Now that
     `event` triggers fire locally, that is actively wrong: an event-triggered
     campaign would appear on sync AND again when the event happens - the first
     time before the user did the thing it is about.

     Displays on sync: no triggers at all (the historical default), or an
     `immediate` trigger. Anything waiting on an event, an attribute threshold
     or a timer must not.

     Unknown trigger types WAIT rather than display: an older SDK meeting a
     newer trigger type should stay silent, not fire at the wrong moment.
     */
    static func displaysOnSync(_ campaign: InAppCampaign) -> Bool {
        guard let triggers = campaign.triggers, !triggers.isEmpty else { return true }
        return triggers.contains { $0.type == "immediate" }
    }

    private func isEligibleForDisplayLocked(_ campaign: InAppCampaign) -> Bool {
        guard let frequencyCap = campaign.frequencyCap else {
            return true // No frequency cap
        }

        // Get impression history for this campaign
        let impressions = campaignImpressions[campaign.id] ?? []

        // Parse time window. nil = ALL TIME ('once' / 'lifetime' / 'session'),
        // so every impression on record counts - which is what makes the
        // composer's default, "each user sees this campaign one time only",
        // actually mean once rather than once per day.
        let recentImpressions: [Date]
        if let windowSeconds = Self.parseTimeWindow(frequencyCap.timeWindow) {
            let cutoffTime = Date().addingTimeInterval(-windowSeconds)
            recentImpressions = impressions.filter { $0 > cutoffTime }
        } else {
            recentImpressions = impressions
        }

        // Check max impressions. nil = UNLIMITED, so there is no ceiling to
        // reach - the window and the minimum delay below still apply.
        if let maxImpressions = frequencyCap.maxImpressions,
           recentImpressions.count >= maxImpressions {
            logger.debug("Campaign \(campaign.id) has reached frequency cap")
            return false
        }

        // Check minimum delay between impressions
        if let minDelay = frequencyCap.minDelayBetweenImpressions,
           let lastImpression = impressions.last {
            let timeSinceLastImpression = Date().timeIntervalSince(lastImpression)
            if timeSinceLastImpression < TimeInterval(minDelay) {
                logger.debug("Campaign \(campaign.id) min delay not met")
                return false
            }
        }

        return true
    }

    /**
     Seconds in a frequency-cap window, or `nil` for ALL TIME.

     The vocabulary is shared with the backend and the other SDKs - see
     backend `common/in-app-frequency-window.ts`. iOS knew only h/d/w, so:

       'lifetime'  the DEFAULT the composer saves for "show once per user"
                   -> `dropLast()` left "lifetim", which is not a number, so
                   value fell back to 1 and the unit fell through to days.
                   "Once, ever" was enforced as ONCE PER DAY.
       'session'   unknown -> 1 day.
       '3m'        3 months -> 3 DAYS.

     `nil` rather than a huge number so the caller counts EVERY impression it
     holds; a sentinel would have to be bigger than any install is old, which is
     the kind of number that is right until it is not.

     `min` is minutes and `m` is months, checked longest-first: "30min" ends
     with "m" too. Android read `m` as minutes while the dashboard meant months
     - a 43,000x under-cap - which is why the two never share a letter again.
     */
    static func parseTimeWindow(_ timeWindow: String) -> TimeInterval? {
        let w = timeWindow.trimmingCharacters(in: .whitespaces).lowercased()

        switch w {
        case "once", "lifetime", "session":
            // 'session' is all-time here on purpose: this manager holds no
            // session boundary, and counting MORE impressions caps harder,
            // which is the safe direction for a control against over-messaging.
            return nil
        case "day": return 86400
        case "week": return 604800
        case "month": return 2_592_000
        default: break
        }

        // Longest suffix first. "min" before "m", "mo" before "m".
        let units: [(String, TimeInterval)] = [
            ("min", 60),
            ("mo", 2_592_000),
            ("h", 3600),
            ("d", 86400),
            ("w", 604800),
            ("m", 2_592_000),
        ]
        for (suffix, seconds) in units where w.hasSuffix(suffix) {
            let numeric = String(w.dropLast(suffix.count))
            // Clamped: `Int * Int` traps in Swift, so a server-supplied
            // "9999999999999999d" would deterministically crash evaluation.
            guard let parsed = Double(numeric), parsed > 0 else { break }
            return min(parsed, 3_650_000) * seconds
        }

        // Unparseable. One day, matching the backend - safer than all-time
        // (which caps harder than asked) or zero (which does not cap).
        return 86400
    }

    // MARK: - Campaign Display

    /// Present a campaign's view on the main thread. The display slot has
    /// already been claimed under the lock by `evaluateAndDisplay()`.
    @MainActor
    @discardableResult
    /**
     Fetch a re-check campaign's content, re-verifying eligibility server-side.

     Returns nil when the user no longer qualifies OR the request fails. Both
     mean SHOW NOTHING: a campaign in this mode is one the marketer said must
     not display on stale information, so falling back to anything held would
     defeat the setting they chose. That includes the offline case.
     */
    private func resolveForDisplay(_ campaign: InAppCampaign) async -> InAppCampaign? {
        do {
            let request = ResolveRequest(
                userId: identityManager.getUserId() ?? "",
                anonymousId: identityManager.getAnonymousId(),
                sessionId: sessionManager.getSessionId(),
                campaignId: campaign.id,
                attributes: identityManager.getUserAttributes(),
                pendingAttributes: identityManager.pending.pendingAttributes()
            )
            let response = try await networkClient.resolveInAppCampaign(request)
            guard response.eligible, let resolved = response.campaign else {
                logger.info("Campaign \(campaign.id) not displayed: re-check said no")
                return nil
            }
            return resolved
        } catch {
            logger.warn("Re-check failed for \(campaign.id); not displaying: \(error.localizedDescription)")
            return nil
        }
    }

    /// Builds and shows the message view, so it MUST run on the main actor.
    /// Without this it was called from the async sync path on a background
    /// thread and UIKit trapped ("Modifying properties of a view's layer off the
    /// main thread is not allowed"), crashing the host app the moment any in-app
    /// campaign became eligible. Every caller already `await`s it.
    @MainActor
    private func presentCampaign(_ campaign: InAppCampaign) async -> Bool {
        // Re-check mode: this campaign arrived WITHOUT content. Ask the
        // server, which re-verifies eligibility and renders now. Continue with
        // ITS version - freshly checked, freshly rendered.
        var campaign = campaign
        if campaign.reevaluateBeforeDisplay == true {
            guard let resolved = await resolveForDisplay(campaign) else { return false }
            campaign = resolved
        }

        // Pick the window the user is actually LOOKING AT.
        //
        // `connectedScenes.first` and `windows.first` are both arbitrary order.
        // A React Native app has several UIWindows - RN's own, the dev-menu
        // window, keyboard windows - so `.first` frequently returns one that is
        // not on screen. The message then attaches successfully to a real
        // window, reports success, and is invisible: no error, no message, and
        // nothing in the log to explain it. That is exactly how this failed on
        // 2026-08-12, after the campaign had already synced and been chosen for
        // display.
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first { $0.isKeyWindow }
            ?? scene?.windows.first { !$0.isHidden && $0.alpha > 0 }
            ?? scene?.windows.first

        guard let window else {
            logger.error("No window available to display campaign")
            // Release the claimed slot so a later evaluation can retry.
            withState { isDisplaying = false }
            return false
        }

        // One view for every type: the six former subclasses differed only in
        // placement, which now lives inside InAppWebMessageView. The initialiser
        // fails when the campaign carries no renderable document - in that case
        // display nothing and DO NOT count an impression, rather than showing an
        // empty container the user has to dismiss.
        // Native content renders with UIKit views; HTML renders in a web view.
        // Both share the placement and dismissal semantics - those belong to the
        // message TYPE, not to its content.
        // HTML runs author-supplied JavaScript in this app's process, so it is
        // opt-in. This is a SKIP, not a failure: native campaigns keep
        // displaying, so the channel stays usable rather than all-or-nothing.
        //
        // THE FLAG IS ABOUT THIS SDK'S WEB VIEW, so it applies only when THIS
        // SDK is going to draw. When the host has set an in-app callback the
        // SDK's views never run - the host renders with whatever it has - and
        // gating the handoff on a flag describing a renderer that is not
        // involved blocked HTML from apps that had explicitly said they could
        // draw it.
        //
        // That is what happened on 2026-08-31. `setInAppMessageCallback(_:capabilities:)`
        // sets `hostCapabilities`, and the sync reports it VERBATIM - the flag
        // is not consulted there. So an app declaring `content.html` told the
        // server it could render HTML, the composer warned the marketer about
        // nothing, the campaign was served, and then this gate dropped it
        // silently. Reported as "the SDK shows eligibility but nothing appears".
        //
        // Android has always had it right: it passes the flag INTO the presenter
        // (Joryio.kt:113) and has no gate before `onMessageReady`. This now
        // matches. If the SDK is refusing HTML, the report must also say
        // `content.native` only - the two must never disagree, because their
        // disagreement is invisible until a message goes missing.
        if onMessageReady == nil {
            var isHtml = true
            if case .native = campaign.content { isHtml = false }
            if isHtml && !allowHtmlJsInAppMessages {
                logger.warn(
                    "Campaign \(campaign.id) is an HTML in-app message, but "
                        + "InAppConfig.allowHtmlJsInAppMessages is false and no host "
                        + "renderer is set - not displaying it."
                )
                withState { isDisplaying = false }
                return false
            }
        }

        // Display delay, in SECONDS: wait after the trigger before showing.
        //
        // Applied HERE, after every eligibility gate, so the wait cannot skip a
        // check - and before the presenter, so nothing is on screen during it.
        // The impression is tracked by the caller once present() succeeds, so a
        // message cancelled or superseded during the wait never counts.
        if let delaySeconds = campaign.delay, delaySeconds > 0 {
            logger.debug("Campaign \(campaign.id) waits \(delaySeconds)s before display")
            try? await Task.sleep(nanoseconds: UInt64(delaySeconds) * 1_000_000_000)

            // Re-check: the app may have backgrounded, another message may have
            // taken the screen, or the user may have been identified as someone
            // else while we waited. Showing regardless would surface a message
            // for a state that no longer exists.
            guard !Task.isCancelled else {
                withState { isDisplaying = false }
                return false
            }
        }

        // Base names no view class; JoryioUI draws. Nothing is displayed when
        // that product is not linked, which is the correct outcome for an
        // analytics-and-push-only integration.
        // A host callback wins; the SDK must not also draw the message.
        if let onMessageReady {
            await MainActor.run { onMessageReady(campaign) }
            // Stamp the cross-campaign gap on HANDOFF, matching Android. The
            // host owns rendering from here, so handing the message over is the
            // display as far as the SDK can tell - without this, every eligible
            // campaign would fire back-to-back for host-rendered apps.
            withState { lastDisplayTime = Date() }
            return true
        }

        guard let presenter = Joryio.shared.inAppPresenter else {
            logger.debug("No in-app presenter (JoryioUI not linked); not displaying \(campaign.id)")
            withState { isDisplaying = false }
            return false
        }

        // Trust the presenter's answer rather than assuming success: it
        // declines content it cannot draw, and counting an impression there
        // would inflate the campaign's reach.
        guard presenter.present(campaign: campaign, in: window, delegate: self) else {
            logger.warn("Campaign \(campaign.id) has no renderable content; skipping")
            withState { isDisplaying = false }
            return false
        }

        return true
    }

    // MARK: - Host-rendered display

    /// Set by Joryio.setInAppMessageCallback. When present, the host app draws
    /// the message and the SDK does not - matching Android, where this has
    /// always been possible. Without it an iOS app could not render in-app
    /// messages with its own UI at all.
    var onMessageReady: ((InAppCampaign) -> Void)?

    /// What the HOST can render, when the host renders instead of this SDK.
    ///
    /// The SDK's own capability list describes its own views. Once a host sets
    /// an in-app callback those views never run, so describing them describes
    /// the wrong renderer - and the answer matters, because the server targets
    /// campaigns on it and its rollup resolves an absent capability to "no"
    /// rather than to "unknown".
    ///
    /// A Unity game laying a message out on its own canvas can render
    /// structured `content.native` and almost certainly cannot render
    /// `content.html` unless it also hosts a WebView. Only the host knows.
    ///
    /// Nil means nobody has said, and the SDK keeps describing its own
    /// renderer - correct while the SDK is the one drawing. Matches Android.
    var hostCapabilities: [String]?

    /// ISO-8601 UTC with milliseconds - the format the web SDK sends and the
    /// backend canonicalises to. Static so it costs one formatter, not one per
    /// impression.
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    static func isoTimestamp() -> String { isoFormatter.string(from: Date()) }

    /// Public entry point for a host that rendered the message itself and now
    /// needs to report what happened. Impressions are what frequency caps and
    /// reporting are built on, so a host-rendered message that cannot report is
    /// invisible in both.
    func trackHostImpression(campaignId: String, action: String) {
        Task { await trackImpression(campaignId: campaignId, action: action) }
    }

    // MARK: - Impression Tracking

    /// Track impression to backend
    /// `name` is what the message called the click (data-action, a bridge logClick); it rides in the wire `action` while the markers still say 'click'.
    private func trackImpression(campaignId: String, action: String, name: String? = nil) async {
        let sessionId = sessionManager.getSessionId()

        // Echo the delivery token the server issued for this message - proof we
        // actually served it, and the key that makes each transition one-shot.
        // Looked up from the campaign rather than passed in, so every call site
        // (display, click, dismiss) carries it without having to remember to.
        let deliveryToken = activeCampaigns.first { $0.id == campaignId }?.deliveryToken

        // Map the action onto the SAME structured markers the web SDK sends.
        // The backend gate for in_app.displayed reads these; sending only
        // `action` made every mobile click and dismiss count as a display.
        // Mirrors sdk-web/src/core/inapp.ts exactly, including collapsing the
        // action to the singular 'click'/'dismiss' it uses.
        let nowIso = Self.isoTimestamp()
        let normalized = action.lowercased()
        let isClick = normalized.contains("click")
        let isDismiss = normalized.contains("dismiss")
        let isConvert = normalized.contains("convert")

        let request = TrackImpressionRequest(
            campaignId: campaignId,
            userId: identityManager.getUserId() ?? "",
            anonymousId: identityManager.getAnonymousId(),
            sessionId: sessionId,
            action: isClick ? (name?.isEmpty == false ? name! : "click") : (isDismiss ? "dismiss" : action),
            displayedAt: normalized.contains("display") ? nowIso : nil,
            clicked: isClick ? true : nil,
            clickedAt: isClick ? nowIso : nil,
            dismissedAt: isDismiss ? nowIso : nil,
            converted: isConvert ? true : nil,
            convertedAt: isConvert ? nowIso : nil,
            deliveryToken: deliveryToken
        )

        do {
            try await networkClient.trackImpression(request)
            logger.debug("Tracked \(action) for campaign \(campaignId)")
        } catch {
            logger.error("Failed to track impression: \(error.localizedDescription)")
        }
    }

    /// Record impression locally for frequency capping.
    /// Mutates `campaignImpressions`; the caller MUST already hold `stateLock`.
    private func recordImpressionLocked(campaignId: String) {
        var impressions = campaignImpressions[campaignId] ?? []
        impressions.append(Date())

        // Keep only last 100 impressions per campaign
        if impressions.count > 100 {
            impressions = Array(impressions.suffix(100))
        }

        campaignImpressions[campaignId] = impressions
        saveImpressionData()
    }

    // MARK: - Persistence

    private func loadCachedData() {
        // Load cached campaigns
        activeCampaigns = storage.getCachedCampaignsSafe()
        logger.debug("Loaded \(activeCampaigns.count) cached campaigns")

        // Load impression data from UserDefaults
        if let data = UserDefaults.standard.data(forKey: "jry_campaign_impressions"),
           let decoded = try? JSONDecoder().decode([String: [Date]].self, from: data) {
            campaignImpressions = decoded
        }

        if let data = UserDefaults.standard.data(forKey: "jry_displayed_campaigns"),
           let decoded = try? JSONDecoder().decode(Set<String>.self, from: data) {
            displayedCampaigns = decoded
        }
    }

    private func saveImpressionData() {
        if let encoded = try? JSONEncoder().encode(campaignImpressions) {
            UserDefaults.standard.set(encoded, forKey: "jry_campaign_impressions")
        }

        if let encoded = try? JSONEncoder().encode(displayedCampaigns) {
            UserDefaults.standard.set(encoded, forKey: "jry_displayed_campaigns")
        }
    }

    // MARK: - Public API

    /// Trigger campaign evaluation manually
    func evaluateCampaigns() async {
        await evaluateAndDisplay()
    }

    /// Clear all displayed campaigns (for testing)
    func resetDisplayedCampaigns() {
        withState {
            displayedCampaigns.removeAll()
            saveImpressionData()
        }
        logger.debug("Reset displayed campaigns")
    }

    /// Clear all in-app state on identity reset/logout so the next user never
    /// sees the previous user's displayed campaigns or impression history.
    func clear() {
        withState {
            displayedCampaigns.removeAll()
            campaignImpressions.removeAll()
            activeCampaigns.removeAll()
            isDisplaying = false
            lastDisplayTime = nil
            lastSyncTime = nil
            saveImpressionData()
        }
        logger.debug("Cleared in-app messaging state")
    }
}

// MARK: - Message View Delegate

extension InAppMessagingManager: InAppMessageViewDelegate {
    func messageViewDidAppear(_ campaignId: String) {
        logger.debug("Message appeared: \(campaignId)")
    }

    func messageViewDidDismiss(_ campaignId: String) {
        logger.debug("Message dismissed: \(campaignId)")
        withState { isDisplaying = false }

        Task {
            await trackImpression(campaignId: campaignId, action: "dismiss")
            // Evaluate next campaign after a delay
            try? await Task.sleep(nanoseconds: UInt64(minDelayBetweenMessages * 1_000_000_000))
            await evaluateAndDisplay()
        }
    }

    func messageViewClicked(_ campaignId: String, action: String, url: String?) {
        logger.debug("Click on campaign \(campaignId): \(action)")

        Task {
            await trackImpression(campaignId: campaignId, action: "click", name: action)

            // http(s) only - the view already filtered, this is defence in
            // depth. `javascript:`/`data:`/`file:` URLs are how authored
            // content escapes its container.
            guard
                let urlString = url,
                let target = URL(string: urlString),
                let scheme = target.scheme?.lowercased(),
                scheme == "http" || scheme == "https"
            else { return }

            await MainActor.run {
                UIApplication.shared.open(target)
            }
        }
    }
}

// MARK: - Message View Protocol

public protocol InAppMessageViewDelegate: AnyObject {
    func messageViewDidAppear(_ campaignId: String)
    func messageViewDidDismiss(_ campaignId: String)
    /// A click inside the message. `url` is set for link activations, which the
    /// manager opens externally; otherwise this is a tracked in-message action.
    func messageViewClicked(_ campaignId: String, action: String, url: String?)
}

// MARK: - Differential sync

extension InAppMessagingManager {
    /**
     Re-evaluate when a WATCHED attribute changes.

     Web polls on a timer; a background loop on a phone is a battery cost for
     something the SDK is told about directly, so this is event-driven - the
     host app setting an attribute is the event.

     No watched attribute, no sync: an app that sets attributes frequently
     must not turn every one of them into a network round trip.
     */
    /**
     An event just happened in the app - show anything waiting on it.

     The server sends five trigger types and `event` was evaluated by nobody:
     a campaign set to "show when the user does add_to_cart" waited for the
     event to upload and the next sync to decide, so it appeared on the user's
     next launch rather than at the moment they did it. Everything needed was
     already on the device once the model decoded `triggers`.

     NO eligibility re-check. The server sent this campaign because the user
     matched it; re-deciding here can only subtract, using data the device does
     not have - which is how Android came to suppress every segment-targeted
     campaign. The device evaluates only what the server cannot know.
     */
    /**
     The user just tapped a push - show anything waiting on that.

     `push_notification_tap` is a trigger type the campaign editor OFFERS, the
     backend stores and the sync response sends - and no SDK acted on it. A
     marketer could build "tap the push, see the coupon details", save it, and
     nothing would ever appear.

     Syncs FIRST, deliberately. Unlike an event trigger - where the campaign is
     already on the device because the server pre-authorised it - a push tap is
     a moment where the freshest eligibility matters, and the tap has just
     brought the app to the foreground anyway, so the round trip costs nothing
     the user notices.
     */
    func onPushTapped() async {
        await sync()

        let candidates = withState { activeCampaigns }
        for campaign in candidates.sorted(by: { $0.priority > $1.priority }) {
            let matches = (campaign.triggers ?? []).contains { $0.type == "push_notification_tap" }
            if matches {
                _ = await presentCampaign(campaign)
                return
            }
        }
    }

    func onEventTracked(_ eventName: String, properties: [String: Any]) {
        guard !eventName.isEmpty else { return }
        let candidates = withState { activeCampaigns }
        for campaign in candidates.sorted(by: { $0.priority > $1.priority }) {
            let matches = (campaign.triggers ?? []).contains { t in
                t.type == "event" && t.event == eventName && Self.triggerFilterMatches(t, properties)
            }
            if matches {
                Task { _ = await presentCampaign(campaign) }
                // One per event: a single action should not stack modals.
                return
            }
        }
    }

    /// A trigger's own property condition. No condition matches on the event
    /// name alone; an UNKNOWN operator does not match - failing closed, because
    /// a typo that silently matched would look like it worked.
    static func triggerFilterMatches(_ trigger: InAppTrigger, _ properties: [String: Any]) -> Bool {
        guard let attribute = trigger.attribute else { return true }
        let actual = properties[attribute]
        let expected = trigger.value?.value
        switch trigger.`operator` {
        case nil, "equals", "eq":
            return String(describing: actual ?? "") == String(describing: expected ?? "")
        case "not_equals", "neq":
            return String(describing: actual ?? "") != String(describing: expected ?? "")
        case "greater_than", "gt":
            return Self.number(actual) > Self.number(expected)
        case "less_than", "lt":
            return Self.number(actual) < Self.number(expected)
        case "contains":
            return String(describing: actual ?? "").contains(String(describing: expected ?? ""))
        case "exists":
            return actual != nil
        default:
            return false
        }
    }

    private static func number(_ v: Any?) -> Double {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        if let s = v as? String, let d = Double(s) { return d }
        return .nan
    }

    func attributesDidChange(_ keys: [String]) {
        // FAST PATH: a campaign already on this device whose attribute_threshold
        // is now satisfied can display immediately, with no round trip.
        checkAttributeThresholds(keys)

        // SLOW PATH, and NOT redundant: a changed attribute can make the user
        // newly eligible for a campaign the device has never been sent - the
        // server pre-authorises, so only it can know that. This is the
        // difference from `event` triggers, where the campaign is already here
        // by definition and no sync is needed.
        let watched = withState { watchedAttributes }
        guard !watched.isEmpty, keys.contains(where: { watched.contains($0) }) else { return }

        Task { await sync() }
    }

    /**
     Display a held campaign whose `attribute_threshold` is now met.

     `attribute_threshold` is a trigger type the editor offers and the server
     sends, and no SDK evaluated it: "show when loyaltyPoints passes 1000" only
     ever appeared on some later sync, if at all.

     Evaluated against the CURRENT attribute value, not the changed keys alone -
     a threshold is about where the value landed, not that it moved.
     */
    private func checkAttributeThresholds(_ changedKeys: [String]) {
        guard !changedKeys.isEmpty else { return }
        let attributes = identityManager.getUserAttributes()
        let candidates = withState { activeCampaigns }

        for campaign in candidates.sorted(by: { $0.priority > $1.priority }) {
            let hit = (campaign.triggers ?? []).contains { t in
                t.type == "attribute_threshold"
                    && t.attribute.map { changedKeys.contains($0) } == true
                    && Self.triggerFilterMatches(t, attributes)
            }
            if hit {
                Task { _ = await presentCampaign(campaign) }
                return
            }
        }
    }
}

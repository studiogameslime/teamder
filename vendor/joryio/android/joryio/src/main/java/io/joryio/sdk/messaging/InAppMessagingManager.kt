package io.joryio.sdk.messaging

import io.joryio.sdk.core.IdentityManager
import io.joryio.sdk.core.Logger
import io.joryio.sdk.core.SessionManager
import io.joryio.sdk.core.StorageManager
import io.joryio.sdk.models.*
import io.joryio.sdk.network.NetworkClient
import io.joryio.sdk.network.NetworkResult
import kotlinx.coroutines.*
import java.util.Date
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Manages in-app messaging campaigns
 */
internal class InAppMessagingManager(
    private val networkClient: NetworkClient,
    private val identityManager: IdentityManager,
    private val sessionManager: SessionManager,
    private val storage: StorageManager,
    private val logger: Logger,
    /**
     * Mirrors JoryioConfig.allowHtmlJsInAppMessages so the capabilities this
     * reports match what the renderer will actually do with a campaign. Passed
     * in rather than read from a global for the same reason the renderer takes
     * it: one source, no drift.
     */
    private val allowHtmlJsInAppMessages: Boolean = false,
) {
    /**
     * What the HOST can render, when the host renders instead of this SDK.
     *
     * The list below describes THIS SDK's own views. The moment a host sets an
     * in-app callback those views never run, so describing them is describing
     * the wrong renderer - and the answer matters, because the server targets
     * campaigns on it and its rollup resolves an absent capability to "no",
     * not to "unknown".
     *
     * A Unity game laying a message out on its own canvas can render structured
     * `content.native` and almost certainly cannot render `content.html` unless
     * it also hosts a WebView. Only the host knows, so only the host can say.
     *
     * Null means nobody has said, and the SDK keeps describing its own renderer
     * - which is exactly right while the SDK is the one drawing.
     */
    internal var hostCapabilities: List<String>? = null
    private var campaigns: List<InAppCampaign> = emptyList()
    private var lastSyncTime: Date? = null

    /**
     * Is a sync IN FLIGHT right now?
     *
     * Android had no sync guard of ANY kind - not an in-flight flag and not a
     * minimum interval - so every trigger (session start, foreground, push tap,
     * attribute change, a host calling syncInAppCampaigns) went straight to the
     * network, and two that overlapped both evaluated and both could display.
     *
     * The web SDK has always claimed `isSyncing` before its request. iOS
     * checked a `lastSyncTime` that is only written once the response arrives,
     * which is a check-then-act race across the whole round trip. Observed on
     * production 2026-08-31: paired /v1/in-app/sync requests 40ms apart on every
     * launch, and one queued test send counted as two displays.
     *
     * Atomic compare-and-set rather than a plain flag: `sync()` is called from
     * several coroutines and there is no lock around this class.
     */
    private val isSyncing = AtomicBoolean(false)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    /** Seconds between two DIFFERENT campaigns. Replaced by the server's value. */
    private var minDelayBetweenCampaignsSeconds: Int = 3
    private var lastDisplayAtMs: Long = 0

    /** Attributes a differential-sync campaign is waiting on. */
    private var watchedAttributes: Set<String> = emptySet()

    // Callback for displaying messages
    var onMessageReady: ((InAppCampaign) -> Unit)? = null

    init {
        logger.debug("InAppMessagingManager initialized")
    }

    /**
     * Sync campaigns from backend
     */
    suspend fun sync() {
        // Check AND claim in one atomic step. Reading a flag and then setting it
        // is the race this exists to close, so compareAndSet does both or
        // neither.
        if (!isSyncing.compareAndSet(false, true)) {
            logger.debug("Skipping sync, a sync is already in flight")
            return
        }
        try {
            logger.debug("Syncing in-app campaigns")

            val request = SessionSyncRequest(
                userId = identityManager.getUserId() ?: "",
                anonymousId = identityManager.getAnonymousId(),
                sessionId = sessionManager.getSessionId(),
                attributes = identityManager.getUserAttributes(),
                // Only what the server has not acknowledged. Everything else is
                // already in the stored profile, and the server should read its
                // own copy rather than trust a device's cache.
                pendingAttributes = identityManager.pending.pending(),
                // Native is unconditional - those messages are drawn by this
                // SDK's own views with no WebView involved. HTML appears only
                // when the integration opted in, because for everyone else it
                // genuinely cannot display.
                capabilities = hostCapabilities ?: if (allowHtmlJsInAppMessages) {
                    listOf("content.native", "content.html")
                } else {
                    listOf("content.native")
                }
            )

            when (val result = networkClient.syncInAppMessages(request)) {
                is NetworkResult.Success -> {
                    val response = result.data
                    campaigns = response.campaigns
                    // evaluationMode was decoded into a model field and never
                    // branched on, so a campaign set to differential-sync
                    // behaved as session-start-only on Android while working on
                    // web. Collect what those campaigns watch; setAttributes
                    // re-syncs when one of them changes.
                    watchedAttributes = response.campaigns
                        .filter { it.evaluationMode == "differential-sync" }
                        .flatMap { it.watchedAttributes ?: emptyList() }
                        .toSet()
                    // Minimum gap between DIFFERENT campaigns, in seconds. The
                    // model field existed and nothing read it - and the server
                    // only sent a hardcoded constant - so a workspace's
                    // configured gap reached nothing on either side.
                    response.delayBetweenCampaigns?.let {
                        if (it >= 0) minDelayBetweenCampaignsSeconds = it
                    }
                    lastSyncTime = Date()

                    logger.info("Synced ${campaigns.size} campaigns")

                    // Evaluate and display campaigns
                    evaluateAndDisplay()
                }
                is NetworkResult.Error -> {
                    logger.error("Failed to sync campaigns: ${result.message}")
                }
            }
        } catch (e: Exception) {
            logger.error("Failed to sync campaigns: ${e.message}", e)
        } finally {
            // Released on EVERY exit, the exception path included. A sync that
            // fails must not wedge the flag on, or in-app messaging goes silent
            // for the rest of the process with no error to show for it.
            isSyncing.set(false)
        }
    }

    /**
     * Evaluate campaigns and display eligible ones
     */
    private fun evaluateAndDisplay() {
        if (campaigns.isEmpty()) {
            logger.debug("No campaigns to evaluate")
            return
        }

        // Sort by priority (higher first)
        val sortedCampaigns = campaigns.sortedByDescending { it.priority }

        for (campaign in sortedCampaigns) {
            if (displaysOnSync(campaign) && shouldDisplayCampaign(campaign)) {
                displayCampaign(campaign)
                // Only display one campaign at a time
                break
            }
        }
    }

    /**
     * Hand ONE campaign to the presenter, honouring its display delay.
     *
     * Extracted from evaluateAndDisplay so the sync path and the local
     * event-trigger path share it. Two copies would drift - the delay, the
     * lastDisplayAtMs stamp that powers the cross-campaign gap, and the
     * presenter handoff all have to behave identically however the display was
     * decided.
     *
     * Callers must have passed shouldDisplayCampaign() first; this does not
     * re-check.
     */
    /**
     * Fetch a re-check campaign's content, re-verifying eligibility server-side.
     *
     * Returns null when the user no longer qualifies OR the request fails.
     * Both mean SHOW NOTHING: a campaign in this mode is one the marketer said
     * must not display on stale information, so falling back to anything held
     * would defeat the setting they chose. That includes the offline case.
     */
    private suspend fun resolveForDisplay(campaign: InAppCampaign): InAppCampaign? {
        return try {
            val result = networkClient.resolveInAppCampaign(
                io.joryio.sdk.models.ResolveRequest(
                    userId = identityManager.getUserId() ?: "",
                    anonymousId = identityManager.getAnonymousId(),
                    sessionId = sessionManager.getSessionId(),
                    campaignId = campaign.id,
                    attributes = identityManager.getUserAttributes(),
                    pendingAttributes = identityManager.pending.pending(),
                ),
            )
            when (result) {
                is NetworkResult.Success -> {
                    val body = result.data
                    if (body.eligible && body.campaign != null) {
                        body.campaign
                    } else {
                        logger.info("Campaign ${'$'}{campaign.id} not displayed: re-check said no")
                        null
                    }
                }
                is NetworkResult.Error -> {
                    logger.warn("Re-check failed for ${'$'}{campaign.id}; not displaying")
                    null
                }
            }
        } catch (e: Exception) {
            logger.warn("Re-check failed for ${'$'}{campaign.id}; not displaying: ${'$'}{e.message}")
            null
        }
    }

    private fun displayCampaign(campaign: InAppCampaign) {
        // Re-check mode: this campaign arrived WITHOUT content. Ask the
        // server, which re-verifies eligibility and renders now, then continue
        // with ITS version - freshly checked, freshly rendered.
        if (campaign.reevaluateBeforeDisplay == true) {
            scope.launch {
                val resolved = resolveForDisplay(campaign) ?: return@launch
                presentResolved(resolved)
            }
            return
        }
        presentResolved(campaign)
    }

    /** Hand a campaign (already resolved, if it needed it) to the presenter. */
    private fun presentResolved(campaign: InAppCampaign) {
        logger.info("Displaying campaign: ${campaign.name}")

        val delaySeconds = campaign.delay ?: 0
        if (delaySeconds > 0) {
            // Display delay, in SECONDS. Applied AFTER every eligibility gate
            // so the wait cannot skip a check, and before the host is notified
            // so nothing is on screen during it.
            logger.debug("Campaign ${campaign.id} waits ${delaySeconds}s before display")
            scope.launch {
                delay(delaySeconds * 1000L)
                onMessageReady?.invoke(campaign)
            }
        } else {
            onMessageReady?.invoke(campaign)
        }
    }

    /**
     * Record that a message REALLY reached the screen (or was handed to a host
     * that renders it). Only this stamps the cross-campaign gap.
     *
     * It used to be stamped in [presentResolved], before anyone knew whether the
     * message could be shown. During a cold start there is no foreground Activity
     * yet, so the presenter dropped the message — and the gap was consumed
     * anyway. Observed on Android: "Displaying campaign: Late-cancel explainer" →
     * "No foreground Activity; not displaying" → "Too soon since the last in-app
     * message; skipping" for that campaign AND every other one. A message that
     * was never seen silently spent the budget for the ones that could have been.
     *
     * Leaving the stamp alone on a failed display also makes the next sync retry
     * it, which is why no explicit pending-queue is needed here.
     */
    internal fun noteDisplayed() {
        lastDisplayAtMs = System.currentTimeMillis()
    }

    /**
     * Check if campaign should be displayed
     */
    /**
     * Does this campaign display on SYNC, or is it waiting for something?
     *
     * `evaluateAndDisplay` used to show the first eligible campaign whatever
     * its triggers said, because no trigger type was evaluated at all. Now that
     * `event` triggers fire locally, that is actively wrong: an
     * event-triggered campaign would appear on sync AND again when the event
     * happens - the first one before the user did the thing it is about.
     *
     * Displays on sync: no triggers at all (the historical default), or an
     * `immediate` trigger. Anything waiting on an event, an attribute
     * threshold or a timer must NOT.
     *
     * Unknown trigger types wait rather than display. An older SDK meeting a
     * newer trigger type should stay silent, not fire at the wrong moment.
     */
    private fun displaysOnSync(campaign: InAppCampaign): Boolean {
        val triggers = campaign.triggers ?: emptyList()
        if (triggers.isEmpty()) return true
        return triggers.any { it["type"] == "immediate" }
    }

    private fun shouldDisplayCampaign(campaign: InAppCampaign): Boolean {
        // Minimum gap since the last message of ANY campaign. Distinct from the
        // per-campaign frequency cap below: this one stops two different
        // messages landing back to back.
        val since = System.currentTimeMillis() - lastDisplayAtMs
        if (lastDisplayAtMs > 0 && since < minDelayBetweenCampaignsSeconds * 1000L) {
            logger.debug("Too soon since the last in-app message; skipping ${campaign.name}")
            return false
        }

        // SHOW ONCE unless the marketer asked for more.
        //
        // The product rule is that a campaign is shown to a user once, and
        // repeating it is something you turn ON - which is what a frequency cap
        // expresses. Android honoured the cap but had no default, so a campaign
        // with no cap set re-displayed on EVERY sync: every launch, every
        // foreground. iOS has always applied show-once-ever in exactly this
        // position (`frequencyCap != nil || !displayedCampaigns.contains(id)`),
        // so the same campaign behaved oppositely on the two platforms and the
        // marketer had no way to know which they were getting.
        //
        // Deliberately built on the impression history rather than on a second
        // "displayed" set. That history is already persisted, and it is written
        // in trackImpression - AFTER a message really reached the screen. iOS's
        // separate set is written when a display is CLAIMED, which is how one
        // failed render silently suppressed a campaign forever there
        // (fixed 2026-08-31). Reusing the record that means "this was actually
        // seen" cannot reproduce that.
        //
        // resetDisplayedCampaigns() clears this same history, so the testing
        // affordance keeps working unchanged.
        if (campaign.frequencyCap == null && storage.getCampaignImpressions(campaign.id).isNotEmpty()) {
            logger.debug("Campaign ${campaign.name} was already shown and sets no frequency cap; skipping")
            return false
        }

        // Check frequency cap
        if (!checkFrequencyCap(campaign)) {
            logger.debug("Campaign ${campaign.name} frequency cap exceeded")
            return false
        }

        // NO local targeting re-check. The server sent this campaign BECAUSE the
        // user matched its segments and filters; re-deciding that here can only
        // ever SUBTRACT, using data this device does not have.
        //
        // Both branches of the old check were broken in exactly that way:
        //
        //   segments  storage.getUserSegments() was always empty -
        //             setUserSegments() is called by nothing, and the backend
        //             never sent the user's segments. So EVERY segment-targeted
        //             campaign was rejected AFTER the server approved it: zero
        //             Android impressions, no error anywhere.
        //
        //   filters   evaluated against identityManager.getUserAttributes(),
        //             which is in-memory only and EMPTY on every cold start, so
        //             a filter-targeted campaign was suppressed until the host
        //             app happened to call setAttributes.
        //
        // The device evaluates only what the server cannot know - did the
        // trigger fire, has the delay elapsed, is the local cap reached. See
        // docs/CLIENT_SIDE_TRIGGERS_PLAN.md.

        return true
    }

    /**
     * Check frequency cap
     */
    private fun checkFrequencyCap(campaign: InAppCampaign): Boolean {
        val frequencyCap = campaign.frequencyCap ?: return true

        val impressions = storage.getCampaignImpressions(campaign.id)
        val now = Date()

        // Filter impressions within time window. null = ALL TIME
        // ('once' / 'lifetime' / 'session'), so every impression on record
        // counts - which is what makes the composer's default, "each user sees
        // this campaign one time only", mean once rather than once per day.
        val windowStart = getWindowStart(now, frequencyCap.timeWindow)
        val recentImpressions =
            if (windowStart == null) impressions else impressions.filter { it.after(windowStart) }

        // Check max impressions. null = UNLIMITED, so there is no ceiling to
        // reach - the window and the minimum delay below still apply.
        val maxImpressions = frequencyCap.maxImpressions
        if (maxImpressions != null && recentImpressions.size >= maxImpressions) {
            return false
        }

        // Check min delay between impressions
        val minDelay = frequencyCap.minDelayBetweenImpressions
        if (minDelay != null && impressions.isNotEmpty()) {
            val lastImpression = impressions.maxOrNull()!!
            val timeSinceLastImpression = now.time - lastImpression.time
            if (timeSinceLastImpression < minDelay * 1000) {
                return false
            }
        }

        return true
    }

    /**
     * Get window start time based on time window string
     */
    /**
     * Start of the frequency-cap window, or `null` for ALL TIME.
     *
     * Shared vocabulary - see the backend's common/in-app-frequency-window.ts.
     * Android knew only d/h/m, and read `m` as MINUTES while the dashboard and
     * every other layer meant MONTHS: a three-month cap was enforced as three
     * minutes, a 43,000x error in the direction of over-messaging, which is the
     * one direction a frequency cap exists to prevent.
     *
     * Two more it could not read, both falling through to "1 day":
     *   'lifetime'  the DEFAULT saved for "show once per user", so the product
     *               promise "one time only" meant "once per day, forever"
     *   '2w'        weeks had no branch at all - and the fallback discarded the
     *               NUMBER too, so any weeks window became one day
     *
     * `min` is minutes and `m` is months, tested longest-first: "30min" ends
     * with "m" as well.
     */
    private fun getWindowStart(now: Date, timeWindow: String): Date? {
        val w = timeWindow.trim().lowercase()

        when (w) {
            // 'session' is all-time here deliberately: this manager holds no
            // session boundary, and counting MORE impressions caps harder,
            // which is the safe direction for a control against over-messaging.
            "once", "lifetime", "session" -> return null
            "day" -> return Date(now.time - 24L * 60 * 60 * 1000)
            "week" -> return Date(now.time - 7L * 24 * 60 * 60 * 1000)
            "month" -> return Date(now.time - 30L * 24 * 60 * 60 * 1000)
        }

        // Longest suffix first, so "min" and "mo" are never read as "m".
        val units = listOf(
            "min" to 60L * 1000,
            "mo" to 30L * 24 * 60 * 60 * 1000,
            "h" to 60L * 60 * 1000,
            "d" to 24L * 60 * 60 * 1000,
            "w" to 7L * 24 * 60 * 60 * 1000,
            "m" to 30L * 24 * 60 * 60 * 1000,
        )
        for ((suffix, millis) in units) {
            if (!w.endsWith(suffix)) continue
            val value = w.dropLast(suffix.length).toLongOrNull() ?: break
            if (value <= 0) break
            return Date(now.time - value * millis)
        }

        // Unparseable. One day, matching the backend - safer than all-time
        // (which caps harder than asked) or zero (which does not cap).
        return Date(now.time - 24L * 60 * 60 * 1000)
    }

    /** ISO-8601 UTC, the format the web SDK sends and the backend canonicalises to. */
    private fun isoTimestamp(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())

    /** `name` is what the message called a click (data-action, logClick, a button id); it rides in the wire `action` while the markers still say click. */
    suspend fun trackImpression(campaignId: String, action: String, name: String? = null) {
        try {
            logger.debug("Tracking impression: $campaignId - $action")

            // Store impression locally
            storage.addCampaignImpression(campaignId, Date())

            // Echo the delivery token the server issued for this message - proof we
            // actually served it, and the key that makes each transition one-shot.
            // Looked up from the campaign rather than passed in, so every call
            // site (display, click, dismiss) carries it without having to
            // remember to.
            val deliveryToken = campaigns.firstOrNull { it.id == campaignId }?.deliveryToken

            // Send to backend
            // Map the action onto the SAME structured markers the web SDK sends.
            // The backend gate for in_app.displayed reads these; sending only
            // `action` made every mobile click and dismiss count as a display.
            // Mirrors sdk-web/src/core/inapp.ts exactly, including collapsing
            // the action to the singular 'click'/'dismiss' it uses.
            val nowIso = isoTimestamp()
            val normalized = action.lowercase()
            val request = TrackImpressionRequest(
                campaignId = campaignId,
                userId = identityManager.getUserId() ?: "",
                anonymousId = identityManager.getAnonymousId(),
                sessionId = sessionManager.getSessionId(),
                action = when {
                    normalized.contains("click") -> name?.takeIf { it.isNotBlank() } ?: "click"
                    normalized.contains("dismiss") -> "dismiss"
                    else -> action
                },
                displayedAt = if (normalized.contains("display")) nowIso else null,
                clicked = if (normalized.contains("click")) true else null,
                clickedAt = if (normalized.contains("click")) nowIso else null,
                dismissedAt = if (normalized.contains("dismiss")) nowIso else null,
                converted = if (normalized.contains("convert")) true else null,
                convertedAt = if (normalized.contains("convert")) nowIso else null,
                deliveryToken = deliveryToken
            )

            when (val result = networkClient.trackImpression(request)) {
                is NetworkResult.Success -> {
                    logger.debug("Impression tracked successfully")
                }
                is NetworkResult.Error -> {
                    logger.error("Failed to track impression: ${result.message}")
                }
            }
        } catch (e: Exception) {
            logger.error("Failed to track impression: ${e.message}", e)
        }
    }

    /**
     * Get all campaigns
     */
    fun getCampaigns(): List<InAppCampaign> {
        return campaigns
    }

    /**
     * Get last sync time
     */
    fun getLastSyncTime(): Date? {
        return lastSyncTime
    }

    /**
     * Clear campaigns
     */
    fun clear() {
        campaigns = emptyList()
        lastSyncTime = null
        logger.debug("Campaigns cleared")
    }

    /**
     * Re-run the display decision over the campaigns already held.
     *
     * No network: this is deliberately the same evaluation the sync path runs,
     * so a caller cannot get a second, subtly different set of rules.
     */
    fun evaluateNow() {
        evaluateAndDisplay()
    }

    /**
     * Forget which campaigns have already been shown, so they can display again.
     *
     * Testing affordance, mirroring iOS. Without it the only way to re-test a
     * campaign on Android was to uninstall the app, because frequency state is
     * held locally (that is what lets a trigger fire instantly and offline).
     * Clears the cross-campaign gap too, or the next message would still be
     * suppressed by it.
     */
    fun resetDisplayedCampaigns() {
        storage.clearCampaignImpressions()
        lastDisplayAtMs = 0
        logger.debug("Reset displayed campaigns")
    }

    /**
     * Shutdown manager
     */
    fun shutdown() {
        scope.cancel()
        logger.debug("InAppMessagingManager shutdown")
    }

    /**
     * Re-evaluate when a WATCHED attribute changes.
     *
     * Web polls on a timer; a background loop on a phone is a battery cost for
     * something the SDK is told about directly, so this is event-driven - the
     * host app setting an attribute is the event.
     *
     * No watched attribute, no sync: an app that sets attributes frequently
     * must not turn every one of them into a network round trip.
     */
    /**
     * An event just happened in the app - show anything waiting on it.
     *
     * The server sends five trigger types and `event` was evaluated by nobody:
     * a campaign set to "show when the user does add_to_cart" waited for the
     * event to upload and the next sync to decide, so it appeared on the next
     * launch rather than at the moment they did it. Everything needed was
     * already on the device.
     *
     * NO eligibility re-check - the server sent this campaign because the user
     * matched it. Re-deciding here can only subtract, using data the device
     * does not have, which is exactly how this class came to suppress every
     * segment-targeted campaign.
     */
    /**
     * The user just tapped a push - show anything waiting on that.
     *
     * `push_notification_tap` is a trigger type the campaign editor OFFERS
     * (InAppDeliveryStep.tsx), the backend stores and the sync response sends -
     * and no SDK acted on it. A marketer could build "tap the push, see the
     * coupon details", save it, and nothing would ever appear.
     *
     * Syncs FIRST, deliberately. Unlike an event trigger - where the campaign
     * is already on the device because the server pre-authorised it - a push
     * tap is a moment where the freshest eligibility matters, and the tap has
     * just brought the app to the foreground anyway, so the round trip costs
     * nothing the user notices.
     */
    suspend fun onPushTapped() {
        sync()

        val match = campaigns
            .sortedByDescending { it.priority }
            .firstOrNull { campaign ->
                (campaign.triggers ?: emptyList<Map<String, Any?>>())
                    .any { it["type"] == "push_notification_tap" }
            } ?: return

        if (shouldDisplayCampaign(match)) {
            logger.info("Push tap triggered campaign: ${'$'}{match.name}")
            displayCampaign(match)
        }
    }

    fun onEventTracked(eventName: String, properties: Map<String, Any?>) {
        if (eventName.isEmpty()) return
        val match = campaigns
            .sortedByDescending { it.priority }
            .firstOrNull { campaign ->
                (campaign.triggers ?: emptyList<Map<String, Any?>>()).any { t ->
                    t["type"] == "event" &&
                        t["event"] == eventName &&
                        triggerFilterMatches(t, properties)
                }
            } ?: return

        // Reuse the ONE display routine, so caps, delay, the cross-campaign gap
        // and the presenter handoff all behave exactly as they do on a sync.
        // A second display path here is how the two would drift apart.
        if (shouldDisplayCampaign(match)) {
            logger.info("Event '${'$'}eventName' triggered campaign: ${'$'}{match.name}")
            displayCampaign(match)
        }
    }

    /**
     * A trigger's own property condition. No condition matches on the event
     * name alone; an UNKNOWN operator does NOT match - failing closed, because
     * a typo that silently matched would look like it worked.
     */
    private fun triggerFilterMatches(trigger: Map<String, Any?>, properties: Map<String, Any?>): Boolean {
        val attribute = trigger["attribute"] as? String ?: return true
        val actual = properties[attribute]
        val expected = trigger["value"]
        fun num(v: Any?): Double = when (v) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull() ?: Double.NaN
            else -> Double.NaN
        }
        return when (trigger["operator"] as? String) {
            null, "equals", "eq" -> actual?.toString() == expected?.toString()
            "not_equals", "neq" -> actual?.toString() != expected?.toString()
            "greater_than", "gt" -> num(actual) > num(expected)
            "less_than", "lt" -> num(actual) < num(expected)
            "contains" -> actual?.toString().orEmpty().contains(expected?.toString().orEmpty())
            "exists" -> actual != null
            else -> false
        }
    }

    fun attributesDidChange(keys: Collection<String>) {
        // FAST PATH: a campaign already on this device whose attribute_threshold
        // is now satisfied can display immediately, with no round trip.
        checkAttributeThresholds(keys)
        if (watchedAttributes.isEmpty()) return
        if (keys.none { watchedAttributes.contains(it) }) return

        scope.launch { sync() }
    }

    /**
     * Display a held campaign whose `attribute_threshold` is now met.
     *
     * A trigger type the editor offers and the server sends, evaluated by no
     * SDK: "show when loyaltyPoints passes 1000" only ever appeared on some
     * later sync, if at all.
     *
     * Evaluated against the CURRENT attribute values, not the changed keys
     * alone - a threshold is about where the value landed, not that it moved.
     */
    private fun checkAttributeThresholds(changedKeys: Collection<String>) {
        if (changedKeys.isEmpty()) return
        val attributes = identityManager.getUserAttributes()

        val match = campaigns
            .sortedByDescending { it.priority }
            .firstOrNull { campaign ->
                (campaign.triggers ?: emptyList<Map<String, Any?>>()).any { t ->
                    t["type"] == "attribute_threshold" &&
                        (t["attribute"] as? String)?.let { changedKeys.contains(it) } == true &&
                        triggerFilterMatches(t, attributes)
                }
            } ?: return

        if (shouldDisplayCampaign(match)) {
            logger.info("Attribute threshold triggered campaign: ${'$'}{match.name}")
            displayCampaign(match)
        }
    }
}

package io.joryio.sdk.network

import io.joryio.sdk.models.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Joryio API endpoints
 */
/**
 * Retrofit endpoint paths are RELATIVE - no leading "/".
 *
 * A leading slash makes Retrofit treat the path as absolute from the host root
 * and DISCARD the base URL's path. With an apiHost of "https://host/api" every
 * call went to https://host/v1/... and returned 404 "Cannot POST
 * /v1/in-app/sync", so the Android SDK could never reach the API even once it
 * initialized. Keep these relative.
 */
internal interface JoryioApi {

    /**
     * Track a batch of events
     */
    @POST("v1/track/batch")
    suspend fun trackBatch(
        @Body batch: EventBatch
    ): Response<BatchResponse>

    /**
     * Track a single event
     */
    @POST("v1/track")
    suspend fun trackEvent(
        @Body event: Event
    ): Response<EventResponse>

    /**
     * Identify a user
     */
    @POST("v1/identify")
    suspend fun identify(
        @Body request: IdentifyRequest
    ): Response<IdentifyResponse>

    /**
     * Alias a user
     */
    @POST("v1/alias")
    suspend fun alias(
        @Body request: AliasRequest
    ): Response<AliasResponse>

    /**
     * Set user attributes (uses /v1/attributes endpoint to avoid $identify events)
     */
    @POST("v1/attributes")
    suspend fun setAttributes(
        @Body request: SetAttributesRequest
    ): Response<SetAttributesResponse>

    /**
     * Marketing subscription: set a channel's status.
     *
     * NOT tracking consent (optIn/optOut). This is whether the person may be
     * MESSAGED on a channel, and it is what an in-app preference centre writes.
     */
    @POST("v1/subscriptions/channel")
    suspend fun updateChannelSubscription(
        @Body request: ChannelSubscriptionRequest
    ): Response<SubscriptionResponse>

    /**
     * Marketing subscription: join or leave a subscription group (list).
     */
    @POST("v1/subscriptions/group")
    suspend fun updateSubscriptionGroup(
        @Body request: SubscriptionGroupRequest
    ): Response<SubscriptionResponse>

    /**
     * Sync in-app messages for current session
     */
    @POST("v1/in-app/sync")
    suspend fun syncInAppMessages(
        @Body request: SessionSyncRequest
    ): Response<SessionSyncResponse>

    /**
     * Display-time re-check for a `reevaluateBeforeDisplay` campaign.
     */
    @POST("v1/in-app/resolve")
    suspend fun resolveInAppCampaign(
        @Body request: ResolveRequest
    ): Response<ResolveResponse>

    /**
     * Track in-app message impression
     */
    @POST("v1/in-app/track")
    suspend fun trackImpression(
        @Body request: TrackImpressionRequest
    ): Response<ImpressionResponse>

    /** A form inside an in-app message; the same route the web SDK posts to. */
    @POST("v1/in-app/form-submit")
    suspend fun submitInAppForm(
        @Body request: io.joryio.sdk.models.InAppFormSubmitRequest
    ): Response<io.joryio.sdk.models.InAppFormSubmitResponse>

    /**
     * Register push notification device token
     */
    @POST("v1/push/register")
    suspend fun registerPushToken(
        @Body request: PushTokenRequest
    ): Response<PushTokenResponse>

    /**
     * Unregister push notification device token
     */
    @POST("v1/push/unregister")
    suspend fun unregisterPushToken(
        @Body request: PushTokenRequest
    ): Response<PushTokenResponse>

    /**
     * Report that a push actually ARRIVED on this device.
     *
     * The only positive delivery signal push can produce. FCM answers a send
     * with "accepted" and never reports what reached the handset, so the device
     * telling us for itself is the difference between "we handed it to Google"
     * and "it reached someone".
     */
    // Root-mounted, like the click route: the signed trackingId is the
    // authority, and the same route serves the web service worker, which has
    // no SDK key at all.
    @POST("track/push/delivered/{trackingId}")
    suspend fun reportPushDelivered(
        @retrofit2.http.Path("trackingId") trackingId: String
    ): Response<PushTokenResponse>
}


// API Response Models
data class BatchResponse(
    val success: Boolean,
    val processed: Int,
    val message: String? = null
)

data class EventResponse(
    val success: Boolean,
    val message: String? = null
)

data class IdentifyResponse(
    val success: Boolean,
    val message: String? = null
)

data class AliasResponse(
    val success: Boolean,
    val message: String? = null
)

data class SetAttributesResponse(
    val success: Boolean,
    val message: String? = null
)

data class ImpressionResponse(
    val success: Boolean,
    val message: String? = null
)

data class PushTokenResponse(
    val success: Boolean,
    val message: String? = null
)

// API Request Models
data class IdentifyRequest(
    val userId: String,
    val anonymousId: String,
    val attributes: Map<String, Any?>? = null,
    val timestamp: java.util.Date = java.util.Date()
)

data class AliasRequest(
    val userId: String,
    val anonymousId: String,
    val timestamp: java.util.Date = java.util.Date()
)

/**
 * Attribute-operations request for POST /v1/attributes.
 *
 * Each section maps to an atomic backend operation; Gson omits null fields, so
 * only the operation in play is sent. An increment carries a DELTA (not a
 * locally-computed absolute), so multi-device writes don't clobber:
 *   - attributes: absolute `$set`
 *   - increment:  `$inc`   (delta)
 *   - append:     `$addToSet`
 *   - remove:     `$pull`
 *   - unset:      `$unset`
 */
data class SetAttributesRequest(
    val userId: String?,
    val anonymousId: String,
    val attributes: Map<String, Any?>? = null,
    val increment: Map<String, Number>? = null,
    val append: Map<String, Any?>? = null,
    val remove: Map<String, Any?>? = null,
    val unset: List<String>? = null
)

/*
 * Wire values are byte-identical to the web SDK and the backend DTO: the status
 * is camelCase `optedIn` (a NormalizeEnumCasing migration renamed the stored
 * value and the API 400s on `opted_in`), and the action is `subscribe` /
 * `unsubscribe`. One state must not become two segment rules.
 */
data class ChannelSubscriptionRequest(
    val channel: String,
    val status: String,
    val userId: String? = null,
    val anonymousId: String? = null
)

data class SubscriptionGroupRequest(
    val groupId: String,
    val channel: String,
    val action: String,
    val userId: String? = null,
    val anonymousId: String? = null
)

data class SubscriptionResponse(
    val success: Boolean = false
)

data class PushTokenRequest(
    val userId: String?,
    val anonymousId: String,
    val token: String,
    val platform: String = "android",

    /**
     * The stable device id, so the server attaches this token to the device row
     * that already exists rather than inserting a second one keyed only by the
     * token.
     *
     * Without it, first launch produced TWO rows seconds apart - one carrying
     * the identity with no token, one carrying the token with no identity, and
     * nothing joining them. Device counts doubled and any read of "the device"
     * got a 50/50 chance of the row without the token. Reported from a
     * production integration, 2026-08-23.
     */
    val deviceId: String? = null,
    // What the device IS - model, os_version, app_version. Absent until now,
    // which left Android device rows with nothing to filter or target on.
    val deviceInfo: Map<String, Any>? = null,
    val timestamp: java.util.Date = java.util.Date()
)

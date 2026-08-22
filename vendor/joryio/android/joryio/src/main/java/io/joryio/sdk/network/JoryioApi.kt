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

data class PushTokenRequest(
    val userId: String?,
    val anonymousId: String,
    val token: String,
    val platform: String = "android",
    // What the device IS - model, os_version, app_version. Absent until now,
    // which left Android device rows with nothing to filter or target on.
    val deviceInfo: Map<String, Any>? = null,
    val timestamp: java.util.Date = java.util.Date()
)

package io.joryio.sdk.core

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import io.joryio.sdk.models.*
import java.util.*

/**
 * Manages local storage for user data and SDK state
 */
internal class StorageManager(
    context: Context,
    private val sdkKey: String,
    private val logger: Logger
) {
    // Encrypted at rest via EncryptedSharedPreferences (see SecurePrefs); this file holds the
    // sensitive identity KV (anonymousId, userId, session) and the FCM device token. Falls back
    // to plaintext SharedPreferences only on API < 23 or a keystore failure — never crashes.
    private val prefs: SharedPreferences = SecurePrefs.get(
        context,
        "joryio_${sdkKey.hashCode()}",
        logger
    )
    private val gson = Gson()

    companion object {
        private const val KEY_ANONYMOUS_ID = "anonymous_id"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_SESSION = "session"
        private const val KEY_ATTRIBUTES = "attributes"
        private const val KEY_PENDING_ATTRIBUTES = "pending_attributes"
        private const val KEY_OPTED_OUT = "opted_out"
        private const val KEY_REPORTED_PUSH_PERMISSION = "reported_push_permission"
        private const val KEY_REGISTERED_PUSH_KEY = "registered_push_key"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_CAMPAIGN_IMPRESSIONS = "campaign_impressions"
        private const val KEY_USER_SEGMENTS = "user_segments"
    }

    // MARK: - Anonymous ID

    fun getAnonymousId(): String {
        val existingId = prefs.getString(KEY_ANONYMOUS_ID, null)
        if (existingId != null) {
            return existingId
        }

        val newId = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_ANONYMOUS_ID, newId).apply()
        logger.debug("Generated new anonymous ID: $newId")
        return newId
    }

    // MARK: - Device ID

    fun getDeviceId(): String {
        val existingId = prefs.getString(KEY_DEVICE_ID, null)
        if (existingId != null) {
            return existingId
        }

        val newId = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE_ID, newId).apply()
        logger.debug("Generated new device ID: $newId")
        return newId
    }

    // MARK: - User ID

    fun getUserId(): String? {
        return prefs.getString(KEY_USER_ID, null)
    }

    fun setUserId(userId: String?) {
        if (userId != null) {
            prefs.edit().putString(KEY_USER_ID, userId).apply()
            logger.debug("User ID set: ${maskIdentifier(userId)}")
        } else {
            prefs.edit().remove(KEY_USER_ID).apply()
            logger.debug("User ID cleared")
        }
    }

    // MARK: - Session

    fun getSession(): SessionInfo? {
        val json = prefs.getString(KEY_SESSION, null) ?: return null
        return try {
            gson.fromJson(json, SessionInfo::class.java)
        } catch (e: Exception) {
            logger.error("Failed to deserialize session", e)
            null
        }
    }

    fun setSession(session: SessionInfo) {
        val json = gson.toJson(session)
        prefs.edit().putString(KEY_SESSION, json).apply()
        logger.debug("Session saved: ${session.sessionId}")
    }

    fun clearSession() {
        prefs.edit().remove(KEY_SESSION).apply()
        logger.debug("Session cleared")
    }

    // MARK: - User Attributes
    //
    // The user-attribute trait bag (email/phone/name/custom) is PII and is
    // NEVER persisted at rest — it is held in memory by IdentityManager for the
    // session only. The only durable operation kept here is a purge, used both
    // as a one-time cleanup on init and on reset()/logout, so any bag written by
    // an older SDK build is removed from existing installs.

    // MARK: - Tracking opt-out
    //
    // PERSISTED. A withdrawal of consent has to outlive the process that
    // received it - an in-memory flag meant the next launch read config and
    // silently opted the user back in.

    /**
     * The push-permission value most recently reported to the backend.
     *
     * Kept so the attribute is sent only when it CHANGES. Without it, reporting
     * on every launch and foreground would cost a request per app open to
     * re-state a value that moves maybe twice in an install's lifetime.
     */
    fun getReportedPushPermission(): String? = prefs.getString(KEY_REPORTED_PUSH_PERMISSION, null)

    fun setReportedPushPermission(value: String) {
        prefs.edit().putString(KEY_REPORTED_PUSH_PERMISSION, value).apply()
    }

    fun getOptedOut(): Boolean = prefs.getBoolean(KEY_OPTED_OUT, false)

    fun setOptedOut(value: Boolean) {
        prefs.edit().putBoolean(KEY_OPTED_OUT, value).apply()
    }

    // MARK: - Pending attribute writes (outbound queue)
    //
    // DELIBERATELY separate from the trait bag above, which is never persisted.
    // This is not a cache of who the user is - it is UNDELIVERED WORK: the few
    // keys the app wrote that the server has not acknowledged. If it is lost,
    // the write never happens and the server never learns the value; if the
    // trait bag is lost, the server already has it.
    //
    // Encrypted at rest (EncryptedSharedPreferences, see SecurePrefs), cleared
    // the moment the server acks, and purged on reset()/logout/opt-out - so it
    // holds PII only for the span between a failed send and the next successful
    // one, and only when a send has actually failed.

    fun getPendingAttributes(): String? = prefs.getString(KEY_PENDING_ATTRIBUTES, null)

    fun setPendingAttributes(json: String?) {
        if (json.isNullOrEmpty()) {
            prefs.edit().remove(KEY_PENDING_ATTRIBUTES).apply()
        } else {
            prefs.edit().putString(KEY_PENDING_ATTRIBUTES, json).apply()
        }
    }

    fun clearPendingAttributes() {
        prefs.edit().remove(KEY_PENDING_ATTRIBUTES).apply()
        logger.debug("Pending attribute writes cleared")
    }

    fun clearUserAttributes() {
        prefs.edit().remove(KEY_ATTRIBUTES).apply()
        logger.debug("User attributes cleared")
    }

    // MARK: - Device Token (for push notifications)

    fun getDeviceToken(): String? {
        return prefs.getString(KEY_DEVICE_TOKEN, null)
    }

    fun setDeviceToken(token: String) {
        prefs.edit().putString(KEY_DEVICE_TOKEN, token).apply()
        logger.debug("Device token saved: ${token.take(20)}...")
    }

    fun clearDeviceToken() {
        prefs.edit().remove(KEY_DEVICE_TOKEN).apply()
        logger.debug("Device token cleared")
    }

    // MARK: - Campaign Impressions

    fun getCampaignImpressions(campaignId: String): List<Date> {
        val key = "${KEY_CAMPAIGN_IMPRESSIONS}_$campaignId"
        val json = prefs.getString(key, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<Long>>() {}.type
            val timestamps: List<Long> = gson.fromJson(json, type) ?: emptyList()
            timestamps.map { Date(it) }
        } catch (e: Exception) {
            logger.error("Failed to deserialize campaign impressions", e)
            emptyList()
        }
    }

    /**
     * Forget every recorded impression, so frequency caps start clean.
     *
     * Backs Joryio.resetDisplayedCampaigns(), which exists so a campaign can be
     * re-tested without reinstalling the app. Keys are per-campaign, so this
     * sweeps the prefix rather than a single entry.
     */
    /**
     * The token+identity pair last CONFIRMED registered by the backend.
     *
     * Stored only after a successful response, never before: if the marker were
     * written optimistically, a failed registration would be remembered as done
     * and the device would never retry - silently unreachable by push.
     *
     * The identity is part of the key because the same token under a new user is
     * a genuinely different registration (see reset()).
     */
    fun getRegisteredPushKey(): String? = prefs.getString(KEY_REGISTERED_PUSH_KEY, null)

    fun setRegisteredPushKey(value: String) {
        prefs.edit().putString(KEY_REGISTERED_PUSH_KEY, value).apply()
    }

    fun clearRegisteredPushKey() {
        prefs.edit().remove(KEY_REGISTERED_PUSH_KEY).apply()
    }

    fun clearCampaignImpressions() {
        val editor = prefs.edit()
        prefs.all.keys
            .filter { it.startsWith(KEY_CAMPAIGN_IMPRESSIONS) }
            .forEach { editor.remove(it) }
        editor.apply()
    }

    fun addCampaignImpression(campaignId: String, timestamp: Date) {
        val impressions = getCampaignImpressions(campaignId).toMutableList()
        impressions.add(timestamp)

        // Keep only last 100 impressions
        val recentImpressions = impressions.takeLast(100)

        val key = "${KEY_CAMPAIGN_IMPRESSIONS}_$campaignId"
        val timestamps = recentImpressions.map { it.time }
        val json = gson.toJson(timestamps)
        prefs.edit().putString(key, json).apply()
        logger.debug("Campaign impression recorded: $campaignId")
    }

    // MARK: - User Segments

    // User segments were stored here for a client-side targeting re-check that
    // has been removed: the server decides eligibility, and re-deciding it on
    // the device could only subtract. setUserSegments() was never called by
    // anything, so the check rejected EVERY segment-targeted campaign. Removed
    // rather than left dead, so nobody wires it back up.

    // MARK: - Clear All Data

    fun clearAllData() {
        prefs.edit().clear().apply()
        logger.info("All SDK data cleared")
    }
}

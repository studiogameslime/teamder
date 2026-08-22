package io.joryio.sdk.push

import android.content.Context
import io.joryio.sdk.core.DeviceInfo
import com.google.firebase.messaging.FirebaseMessaging
import io.joryio.sdk.core.IdentityManager
import io.joryio.sdk.core.Logger
import io.joryio.sdk.core.SecurePrefs
import io.joryio.sdk.core.StorageManager
import io.joryio.sdk.network.NetworkClient
import io.joryio.sdk.network.NetworkResult
import io.joryio.sdk.network.PushTokenRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Persists an FCM token that arrived via [JoryioFirebaseMessagingService.onNewToken]
 * BEFORE the SDK was initialized. Uses a fixed, sdk-key-independent SharedPreferences
 * file because the messaging service has no access to the configured SDK key.
 */
internal object PendingTokenStore {
    private const val PREFS = "joryio_pending"
    private const val KEY = "pending_push_token"

    // The FCM token is sensitive; store it encrypted at rest (EncryptedSharedPreferences).
    // SecurePrefs migrates any pre-existing plaintext "joryio_pending" file on first access
    // and falls back to plaintext only on API < 23 / keystore failure.
    private fun prefs(context: Context) = SecurePrefs.get(context, PREFS)

    /**
     * Start building this store on a background thread.
     *
     * Called at the top of SDK init so its keystore setup overlaps with the main
     * store's instead of running after it. [bootstrapToken] reads this file on
     * the caller's thread, so without the overlap the app pays two serial
     * keystore initialisations during initialize().
     */
    fun prewarm(context: Context) = SecurePrefs.prewarm(context, PREFS)

    fun save(context: Context, token: String) {
        prefs(context).edit().putString(KEY, token).apply()
    }

    /** Returns the pending token (if any) and clears it. */
    fun take(context: Context): String? {
        val prefs = prefs(context)
        val token = prefs.getString(KEY, null)
        if (token != null) {
            prefs.edit().remove(KEY).apply()
        }
        return token
    }
}

/**
 * Manages push notifications with Firebase Cloud Messaging
 */
internal class PushNotificationManager(
    context: Context,
    private val networkClient: NetworkClient,
    private val identityManager: IdentityManager,
    private val storage: StorageManager,
    private val logger: Logger
) {
    private val appContext: Context = context.applicationContext
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    init {
        logger.debug("PushNotificationManager initialized")
    }

    /**
     * Called once at SDK init. Recovers a token captured before init (cheap safety
     * net) AND proactively fetches the current FCM token (robust path), so a token
     * delivered while the SDK was uninitialized is never permanently lost.
     */
    fun bootstrapToken() {
        // (a) Cheap safety net: a token onNewToken persisted before init.
        try {
            PendingTokenStore.take(appContext)?.let { pending ->
                logger.debug("Registering push token captured before init")
                registerToken(pending)
            }
        } catch (e: Exception) {
            logger.warn("Failed to read pending push token: ${e.message}")
        }

        // (b) Robust path: fetch the current token straight from FCM.
        //
        // MUST catch Throwable, not Exception. firebase-messaging is `compileOnly`
        // (see build.gradle.kts) — deliberately optional, supplied by the host app
        // only if it wants push. When it is absent, touching FirebaseMessaging
        // throws NoClassDefFoundError, which is an ERROR, not an Exception: the
        // `catch (e: Exception)` this replaces never fired, so a missing optional
        // dependency propagated out of bootstrapToken and aborted the WHOLE of
        // Joryio.initialize() — killing analytics and in-app messaging in any app
        // that had not set up push.
        if (!isFcmOnClasspath()) {
            logger.debug("firebase-messaging not on the classpath; push disabled (analytics unaffected)")
            return
        }
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    task.result?.let { token -> registerToken(token) }
                } else {
                    logger.warn("Failed to fetch FCM token: ${task.exception?.message}")
                }
            }
        } catch (t: Throwable) {
            // Reached when firebase-messaging IS on the classpath but unusable —
            // typically no google-services.json, so FirebaseApp was never initialized.
            logger.warn("FirebaseMessaging unavailable, cannot auto-fetch token: ${t.message}")
        }
    }

    /**
     * Whether the optional `firebase-messaging` artifact is actually present.
     *
     * Asking the classloader turns a linkage failure into a boolean, so the
     * "is push configured?" decision is made explicitly rather than by catching an
     * Error after the fact.
     */
    private fun isFcmOnClasspath(): Boolean = try {
        Class.forName("com.google.firebase.messaging.FirebaseMessaging", false, javaClass.classLoader)
        true
    } catch (t: Throwable) {
        false
    }

    /**
     * Re-send the stored token so it is associated with the CURRENT identity.
     *
     * Called from reset(): the device row on the backend is keyed by userId, so
     * after a logout it still points at the person who just logged out. Without
     * this, the next user of that phone inherits the previous user's push
     * targeting - a privacy problem, not merely a delivery one.
     *
     * iOS has done this since the identity/logout hardening; Android did not,
     * which is the kind of one-sided fix the parity rule exists to catch.
     */
    fun reregisterToken() {
        val token = storage.getDeviceToken()
        if (token == null) {
            logger.debug("No stored device token to re-register")
            return
        }
        registerToken(token, force = true)
    }

    /**
     * Retry a registration the backend never confirmed.
     *
     * Called on foreground. Transient failures are already retried inside the
     * request, and a sustained outage is retried at the next init - but an app
     * that STAYS OPEN after one would otherwise remain unreachable by push until
     * it was relaunched, which for a long-lived session can be days. This turns
     * that window into "until the user next brings the app forward".
     *
     * Cheap by construction: with a confirmed registration the guard inside
     * registerToken returns immediately without touching the network.
     */
    fun retryRegistrationIfUnconfirmed() {
        val token = storage.getDeviceToken() ?: return
        registerToken(token)
    }

    /** Register a device token with the backend under the current identity. */
    @JvmOverloads
    fun registerToken(token: String, force: Boolean = false) {
        scope.launch {
            try {
                // Skip a registration the backend already has. bootstrapToken()
                // asks FCM for the current token on EVERY init, so without this
                // every app launch spent a request restating an unchanged token.
                //
                // Keyed by token+identity: the same token under a new user is a
                // different registration, which is what makes reset() work.
                val key = "$token|${identityManager.getUserId() ?: identityManager.getAnonymousId()}"
                if (!force && storage.getRegisteredPushKey() == key) {
                    logger.debug("Push token already registered for this identity; skipping")
                    return@launch
                }

                logger.debug("Registering push token: ${token.take(20)}...")

                // Store token locally
                storage.setDeviceToken(token)

                // Send to backend
                val request = PushTokenRequest(
                    userId = identityManager.getUserId(),
                    anonymousId = identityManager.getAnonymousId(),
                    token = token,
                    platform = "android",
                    // Send what the device IS, not just its token. Without this
                    // an Android device row carried no model, os_version or
                    // app_version, so segment filters over those fields matched
                    // zero Android users - silently, because a missing version
                    // loses a comparison rather than raising one. iOS has always
                    // sent this dict; the key names here match it deliberately.
                    deviceInfo = runCatching { DeviceInfo.getDeviceInfo(appContext) }.getOrNull()
                )

                when (val result = networkClient.registerPushToken(request)) {
                    is NetworkResult.Success -> {
                        // Mark AFTER the backend confirms. Marking before would
                        // remember a FAILED registration as done and leave the
                        // device permanently unreachable by push.
                        storage.setRegisteredPushKey(key)
                        logger.info("Push token registered successfully")
                    }
                    is NetworkResult.Error -> {
                        logger.error("Failed to register push token: ${result.message}")
                    }
                }
            } catch (e: Exception) {
                logger.error("Failed to register push token: ${e.message}", e)
            }
        }
    }

    /**
     * Unregister device token from backend
     */
    fun unregisterToken() {
        scope.launch {
            try {
                val token = storage.getDeviceToken()
                if (token == null) {
                    logger.debug("No push token to unregister")
                    return@launch
                }

                logger.debug("Unregistering push token")

                val request = PushTokenRequest(
                    userId = identityManager.getUserId(),
                    anonymousId = identityManager.getAnonymousId(),
                    token = token,
                    platform = "android"
                )

                when (val result = networkClient.unregisterPushToken(request)) {
                    is NetworkResult.Success -> {
                        storage.clearDeviceToken()
                        logger.info("Push token unregistered successfully")
                    }
                    is NetworkResult.Error -> {
                        logger.error("Failed to unregister push token: ${result.message}")
                    }
                }
            } catch (e: Exception) {
                logger.error("Failed to unregister push token: ${e.message}", e)
            }
        }
    }

    /**
     * Get current device token
     */
    fun getToken(): String? {
        return storage.getDeviceToken()
    }

    /**
     * Check if push is enabled
     */
    fun isPushEnabled(): Boolean {
        return storage.getDeviceToken() != null
    }
}

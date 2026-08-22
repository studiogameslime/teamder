package io.joryio.sdk.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.joryio.sdk.Joryio

/**
 * Firebase Cloud Messaging service for receiving push notifications
 *
 * To use this service, add the following to your AndroidManifest.xml:
 *
 * <service
 *     android:name="io.joryio.sdk.push.JoryioFirebaseMessagingService"
 *     android:exported="false">
 *     <intent-filter>
 *         <action android:name="com.google.firebase.MESSAGING_EVENT" />
 *     </intent-filter>
 * </service>
 */
class JoryioFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val CHANNEL_ID = "joryio_push"
        private const val CHANNEL_NAME = "Joryio Notifications"
        private const val DEFAULT_NOTIFICATION_ID = 1001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    /**
     * Called when a new FCM token is generated
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)

        // Register token with Joryio
        try {
            val pushManager = Joryio.getInstance().pushManager
            pushManager?.registerToken(token)
        } catch (e: Exception) {
            // SDK not initialized yet. Persist the token so initialize() can recover
            // and register it (see PushNotificationManager.bootstrapToken).
            try {
                PendingTokenStore.save(applicationContext, token)
            } catch (persistError: Exception) {
                // Best effort; nothing else we can do here.
            }
        }
    }

    /**
     * Called when a message is received
     */
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        // Check if message is from Joryio
        val isJoryio = remoteMessage.data["joryio"] == "true"
        if (!isJoryio) {
            return
        }

        // A silent SYNC nudge, not a message to show. The backend sends one after
        // queueing an in-app test so the SDK pulls immediately instead of
        // waiting for the next app open. iOS had this branch (logging, never
        // syncing); Android had none at all, so a nudge arrived and was
        // rendered as an empty notification with no title or body.
        val syncType = remoteMessage.data["jry_sync"]
        if (!syncType.isNullOrEmpty()) {
            when (syncType) {
                "campaigns", "in_app" -> {
                    Joryio.getInstance().syncInAppCampaigns()
                }
                else -> {
                    // Named rather than silently ignored: an unknown type means
                    // the backend and the SDK disagree, which is worth seeing.
                    android.util.Log.d("JoryioFCM", "Unknown jry_sync type: $syncType")
                }
            }
            return
        }

        // Extract notification data
        val title = remoteMessage.notification?.title ?: remoteMessage.data["title"] ?: ""
        val body = remoteMessage.notification?.body ?: remoteMessage.data["body"] ?: ""
        // BOTH sources, deliberately. The backend sends the image as FCM's
        // `notification.imageUrl` (see fcm-provider.ts), which is what Firebase
        // itself renders for a background notification - this code only looked at
        // `data["image_url"]`, a DIFFERENT field, so an image sent by a campaign
        // was invisible whenever OUR service did the rendering (foreground, or a
        // data-only send). The data key stays as a fallback for data-only pushes.
        val imageUrl = remoteMessage.notification?.imageUrl?.toString()
            ?: remoteMessage.data["image_url"]
        val deepLink = remoteMessage.data["deep_link"]
        val trackingId = remoteMessage.data["trackingId"]
        val customData = remoteMessage.data.filterKeys {
            it !in listOf("joryio", "title", "body", "image_url", "deep_link", "trackingId")
        }

        // Display notification
        displayNotification(
            title = title,
            body = body,
            imageUrl = imageUrl,
            deepLink = deepLink,
            trackingId = trackingId,
            customData = customData
        )
    }

    /**
     * Display notification
     */
    private fun displayNotification(
        title: String,
        body: String,
        imageUrl: String?,
        deepLink: String?,
        trackingId: String?,
        customData: Map<String, String>
    ) {
        // `as?`: getSystemService can return null, and the unchecked cast threw
        // a NullPointerException out of onMessageReceived — i.e. a crash in the
        // HOST APP triggered remotely, by us sending a push. Failing to show one
        // notification is the correct cost.
        val notificationManager =
            getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        if (notificationManager == null) {
            android.util.Log.w("Joryio", "NotificationManager unavailable; cannot show notification")
            return
        }

        // Create intent
        val intent = createNotificationIntent(deepLink, trackingId, customData)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Build notification
        val notificationBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getNotificationIcon())
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)

        // Rich image, when the campaign carries one. onMessageReceived already
        // runs on a FirebaseMessagingService worker thread, so the bounded fetch
        // below is safe here - it must never be moved onto the main thread.
        //
        // A failed or oversized download degrades to the plain notification
        // rather than dropping the message: no picture is a far better outcome
        // than no notification.
        if (!imageUrl.isNullOrBlank()) {
            val bitmap = NotificationImageLoader.fetch(imageUrl)
            if (bitmap != null) {
                notificationBuilder
                    .setLargeIcon(bitmap)
                    .setStyle(
                        NotificationCompat.BigPictureStyle()
                            .bigPicture(bitmap)
                            // Collapsed view shows the small icon, not a duplicate
                            // of the big picture.
                            .bigLargeIcon(null as android.graphics.Bitmap?),
                    )
            }
        }

        // Show notification
        notificationManager.notify(DEFAULT_NOTIFICATION_ID, notificationBuilder.build())
    }

    /**
     * Build the intent fired when the notification is TAPPED.
     *
     * The tap is routed through [JoryioNotificationTrampolineActivity] rather than
     * straight to the host launcher. The click must be tracked ON TAP, not when the
     * notification is built (that inflated CTR to ~100%). A trampoline Activity — not
     * a BroadcastReceiver/Service — is required because Android 12+ bans indirect
     * notification activity starts ("notification trampolines") from receivers/services.
     */
    private fun createNotificationIntent(
        deepLink: String?,
        trackingId: String?,
        customData: Map<String, String>
    ): Intent {
        val trampolineIntent = Intent(this, JoryioNotificationTrampolineActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK

            // Carry everything the trampoline needs to (a) track the click and
            // (b) reconstruct the host launch intent + deep link.
            if (trackingId != null) {
                putExtra("joryio_tracking_id", trackingId)
            }
            if (deepLink != null) {
                putExtra("joryio_deep_link", deepLink)
            }
            customData.forEach { (key, value) ->
                putExtra("joryio_$key", value)
            }
        }

        return trampolineIntent
    }

    /**
     * Get notification icon from app resources
     */
    private fun getNotificationIcon(): Int {
        // Resource reflection, deliberately. It is how a host app supplies its own
        // notification icon by simply adding a drawable named `ic_notification`,
        // with nothing to register and no API to call - the convention every push
        // SDK uses. Lint discourages it because R8 resource shrinking can remove a
        // drawable that nothing references by name, and that is exactly why the
        // zero-check below exists: a stripped icon degrades to the app icon rather
        // than failing to post the notification.
        @Suppress("DiscouragedApi")
        val resourceId = resources.getIdentifier(
            "ic_notification",
            "drawable",
            packageName
        )

        // Fallback to app icon
        return if (resourceId != 0) {
            resourceId
        } else {
            applicationInfo.icon
        }
    }

    /** Notification channels exist from API 26; minSdk is 23, so this stays guarded. */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Push notifications from Joryio"
            enableLights(true)
            enableVibration(true)
        }

        val notificationManager =
            getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        notificationManager?.createNotificationChannel(channel)
    }
}

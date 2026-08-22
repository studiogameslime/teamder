package io.joryio.sdk.push

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import io.joryio.sdk.Joryio

/**
 * Invisible trampoline that receives a push-notification TAP, records the click,
 * then forwards to the host app's launcher (carrying the deep link / custom data).
 *
 * Why an Activity and not a BroadcastReceiver/Service:
 *  - Push click must be attributed on TAP. Tracking at notification-build time
 *    inflated CTR to ~100%.
 *  - Android 12+ (targetSdk 31+) forbids starting an Activity from a notification
 *    trampoline that is a service or broadcast receiver. Activities are allowed.
 *
 * Declared `exported="false"` with a translucent, no-history theme so it never
 * shows UI and never appears in recents.
 */
class JoryioNotificationTrampolineActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val incoming = intent

        // 1. Track the click ON TAP (best effort; no-op if SDK not initialized).
        val trackingId = incoming?.getStringExtra("joryio_tracking_id")
        if (trackingId != null) {
            try {
                Joryio.getInstance().trackPushClick(trackingId)
            } catch (e: Exception) {
                // SDK not initialized on tap; nothing to attribute to.
            }
        }

        // 2. Forward to the host launcher, carrying all joryio_* extras (tracking
        //    id, deep link, custom data) so the host can honor the deep link.
        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            if (launchIntent != null) {
                launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                incoming?.extras?.let { launchIntent.putExtras(it) }
                startActivity(launchIntent)
            }
        } catch (e: Exception) {
            // If we can't resolve/launch the host, just finish silently.
        }

        finish()
    }
}

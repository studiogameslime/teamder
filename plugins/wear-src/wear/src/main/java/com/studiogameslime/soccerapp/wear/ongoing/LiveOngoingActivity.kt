package com.studiogameslime.soccerapp.wear.ongoing

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.studiogameslime.soccerapp.wear.MainActivity
import com.studiogameslime.soccerapp.wear.R
import com.studiogameslime.soccerapp.wear.model.WearGameState

/**
 * Surfaces a running live-match timer as a Wear OS **Ongoing Activity** — the
 * watch-face indicator + the "recent apps" launcher chip that Wear App Quality
 * requires while an activity is in progress (Google rejected vc1023 for missing
 * this). Backed by an ongoing notification the OngoingActivity attaches to, so
 * it survives process death and needs no foreground service (avoiding the
 * Android-14 FGS-type + background-start restrictions from a data-layer callback).
 *
 * Driven from [TileUpdateListenerService] on every /teamder/state change (runs
 * whether or not the app is open): update() while a live game is on, clear()
 * once it ends.
 */
object LiveOngoingActivity {

    private const val CHANNEL_ID = "live_match"
    private const val NOTIF_ID = 4711
    /** Auto-dismiss the ongoing notification if it isn't refreshed within this
     *  window (longer than any match; the phone re-publishes a live match ~every
     *  60s). Prevents a leaked, forever-counting timer when the phone dies. */
    private const val ONGOING_TTL_MS = 3L * 60L * 60L * 1000L // 3h

    fun update(context: Context, state: WearGameState) {
        if (state !is WearGameState.Live) {
            clear(context)
            return
        }
        ensureChannel(context)
        val t = state.timer
        val touch = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        // Elapsed at the moment the payload was parsed (monotonic base).
        val baseElapsed = if (t.baseElapsedMs >= 0L) t.baseElapsedMs else t.accumulatedMs
        // A running stopwatch counts up from the elapsedRealtime at which it read 0.
        val timeZeroMs =
            (if (t.parseAnchorRealtimeMs > 0L) t.parseAnchorRealtimeMs
            else SystemClock.elapsedRealtime()) - baseElapsed

        val status =
            if (t.running) {
                Status.Builder()
                    .addTemplate("#time#")
                    .addPart("time", Status.StopwatchPart(timeZeroMs))
                    .build()
            } else {
                Status.Builder().addTemplate(formatMmSs(baseElapsed)).build()
            }

        val title = state.title.ifBlank { "משחק חי" }
        val builder =
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_wear_foreground)
                .setContentTitle(title)
                .setContentText(if (t.running) "המשחק רץ" else "מושהה")
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                // Self-dismiss safeguard: if the phone dies mid-match and never
                // publishes a terminal state, no event ever arrives to clear()
                // this un-swipeable ongoing notification — it would count forever.
                // Every refresh (each /teamder/state event + the phone's ~60s
                // re-publish) re-applies this timeout, so it only fires after a
                // long gap with NO updates = the phone is gone.
                .setTimeoutAfter(ONGOING_TTL_MS)
                .setContentIntent(touch)

        val ongoing =
            OngoingActivity.Builder(context, NOTIF_ID, builder)
                .setStaticIcon(R.drawable.ic_wear_foreground)
                .setTouchIntent(touch)
                .setStatus(status)
                .build()
        ongoing.apply(context)

        try {
            NotificationManagerCompat.from(context).notify(NOTIF_ID, builder.build())
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted yet — no-op; it'll post once granted.
        }
    }

    fun clear(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIF_ID)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(NotificationManager::class.java)
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        "משחק חי",
                        NotificationManager.IMPORTANCE_LOW,
                    ),
                )
            }
        }
    }

    private fun formatMmSs(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        return "%02d:%02d".format(total / 60, total % 60)
    }
}

package com.studiogameslime.soccerapp.widget

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Custom FCM service so a server-sent `type:"timerSync"` data message
 * refreshes the home-screen widget + paired-watch tile NATIVELY — even when
 * the app is killed.
 *
 * Why this exists: in-app, `useWatchSync` (JS) listens to Firestore and
 * republishes the widget payload on every timer change. But that listener
 * only runs while the JS process is alive — so a registered player who
 * isn't actively in the app saw a frozen clock when another device
 * started/paused the timer. This service closes that gap: a silent FCM
 * wakes it (no JS needed), and it patches the widget state in Kotlin.
 *
 * Registered with default intent-filter priority (0), which beats
 * expo-notifications' own service (priority -1), so FCM dispatches here
 * first. EVERY non-timer message is forwarded to `super` so normal push
 * notifications keep flowing through expo-notifications unchanged.
 */
class TeamderMessagingService : ExpoFirebaseMessagingService() {

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    if (data["type"] == "timerSync") {
      try {
        handleTimerSync(applicationContext, data)
      } catch (_: Exception) {
        // Best-effort widget refresh — never crash the FCM pipeline.
      }
      return // silent: do not let expo build a visible notification
    }
    super.onMessageReceived(remoteMessage)
  }

  private fun handleTimerSync(context: Context, data: Map<String, String>) {
    val gameId = data["gameId"] ?: return

    val prefs = context.getSharedPreferences(
      TeamderWidgetProvider.PREFS, Context.MODE_PRIVATE,
    )
    val existing = prefs.getString(TeamderWidgetProvider.KEY_JSON, null)?.let {
      try { JSONObject(it) } catch (_: Exception) { null }
    }

    val running = data["timerRunning"] == "true"
    val lastStartedAt = data["timerLastStartedAt"]?.toLongOrNull() ?: 0L
    val accumulatedMs = data["timerAccumulatedMs"]?.toLongOrNull() ?: 0L
    val controlledBy = data["timerControlledBy"] ?: ""
    val controlledByName = data["timerControlledByName"] ?: ""
    val title = data["gameTitle"] ?: ""

    // Merge into the existing payload when it's the SAME game so we keep the
    // roster / viewer / measured clock offset the JS layer wrote. Otherwise
    // build a minimal live payload (timer widget works; the players list
    // fills in next time the app runs).
    val state: JSONObject =
      if (existing != null && existing.optString("gameId") == gameId) {
        existing
      } else {
        JSONObject().apply { put("clockOffsetMs", 0L) }
      }

    val gameEnded = data["gameEnded"] == "true"
    if (gameEnded) {
      // Game finished/cancelled: clear the live card so a killed-app widget/tile
      // doesn't stay frozen on it (ending while paused changes no timer primitive,
      // so this is the only signal these surfaces get). Downgrade to
      // 'notRegistered' — the same terminal state the JS layer publishes on
      // logout, which both the widget and the watch treat as "no live game".
      // Only touch OUR game's payload: if a DIFFERENT live game is showing, leave
      // it (the fresh-minimal `state` picked above would otherwise clobber it).
      if (existing != null && existing.optString("gameId") != gameId) return
      state.put("kind", "notRegistered")
      state.put("gameId", gameId)
      state.remove("timer")
      state.remove("baseElapsedMs")
      state.remove("serverNowMs")
    } else {
      state.put("kind", "live")
      state.put("gameId", gameId)
      if (title.isNotEmpty()) state.put("title", title)
      state.put("controlledBy", controlledBy)
      state.put("controlledByName", controlledByName)
      val timer = state.optJSONObject("timer") ?: JSONObject()
      timer.put("running", running)
      timer.put("lastStartedAt", lastStartedAt)
      timer.put("accumulatedMs", accumulatedMs)
      // For a minimal/fresh payload (no JS-measured offset — clockOffsetMs is 0),
      // anchor to the server's send time so a skewed DEVICE clock doesn't corrupt
      // the fold. offset = serverNowMs(send) − deviceNow(receive). The cached
      // JS-measured offset (RTT-corrected) is more accurate, so only derive from
      // the message when there's no cached offset.
      val msgServerNow = data["serverNowMs"]?.toLongOrNull()
      if (state.optLong("clockOffsetMs", 0L) == 0L && msgServerNow != null) {
        state.put("clockOffsetMs", msgServerNow - System.currentTimeMillis())
      }
      // CRITICAL: re-stamp the resolved base + publish instant, exactly like the
      // widget-tap path (TimerActionReceiver.applyOptimisticPrefsUpdate). This FCM
      // merges into a payload the JS layer published earlier (root serverNowMs +
      // nested timer.baseElapsedMs from that publish); once the app is killed the
      // JS re-publish loop stops, so those fields go STALE. The watch fold
      // (watchServerNow − serverNowMs) and the widget fold (nowEpoch − serverNowMs)
      // would then add the whole age-of-last-publish to the timer — a paused-then-
      // remotely-started clock jumps forward by that gap. Re-stamp so the fold
      // starts at ~0. baseElapsedMs is the elapsed AT this instant: for a running
      // timer that's accumulatedMs + (nowServer − lastStartedAt) (the FCM arrives
      // AFTER the remote start, so fold that gap in); paused → just accumulatedMs.
      // Written to BOTH the ROOT (widget reads it there) and NESTED timer (the
      // watch's parseWearState reads it there).
      val clockOffsetMs = state.optLong("clockOffsetMs", 0L)
      val nowServer = System.currentTimeMillis() + clockOffsetMs
      val baseElapsed =
        if (running && lastStartedAt > 0L) {
          accumulatedMs + (nowServer - lastStartedAt).coerceAtLeast(0L)
        } else {
          accumulatedMs
        }
      timer.put("baseElapsedMs", baseElapsed)
      state.put("timer", timer)
      state.put("baseElapsedMs", baseElapsed)
      state.put("serverNowMs", nowServer)
    }

    val json = state.toString()
    prefs.edit().putString(TeamderWidgetProvider.KEY_JSON, json).apply()
    TeamderWidgetProvider.requestRefresh(context)
    TeamderPlayersWidgetProvider.requestRefresh(context)

    // Mirror to the paired watch (same path/keys WatchBridgeModule uses).
    // AWAIT the write: onMessageReceived runs on a background thread and the
    // process may be reaped the instant this method returns — a fire-and-forget
    // putDataItem would be dropped before the Data Layer flushes it.
    try {
      val req = PutDataMapRequest.create("/teamder/state").apply {
        dataMap.putString("json", json)
        dataMap.putLong("ts", System.currentTimeMillis())
      }.asPutDataRequest().setUrgent()
      Tasks.await(
        Wearable.getDataClient(context).putDataItem(req),
        5, TimeUnit.SECONDS,
      )
    } catch (_: Exception) {
      // No paired watch / Wearable unavailable / timeout — widget still updated.
    }
  }
}

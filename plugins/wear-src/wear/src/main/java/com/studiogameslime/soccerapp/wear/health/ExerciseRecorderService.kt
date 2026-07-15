package com.studiogameslime.soccerapp.wear.health

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import com.studiogameslime.soccerapp.wear.R
import org.json.JSONObject
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Records a live football match on the watch with Wear **Health Services**
 * (`ExerciseClient`) and, when the match ends, relays the session totals to the
 * phone via [WearPhysicalSender] (`/teamder/physical`). The phone persists them
 * to `games/{gameId}/physical/{uid}` → the evening-summary physical panel.
 *
 * WHY Health Services (not Health Connect): HS reads the watch's OWN sensors
 * behind the normal `BODY_SENSORS` / `ACTIVITY_RECOGNITION` runtime permissions
 * — it needs NONE of the `android.permission.health.*` Health-Connect
 * permissions, so it doesn't trip Google Play's Health-apps declaration gate
 * that blocks our Individual developer account. GPS is off (no
 * ACCESS_FINE_LOCATION) so there's no Location-declaration gate either; distance
 * is step-derived, heart-rate/steps/calories from the watch's onboard sensors.
 *
 * Foreground service: an exercise must keep recording with the screen off, so
 * per Google's guidance we run as a `health`-typed foreground service. Health
 * Services keeps the exercise alive in its own process and delivers cumulative
 * totals in [ExerciseUpdate]; we keep the LATEST totals (they're monotonic) plus
 * running HR/speed stats, and emit one session on stop.
 *
 * Lifecycle (driven by [PhysicalStateListenerService] + MainActivity, off the
 * phone's `/teamder/state`):
 *   • [ACTION_START] + [EXTRA_GAME_ID] → start recording (idempotent).
 *   • [ACTION_STOP]                    → flush + send + end + stop.
 *   • hard cap [MAX_MS]                → auto-stop (guards a phone that ends the
 *                                        match without ever publishing a
 *                                        terminal state).
 *
 * Best-effort throughout: no watch → nothing starts; a failed send is dropped
 * (the MessageClient already retries to connected nodes). This can only be
 * verified on a real Galaxy Watch — there is no emulator sensor path.
 */
class ExerciseRecorderService : Service() {

    private val exerciseClient by lazy {
        HealthServices.getClient(this).exerciseClient
    }
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var recording = false
    @Volatile private var gameId: String = ""

    // Cumulative totals — kept as the LATEST value HS reports (monotonic).
    @Volatile private var distanceM = 0.0
    @Volatile private var steps = 0.0
    @Volatile private var calories = 0.0
    // Rolling HR / speed stats built from the sample streams.
    @Volatile private var hrSum = 0.0
    @Volatile private var hrCount = 0L
    @Volatile private var hrMax = 0.0
    @Volatile private var speedSum = 0.0
    @Volatile private var speedCount = 0L
    @Volatile private var speedMax = 0.0
    @Volatile private var sprintSamples = 0L

    private val autoStop = Runnable {
        Log.i(TAG, "auto-stop (max duration) for $gameId")
        finishAndStop()
    }

    private val callback = object : ExerciseUpdateCallback {
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {
            Log.w(TAG, "exercise registration failed", throwable)
        }
        override fun onAvailabilityChanged(
            dataType: DataType<*, *>,
            availability: Availability,
        ) {}
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            accumulate(update)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                finishAndStop()
                return START_NOT_STICKY
            }
            else -> {
                val gid = intent?.getStringExtra(EXTRA_GAME_ID)?.trim().orEmpty()
                if (gid.isEmpty()) {
                    // Nothing to bind the session to — don't linger as a
                    // foreground service with no work.
                    stopSelf()
                    return START_NOT_STICKY
                }
                // An FGS of type=health THROWS on API 34+ if neither sensor
                // permission is granted — and MainActivity requests them
                // asynchronously, so on a first-ever open during a live match the
                // grant may not have landed yet. Bail cleanly BEFORE going
                // foreground (never call startForeground without the grant), so we
                // can't be killed by the "did not start in time" timeout.
                if (!hasSensorPermission(this)) {
                    Log.w(TAG, "sensor permission not granted; not recording yet")
                    stopSelf()
                    return START_NOT_STICKY
                }
                if (!startForegroundSafely()) {
                    // Couldn't enter foreground — clear the obligation and abort
                    // rather than run un-foregrounded until the system kills us.
                    stopSelf()
                    return START_NOT_STICKY
                }
                // Retry any sessions a previous match couldn't deliver (phone was
                // out of range at that flush) — at-least-once watch→phone.
                flushStash(applicationContext)
                if (!recording) {
                    gameId = gid
                    startRecording()
                } else if (gid != gameId) {
                    // A different match started before the previous one was
                    // stopped — flush the old one, then begin the new.
                    finishSessionOnly()
                    gameId = gid
                    resetStats()
                    startRecording()
                }
            }
        }
        // START_NOT_STICKY: a system-killed FGS should NOT be auto-restarted with
        // a null intent (it carries no gameId and would just stopSelf). The
        // background PhysicalStateListenerService re-starts recording on the next
        // /teamder/state publish (~60s), and undelivered sessions are re-sent from
        // the stash — so we recover without a pointless respawn.
        return START_NOT_STICKY
    }

    private fun startRecording() {
        recording = true
        resetStats()
        try {
            // GPS DELIBERATELY OFF → no ACCESS_FINE_LOCATION, so no Play Store
            // Location-permission declaration / prominent-disclosure gate (which
            // would block the release the way the health gate does). Distance is
            // step-derived by Health Services — accurate enough for the "relative,
            // fun" summary; SPEED is a GPS-only stream so it's omitted (top/avg
            // speed + sprints resolve to 0, which the panel hides).
            val config = ExerciseConfig.builder(ExerciseType.SOCCER)
                .setDataTypes(
                    setOf(
                        DataType.HEART_RATE_BPM,
                        DataType.DISTANCE_TOTAL,
                        DataType.STEPS_TOTAL,
                        DataType.CALORIES_TOTAL,
                    ),
                )
                .setIsAutoPauseAndResumeEnabled(false)
                .setIsGpsEnabled(false)
                .build()
            exerciseClient.setUpdateCallback(callback)
            // ListenableFuture — fire and forget; failures surface via
            // onRegistrationFailed. We don't block the service thread on it.
            exerciseClient.startExerciseAsync(config)
            mainHandler.postDelayed(autoStop, MAX_MS)
            active = true
            Log.i(TAG, "recording started for $gameId")
        } catch (e: Throwable) {
            // Missing permission / no sensor / HS unavailable → give up cleanly
            // rather than crash the watch app.
            Log.w(TAG, "startRecording failed", e)
            recording = false
            active = false
            stopForegroundCompat()
            stopSelf()
        }
    }

    private fun accumulate(update: ExerciseUpdate) {
        val m = update.latestMetrics
        try {
            m.getData(DataType.DISTANCE_TOTAL)?.let {
                distanceM = (it.total as Number).toDouble()
            }
        } catch (_: Throwable) {}
        try {
            m.getData(DataType.STEPS_TOTAL)?.let {
                steps = (it.total as Number).toDouble()
            }
        } catch (_: Throwable) {}
        try {
            m.getData(DataType.CALORIES_TOTAL)?.let {
                calories = (it.total as Number).toDouble()
            }
        } catch (_: Throwable) {}
        try {
            for (dp in m.getData(DataType.HEART_RATE_BPM)) {
                val bpm = dp.value
                if (bpm > 0) {
                    hrSum += bpm
                    hrCount++
                    if (bpm > hrMax) hrMax = bpm
                }
            }
        } catch (_: Throwable) {}
        // No SPEED stream: it's GPS-only and GPS is off (see startRecording),
        // so top/avg speed + sprints stay 0 and the panel hides them.
    }

    /** Build the session JSON from the accumulated stats. null if nothing
     *  meaningful was recorded (no hollow all-zero doc). */
    private fun buildSessionJson(): JSONObject? {
        if (distanceM <= 0 && steps <= 0 && hrCount == 0L) return null
        val avgHr = if (hrCount > 0) hrSum / hrCount else 0.0
        val topSpeedKmh = speedMax * 3.6
        val avgSpeedKmh = if (speedCount > 0) (speedSum / speedCount) * 3.6 else 0.0
        // Effort 0..100: prefer heart-rate reserve (generic rest 60 / max 190);
        // fall back to movement volume when HR is absent (band with no HR).
        val effort = if (avgHr > 0) {
            (((avgHr - 60.0) / (190.0 - 60.0)) * 100.0).coerceIn(0.0, 100.0)
        } else {
            ((distanceM / 1000.0) * 8.0 + sprintSamples * 1.2).coerceIn(0.0, 100.0)
        }
        return JSONObject().apply {
            put("gameId", gameId)
            put("distanceM", distanceM.roundToLong())
            put("steps", steps.roundToLong())
            put("calories", calories.roundToLong())
            put("topSpeedKmh", round1(topSpeedKmh))
            put("avgSpeedKmh", round1(avgSpeedKmh))
            put("sprints", sprintSamples)
            put("avgHr", avgHr.roundToInt())
            put("maxHr", hrMax.roundToInt())
            put("effortScore", effort.roundToInt())
            put("source", "wear")
        }
    }

    /** Flush + send the session, then end the HS exercise. Does NOT stop the
     *  service (used when swapping to a new match). */
    private fun finishSessionOnly() {
        mainHandler.removeCallbacks(autoStop)
        val session = buildSessionJson()
        if (session != null) {
            // Persist FIRST, then try to deliver — MessageClient is fire-and-
            // forget with no store-and-forward, so if the phone is out of range at
            // the whistle the stash keeps the session and the next match's start
            // (or the immediate flush below) re-sends it. Delivered entries are
            // removed on success.
            WearPhysicalStash.add(applicationContext, session.toString())
            flushStash(applicationContext)
        } else {
            Log.i(TAG, "no meaningful session to send for $gameId")
        }
        try {
            exerciseClient.endExerciseAsync()
        } catch (e: Throwable) {
            Log.w(TAG, "endExercise failed", e)
        }
        recording = false
    }

    /** Flush + send + end + stop the service entirely. */
    private fun finishAndStop() {
        if (recording) finishSessionOnly()
        active = false
        stopForegroundCompat()
        stopSelf()
    }

    private fun resetStats() {
        distanceM = 0.0; steps = 0.0; calories = 0.0
        hrSum = 0.0; hrCount = 0L; hrMax = 0.0
        speedSum = 0.0; speedCount = 0L; speedMax = 0.0; sprintSamples = 0L
    }

    // ── Foreground plumbing ──────────────────────────────────────────────
    /** @return true if we successfully entered the foreground. On false the
     *  caller MUST abort (stopSelf) — running un-foregrounded after
     *  startForegroundService gets the process killed within ~5s. */
    private fun startForegroundSafely(): Boolean {
        return try {
            ensureChannel()
            val notif = NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Teamder")
                .setContentText("מקליט נתוני משחק")
                .setSmallIcon(R.drawable.ic_wear_foreground)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                    NOTIF_ID,
                    notif,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH,
                )
            } else {
                startForeground(NOTIF_ID, notif)
            }
            true
        } catch (e: Throwable) {
            Log.w(TAG, "startForeground failed", e)
            false
        }
    }

    private fun stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (_: Throwable) {}
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        "הקלטת משחק",
                        NotificationManager.IMPORTANCE_LOW,
                    ),
                )
            }
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(autoStop)
        // Belt-and-suspenders: if we're torn down while still recording, try to
        // salvage the session (stash + best-effort send) before the process dies.
        if (recording) {
            try {
                finishSessionOnly()
            } catch (_: Throwable) {}
        }
        active = false
        super.onDestroy()
    }

    companion object {
        private const val TAG = "ExerciseRecorder"
        private const val CHANNEL_ID = "teamder_match_recording"
        private const val NOTIF_ID = 4711

        const val ACTION_START = "com.studiogameslime.soccerapp.wear.RECORD_START"
        const val ACTION_STOP = "com.studiogameslime.soccerapp.wear.RECORD_STOP"
        const val EXTRA_GAME_ID = "gameId"

        /** True between a successful startRecording and stop/destroy. Lets stop()
         *  no-op when nothing is running (avoids a needless background startService
         *  + its caught IllegalStateException on every idle /state republish). */
        @Volatile
        private var active = false

        /** Hard cap: never record longer than a pickup evening could last. */
        private const val MAX_MS = 4L * 60L * 60L * 1000L // 4h

        private fun round1(v: Double): Double = (v * 10).roundToInt() / 10.0

        /** True if at least one sensor permission is granted — enough for a
         *  health-typed foreground service (steps OR heart-rate). */
        fun hasSensorPermission(context: Context): Boolean {
            val g = android.content.pm.PackageManager.PERMISSION_GRANTED
            return context.checkSelfPermission(android.Manifest.permission.BODY_SENSORS) == g ||
                context.checkSelfPermission(android.Manifest.permission.ACTIVITY_RECOGNITION) == g
        }

        /** Re-send any sessions still stashed on the watch (undelivered because
         *  the phone was out of range at their flush). Each is removed only on a
         *  confirmed delivery. */
        private fun flushStash(context: Context) {
            for (json in WearPhysicalStash.all(context)) {
                WearPhysicalSender.sendSession(context, json) {
                    WearPhysicalStash.remove(context, json)
                }
            }
        }

        /** Start (or update) recording for [gameId]. Idempotent. */
        fun start(context: Context, gameId: String) {
            if (gameId.isBlank()) return
            val intent = Intent(context, ExerciseRecorderService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_GAME_ID, gameId)
            }
            try {
                context.startForegroundService(intent)
            } catch (e: Throwable) {
                // API 31+ blocks starting a foreground service from the background
                // (e.g. the state-listener while the app is closed). Caught so we
                // never crash; the in-app MainActivity path is the reliable start.
                Log.w(TAG, "start() failed (background FGS start blocked?)", e)
            }
        }

        /** Flush + send + stop recording. No-op when nothing is running (so an
         *  idle non-live /state republish doesn't spam caught exceptions). */
        fun stop(context: Context) {
            if (!active) return
            val intent = Intent(context, ExerciseRecorderService::class.java).apply {
                action = ACTION_STOP
            }
            try {
                context.startService(intent)
            } catch (e: Throwable) {
                Log.w(TAG, "stop() failed", e)
            }
        }
    }
}

/**
 * A tiny watch-side pending-session store, so a finished match's physical data
 * isn't lost when the phone is out of range at the flush moment (MessageClient
 * has no store-and-forward). Sessions are added on flush and removed only after
 * a confirmed delivery; [ExerciseRecorderService.flushStash] re-sends them on
 * the next match start. Bounded so an unpaired watch can't grow it unbounded.
 */
private object WearPhysicalStash {
    private const val PREFS = "TeamderWearPhysicalPending"
    private const val KEY = "pending"
    private const val MAX = 20
    private val LOCK = Any()

    fun add(context: Context, json: String) = synchronized(LOCK) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = try {
            org.json.JSONArray(prefs.getString(KEY, "[]"))
        } catch (_: Exception) {
            org.json.JSONArray()
        }
        arr.put(json)
        // Trim oldest-first if over the cap.
        val out = if (arr.length() > MAX) {
            val t = org.json.JSONArray()
            for (i in (arr.length() - MAX) until arr.length()) t.put(arr.get(i))
            t
        } else {
            arr
        }
        prefs.edit().putString(KEY, out.toString()).apply()
    }

    fun all(context: Context): List<String> = synchronized(LOCK) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = try {
            org.json.JSONArray(prefs.getString(KEY, "[]"))
        } catch (_: Exception) {
            org.json.JSONArray()
        }
        buildList { for (i in 0 until arr.length()) add(arr.optString(i)) }
            .filter { it.isNotEmpty() }
    }

    fun remove(context: Context, json: String) = synchronized(LOCK) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = try {
            org.json.JSONArray(prefs.getString(KEY, "[]"))
        } catch (_: Exception) {
            org.json.JSONArray()
        }
        val out = org.json.JSONArray()
        for (i in 0 until arr.length()) {
            val e = arr.optString(i)
            if (e != json) out.put(e)
        }
        prefs.edit().putString(KEY, out.toString()).apply()
    }
}

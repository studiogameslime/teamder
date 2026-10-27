package com.studiogameslime.soccerapp.phoneactivity

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.*
import android.os.*
import org.json.JSONArray
import org.json.JSONObject

/** Explicit, temporary test. Nothing is written to disk or uploaded. */
class PhoneActivityService : Service(), LocationListener {
    companion object {
        var running = false
        var starting = false
        var owner: String? = null
        var engine = PhoneMovement()
        var began = 0L
        var ended = 0L
        var error: String? = null
        var instance: PhoneActivityService? = null
        fun snapshot(): String {
            val now = SystemClock.elapsedRealtime()
            val current = if (running) engine.current(now) else null
            return JSONObject().apply {
                put("running", running); put("starting", starting)
                put("elapsedMs", if (began == 0L) 0 else (if (running) now else ended) - began)
                put("current", current ?: JSONObject.NULL)
                put("peak", engine.peak?.times(3.6) ?: JSONObject.NULL)
                put("distance", if (engine.measuredMs > 0) engine.distance else JSONObject.NULL)
                put("sprints", if (engine.measuredMs > 0) engine.sprints else JSONObject.NULL)
                put("sprintMs", if (engine.measuredMs > 0) engine.sprintMs else JSONObject.NULL)
                put("measuredMs", engine.measuredMs); put("sprinting", running && engine.sprinting(now))
                put("quality", if (!running) "idle" else if (current != null) "good" else if (engine.accepted == 0 && engine.rejected == 0) "waiting" else "weak")
                put("error", error ?: JSONObject.NULL)
                put("graph", JSONArray().apply { engine.graph.forEach { put(it ?: JSONObject.NULL) } })
            }.toString()
        }
        fun clear() { engine = PhoneMovement(); began = 0; ended = 0; owner = null; error = null; starting = false }
    }
    private lateinit var manager: LocationManager
    private val handler = Handler(Looper.getMainLooper())
    private val limit = Runnable { error = "limit"; finish() }
    override fun onCreate() { super.onCreate(); instance = this; manager = getSystemService(LOCATION_SERVICE) as LocationManager }
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { finish(); return START_NOT_STICKY }
        if (intent?.getStringExtra("owner") != owner || owner == null) { finish(); return START_NOT_STICKY }
        if (running) return START_NOT_STICKY
        try {
            val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(NotificationChannel("phone_measurement", "בדיקת מדידה בטלפון", NotificationManager.IMPORTANCE_LOW))
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            val pending = PendingIntent.getActivity(this, 21, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val stop = PendingIntent.getService(this, 22, Intent(this, PhoneActivityService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val notification = Notification.Builder(this, "phone_measurement")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("בדיקת המדידה פעילה")
                .setContentText("הטלפון מודד גם כשהמסך כבוי. ניתן לסיים כאן.")
                .setContentIntent(pending).setOngoing(true).addAction(Notification.Action.Builder(null, "סיום מדידה", stop).build()).build()
            if (Build.VERSION.SDK_INT >= 29) startForeground(7321, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(7321, notification)
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) throw SecurityException()
            if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) { error = "location_off"; finish(); return START_NOT_STICKY }
            engine = PhoneMovement(); began = SystemClock.elapsedRealtime(); ended = began; error = null
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
            running = true; starting = false
            handler.postDelayed(limit, 2 * 60 * 60 * 1000L)
        } catch (_: SecurityException) { error = "permission"; finish() }
          catch (_: Exception) { error = "start_failed"; finish() }
        return START_NOT_STICKY
    }
    override fun onLocationChanged(location: Location) {
        if (!running) return
        engine.add(PhoneMovement.Sample(location.elapsedRealtimeNanos / 1000000,
            if (location.hasSpeed()) location.speed.toDouble() else Double.NaN,
            if (location.hasAccuracy()) location.accuracy.toDouble() else Double.NaN,
            if (location.hasSpeedAccuracy()) location.speedAccuracyMetersPerSecond.toDouble() else Double.NaN), SystemClock.elapsedRealtime())
    }
    override fun onProviderDisabled(provider: String) { if (provider == LocationManager.GPS_PROVIDER) { error = "location_off"; finish() } }
    override fun onProviderEnabled(provider: String) {}
    @Deprecated("Legacy callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    fun finish() {
        if (running) ended = SystemClock.elapsedRealtime()
        running = false; starting = false
        handler.removeCallbacks(limit)
        manager.removeUpdates(this)
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onTaskRemoved(rootIntent: Intent?) { finish(); super.onTaskRemoved(rootIntent) }
    override fun onDestroy() { finish(); instance = null; super.onDestroy() }
}

package com.studiogameslime.soccerapp.wear.activity

import android.app.Service
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.data.*
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.FutureCallback
import com.google.common.util.concurrent.ListenableFuture
import com.google.android.gms.wearable.*
import com.studiogameslime.soccerapp.wear.MainActivity
import com.studiogameslime.soccerapp.wear.R
import androidx.compose.runtime.mutableStateOf
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/** User-started foreground exercise. Phone eligibility gates every individual sample. */
class PersonalExerciseService : Service(), DataClient.OnDataChangedListener, MessageClient.OnMessageReceivedListener {
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val client by lazy { HealthServices.getClient(this).exerciseClient }
    private val journal by lazy { ActivityJournal(this) }
    private val gate = ActivityGate()
    private var leaseId: Long? = null
    private var user = ""
    private var game = ""
    private var standalone = false
    private var sourceBinding: ActivitySourceBinding? = null
    private var standaloneClock: ActivityClock? = null
    private var stateJson: JSONObject? = null
    private var phoneNode = ""
    private var lastStateAt = 0L
    private var exerciseOwned = false
    private var eligible = false
    private var transition = false
    private var stopping = false
    @Volatile private var destroyed = false
    private var startFuture: ListenableFuture<Void>? = null
    private var terminalMessage: String? = null
    private var bootEpoch = 0L
    private val cursor = ActivitySampleCursor()
    private var lastStateRequestAt = 0L
    private val tick = object : Runnable {
        override fun run() {
            executor.execute {
                if (destroyed || !lifecycleLease.owns(leaseId) || journal.active() == null) return@execute
                applyGate(); journal.flush(false)
                if (SystemClock.elapsedRealtime() - lastStateRequestAt >= 30_000 && phoneNode.isNotBlank()) {
                    lastStateRequestAt = SystemClock.elapsedRealtime()
                    Wearable.getMessageClient(this@PersonalExerciseService).sendMessage(phoneNode, if(standalone) "/teamder/activity-source-request" else "/teamder/request-state",
                        JSONObject().put("userId", user).toString().toByteArray())
                }
            }
            handler.postDelayed(this, 10_000)
        }
    }
    private val callback = object : ExerciseUpdateCallback {
        override fun onRegistered() { }
        override fun onRegistrationFailed(throwable: Throwable) { if (!destroyed && lifecycleLease.owns(leaseId)) fail("לא ניתן להתחבר לחיישני השעון") }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) { }
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) { }
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            if (destroyed || !lifecycleLease.owns(leaseId)) return
            try {
                val timestampDriftMs = kotlin.math.abs((System.currentTimeMillis() - SystemClock.elapsedRealtime()) - bootEpoch)
                val activeClock=WearClockSync.calibration?.takeIf{it.fresh(System.currentTimeMillis())} ?: if(standalone)standaloneClock else null
                val clock = activeClock?.let { it.copy(uncertaintyMs = it.uncertaintyAt(System.currentTimeMillis()) + timestampDriftMs) }
                if (clock == null || (!standalone && !clock.fresh(System.currentTimeMillis()))) { applyGate(); return }
                fun record(id: String, start: Long, end: Long, key: String, value: Number, point: Boolean = false) {
                    if (!ActivitySampleProtocol.valid(start, end, key, value) || !gate.accepts(start, end, point)) return
                    if (!cursor.claim(key, start + clock.offsetMs, end + clock.offsetMs, point)) return
                    journal.append(JSONObject().put("id", id).put("startAtMs", start).put("endAtMs", end).put(key, value), clock)
                }
                update.latestMetrics.getData(DataType.DISTANCE).sortedBy { it.endDurationFromBoot }.forEach { p ->
                    val a = bootEpoch + p.startDurationFromBoot.toMillis(); val b = bootEpoch + p.endDurationFromBoot.toMillis()
                    record("d:$a:$b", a, b, "distanceM", p.value)
                }
                update.latestMetrics.getData(DataType.STEPS).sortedBy { it.endDurationFromBoot }.forEach { p ->
                    val a = bootEpoch + p.startDurationFromBoot.toMillis(); val b = bootEpoch + p.endDurationFromBoot.toMillis()
                    record("s:$a:$b", a, b, "steps", p.value)
                }
                update.latestMetrics.getData(DataType.CALORIES).sortedBy { it.endDurationFromBoot }.forEach { p ->
                    val a = bootEpoch + p.startDurationFromBoot.toMillis(); val b = bootEpoch + p.endDurationFromBoot.toMillis()
                    record("c:$a:$b", a, b, "calories", p.value)
                }
                update.latestMetrics.getData(DataType.HEART_RATE_BPM).sortedBy { it.timeDurationFromBoot }.forEach { p ->
                    val at = bootEpoch + p.timeDurationFromBoot.toMillis()
                    if (p.value in 25.0..240.0) record("h:$at", at, at, "heartRateBpm", p.value, true)
                }
                if (standalone) update.latestMetrics.getData(DataType.SPEED).sortedBy { it.timeDurationFromBoot }.forEach { p ->
                    val at = bootEpoch + p.timeDurationFromBoot.toMillis()
                    record("v:$at", at, at, "speedMps", p.value, true)
                }
                if (update.exerciseStateInfo.state.isEnded && !stopping) {
                    finish("המדידה הופסקה בשעון. הנתונים שנמדדו נשמרו")
                }
            } catch (_: Exception) { fail("לא ניתן לשמור מדידה. הנתונים הקודמים נשמרו") }
        }
    }

    override fun onCreate() {
        super.onCreate()
        if (!com.studiogameslime.soccerapp.wear.SportsActivity.ENABLED) { stopSelf(); return }
        leaseId = lifecycleLease.acquire()
        if (leaseId == null) {
            feedback.value = "מדידה קודמת מסתיימת. נסו שוב בעוד רגע"
            stopSelf()
            return
        }
        bootEpoch = System.currentTimeMillis() - SystemClock.elapsedRealtime()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("personal_exercise", "פעילות אישית", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 7301, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, "personal_exercise").setSmallIcon(R.drawable.ic_wear_foreground)
            .setContentTitle("מדידת הפעילות שלי").setContentText("המדידה נשמרת בחשבון הפרטי שלך. אפשר לסיים בכל רגע")
            .setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(7301, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        else startForeground(7301, notification)
        Wearable.getDataClient(this).addListener(this)
        Wearable.getMessageClient(this).addListener(this)
        handler.post(tick)
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!com.studiogameslime.soccerapp.wear.SportsActivity.ENABLED) { stopSelf(); return START_NOT_STICKY }
        if (!lifecycleLease.owns(leaseId)) { stopSelf(); return START_NOT_STICKY }
        executor.execute {
            if (destroyed || !lifecycleLease.owns(leaseId)) return@execute
            if (intent?.action == "stop") { stopExercise(); return@execute }
            if (stopping) {
                feedback.value = "מדידה קודמת מסתיימת. נסו שוב בעוד רגע"
                stopSelf(startId)
                return@execute
            }
            if (recording.value) return@execute
            user = intent?.getStringExtra("userId").orEmpty(); game = intent?.getStringExtra("gameId").orEmpty()
            standalone = intent?.getStringExtra("mode")=="standalone"
            if(standalone){
                StandaloneSourceStore.restore(this)
                sourceBinding=StandaloneSourceStore.binding.value
                val requested=ActivitySourceBinding(user,intent?.getStringExtra("connectionId").orEmpty(),intent?.getLongExtra("sourceGeneration",-1) ?: -1,
                    intent?.getStringExtra("readerInstallationId").orEmpty(),intent?.getStringExtra("deviceId").orEmpty(),sourceBinding?.validUntilMs ?: 0,intent?.getStringExtra("phoneNodeId").orEmpty())
                val clock=WearClockSync.calibration
                if(!requested.sameSource(sourceBinding) || !requested.valid() || sourceBinding?.userId!=user || clock==null || !clock.fresh(System.currentTimeMillis()) || !StandaloneSessionPolicy.canStart(sourceBinding,System.currentTimeMillis()+clock.offsetMs)){
                    fail("בחרו את השעון כמקור הפעילות בטלפון והמתינו לסנכרון");return@execute
                }
                standaloneClock=clock
            }
            if (user.isBlank() || (!standalone && game.isBlank())) { fail("פתחו שוב מדידה מתוך המחזור בשעון"); return@execute }
            stateJson = intent?.getStringExtra("state")?.let { JSONObject(it) }
            lastStateAt = stateJson?.optJSONObject("activity")?.optLong("confirmedAtMs") ?: 0
            phoneNode = if(standalone)sourceBinding!!.phoneNodeId else intent?.getStringExtra("phoneNodeId").orEmpty()
            journal.recoverInterrupted() // this service holds the exclusive recorder lease
            journal.begin(user, game, if(standalone)sourceBinding else null)
            recording.value = true
            client.setUpdateCallback(executor, callback)
            future(client.getCurrentExerciseInfoAsync(), { info ->
                if (info == null) { fail("שירות המדידה החזיר תשובה חסרה"); return@future }
                if (info.exerciseTrackedStatus == ExerciseTrackedStatus.OTHER_APP_IN_PROGRESS) {
                    fail("אימון אחר כבר פועל בשעון. סיימו אותו לפני מדידה כאן")
                } else if (info.exerciseTrackedStatus == ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS) {
                    exerciseOwned = true; recording.value = true; applyGate()
                } else configure()
            }, { fail("שירות המדידה אינו זמין בשעון") })
        }
        return START_NOT_STICKY
    }
    private fun configure() {
        future(client.getCapabilitiesAsync(), { capabilities ->
            if (capabilities == null) { fail("יכולות המדידה אינן זמינות בשעון"); return@future }
            val type = if (ExerciseType.SOCCER in capabilities.supportedExerciseTypes) ExerciseType.SOCCER else ExerciseType.WORKOUT
            if (type !in capabilities.supportedExerciseTypes) { fail("מדידת פעילות אינה נתמכת בשעון הזה"); return@future }
            val supported = capabilities.getExerciseTypeCapabilities(type).supportedDataTypes
            val requested = mutableSetOf<DataType<*, *>>(DataType.DISTANCE, DataType.STEPS, DataType.CALORIES)
            if (standalone) requested.add(DataType.SPEED)
            val hrPermission = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else "android.permission.BODY_SENSORS"
            if (checkSelfPermission(hrPermission) == android.content.pm.PackageManager.PERMISSION_GRANTED) requested.add(DataType.HEART_RATE_BPM)
            val available = requested.intersect(supported)
            if (available.isEmpty()) { fail("אין מדדים נתמכים זמינים בשעון"); return@future }
            val config = ExerciseConfig.Builder(type).setDataTypes(available).setIsGpsEnabled(false).setIsAutoPauseAndResumeEnabled(false).build()
            startFuture = client.startExerciseAsync(config)
            future(startFuture!!, {
                exerciseOwned = true; recording.value = true; applyGate()
            }, { fail("לא ניתן להתחיל מדידה. בדקו הרשאות בשעון") })
        }, { fail("לא ניתן לבדוק את חיישני השעון") })
    }
    private fun applyGate() {
        val now = System.currentTimeMillis()
        val active = journal.active()
        if (active != null && now - active.optLong("startedAtMs") >= StandaloneSessionPolicy.MAX_DURATION_MS) {
            stopExercise(); feedback.value = "המדידה הסתיימה לאחר זמן ממושך. הנתונים נשמרו"
            return
        }
        if (kotlin.math.abs((now - SystemClock.elapsedRealtime()) - bootEpoch) > 1_000) {
            fail("שעון המכשיר השתנה. התחילו מדידה מחדש לכיול זמן מדויק")
            return
        }
        val current = stateJson
        val freshClock=WearClockSync.calibration?.takeIf{it.fresh(now)}
        if(freshClock==null) WearClockSync.request(this, phoneNode, user)
        if(standalone && freshClock!=null)standaloneClock=freshClock
        val clock=freshClock ?: if(standalone)standaloneClock else null
        val activity = current?.optJSONObject("activity")
        val serverNow = now + (clock?.offsetMs ?: 0.0)
        if(standalone && sourceBinding?.sameSource(StandaloneSourceStore.binding.value)!=true){
            fail("מקור הפעילות או החשבון השתנו. המדידה הסתיימה");return
        }
        val okay = if(standalone){
            clock!=null && active!=null && StandaloneSessionPolicy.canContinue(sourceBinding,StandaloneSourceStore.binding.value,active.getLong("startedAtMs"),now)
        }else current?.optString("gameId") == game && current.optJSONObject("viewer")?.optString("id") == user &&
            clock?.fresh(now) == true && activity?.optBoolean("eligible") == true && activity.optString("userId") == user &&
            activity.optString("gameId") == game && activity.optLong("confirmedAtMs") <= serverNow && activity.optLong("validUntilMs") > serverNow
        eligible = okay
        val until=if(okay){if(standalone)journal.active()!!.getLong("startedAtMs")+12*60*60_000L else (activity!!.optLong("validUntilMs")-clock!!.offsetMs).toLong()} else now
        gate.update(now,okay,until,if(standalone)"standalone:${sourceBinding!!.connectionId}" else activity?.optString("roundId").orEmpty())
        feedback.value = when {
            clock==null || (!standalone && !clock.fresh(now)) -> "ממתין לכיול זמן מול הטלפון"
            okay && standalone && StandaloneSourceStore.binding.value?.fresh(serverNow)!=true -> "המדידה נשמרת בשעון עד לחיבור מחדש לטלפון"
            okay && standalone -> "המדידה האישית פועלת עד לסיום שלך"
            okay -> "המדידה פעילה בזמן המשחק שלי"
            standalone -> "המדידה מושהית עד לעדכון מקור הפעילות מהטלפון"
            else -> "המדידה מושהית עד שאשחק והטיימר ירוץ"
        }
        if (exerciseOwned && !transition && !stopping) {
            transition = true
            val operation = if (okay) client.resumeExerciseAsync() else client.pauseExerciseAsync()
            future(operation, { transition = false }, { transition = false; fail("המדידה נעצרה. בדקו הרשאות וחיבור") })
        }
    }
    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            val path = event.dataItem.uri.path.orEmpty()
            if(path==StandaloneSourceStore.PATH){
                val node=event.dataItem.uri.host.orEmpty()
                if(standalone){
                    val raw=if(event.type==DataEvent.TYPE_CHANGED)DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json") else null
                    executor.execute{StandaloneSourceStore.accept(this,raw,node);applyGate()}
                }
                continue
            }
            if(path.startsWith("/teamder/standalone-activity-ack/") && event.type==DataEvent.TYPE_CHANGED){
                val parts=path.split("/");val map=DataMapItem.fromDataItem(event.dataItem).dataMap
                if(parts.size==5)executor.execute{journal.acknowledgeStandalone(parts[3],parts[4].toLongOrNull() ?: 0,map)}
                continue
            }
            if (path == "/teamder/state" && !standalone) {
                val json = if (event.type == DataEvent.TYPE_CHANGED) DataMapItem.fromDataItem(event.dataItem).dataMap.getString("json") else null
                val node = event.dataItem.uri.host.orEmpty()
                executor.execute {
                    if (phoneNode.isNotBlank() && node != phoneNode) return@execute
                    val next = json?.let { JSONObject(it) }
                    ActivityJournal.authorizePayload(json)
                    if (next != null && (next.optJSONObject("viewer")?.optString("id") != user || next.optString("gameId") != game)) {
                        terminalMessage = "המחזור או החשבון השתנו. הפעילות נשלחה לשמירה"
                        stopExercise(); return@execute
                    }
                    val at = next?.optJSONObject("activity")?.optLong("confirmedAtMs") ?: 0
                    if (next != null && at < lastStateAt) return@execute
                    lastStateAt = at; stateJson = next; applyGate()
                }
            } else if (path.startsWith("/teamder/activity-ack/") && event.type == DataEvent.TYPE_CHANGED) {
                val map = DataMapItem.fromDataItem(event.dataItem).dataMap
                val parts = path.split("/")
                if (parts.size == 5) executor.execute { journal.acknowledge(parts[3], parts[4].toLongOrNull() ?: 0, map.getString("userId").orEmpty()) }
            }
        }
    }
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == "/teamder/clock-result" && event.sourceNodeId == phoneNode) {
            WearClockSync.accept(this, String(event.data, Charsets.UTF_8)); executor.execute { ActivityJournal.authorizePayload(stateJson?.toString()); applyGate() }
        }
    }
    private fun stopExercise() {
        if (stopping || !lifecycleLease.owns(leaseId)) return
        gate.close(System.currentTimeMillis()); stopping = true
        if (exerciseOwned) future(client.endExerciseAsync(), { finish("הפעילות נשמרה וממתינה לסנכרון") }, { finish("הפעילות נשמרה מקומית") })
        else finish("הפעילות נשמרה מקומית")
    }
    private fun fail(message: String) { terminalMessage = message; stopExercise(); feedback.value = message }
    private fun finish(message: String) {
        if (!lifecycleLease.owns(leaseId)) return
        stopping = true; recording.value = false; gate.close(System.currentTimeMillis())
        journal.flush(true); feedback.value = terminalMessage ?: message
        stopSelf()
    }
    override fun onDestroy() {
        destroyed = true
        handler.removeCallbacks(tick)
        val cleanupLease = leaseId
        if (!lifecycleLease.owns(cleanupLease)) {
            executor.shutdown()
            super.onDestroy()
            return
        }
        recording.value = false
        Wearable.getDataClient(this).removeListener(this); Wearable.getMessageClient(this).removeListener(this)
        executor.execute {
            stopping = true; gate.close(System.currentTimeMillis()); journal.flush(true)
            val direct = com.google.common.util.concurrent.MoreExecutors.directExecutor()
            fun release() {
                lifecycleLease.release(cleanupLease)
                executor.shutdown()
            }
            fun clear() {
                try { client.clearUpdateCallbackAsync(callback).addListener({ release() }, direct) }
                catch (_: Exception) { release() }
            }
            val finishOwned = Runnable {
                if (!lifecycleLease.owns(cleanupLease)) { release(); return@Runnable }
                try { Futures.addCallback(client.getCurrentExerciseInfoAsync(), object : FutureCallback<ExerciseInfo> {
                    override fun onSuccess(info: ExerciseInfo?) {
                        if (!lifecycleLease.owns(cleanupLease)) { release(); return }
                        if (info?.exerciseTrackedStatus == ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS) {
                            try { client.endExerciseAsync().addListener({ clear() }, direct) }
                            catch (_: Exception) { clear() }
                        } else clear()
                    }
                    override fun onFailure(error: Throwable) { clear() }
                }, direct) } catch (_: Exception) { clear() }
            }
            // A start already sent to Health Services must settle before the ownership check.
            val pending = startFuture
            if (pending != null) pending.addListener(finishOwned, direct) else finishOwned.run()
        }
        super.onDestroy()
    }
    private fun <T> future(value: ListenableFuture<T>, success: (T?) -> Unit, failure: (Throwable) -> Unit) {
        Futures.addCallback(value, NullableFutureCallback<T>(
            { result -> if (!destroyed && lifecycleLease.owns(leaseId)) success(result) },
            { error -> if (!destroyed && lifecycleLease.owns(leaseId)) failure(error) }
        ), executor)
    }
    companion object {
        private val lifecycleLease = ExerciseLifecycleLease()
        val recording = mutableStateOf(false)
        val feedback = mutableStateOf("")
    }
}

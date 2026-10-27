package com.studiogameslime.soccerapp.widget

import android.content.Context
import android.content.Intent
import androidx.work.*
import org.json.JSONObject
import java.util.UUID

/** User actions are never retried after process death/offline against a later round. */
class WidgetTimerWorker(context: Context, params: WorkerParameters, private val backend: WidgetBackend) : Worker(context, params) {
    constructor(context: Context, params: WorkerParameters) : this(context, params, FirebaseWidgetBackend())
    override fun doWork(): Result {
        val uid = inputData.getString("uid") ?: return Result.failure()
        val gameId = inputData.getString("gameId") ?: return Result.failure()
        val round = inputData.getString("round") ?: return Result.failure()
        val command = inputData.getString("command") ?: return Result.failure()
        val action = inputData.getString("action") ?: return Result.failure()
        val session = inputData.getLong("session", -1)
        val at = inputData.getLong("at", 0)
        fun current() = !isStopped && WidgetStateStore.generation(applicationContext) == session &&
            WidgetStateStore.owner(WidgetStateStore.read(applicationContext)) == uid
        if (!current()) {
            WidgetCommandReply.send(applicationContext, inputData.getString("sourceNodeId"), command, false, "החשבון התחלף. רעננו את השעון", true)
            return Result.success()
        }
        var error: String? = null
        try {
            if (System.currentTimeMillis() - at !in 0..60_000) throw WidgetTimerModel.Changed()
            if (backend.userId() != uid) throw WidgetTimerModel.NotController()
            val state = WidgetStateStore.read(applicationContext) ?: throw WidgetTimerModel.Changed()
            if (state.optString("gameId") != gameId || state.optString("timerRoundId") != round) throw WidgetTimerModel.Changed()
            val name = state.optJSONObject("viewer")?.optString("name").orEmpty()
            val result = backend.mutate(gameId, uid, round, action, name, command) {
                if (!current() || backend.userId() != uid || WidgetStateStore.pending(applicationContext)?.optString("command") != command ||
                    System.currentTimeMillis() - at !in 0..60_000) throw WidgetTimerModel.Changed()
                System.currentTimeMillis() + (WidgetStateStore.read(applicationContext)?.optLong("clockOffsetMs") ?: 0)
            }
            synchronized(TeamderWidgetProvider.STATE_LOCK) {
                val latest = WidgetStateStore.read(applicationContext)
                if (current() && latest != null && latest.optString("gameId") == gameId && latest.optString("timerRoundId") == round) {
                    val identities = mutableMapOf<String, Map<String, Any?>>()
                    val rows = latest.optJSONArray("players")
                    if (rows != null) for (i in 0 until rows.length()) {
                        val row = rows.optJSONObject(i) ?: continue
                        identities[row.optString("id")] = mapOf("name" to row.optString("name"), "photoUrl" to row.optString("photo"))
                    }
                    val next = WidgetStateStore.payload(latest, WidgetGameModel.Game(gameId, result), identities,
                        System.currentTimeMillis() + latest.optLong("clockOffsetMs"))
                    next.put("widgetNotice", "הפעולה נשמרה").put("widgetFeedbackAtMs", System.currentTimeMillis())
                    WidgetStateStore.write(applicationContext, next)
                }
            }
        } catch (failure: Exception) {
            error = when (failure) {
                is WidgetTimerModel.Changed -> failure.message
                is WidgetTimerModel.NotController -> "פתחו את האפליקציה כדי לבדוק את ההתחברות והשליטה"
                else -> "לא התקבל אישור לפעולה. רעננו ובדקו את המצב"
            }
        } finally {
            synchronized(TeamderWidgetProvider.STATE_LOCK) {
                if (WidgetStateStore.pending(applicationContext)?.optString("command") == command) {
                    WidgetStateStore.prefs(applicationContext).edit().remove("widgetPending")
                        .putLong("widgetActionSerial", WidgetStateStore.actionSerial(applicationContext) + 1).apply()
                    val latest = WidgetStateStore.read(applicationContext)
                    if (current() && latest != null && error != null) {
                        latest.put("widgetError", error).put("widgetFeedbackAtMs", System.currentTimeMillis())
                        WidgetStateStore.write(applicationContext, latest)
                    }
                }
            }
            WidgetStateStore.refresh(applicationContext)
            WidgetRosterWorker.enqueue(applicationContext, gameId, uid, true)
            WidgetCommandReply.send(applicationContext, inputData.getString("sourceNodeId"), command,
                error == null, error ?: "הפעולה נשמרה", true)
        }
        return if (error == null) Result.success() else Result.failure()
    }

    companion object {
        /** Returns before any network call; the receiver never exceeds its lifetime. */
        fun receive(context: Context, intent: Intent) {
            val watch = intent.getStringExtra("origin") == "watch"
            val sourceNode = if (watch) intent.getStringExtra("sourceNodeId") else null
            val watchCommand = if (watch) intent.getStringExtra("commandId") else null
            fun reject(message: String) = WidgetCommandReply.send(context, sourceNode, watchCommand, false, message)
            val gameId = intent.getStringExtra("gameId").orEmpty()
            val uid = intent.getStringExtra("viewerId").orEmpty()
            val round = intent.getStringExtra("timerRoundId").orEmpty()
            val action = when (intent.getStringExtra("action")) {
                TimerActionReceiver.ACTION_START -> "start"
                TimerActionReceiver.ACTION_PAUSE -> "pause"
                TimerActionReceiver.ACTION_RESET -> "reset"
                else -> return
            }
            synchronized(TeamderWidgetProvider.STATE_LOCK) {
                val state = WidgetStateStore.read(context) ?: run { reject("פתחו את האפליקציה בטלפון ורעננו"); return }
                if (watch && (watchCommand.isNullOrBlank() || watchCommand.length > 128 || sourceNode.isNullOrBlank() ||
                    (System.currentTimeMillis() + state.optLong("clockOffsetMs") - intent.getLongExtra("issuedAtMs", 0)) !in -2_000..60_000 ||
                    (action == "reset" && !intent.getBooleanExtra("resetConfirmed", false)))) {
                    reject("הבקשה התיישנה או לא אושרה. רעננו ונסו שוב")
                    return
                }
                if (uid.isBlank() || round.isBlank() || WidgetStateStore.owner(state) != uid || state.optString("gameId") != gameId ||
                    state.optString("timerRoundId") != round || !state.optBoolean("canControl") || state.optString("kind") != "live" ||
                    intent.getLongExtra("widgetSession", -1) != WidgetStateStore.generation(context)) {
                    state.put("widgetError", "המידע השתנה. רעננו ונסו שוב")
                    WidgetStateStore.write(context, state)
                    WidgetStateStore.refresh(context)
                    reject("המשחק או החשבון השתנו. רעננו ונסו שוב")
                    return
                }
                if (WidgetStateStore.validPending(context, state)) {
                    if (WidgetStateStore.pending(context)?.optString("command") != watchCommand) reject("פעולה קודמת עדיין נשמרת")
                    return
                }
                state.remove("widgetError"); state.remove("widgetNotice"); state.remove("widgetFeedbackAtMs")
                WidgetStateStore.write(context, state)
                if (action == "reset" && !watch && !WidgetStateStore.armed(context, state)) {
                    WidgetStateStore.prefs(context).edit().putString("widgetResetArm", JSONObject().put("uid", uid)
                        .put("gameId", gameId).put("round", round).put("at", System.currentTimeMillis()).toString()).apply()
                    WidgetStateStore.refresh(context)
                    return
                }
                val command = watchCommand ?: UUID.randomUUID().toString()
                val at = System.currentTimeMillis()
                val request = OneTimeWorkRequest.Builder(WidgetTimerWorker::class.java).setInputData(Data.Builder()
                    .putString("gameId", gameId).putString("uid", uid).putString("round", round)
                    .putString("action", action).putString("command", command).putLong("at", at)
                    .putString("sourceNodeId", sourceNode)
                    .putLong("session", WidgetStateStore.generation(context)).build()).build()
                WidgetStateStore.prefs(context).edit().remove("widgetResetArm")
                    .putLong("widgetActionSerial", WidgetStateStore.actionSerial(context) + 1)
                    .putString("widgetPending", JSONObject().put("uid", uid).put("gameId", gameId).put("command", command).put("at", at).toString()).apply()
                try { WorkManager.getInstance(context).enqueueUniqueWork("widget-action:$uid:$gameId", ExistingWorkPolicy.APPEND_OR_REPLACE, request) }
                catch (error: Exception) {
                    WidgetStateStore.prefs(context).edit().remove("widgetPending").apply()
                    state.put("widgetError", "לא ניתן לשמור כרגע. נסו שוב")
                    WidgetStateStore.write(context, state)
                    reject("לא ניתן לשמור כרגע. נסו שוב")
                }
            }
            WidgetStateStore.refresh(context)
        }
    }
}

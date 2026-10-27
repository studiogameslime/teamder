package com.studiogameslime.soccerapp.widget

import android.content.Context
import androidx.work.*
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.studiogameslime.soccerapp.watch.WearTimerCommandService
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection

/** Durable upload does not depend on the React Native process being open. */
interface ActivityUploadBackend {
    fun userId(): String?
    fun send(payload: JSONObject, uid: String): JSONObject
    fun sourceMatches(chunk:JSONObject,uid:String):Boolean = false
    fun acknowledgeStandalone(chunk:JSONObject,uid:String){ error("Standalone acknowledgement is unavailable") }
    fun acknowledge(session: String, revision: Long, uid: String)
}

class PersonalActivityUploadWorker(context: Context, params: WorkerParameters, private val backend: ActivityUploadBackend) : Worker(context, params) {
    constructor(context: Context, params: WorkerParameters) : this(context, params, FirebaseActivityUploadBackend(context))
    override fun doWork(): Result {
        if (!com.studiogameslime.soccerapp.watch.SportsActivity.ENABLED) return Result.success()
        val uid = inputData.getString("uid") ?: return Result.failure()
        fun current() = !isStopped && backend.userId()==uid
        if(!current())return Result.success()
        data class Row(val prefs:android.content.SharedPreferences,val raw:String,val chunk:JSONObject)
        val queues=listOf("TeamderActivityInbox","TeamderStandaloneActivityInbox").map{applicationContext.getSharedPreferences(it,Context.MODE_PRIVATE)}
        val rows=synchronized(WearTimerCommandService.ACTIVITY_LOCK){queues.flatMap{prefs->
            prefs.all.filterKeys{it.startsWith("$uid:")}.values.filterIsInstance<String>().mapNotNull{raw->
                try{Row(prefs,raw,JSONObject(raw))}catch(_:Exception){null}
            }
        }.sortedWith(compareBy<Row>{it.chunk.optString("sessionId")}.thenBy{it.chunk.optLong("revision")})}
        fun rowCurrent(chunk:JSONObject):Boolean = current() && if(chunk.optString("mode")=="standalone")backend.sourceMatches(chunk,uid)
            else WidgetStateStore.owner(WidgetStateStore.read(applicationContext))==uid
        var deferred=false;var attempted=0;val blocked=mutableSetOf<String>()
        for(row in rows){
            if(!current())return Result.success()
            val chunk=row.chunk;val session=chunk.optString("sessionId");val revision=chunk.optLong("revision")
            if(session in blocked || !rowCurrent(chunk))continue // Obsolete generations remain quarantined, never replayed.
            if(++attempted>5)return Result.retry()
            try{
                require(chunk.optString("userId")==uid && session.matches(Regex("[A-Za-z0-9-]{1,80}")) && revision>0)
                val request=JSONObject(row.raw).put("expectedUid",uid)
                val response=backend.send(request,uid)
                if(!rowCurrent(chunk))return Result.success()
                if(response.optString("status") !in listOf("saved","duplicate")){deferred=true;blocked.add(session);continue}
                if(chunk.optString("mode")=="standalone")backend.acknowledgeStandalone(chunk,uid)
                else backend.acknowledge(session,revision,uid)
                if(!rowCurrent(chunk))return Result.success()
                synchronized(WearTimerCommandService.ACTIVITY_LOCK){
                    val key="$uid:$session:$revision"
                    if(row.prefs.getString(key,null)==row.raw)check(row.prefs.edit().remove(key).commit())
                }
            }catch(_:Exception){deferred=true;blocked.add(session)}
        }
        val hasRemaining=synchronized(WearTimerCommandService.ACTIVITY_LOCK){queues.any{prefs->
            prefs.all.filterKeys{it.startsWith("$uid:")}.values.filterIsInstance<String>().any{raw->try{rowCurrent(JSONObject(raw))}catch(_:Exception){false}}
        }}
        return if(deferred || hasRemaining)Result.retry() else Result.success()
    }

    companion object {
        fun enqueue(context: Context, uid: String) {
            if (!com.studiogameslime.soccerapp.watch.SportsActivity.ENABLED) return
            if (uid.isBlank()) return
            val work = OneTimeWorkRequest.Builder(PersonalActivityUploadWorker::class.java)
                .setInputData(Data.Builder().putString("uid", uid).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            val manager = WorkManager.getInstance(context)
            manager.enqueueUniqueWork("personal-activity:$uid", ExistingWorkPolicy.KEEP, work)
            // Recover the tiny finish/enqueue race without appending behind a retrying head.
            val recovery = PeriodicWorkRequest.Builder(PersonalActivityUploadWorker::class.java, 15, TimeUnit.MINUTES)
                .setInputData(Data.Builder().putString("uid", uid).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            manager.enqueueUniquePeriodicWork("personal-activity-recovery:$uid", ExistingPeriodicWorkPolicy.KEEP, recovery)
        }
    }
}

/** Only I/O is injectable. The worker's ordering, ownership fences and retention run unchanged in QA. */
class FirebaseActivityUploadBackend(private val context: Context) : ActivityUploadBackend {
    private var requestsSent=0
    private fun claimRequest(){check(++requestsSent<=5){"Upload request budget reached"}}
    override fun userId(): String? = FirebaseAuth.getInstance().currentUser?.takeUnless { it.isAnonymous }?.uid
    override fun acknowledge(session: String, revision: Long, uid: String) {
        require(userId() == uid)
        val ack = PutDataMapRequest.create("/teamder/activity-ack/$session/$revision").apply {
            dataMap.putString("userId", uid); dataMap.putLong("revision", revision)
        }.asPutDataRequest().setUrgent()
        Tasks.await(Wearable.getDataClient(context).putDataItem(ack), 10, TimeUnit.SECONDS)
    }
    override fun sourceMatches(chunk:JSONObject,uid:String):Boolean = userId()==uid && com.studiogameslime.soccerapp.watch.ActivitySourceStore.matches(context,chunk)
    override fun acknowledgeStandalone(chunk:JSONObject,uid:String) {
        com.studiogameslime.soccerapp.watch.StandaloneActivityInbox.acknowledge(context,uid,chunk.getString("sessionId"),chunk.getLong("revision"))
    }
    override fun send(payload: JSONObject, uid: String): JSONObject {
        if(payload.optString("mode")=="standalone"){
            for(request in com.studiogameslime.soccerapp.watch.StandaloneRecordBatch.requests(payload,uid)){
                require(sourceMatches(payload,uid))
                claimRequest()
                val response=com.studiogameslime.soccerapp.watch.ActivityNativeCallable.call("saveMyActivityRecords",request,uid)
                if(response.optString("status") !in listOf("saved","duplicate"))return response
                require(sourceMatches(payload,uid))
            }
            return JSONObject().put("status","saved")
        }
        val auth = FirebaseAuth.getInstance()
        val user = auth.currentUser ?: error("No session")
        require(user.uid == uid && !user.isAnonymous)
        val token = Tasks.await(user.getIdToken(false), 15, TimeUnit.SECONDS).token ?: error("No token")
        require(auth.currentUser?.uid == uid)
        val project = FirebaseApp.getInstance().options.projectId ?: error("No project")
        require(project.matches(Regex("[a-z0-9-]+")))
        claimRequest()
        val connection = URL("https://us-central1-$project.cloudfunctions.net/savePersonalActivity").openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 15_000; connection.readTimeout = 20_000
            connection.requestMethod = "POST"; connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.outputStream.use { it.write(JSONObject().put("data", payload).toString().toByteArray(Charsets.UTF_8)) }
            require(connection.responseCode == 200)
            val response = connection.inputStream.bufferedReader().use { it.readText() }
            require(response.length <= 80_000)
            val json = JSONObject(response)
            return json.optJSONObject("result") ?: json.optJSONObject("data") ?: error("No result")
        } finally { connection.disconnect() }
    }

}

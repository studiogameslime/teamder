package com.studiogameslime.soccerapp.watch

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection

/** Authenticated source binding is independent of the game's widget cache. */
object ActivitySourceStore {
    val executor = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val lock = Any()
    const val PATH = "/teamder/activity-source"
    fun readerId(context: Context): String = synchronized(lock) {
        val file=android.util.AtomicFile(java.io.File(context.noBackupFilesDir,"teamder_activity_reader"))
        try { return file.openRead().bufferedReader().use{it.readText()}.also{require(it.matches(Regex("[A-Za-z0-9-]{1,80}")))} }
        catch(_:java.io.FileNotFoundException){ }
        val id=UUID.randomUUID().toString();val stream=file.startWrite()
        try { stream.write(id.toByteArray(Charsets.UTF_8));file.finishWrite(stream) }
        catch(error:Exception){file.failWrite(stream);throw error}
        id
    }
    fun current(context: Context): JSONObject? = synchronized(lock) {
        val uid=FirebaseAuth.getInstance().currentUser?.takeUnless{it.isAnonymous}?.uid ?: return null
        val p=context.getSharedPreferences("TeamderActivitySource",0)
        p.getString("binding",null)?.let{JSONObject(it)}?.takeIf{it.optString("userId")==uid}
    }
    fun matches(context: Context, chunk: JSONObject): Boolean {
        val binding=current(context) ?: return false
        val source=binding.optJSONObject("source") ?: return false
        return chunk.optString("userId")==binding.optString("userId") &&
            chunk.optString("source")==source.optString("kind") && chunk.optString("deviceId")==source.optString("sourceId") &&
            chunk.optString("readerInstallationId")==source.optString("readerInstallationId") &&
            chunk.optString("readerInstallationId")==readerId(context) &&
            chunk.optString("connectionId")==source.optString("connectionId") &&
            chunk.optLong("sourceGeneration",-1)==binding.optLong("generation",-2)
    }
    fun refresh(context: Context): JSONObject {
        check(SportsActivity.ENABLED) { "Activity disabled" }
        val uid=FirebaseAuth.getInstance().currentUser?.takeUnless{it.isAnonymous}?.uid ?: error("No session")
        val result=ActivityNativeCallable.call("getMyActivityState",JSONObject().put("expectedUid",uid),uid)
        return accept(context,result.put("expectedUid",uid))
    }
    fun accept(context: Context, response: JSONObject): JSONObject {
        check(SportsActivity.ENABLED) { "Activity disabled" }
        val uid=response.optString("expectedUid")
        require(uid.isNotBlank() && FirebaseAuth.getInstance().currentUser?.uid==uid)
        val generation=response.optLong("generation",-1)
        require(generation>=0)
        val source=response.optJSONObject("source")
        if(source!=null) require(source.optLong("generation",-1)==generation && source.optString("connectionId").isNotBlank() &&
            source.optString("kind").isNotBlank() && source.optString("sourceId").isNotBlank() && source.optString("readerInstallationId").isNotBlank())
        val clock=PhoneServerClock.get()
        val binding=synchronized(lock){
        val previous=current(context)
        require(previous==null || generation>=previous.optLong("generation"))
        val prefs=context.getSharedPreferences("TeamderActivitySource",0)
        require(generation>=prefs.getLong("maxGeneration:$uid",-1))
        val publication=prefs.getLong("publication",0)+1
        require(FirebaseAuth.getInstance().currentUser?.uid==uid)
        val now=System.currentTimeMillis()+(clock?.offsetMs ?: 0.0)
        val next=JSONObject().put("protocol",1).put("userId",uid).put("generation",generation)
            .put("source",source ?: JSONObject.NULL).put("readerInstallationId",readerId(context)).put("publication",publication)
            .put("serverNowMs",now.toLong()).put("validUntilMs",if(clock!=null)(now+90_000).toLong() else 0)
        check(prefs.edit().putString("binding",next.toString()).putLong("publication",publication).putLong("maxGeneration:$uid",generation).commit())
        next
        }
        require(FirebaseAuth.getInstance().currentUser?.uid==uid)
        val request=PutDataMapRequest.create(PATH).apply{dataMap.putString("json",binding.toString())}.asPutDataRequest().setUrgent()
        Tasks.await(Wearable.getDataClient(context).putDataItem(request),10,TimeUnit.SECONDS)
        return binding
    }
    fun fenceAuth(context:Context){
        if (!SportsActivity.ENABLED) return
        val uid=FirebaseAuth.getInstance().currentUser?.takeUnless{it.isAnonymous}?.uid.orEmpty()
        val owner=context.getSharedPreferences("TeamderActivitySource",0).getString("binding",null)?.let{try{JSONObject(it).optString("userId")}catch(_:Exception){""}}.orEmpty()
        if(uid.isBlank() || (owner.isNotBlank() && owner!=uid))clear(context)
    }
    fun clear(context: Context) = synchronized(lock) {
        val p=context.getSharedPreferences("TeamderActivitySource",0)
        val publication=p.getLong("publication",0)+1
        p.edit().remove("binding").putLong("publication",publication).commit()
        val payload=JSONObject().put("protocol",1).put("userId","").put("generation",0).put("source",JSONObject.NULL)
            .put("readerInstallationId",readerId(context)).put("publication",publication).put("validUntilMs",0)
        Wearable.getDataClient(context).putDataItem(PutDataMapRequest.create(PATH).apply{dataMap.putString("json",payload.toString())}.asPutDataRequest().setUrgent())
        Unit
    }
}

/** Background callable transport; credentials never appear in logs or persisted chunks. */
object ActivityNativeCallable {
    fun call(endpoint: String, payload: JSONObject, uid: String): JSONObject {
        check(SportsActivity.ENABLED) { "Activity disabled" }
        require(endpoint in setOf("getMyActivityState","saveMyActivityRecords"))
        val auth=FirebaseAuth.getInstance();val user=auth.currentUser ?: error("No session")
        require(user.uid==uid && !user.isAnonymous)
        val token=Tasks.await(user.getIdToken(false),15,TimeUnit.SECONDS).token ?: error("No token")
        require(auth.currentUser?.uid==uid)
        val project=FirebaseApp.getInstance().options.projectId ?: error("No project")
        require(project.matches(Regex("[a-z0-9-]+")))
        val c=URL("https://us-central1-$project.cloudfunctions.net/$endpoint").openConnection() as HttpsURLConnection
        try {
            c.connectTimeout=15_000;c.readTimeout=20_000;c.requestMethod="POST";c.doOutput=true
            c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Authorization","Bearer $token")
            // App Check is optional only when its provider is absent; enforced endpoints reject missing tokens.
            try {
                val clazz=Class.forName("com.google.firebase.appcheck.FirebaseAppCheck")
                val instance=clazz.getMethod("getInstance").invoke(null)
                val task=clazz.getMethod("getAppCheckToken",Boolean::class.javaPrimitiveType).invoke(instance,false) as com.google.android.gms.tasks.Task<*>
                val result=Tasks.await(task,10,TimeUnit.SECONDS)
                val checkToken=if(result!=null)Class.forName("com.google.firebase.appcheck.AppCheckToken").getMethod("getToken").invoke(result) as? String else null
                if(!checkToken.isNullOrBlank()) c.setRequestProperty("X-Firebase-AppCheck",checkToken)
            } catch(_:Exception) { }
            require(auth.currentUser?.uid==uid)
            c.outputStream.use{it.write(JSONObject().put("data",payload).toString().toByteArray(Charsets.UTF_8))}
            require(c.responseCode==200)
            val text=c.inputStream.bufferedReader().use{it.readText()};require(text.length<=200_000)
            val json=JSONObject(text)
            return json.optJSONObject("result") ?: json.optJSONObject("data") ?: error("No result")
        } finally{c.disconnect()}
    }
}

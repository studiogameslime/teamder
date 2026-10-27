package com.studiogameslime.soccerapp.watch

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object StandaloneActivityInbox {
    const val PREFS="TeamderStandaloneActivityInbox"
    fun hash(raw: String): String = java.security.MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
    fun acknowledge(context: Context,uid: String,session: String,revision: Long) {
        require(session.matches(Regex("[A-Za-z0-9-]{1,80}")) && revision>0)
        val prefs=context.getSharedPreferences(PREFS,0);val key="$uid:$session:$revision"
        val raw=synchronized(WearTimerCommandService.ACTIVITY_LOCK){prefs.getString(key,null)} ?: return
        val chunk=JSONObject(raw)
        require(FirebaseAuth.getInstance().currentUser?.uid==uid && ActivitySourceStore.matches(context,chunk))
        val ack=PutDataMapRequest.create("/teamder/standalone-activity-ack/$session/$revision").apply{
            dataMap.putString("userId",uid);dataMap.putLong("revision",revision)
            dataMap.putLong("sourceGeneration",chunk.getLong("sourceGeneration"));dataMap.putString("connectionId",chunk.getString("connectionId"))
            dataMap.putString("deviceId",chunk.getString("deviceId"));dataMap.putString("readerInstallationId",chunk.getString("readerInstallationId"))
            dataMap.putString("sha256",hash(raw))
        }.asPutDataRequest().setUrgent()
        Tasks.await(Wearable.getDataClient(context).putDataItem(ack),10,TimeUnit.SECONDS)
        require(FirebaseAuth.getInstance().currentUser?.uid==uid && ActivitySourceStore.matches(context,chunk))
        synchronized(WearTimerCommandService.ACTIVITY_LOCK){
            if(prefs.getString(key,null)==raw) check(prefs.edit().remove(key).commit())
        }
    }
}

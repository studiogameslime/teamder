package com.studiogameslime.soccerapp.wear.activity

import android.content.Context
import androidx.compose.runtime.mutableStateOf
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.PutDataMapRequest
import org.json.JSONObject

object StandaloneSourceStore {
    const val PATH="/teamder/activity-source"
    val binding=mutableStateOf<ActivitySourceBinding?>(null)
    @Volatile var owner="";private set
    @Volatile var phoneNode="";private set
    @Synchronized fun accept(context:Context,json:String?,node:String) {
        if (!com.studiogameslime.soccerapp.wear.SportsActivity.ENABLED) return
        val prefs=context.getSharedPreferences("StandaloneSourceBinding",0)
        if(json==null){binding.value=null;owner="";phoneNode=node;prefs.edit().remove("payload").commit();return}
        try {
            val value=JSONObject(json)
            if(value.optInt("protocol")!=1)return
            val reader=value.optString("readerInstallationId");val publication=value.optLong("publication",-1)
            if(reader.isBlank() || publication<=0)return
            val previousReader=prefs.getString("reader","")
            if(reader==previousReader && node==prefs.getString("node","") && publication<prefs.getLong("publication",0))return
            if(reader==previousReader && node==prefs.getString("node","") && publication==prefs.getLong("publication",0) && json!=prefs.getString("payload",null))return
            val incomingOwner=value.optString("userId")
            val incomingGeneration=value.optLong("generation",-1)
            if(incomingOwner.isNotBlank() && incomingGeneration<prefs.getLong("generation:$incomingOwner",-1))return
            val announced=value.optJSONObject("source")
            val current=binding.value
            if(current!=null && current.userId==incomingOwner && current.sourceGeneration==incomingGeneration &&
                announced?.optString("connectionId")==current.connectionId && announced?.optString("readerInstallationId")==current.readerInstallationId &&
                reader!=current.readerInstallationId)return // An unselected phone cannot steal the selected reader's route.
            val editor=prefs.edit().putString("payload",json).putString("reader",reader).putLong("publication",publication).putString("node",node)
            if(incomingOwner.isNotBlank())editor.putLong("generation:$incomingOwner",incomingGeneration)
            check(editor.commit())
            owner=incomingOwner;phoneNode=node
            val source=value.optJSONObject("source")
            val selected=source?.takeIf{it.optString("kind")=="wear-health-services" && it.optString("sourceId")==ActivityJournal.deviceId(context) && it.optString("readerInstallationId")==reader}
            binding.value=selected?.let{ActivitySourceBinding(owner,it.optString("connectionId"),value.optLong("generation"),reader,
                it.optString("sourceId"),value.optLong("validUntilMs"),node)}?.takeIf{it.valid()}
            if(owner.isNotBlank())WearClockSync.request(context,node,owner)
            ActivityJournal(context).publish()
        }catch(_:Exception){ }
    }
    fun restore(context:Context){
        if (!com.studiogameslime.soccerapp.wear.SportsActivity.ENABLED) return
        val prefs=context.getSharedPreferences("StandaloneSourceBinding",0)
        val raw=prefs.getString("payload",null) ?: return
        if(binding.value==null)accept(context,raw,prefs.getString("node","").orEmpty())
    }
    private var requestedAt=0L
    @Synchronized fun request(context:Context){
        if (!com.studiogameslime.soccerapp.wear.SportsActivity.ENABLED) return
        if(phoneNode.isBlank() || owner.isBlank())return
        val now=android.os.SystemClock.elapsedRealtime()
        if(now-requestedAt<30_000)return
        requestedAt=now
        if(phoneNode.isNotBlank() && owner.isNotBlank())Wearable.getMessageClient(context).sendMessage(phoneNode,"/teamder/activity-source-request",JSONObject().put("userId",owner).toString().toByteArray())
    }
    fun announce(context:Context){
        if (!com.studiogameslime.soccerapp.wear.SportsActivity.ENABLED) return
        Wearable.getNodeClient(context).localNode.addOnSuccessListener{node->
            val id=ActivityJournal.deviceId(context)
            val body=JSONObject().put("deviceId",id).put("label",node.displayName).put("protocol",1)
            Wearable.getDataClient(context).putDataItem(PutDataMapRequest.create("/teamder/activity-device/$id").apply{dataMap.putString("json",body.toString())}.asPutDataRequest().setUrgent())
        }
    }
}

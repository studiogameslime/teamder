package com.studiogameslime.soccerapp.wear.activity

import org.json.JSONObject

object StandaloneAckFence {
    fun hash(raw:String):String = java.security.MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
    fun accepts(raw:String,session:String,revision:Long,ack:JSONObject):Boolean = try {
        val chunk=JSONObject(raw)
        chunk.optString("mode")=="standalone" && chunk.optString("sessionId")==session && chunk.optLong("revision",-1)==revision &&
            revision>0 && ack.optLong("revision",-1)==revision &&
            listOf("userId","connectionId","readerInstallationId","deviceId").all{chunk.optString(it).isNotBlank() && chunk.optString(it)==ack.optString(it)} &&
            chunk.optLong("sourceGeneration",-1)>0 && chunk.optLong("sourceGeneration",-1)==ack.optLong("sourceGeneration",-2) && hash(raw)==ack.optString("sha256")
    }catch(_:Exception){false}
}

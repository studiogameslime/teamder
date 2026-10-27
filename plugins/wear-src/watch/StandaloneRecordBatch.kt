package com.studiogameslime.soccerapp.watch

import org.json.JSONArray
import org.json.JSONObject

/** Same immutable ordering and IDs as the JS converter, including its activity envelope. */
object StandaloneRecordBatch {
    fun requests(chunk:JSONObject,uid:String):List<JSONObject>{
        require(chunk.optString("mode")=="standalone" && chunk.optString("source")=="wear-health-services" && chunk.getString("userId")==uid)
        val offset=chunk.getDouble("offsetMs");val uncertainty=chunk.getDouble("clockUncertaintyMs")
        require(offset.isFinite() && uncertainty.isFinite() && uncertainty in 0.0..60_000.0)
        val session=chunk.getString("sessionId");val revision=chunk.getLong("revision")
        require(session.matches(Regex("[A-Za-z0-9-]{1,80}")) && revision>0)
        val samples=chunk.getJSONArray("samples");require(samples.length() in 1..200)
        fun time(raw:Double):Long {require(raw.isFinite());return kotlin.math.floor(raw+offset+0.5).toLong()}
        var maxEnd=Double.NEGATIVE_INFINITY
        for(i in 0 until samples.length())maxEnd=maxOf(maxEnd,samples.getJSONObject(i).getDouble("endAtMs"))
        val modified=time(if(chunk.has("endedAtMs"))chunk.getDouble("endedAtMs") else maxEnd)
        val records=mutableListOf<JSONObject>()
        val mapping=listOf("distanceM" to "distance","steps" to "steps","calories" to "total-calories","heartRateBpm" to "heart-rate","speedMps" to "speed")
        for(i in 0 until samples.length()){
            val sample=samples.getJSONObject(i);val end=time(sample.getDouble("endAtMs"));val start=time(sample.getDouble("startAtMs"))
            require(end>=start)
            for((key,type) in mapping){
                if(!sample.has(key) || sample.isNull(key))continue
                val value=sample.getDouble(key);require(value.isFinite())
                records.add(JSONObject().put("id","$session:${sample.getString("id")}:$key").put("recordType",type)
                    .put("startAtMs",if(key=="heartRateBpm" || key=="speedMps")end else start).put("endAtMs",end).put("modifiedAtMs",modified).put("clockUncertaintyMs",uncertainty).put("value",value))
            }
        }
        if(modified>time(chunk.getDouble("startedAtMs")))records.add(JSONObject().put("id","$session:activity").put("recordType","activity").put("modifiedAtMs",modified).put("clockUncertaintyMs",uncertainty)
            .put("startAtMs",time(chunk.getDouble("startedAtMs"))).put("endAtMs",modified).put("activityType","football"))
        require(records.isNotEmpty())
        val binding=JSONObject().put("connectionId",chunk.getString("connectionId")).put("generation",chunk.getLong("sourceGeneration"))
            .put("kind","wear-health-services").put("sourceId",chunk.getString("deviceId")).put("readerInstallationId",chunk.getString("readerInstallationId"))
        return records.chunked(300).mapIndexed{part,rows->JSONObject().put("expectedUid",uid).put("binding",binding)
            .put("batchId","$session:$revision:$part").put("records",JSONArray(rows))}
    }
}

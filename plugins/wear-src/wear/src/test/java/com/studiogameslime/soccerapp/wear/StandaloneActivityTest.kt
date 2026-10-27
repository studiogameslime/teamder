package com.studiogameslime.soccerapp.wear

import com.studiogameslime.soccerapp.wear.activity.ActivitySourceBinding
import com.studiogameslime.soccerapp.wear.activity.StandaloneSessionPolicy
import com.studiogameslime.soccerapp.wear.activity.StandaloneAckFence
import com.studiogameslime.soccerapp.watch.StandaloneRecordBatch
import org.json.JSONObject
import org.json.JSONArray

fun main(){
 var count=0
 fun verify(name:String,value:Boolean){check(value){name};count++;println("PASS $name")}
 val source=ActivitySourceBinding("user","connection",3,"reader","device",91_000,"phone-node")
 verify("source is valid",source.valid())
 verify("source expires at its exact boundary",!source.fresh(91_000.0))
 verify("source permits a current independent recording",source.fresh(1000.0))
 verify("source cannot authorize an implausible future expiry",!source.fresh(-20_000.0))
 verify("renewal keeps immutable identity",source.sameSource(source.copy(validUntilMs=100_000)))
 verify("new generation fences old recorder",!source.sameSource(source.copy(sourceGeneration=4)))
 verify("new user fences old recorder",!source.sameSource(source.copy(userId="other")))
 verify("new connection fences old recorder",!source.sameSource(source.copy(connectionId="other")))
 verify("new reader fences old recorder",!source.sameSource(source.copy(readerInstallationId="other")))
 verify("new device fences old recorder",!source.sameSource(source.copy(deviceId="other")))
 verify("new phone node fences old recorder",!source.sameSource(source.copy(phoneNodeId="other")))
 verify("source removal fences old recorder",!source.sameSource(null))
 verify("source generation must be positive",!source.copy(sourceGeneration=0).valid())
 verify("start requires a fresh source",!StandaloneSessionPolicy.canStart(source,100_000.0))
 verify("offline workout continues after source freshness expires",StandaloneSessionPolicy.canContinue(source,source,1000,100_000))
 verify("offline workout continues beyond the old five-minute calibration refresh",StandaloneSessionPolicy.canContinue(source,source,1000,601_000))
 verify("a known generation replacement ends the old recording",!StandaloneSessionPolicy.canContinue(source,source.copy(sourceGeneration=4),1000,10_000))
 verify("a known signout ends the old recording",!StandaloneSessionPolicy.canContinue(source,null,1000,10_000))
 verify("a local workout is bounded to twelve hours",!StandaloneSessionPolicy.canContinue(source,source,1000,1000+StandaloneSessionPolicy.MAX_DURATION_MS))
 val samples=JSONArray()
 repeat(200){i->samples.put(JSONObject().put("id","s:$i").put("startAtMs",1000+i*1000).put("endAtMs",2000+i*1000)
   .put("distanceM",1).put("steps",1).put("calories",0.1).put("heartRateBpm",100))}
 val chunk=JSONObject().put("mode","standalone").put("source","wear-health-services").put("userId","user")
  .put("sessionId","session-a").put("revision",2).put("connectionId","connection").put("sourceGeneration",3)
  .put("readerInstallationId","reader").put("deviceId","device").put("offsetMs",0.5).put("clockUncertaintyMs",2)
  .put("startedAtMs",1000).put("samples",samples)
 val batches=StandaloneRecordBatch.requests(chunk,"user")
 verify("records split at 300 with one activity envelope",batches.map{it.getJSONArray("records").length()}==listOf(300,300,201))
 verify("part zero and stable revision identify the batch",batches.first().getString("batchId")=="session-a:2:0")
 val rows=batches.flatMap{batch->val arr=batch.getJSONArray("records");(0 until arr.length()).map{arr.getJSONObject(it)}}
 verify("metric order matches the JS converter",rows.take(4).map{it.getString("recordType")}==listOf("distance","steps","total-calories","heart-rate"))
 verify("record IDs bind the session",rows.first().getString("id")=="session-a:s:0:distanceM")
 verify("epoch rounding matches Math.round",rows.first().getLong("startAtMs")==1001L)
 verify("heart rate has a point timestamp",rows[3].getLong("startAtMs")==rows[3].getLong("endAtMs"))
 verify("activity envelope follows every metric",rows.last().getString("id")=="session-a:activity" && rows.last().getString("recordType")=="activity")
 verify("activity envelope starts at the session start",rows.last().getLong("startAtMs")==1001L)
 verify("activity type is explicit",rows.last().getString("activityType")=="football")
 verify("modified epoch is deterministic from sample end",rows.all{it.getLong("modifiedAtMs")==201001L})
 verify("retries preserve every payload",StandaloneRecordBatch.requests(JSONObject(chunk.toString()),"user").map{it.toString()}==batches.map{it.toString()})
 verify("source generation is sent in every part",batches.all{it.getJSONObject("binding").getLong("generation")==3L})
 verify("every record retains the measured clock uncertainty",rows.all{it.getDouble("clockUncertaintyMs")==2.0})
 verify("a new session cannot reuse record IDs",StandaloneRecordBatch.requests(JSONObject(chunk.toString()).put("sessionId","session-b"),"user").first().getJSONArray("records").getJSONObject(0).getString("id")!=rows.first().getString("id"))
 verify("ended timestamp overrides the last sample deterministically",StandaloneRecordBatch.requests(JSONObject(chunk.toString()).put("endedAtMs",202000),"user").first().getJSONArray("records").getJSONObject(0).getLong("modifiedAtMs")==202001L)
 verify("another account cannot convert this chunk",runCatching{StandaloneRecordBatch.requests(chunk,"other")}.isFailure)
 verify("round chunks stay on the round path",runCatching{StandaloneRecordBatch.requests(JSONObject(chunk.toString()).put("mode","round"),"user")}.isFailure)
 verify("empty samples never fabricate a zero activity",runCatching{StandaloneRecordBatch.requests(JSONObject(chunk.toString()).put("samples",JSONArray()),"user")}.isFailure)
 val point=JSONObject(chunk.toString()).put("startedAtMs",2000).put("samples",JSONArray().put(JSONObject().put("id","h:first").put("startAtMs",2000).put("endAtMs",2000).put("heartRateBpm",100)))
 verify("an initial heart point does not fabricate a zero-duration activity envelope",StandaloneRecordBatch.requests(point,"user").first().getJSONArray("records").length()==1)
 val speedPoint=JSONObject(point.toString()).put("samples",JSONArray().put(JSONObject().put("id","v:first").put("startAtMs",2000).put("endAtMs",2000).put("speedMps",0)))
 val speedRow=StandaloneRecordBatch.requests(speedPoint,"user").first().getJSONArray("records").getJSONObject(0)
 verify("speed is a point with measured zero, never a distance delta",speedRow.getString("recordType")=="speed" && speedRow.getDouble("value")==0.0 && speedRow.getLong("startAtMs")==speedRow.getLong("endAtMs"))
 verify("speed accepts a plausible sample",com.studiogameslime.soccerapp.wear.activity.ActivitySampleProtocol.valid(2000,2000,"speedMps",6.0))
 verify("speed rejects outliers and intervals",!com.studiogameslime.soccerapp.wear.activity.ActivitySampleProtocol.valid(2000,2000,"speedMps",13.0) && !com.studiogameslime.soccerapp.wear.activity.ActivitySampleProtocol.valid(2000,3000,"speedMps",6.0))
 verify("offline drift bounds may grow without losing a valid chunk",StandaloneRecordBatch.requests(JSONObject(chunk.toString()).put("clockUncertaintyMs",7000),"user").isNotEmpty())
 val raw=chunk.toString()
 val ack=JSONObject().put("revision",2).put("sourceGeneration",3).put("userId","user").put("connectionId","connection")
  .put("readerInstallationId","reader").put("deviceId","device").put("sha256",StandaloneAckFence.hash(raw))
 verify("only a matching server ACK permits raw chunk deletion",StandaloneAckFence.accepts(raw,"session-a",2,ack))
 for(key in listOf("userId","connectionId","readerInstallationId","deviceId","sha256"))verify("ACK rejects mismatched $key",!StandaloneAckFence.accepts(raw,"session-a",2,JSONObject(ack.toString()).put(key,"wrong")))
 verify("ACK rejects mismatched source generation",!StandaloneAckFence.accepts(raw,"session-a",2,JSONObject(ack.toString()).put("sourceGeneration",4)))
 verify("ACK rejects mismatched revision",!StandaloneAckFence.accepts(raw,"session-a",3,ack))
 verify("ACK cannot delete another session",!StandaloneAckFence.accepts(raw,"session-b",2,ack))
 verify("ACK cannot delete overwritten raw content",!StandaloneAckFence.accepts(JSONObject(raw).put("startedAtMs",999).toString(),"session-a",2,ack))
 System.getProperty("teamder.activityFixtureDir")?.let{path->
  val directory=java.io.File(path).apply{mkdirs()}
  val fixture=JSONObject(chunk.toString()).put("clockUncertaintyMs",7000)
  java.io.File(directory,"native-record-chunk.json").writeText(fixture.toString(2))
  java.io.File(directory,"native-record-batches.json").writeText(JSONArray(StandaloneRecordBatch.requests(fixture,"user")).toString(2))
 }
 println("$count standalone activity assertions passed")
}

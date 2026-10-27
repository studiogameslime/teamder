package com.studiogameslime.soccerapp.wear.activity

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

/** Immutable chunks are committed before publication. Acknowledgement alone removes them. */
class ActivityJournal(private val context: Context) {
    private val binding = ActivitySessionBinding()
    private val prefs = context.getSharedPreferences("TeamderExerciseJournal", Context.MODE_PRIVATE)
    fun begin(user: String, game: String, source: ActivitySourceBinding? = null): String = synchronized(LOCK) {
        check(binding.unbound()) { "A journal instance cannot start another session" }
        check(!prefs.contains("active")) { "Recover the interrupted session before beginning" }
        val session = UUID.randomUUID().toString()
        val metadata=JSONObject().put("userId",user)
        if(source!=null){
            require(source.valid() && source.userId==user)
            metadata.put("mode","standalone").put("connectionId",source.connectionId).put("sourceGeneration",source.sourceGeneration)
                .put("readerInstallationId",source.readerInstallationId).put("deviceId",source.deviceId)
        } else metadata.put("gameId",game)
        check(prefs.edit().putString("active", metadata
            .put("sessionId", session).put("revision", 1).put("startedAtMs", System.currentTimeMillis())
            .put("samples", JSONArray()).toString()).commit())
        check(binding.bind(session))
        return session
    }
    fun append(sample: JSONObject, clock: ActivityClock): Unit = synchronized(LOCK) {
        var active = prefs.getString("active", null)?.let { JSONObject(it) } ?: return
        if (!binding.matches(active.optString("sessionId"))) return
        if (active.getJSONArray("samples").length() > 0 &&
            (active.optDouble("offsetMs") != clock.offsetMs || active.optLong("clockMeasuredAtMs") != clock.measuredAtMs)) {
            flush(false)
            active = prefs.getString("active", null)?.let { JSONObject(it) } ?: return
            if (!binding.matches(active.optString("sessionId"))) return
        }
        val samples = active.getJSONArray("samples")
        samples.put(sample)
        // Calibration metadata is frozen with each chunk. A changed calibration starts a new chunk.
        active.put("offsetMs", clock.offsetMs).put("clockMeasuredAtMs", clock.measuredAtMs)
            .put("clockUncertaintyMs", maxOf(active.optDouble("clockUncertaintyMs", 0.0), clock.uncertaintyMs))
        check(prefs.edit().putString("active", active.toString()).commit())
        if (samples.length() >= 200) flush(false)
    }
    /** Only a newly leased service, before begin(), may seal data left by a dead process. */
    fun recoverInterrupted(): Unit = synchronized(LOCK) {
        check(binding.unbound())
        val active = prefs.getString("active", null)?.let { JSONObject(it) } ?: return
        val samples=active.getJSONArray("samples")
        val lastMeasured=(0 until samples.length()).mapNotNull{samples.optJSONObject(it)?.optLong("endAtMs")}.maxOrNull()
        // A dead process cannot account for time between the last sample and a later app launch.
        flushState(active, true, lastMeasured ?: active.optLong("startedAtMs"))
    }
    fun flush(ended: Boolean): Unit = synchronized(LOCK) {
        val active = prefs.getString("active", null)?.let { JSONObject(it) } ?: return
        if (!binding.matches(active.optString("sessionId"))) return
        flushState(active, ended)
    }
    private fun flushState(active: JSONObject, ended: Boolean, endedAtMs:Long=System.currentTimeMillis()) {
        if (active.getJSONArray("samples").length() > 0) {
            val chunk = JSONObject(active.toString()).put("protocol", 1).put("source", "wear-health-services")
                .put("deviceId", deviceId(context)).put("status", if (ended) "ended" else "recording")
            if (ended) chunk.put("endedAtMs", endedAtMs)
            val key = "chunk:${active.getString("sessionId")}:${active.getLong("revision")}"
            check(chunk.toString().toByteArray().size < 80_000)
            active.put("revision", active.getLong("revision") + 1).put("samples", JSONArray())
            val editor = prefs.edit().putString(key, chunk.toString())
            if (ended) editor.remove("active") else editor.putString("active", active.toString())
            check(editor.commit())
        } else if (ended) { prefs.edit().remove("active").commit() }
        publish()
    }
    fun publish() {
        if (!com.studiogameslime.soccerapp.wear.SportsActivity.ENABLED) return
        val owner = authorizedOwner.takeIf { android.os.SystemClock.elapsedRealtime() - authorizedAtRt in 0..90_000 }.orEmpty()
        val standalone=StandaloneSourceStore.binding.value
        val clock=WearClockSync.calibration?.takeIf{it.fresh(System.currentTimeMillis())}
        val sourceReady=standalone!=null && clock!=null && standalone.fresh(System.currentTimeMillis()+clock.offsetMs)
        prefs.all.filterKeys { it.startsWith("chunk:") }.values.forEach { raw ->
            if (raw !is String) return@forEach
            val chunk = JSONObject(raw)
            val independent=chunk.optString("mode")=="standalone"
            if(independent){
                if(!sourceReady || !matchesSource(chunk,standalone!!))return@forEach
            }else if(owner.isBlank() || chunk.optString("userId")!=owner)return@forEach
            val prefix=if(independent)"/teamder/standalone-activity" else "/teamder/activity"
            val path = "$prefix/${chunk.getString("sessionId")}/${chunk.getLong("revision")}"
            val request = PutDataMapRequest.create(path).apply { dataMap.putString("json", raw) }.asPutDataRequest().setUrgent()
            Wearable.getDataClient(context).putDataItem(request)
        }
    }
    fun acknowledge(session: String, revision: Long, userId: String): Unit = synchronized(LOCK) {
        val key = "chunk:$session:$revision"
        val chunk = prefs.getString(key, null)?.let { JSONObject(it) } ?: return
        if (chunk.optString("mode")=="standalone" || chunk.optString("userId") != userId) return
        prefs.edit().remove(key).commit()
        val uri = android.net.Uri.Builder().scheme("wear").authority("*").path("/teamder/activity/$session/$revision").build()
        Wearable.getDataClient(context).deleteDataItems(uri)
        Unit
    }
    companion object {
        private val LOCK = Any()
        fun deviceId(context:Context):String = synchronized(LOCK){
            val p=context.getSharedPreferences("TeamderExerciseJournal",0)
            p.getString("device",null) ?: UUID.randomUUID().toString().also{check(p.edit().putString("device",it).commit())}
        }
        @Volatile private var authorizedOwner = ""
        @Volatile private var authorizedAtRt = 0L
        fun authorizePayload(json: String?) {
            val clock = WearClockSync.calibration?.takeIf { it.fresh(System.currentTimeMillis()) }
            val value = try { json?.let { JSONObject(it) } } catch (_: Exception) { null }
            val confirmed = value?.optJSONObject("activity")?.optLong("confirmedAtMs")?.takeIf { it > 0 }
                ?: value?.optLong("serverNowMs") ?: 0
            val age = if (clock != null) System.currentTimeMillis() + clock.offsetMs - confirmed else Double.POSITIVE_INFINITY
            authorizedOwner = if (age in -2000.0..90_000.0) value?.optJSONObject("viewer")?.optString("id").orEmpty() else ""
            authorizedAtRt = android.os.SystemClock.elapsedRealtime()
        }
    }
    fun hasActive(): Boolean = prefs.contains("active")
    fun active(): JSONObject? = synchronized(LOCK) {
        prefs.getString("active", null)?.let { JSONObject(it) }?.takeIf { binding.matches(it.optString("sessionId")) }
    }
    fun acknowledgeStandalone(session:String,revision:Long,ack:com.google.android.gms.wearable.DataMap):Unit = synchronized(LOCK){
        val key="chunk:$session:$revision";val raw=prefs.getString(key,null) ?: return
        val proof=JSONObject().put("revision",ack.getLong("revision",-1)).put("sourceGeneration",ack.getLong("sourceGeneration",-1)).put("sha256",ack.getString("sha256"))
        listOf("userId","connectionId","readerInstallationId","deviceId").forEach{proof.put(it,ack.getString(it))}
        if(!StandaloneAckFence.accepts(raw,session,revision,proof))return
        check(prefs.edit().remove(key).commit())
        Wearable.getDataClient(context).deleteDataItems(android.net.Uri.Builder().scheme("wear").authority("*").path("/teamder/standalone-activity/$session/$revision").build())
        Unit
    }
    private fun matchesSource(chunk:JSONObject,source:ActivitySourceBinding):Boolean = chunk.optString("userId")==source.userId &&
        chunk.optString("connectionId")==source.connectionId && chunk.optLong("sourceGeneration",-1)==source.sourceGeneration &&
        chunk.optString("deviceId")==source.deviceId && chunk.optString("readerInstallationId")==source.readerInstallationId
}

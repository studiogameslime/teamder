package com.studiogameslime.soccerapp.widget

import android.app.Instrumentation
import android.content.Context
import android.os.Bundle
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class ActivityAuditBackend(private val context: Context) : ActivityUploadBackend {
    private fun prefs() = context.getSharedPreferences("ActivityAuditServer", Context.MODE_PRIVATE)
    override fun userId(): String? = prefs().getString("uid", null)
    override fun sourceMatches(chunk:JSONObject,uid:String):Boolean = chunk.optString("userId")==uid && chunk.optLong("sourceGeneration")==prefs().getLong("sourceGeneration",1)
    override fun acknowledgeStandalone(chunk:JSONObject,uid:String){acknowledge(chunk.getString("sessionId"),chunk.getLong("revision"),uid)}
    override fun send(payload: JSONObject, uid: String): JSONObject {
        val session = payload.getString("sessionId")
        val calls = JSONArray(prefs().getString("calls", "[]"))
        calls.put("$session:${payload.getLong("revision")}")
        prefs().edit().putString("calls", calls.toString()).commit()
        if (prefs().getBoolean("sendFailure", false)) error("Fixture send failure")
        if(prefs().getBoolean("switchSourceOnSend",false))prefs().edit().putLong("sourceGeneration",2).commit()
        if (prefs().getBoolean("switchOnSend", false)) prefs().edit().putString("uid", "qa-other").commit()
        return JSONObject().put("status", prefs().getString("status:$session", prefs().getString("status", "saved")))
    }
    override fun acknowledge(session: String, revision: Long, uid: String) {
        if (prefs().getBoolean("ackFailure", false)) error("Fixture ACK failure")
        val acks = JSONArray(prefs().getString("acks", "[]")); acks.put("$session:$revision")
        prefs().edit().putString("acks", acks.toString()).commit()
        if(prefs().getBoolean("switchSourceOnAck",false))prefs().edit().putLong("sourceGeneration",2).commit()
        if (prefs().getBoolean("switchOnAck", false)) prefs().edit().putString("uid", "qa-other").commit()
    }
}

object ActivityUploadAudit {
    fun run(instrumentation: Instrumentation, context: Context): Int {
        val manager = WorkManager.getInstance(context)
        val server = context.getSharedPreferences("ActivityAuditServer", Context.MODE_PRIVATE)
        val inbox = context.getSharedPreferences("TeamderActivityInbox", Context.MODE_PRIVATE)
        val standalone=context.getSharedPreferences("TeamderStandaloneActivityInbox",Context.MODE_PRIVATE)
        var count = 0
        fun seed() {
            server.edit().clear().putString("uid", "qa-owner").putString("calls", "[]").putString("acks", "[]").commit()
            inbox.edit().clear().commit();standalone.edit().clear().commit()
            WidgetStateStore.write(context, JSONObject().put("viewer", JSONObject().put("id", "qa-owner")))
        }
        fun chunk(session: String, revision: Long, user: String = "qa-owner") {
            val value = JSONObject().put("protocol", 1).put("userId", user).put("gameId", "qa-game")
                .put("sessionId", session).put("revision", revision).put("source", "wear-health-services")
                .put("samples", JSONArray().put(JSONObject().put("id", "d:100:200").put("startAtMs", 100).put("endAtMs", 200).put("distanceM", 4)))
            inbox.edit().putString("$user:$session:$revision", value.toString()).commit()
        }
        fun calls() = JSONArray(server.getString("calls", "[]"))
        fun acks() = JSONArray(server.getString("acks", "[]"))
        fun workInfo(id: UUID): WorkInfo? {
            val future = WorkManager::class.java.getMethod("getWorkInfoById", UUID::class.java).invoke(manager, id) as java.util.concurrent.Future<*>
            return future.get(20, TimeUnit.SECONDS) as? WorkInfo
        }
        fun run(): WorkInfo {
            val request = OneTimeWorkRequest.Builder(PersonalActivityUploadWorker::class.java)
                .setInputData(Data.Builder().putString("uid", "qa-owner").build()).build()
            manager.enqueue(request)
            val deadline = System.currentTimeMillis() + 90_000
            var value: WorkInfo? = null
            while (System.currentTimeMillis() < deadline) {
                value = workInfo(request.id)
                if (value != null && (value.state.isFinished || value.runAttemptCount > 0 && value.state == WorkInfo.State.ENQUEUED)) break
                Thread.sleep(50)
            }
            check(value != null && (value.state.isFinished || value.runAttemptCount > 0)) { "Upload worker timeout" }
            val operation = manager.cancelWorkById(request.id)
            val future = operation.javaClass.getMethod("getResult").invoke(operation) as java.util.concurrent.Future<*>
            future.get(20, TimeUnit.SECONDS)
            return value!!
        }
        fun test(name: String, body: () -> Unit) {
            seed(); body(); count++
            instrumentation.sendStatus(0, Bundle().apply { putString("stream", "PASS $name\n") })
        }
        test("activity saved requires ACK then removes exact chunk") {
            chunk("s1", 1); check(run().state == WorkInfo.State.SUCCEEDED); check(inbox.all.isEmpty()); check(acks().length() == 1)
        }
        test("activity duplicate safely ACKs an already saved revision") {
            chunk("s1", 1); server.edit().putString("status", "duplicate").commit(); run(); check(inbox.all.isEmpty()); check(acks().length() == 1)
        }
        test("activity processing retains raw chunk without ACK") {
            chunk("s1", 1); server.edit().putString("status", "processing").commit(); run(); check(inbox.all.size == 1); check(acks().length() == 0)
        }
        test("activity transport error retains raw chunk without ACK") {
            chunk("s1", 1); server.edit().putBoolean("sendFailure", true).commit(); run(); check(inbox.all.size == 1); check(acks().length() == 0)
        }
        test("activity ACK failure retains saved chunk for idempotent replay") {
            chunk("s1", 1); server.edit().putBoolean("ackFailure", true).commit(); run(); check(inbox.all.size == 1)
        }
        test("activity revisions upload in ascending order") {
            chunk("s1", 3); chunk("s1", 1); chunk("s1", 2); run(); check(calls().toString() == "[\"s1:1\",\"s1:2\",\"s1:3\"]")
        }
        test("blocked activity session does not erase or block other sessions") {
            chunk("a", 1); chunk("a", 2); chunk("b", 1); server.edit().putString("status:a", "processing").commit(); run()
            check(inbox.all.size == 2); check(!inbox.contains("qa-owner:b:1")); check(calls().length() == 2)
        }
        test("signed out activity never uploads or ACKs") {
            chunk("s1", 1); server.edit().remove("uid").commit(); run(); check(inbox.all.size == 1); check(calls().length() == 0)
        }
        test("activity owner mismatch never uploads") {
            chunk("s1", 1); WidgetStateStore.write(context, JSONObject().put("viewer", JSONObject().put("id", "qa-other")))
            run(); check(inbox.all.size == 1); check(calls().length() == 0)
        }
        test("logout during send prevents ACK and deletion") {
            chunk("s1", 1); server.edit().putBoolean("switchOnSend", true).commit(); run(); check(inbox.all.size == 1); check(acks().length() == 0)
        }
        test("logout during ACK prevents deletion") {
            chunk("s1", 1); server.edit().putBoolean("switchOnAck", true).commit(); run(); check(inbox.all.size == 1)
        }
        test("activity upload leaves another account queue untouched") {
            chunk("s1", 1); chunk("private", 1, "qa-other"); run(); check(inbox.all.size == 1); check(inbox.contains("qa-other:private:1"))
        }
        test("activity worker caps request count and retains remaining chunks") {
            for (revision in 1L..6L) chunk("s1", revision)
            run(); check(calls().length() == 5); check(inbox.all.size == 1 && inbox.contains("qa-owner:s1:6"))
        }
        fun independent(generation:Long=1,user:String="qa-owner"){
            val body=JSONObject().put("mode","standalone").put("userId",user).put("sourceGeneration",generation)
                .put("sessionId","standalone").put("revision",1)
            standalone.edit().putString("$user:standalone:1",body.toString()).commit()
        }
        test("standalone records upload without a current game widget"){
            independent();WidgetStateStore.write(context,JSONObject().put("viewer",JSONObject().put("id","")))
            run();check(standalone.all.isEmpty());check(acks().length()==1)
        }
        test("standalone obsolete source stays quarantined without upload or ACK"){
            independent(2);run();check(standalone.all.size==1);check(calls().length()==0);check(acks().length()==0)
        }
        test("standalone source replacement during send prevents ACK and deletion"){
            independent();server.edit().putBoolean("switchSourceOnSend",true).commit();run()
            check(standalone.all.size==1);check(acks().length()==0)
        }
        test("standalone source replacement during ACK retains the exact chunk"){
            independent();server.edit().putBoolean("switchSourceOnAck",true).commit();run();check(standalone.all.size==1)
        }
        test("standalone stale server result retains pending data"){
            independent();server.edit().putString("status","stale").commit();run();check(standalone.all.size==1);check(acks().length()==0)
        }
        test("standalone ACK failure retains saved data"){
            independent();server.edit().putBoolean("ackFailure",true).commit();run();check(standalone.all.size==1)
        }
        test("standalone another account remains private and untouched"){
            independent(user="qa-other");run();check(standalone.all.size==1);check(calls().length()==0)
        }
        return count
    }
}

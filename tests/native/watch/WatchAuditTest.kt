package audit

import com.studiogameslime.soccerapp.wear.model.*
import org.json.JSONObject

fun main() {
 var passed=0
 fun test(name: String, body: () -> Unit) { body(); passed++; println("PASS $name") }
 fun payload(running: Boolean=true): JSONObject = JSONObject().put("kind","live").put("gameId","game")
  .put("canControl",true).put("timerRoundId","rotation:first").put("viewer",JSONObject().put("id","owner"))
  .put("serverNowMs",System.currentTimeMillis()-120_000).put("clockOffsetMs",0)
  .put("timer",JSONObject().put("running",running).put("baseElapsedMs",30_000).put("accumulatedMs",30_000))
 test("running cached payload adds two minutes since publish") {
  val state=parseWearState(payload().toString()) as WearGameState.Live
  check(state.timer.baseElapsedMs in 150_000L..152_000L)
 }
 test("paused cached payload does not add wall time") {
  check((parseWearState(payload(false).toString()) as WearGameState.Live).timer.baseElapsedMs==30_000L)
 }
 test("old-phone timer reconstructs from epoch") {
  val p=payload();p.getJSONObject("timer").remove("baseElapsedMs")
  p.getJSONObject("timer").put("lastStartedAt",System.currentTimeMillis()-20_000)
  check((parseWearState(p.toString()) as WearGameState.Live).timer.baseElapsedMs in 50_000L..52_000L)
 }
 test("malformed JSON safely becomes disconnected") { check(parseWearState("bad") is WearGameState.Disconnected) }
 test("logout payload clears live state") { check(parseWearState("{\"kind\":\"notRegistered\"}") is WearGameState.NotRegistered) }
 test("cached live state older than three hours expires on parse") {
  check(parseWearStateFresh(payload().toString(),System.currentTimeMillis()-4*3600_000L) is WearGameState.Disconnected)
 }
 test("audit: missing freshness timestamp keeps a four-hour old live state") {
  val p=payload().put("serverNowMs",System.currentTimeMillis()-4*3600_000L)
  check(parseWearStateFresh(p.toString(),0) is WearGameState.Live)
 }
 test("audit: a future phone timestamp bypasses three-hour expiry") {
  check(parseWearStateFresh(payload().toString(),System.currentTimeMillis()+24*3600_000L) is WearGameState.Live)
 }
 test("audit: live model drops round, owner and roster sent by the phone") {
  val p=payload().put("players",org.json.JSONArray().put(JSONObject().put("id","p").put("name","player")))
  val s=parseWearState(p.toString()) as WearGameState.Live
  val fields=s.javaClass.declaredFields.map{it.name}
  check("gameId" in fields && listOf("timerRoundId","viewer","players").none{it in fields})
 }
 test("audit: waiting registration is not represented in upcoming model") {
  val s=parseWearState("{\"kind\":\"upcoming\",\"registration\":\"waitlist\",\"players\":[]}") as WearGameState.Upcoming
  check(s.javaClass.declaredFields.none{it.name=="registration"})
 }
 test("audit: one malformed player discards the entire upcoming card") {
  check(parseWearState("{\"kind\":\"upcoming\",\"players\":[null]}") is WearGameState.Disconnected)
 }
 fun game(live: Map<String,Any?>,extra: Map<String,Any?> = emptyMap()): Map<String,Any?> =
  mapOf("status" to "active","createdBy" to "owner","liveMatch" to live)+extra
 fun live(running: Boolean=false)= mapOf<String,Any?>("phase" to "live","roundNumber" to 2L,"timerRunning" to running,
  "timerLastStartedAt" to if(running) 12_000L else 0L,"timerAccumulatedMs" to 1000L,
  "scoreA" to 1L,"goals" to listOf(mapOf("scorerId" to "p")),"goalTally" to mapOf("p" to 4L))
 test("audit: command for an older round resets the new round on first read") {
  // Wire command has no expected round; the actual original transaction binds only after reading round 2.
  val written=legacy(game(live()),ACTION_RESET,20_000)!!["liveMatch"] as Map<*,*>
  check((written["goals"] as List<*>).isEmpty() && written["roundNumber"]==2L)
 }
 test("audit: a pause captured before concurrent start records a backwards interval") {
  val written=legacy(game(live(true)),ACTION_PAUSE,10_000)!!["liveMatch"] as Map<*,*>
  val interval=(written["activeIntervals"] as List<*>).last() as Map<*,*>
  check((interval["e"] as Long)<(interval["s"] as Long))
 }
 test("saved rotation round blocks a legacy action") {
  check(legacy(game(live(),mapOf("rotation" to mapOf("roundInstanceId" to "saved"),"lastCommittedRoundId" to "saved")),ACTION_RESET,20_000)==null)
 }
 test("terminal evening blocks legacy action") { check(legacy(game(live(),mapOf("status" to "finished")),ACTION_START,20_000)==null) }
 test("repeated start is a no-op") { check(legacy(game(live(true)),ACTION_START,20_000)==null) }
 test("reset preserves previously credited goals and clears in-play penalties") {
  val written=legacy(game(live()+mapOf("inPlayPenalties" to listOf(mapOf("id" to "pen")))),ACTION_RESET,20_000)!!["liveMatch"] as Map<*,*>
  check((written["goalTally"] as Map<*,*>)["p"]==3L && (written["inPlayPenalties"] as List<*>).isEmpty())
 }
 println("$passed watch audit cases passed; audit-prefixed cases reproduce existing defects, not fixes.")
}

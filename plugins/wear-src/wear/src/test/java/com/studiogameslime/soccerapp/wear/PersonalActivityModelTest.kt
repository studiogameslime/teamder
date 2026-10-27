package com.studiogameslime.soccerapp.wear
import com.studiogameslime.soccerapp.wear.activity.ActivityClock
import com.studiogameslime.soccerapp.wear.activity.ActivityGate
import com.studiogameslime.soccerapp.wear.activity.ActivitySampleProtocol
import com.studiogameslime.soccerapp.wear.activity.ActivitySampleCursor
import com.studiogameslime.soccerapp.wear.activity.ExerciseLifecycleLease
import com.studiogameslime.soccerapp.wear.activity.ActivitySessionBinding
import com.studiogameslime.soccerapp.wear.activity.NullableFutureCallback

fun main() {
    var checks = 0
    fun verify(label: String, condition: Boolean) { check(condition) { label }; checks++; println("PASS $label") }
    val gate = ActivityGate()
    verify("closed before eligible state", !gate.accepts(100, 200))
    gate.update(100, true, 500, "r1")
    verify("whole interval accepted", gate.accepts(100, 200))
    gate.update(250, false, 250, "r1")
    verify("interval crossing pause rejected", !gate.accepts(200, 300))
    verify("interval ending on pause accepted", gate.accepts(200, 250))
    verify("heart rate on pause excluded", !gate.accepts(250, 250, true))
    gate.update(400, true, 600, "r1")
    verify("bench gap not interpolated", !gate.accepts(200, 500))
    verify("resumed interval accepted", gate.accepts(400, 500))
    verify("expiry fails closed", !gate.accepts(599, 601))
    gate.update(550, true, 800, "r2")
    verify("round transition intervals do not merge", !gate.accepts(500, 600))
    verify("negative interval rejected", !gate.accepts(600, 500))
    val clock = ActivityClock.resolve(1000, 6100, 6120, 1220, 250.0)!!
    verify("four clock timestamps offset", clock.offsetMs == 5000.0)
    verify("clock uncertainty half wire plus bound", clock.uncertaintyMs == 350.0)
    verify("negative RTT rejected", ActivityClock.resolve(1000, 1100, 1500, 1200, 10.0) == null)
    verify("slow RTT rejected", ActivityClock.resolve(1000, 1100, 1100, 6000, 10.0) == null)
    verify("calibration expires", !clock.fresh(400_000))
    verify("unknown phone uncertainty rejected", ActivityClock.resolve(1000, 1100, 1100, 1200, Double.POSITIVE_INFINITY) == null)
    verify("negative phone uncertainty rejected", ActivityClock.resolve(1000, 1100, 1100, 1200, -1.0) == null)
    verify("protocol accepts valid measured distance", ActivitySampleProtocol.valid(100, 1100, "distanceM", 4.0))
    verify("protocol rejects high heart rate without clamping", !ActivitySampleProtocol.valid(100, 100, "heartRateBpm", 241.0))
    verify("protocol accepts maximum heart rate", ActivitySampleProtocol.valid(100, 100, "heartRateBpm", 240.0))
    verify("protocol rejects fractional steps", !ActivitySampleProtocol.valid(100, 200, "steps", 1.5))
    verify("protocol rejects oversized step delta", !ActivitySampleProtocol.valid(100, 200, "steps", 2001))
    verify("protocol rejects oversized distance delta", !ActivitySampleProtocol.valid(100, 200, "distanceM", 4001))
    verify("protocol rejects oversized calories delta", !ActivitySampleProtocol.valid(100, 200, "calories", 301))
    verify("protocol rejects zero duration distance", !ActivitySampleProtocol.valid(100, 100, "distanceM", 1))
    verify("protocol rejects long delta", !ActivitySampleProtocol.valid(100, 300101, "distanceM", 1))
    verify("protocol rejects missing sensor value", !ActivitySampleProtocol.valid(100, 200, "distanceM", Double.NaN))
    verify("protocol rejects implausible distance rate", !ActivitySampleProtocol.valid(100, 200, "distanceM", 4.0))
    verify("protocol rejects implausible step rate", !ActivitySampleProtocol.valid(100, 1100, "steps", 6))
    verify("protocol rejects implausible calorie rate", !ActivitySampleProtocol.valid(100, 1100, "calories", 2))
    val cursor = ActivitySampleCursor()
    verify("cursor accepts first delta", cursor.claim("distanceM", 100.0, 200.0, false))
    verify("cursor rejects overlapping delta", !cursor.claim("distanceM", 199.0, 300.0, false))
    verify("cursor accepts touching delta", cursor.claim("distanceM", 200.0, 300.0, false))
    verify("cursor separates metrics", cursor.claim("steps", 100.0, 200.0, false))
    verify("cursor accepts first heart sample", cursor.claim("heartRateBpm", 150.0, 150.0, true))
    verify("cursor rejects duplicate heart sample", !cursor.claim("heartRateBpm", 150.0, 150.0, true))
    verify("cursor rejects older heart sample", !cursor.claim("heartRateBpm", 140.0, 140.0, true))
    val lease = ExerciseLifecycleLease()
    val old = lease.acquire()
    verify("first recorder acquires lifecycle lease", old != null)
    verify("new recorder rejected while old cleanup is pending", lease.acquire() == null)
    verify("wrong generation cannot release old cleanup", !lease.release(old!! + 1))
    verify("wrong release leaves old recorder owner", lease.owns(old))
    val oldJournal = ActivitySessionBinding()
    verify("journal binds its first session", oldJournal.bind("old-session"))
    verify("journal cannot rebind to a new session", !oldJournal.bind("new-session"))
    verify("old journal can address only its own active session", oldJournal.matches("old-session"))
    verify("unbound journal cannot mutate existing active data", !ActivitySessionBinding().matches("old-session"))
    verify("finished cleanup releases exact lease", lease.release(old))
    val replacement = lease.acquire()
    verify("replacement generation acquired after cleanup", replacement != null && replacement != old)
    verify("late old cleanup cannot release replacement", !lease.release(old))
    verify("replacement remains owner after late old cleanup", lease.owns(replacement))
    val newJournal = ActivitySessionBinding()
    verify("new journal binds its distinct session", newJournal.bind("new-session"))
    verify("old append or flush cannot address new persisted session", !oldJournal.matches("new-session"))
    verify("new journal cannot address old persisted session", !newJournal.matches("old-session"))
    verify("replacement cleanup releases replacement lease", lease.release(replacement))
    verify("null lease never owns or releases recorder", !lease.owns(null) && !lease.release(null))
    val concurrent = ExerciseLifecycleLease()
    val barrier = java.util.concurrent.CountDownLatch(1)
    val owners = arrayOfNulls<Long>(2)
    val attempts = (0..1).map { index -> Thread { barrier.await(); owners[index] = concurrent.acquire() }.also { it.start() } }
    barrier.countDown(); attempts.forEach { it.join(10_000) }
    verify("concurrent start attempts produce exactly one owner", attempts.none { it.isAlive } && owners.count { it != null } == 1)
    verify("concurrent winner is the current owner", concurrent.owns(owners.first { it != null }))
    var voidCalls = 0
    val voidCallback = NullableFutureCallback<Void>({ result ->
        verify("successful Void callback preserves null", result == null)
        voidCalls++
    }, { error("unexpected failure") })
    voidCallback.onSuccess(null)
    verify("successful Void callback invokes completion exactly once", voidCalls == 1)
    var textResult: String? = "unset"
    var failureResult: Throwable? = null
    val typedCallback = NullableFutureCallback<String>({ textResult = it }, { failureResult = it })
    typedCallback.onSuccess("sensor-ready")
    verify("typed callback preserves non-null result", textResult == "sensor-ready")
    typedCallback.onSuccess(null)
    verify("typed callback exposes unexpected null for caller validation", textResult == null)
    val sensorError = IllegalStateException("sensor unavailable")
    typedCallback.onFailure(sensorError)
    verify("failed callback preserves the original error", failureResult === sensorError)
    println("$checks activity model assertions passed")
}

import com.studiogameslime.soccerapp.phoneactivity.PhoneMovement
import kotlin.math.abs

fun main() {
    fun fix(e: PhoneMovement, t: Long, v: Double, accuracy: Double = 5.0, speedAccuracy: Double = 0.5, now: Long = t) =
        e.add(PhoneMovement.Sample(t, v, accuracy, speedAccuracy), now)
    fun near(actual: Double?, expected: Double) = check(actual != null && abs(actual - expected) < 0.00001) { "$actual != $expected" }
    val e = PhoneMovement()
    check(e.peak == null && e.current(0) == null && e.measuredMs == 0L)
    fix(e, 1000, 6.0); check(e.peak == null && e.sprints == 0)
    fix(e, 2000, 6.0); fix(e, 3000, 6.0)
    check(e.sprints == 1 && e.sprintMs == 2000L && e.sprinting(3000))
    fix(e, 4000, 6.0); check(e.sprints == 1 && e.sprintMs == 3000L)
    near(e.distance, 18.0); near(e.peak, 6.0)
    fix(e, 5000, 1.0); fix(e, 6000, 6.0); fix(e, 7000, 6.0)
    check(e.sprints == 1); fix(e, 8000, 6.0); check(e.sprints == 2)
    check(e.current(11001) == null && !e.sprinting(11001))
    val gap = PhoneMovement()
    fix(gap, 1000, 6.0); fix(gap, 2000, 6.0); fix(gap, 6000, 6.0); fix(gap, 7000, 6.0)
    check(gap.sprints == 0 && gap.measuredMs == 2000L); near(gap.distance, 12.0)
    fix(gap, 8000, 6.0, accuracy = 21.0); fix(gap, 9000, 6.0); fix(gap, 10000, 6.0)
    check(gap.sprints == 0 && gap.measuredMs == 3000L && gap.rejected == 1)
    val noise = PhoneMovement()
    fix(noise, 1000, 1.0); fix(noise, 2000, 11.0); fix(noise, 3000, 1.0)
    check(noise.sprints == 0); near(noise.peak, 1.0)
    val invalid = PhoneMovement()
    fix(invalid, 1000, Double.NaN); fix(invalid, 2000, -1.0); fix(invalid, 3000, 12.1)
    fix(invalid, 4000, 6.0, speedAccuracy = Double.NaN); fix(invalid, 5000, 6.0, speedAccuracy = 1.51)
    fix(invalid, 6000, 6.0, accuracy = Double.NaN)
    check(invalid.accepted == 0 && invalid.rejected == 6 && invalid.peak == null)
    fix(invalid, 900000, 6.0, now = 7000); fix(invalid, 7000, 1.0)
    fix(invalid, 7000, 6.0); fix(invalid, 6500, 6.0); fix(invalid, 8000, 1.0)
    check(invalid.accepted == 2 && invalid.measuredMs == 1000L); near(invalid.peak, 1.0)
    val stale = PhoneMovement(); fix(stale, 1000, 6.0, now = 6001); check(stale.accepted == 0)
    val stop = PhoneMovement(); fix(stop, 1000, 0.0); fix(stop, 2000, 0.0)
    near(stop.peak, 0.0); near(stop.distance, 0.0); check(stop.measuredMs == 1000L)
    repeat(200) { fix(stop, 3000L + it * 1000, 1.0) }; check(stop.graph.size == 120)
    println("PhoneMovement: all native assertions passed (sprint threshold/duration, gaps, invalid data, replay, peak confirmation, distance, stale UI, graph bound)")
}

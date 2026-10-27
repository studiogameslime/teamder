package com.studiogameslime.soccerapp.watch

import android.os.SystemClock
import com.google.firebase.FirebaseApp
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Public read-only clock endpoint, bounded RTT probes; never a game or identity mutation. */
object PhoneServerClock {
    data class Anchor(val offsetMs: Double, val uncertaintyMs: Double, val measuredRt: Long, val bootEpoch: Long)
    private var cached: Anchor? = null
    @Synchronized fun get(): Anchor? {
        val nowRt = SystemClock.elapsedRealtime()
        val boot = System.currentTimeMillis() - nowRt
        cached?.let { old ->
            if (nowRt - old.measuredRt in 0..120_000 && kotlin.math.abs(boot - old.bootEpoch) <= 100) return old
        }
        val project = FirebaseApp.getInstance().options.projectId ?: return null
        if (!project.matches(Regex("[a-z0-9-]+"))) return null
        var best: Anchor? = null
        repeat(3) {
            var connection: HttpsURLConnection? = null
            try {
                val sentRt = SystemClock.elapsedRealtime()
                val sentWall = System.currentTimeMillis()
                connection = URL("https://us-central1-$project.cloudfunctions.net/getServerTime").openConnection() as HttpsURLConnection
                connection!!.connectTimeout = 2000; connection!!.readTimeout = 2000
                connection!!.requestMethod = "POST"; connection!!.doOutput = true
                connection!!.setRequestProperty("Content-Type", "application/json")
                connection!!.outputStream.use { it.write("{\"data\":{}}".toByteArray()) }
                if (connection!!.responseCode != 200) return@repeat
                val text = connection!!.inputStream.bufferedReader().use { it.readText() }
                if (text.length > 4096) return@repeat
                val receivedWall = System.currentTimeMillis()
                val receivedRt = SystemClock.elapsedRealtime()
                val rtt = receivedRt - sentRt
                if (rtt !in 0..3000 || kotlin.math.abs((receivedWall - sentWall) - rtt) > 100) return@repeat
                val response = JSONObject(text)
                val result = response.optJSONObject("result") ?: response.optJSONObject("data") ?: return@repeat
                val serverNow = result.optLong("now", 0)
                if (serverNow <= 0) return@repeat
                val value = Anchor(serverNow - (sentWall + receivedWall) / 2.0, rtt / 2.0 + 1.0, receivedRt, receivedWall - receivedRt)
                if (best == null || value.uncertaintyMs < best!!.uncertaintyMs) best = value
            } catch (_: Exception) { }
            finally { connection?.disconnect() }
        }
        cached = best
        return best
    }
    fun uncertaintyNow(anchor: Anchor): Double = anchor.uncertaintyMs +
        (SystemClock.elapsedRealtime() - anchor.measuredRt).coerceAtLeast(0) * 0.0001
}

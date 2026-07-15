package com.studiogameslime.soccerapp.watch

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONArray
import org.json.JSONObject

/**
 * Phone-side receiver for physical-session data recorded ON THE WATCH.
 *
 * The Galaxy Watch app records a live match with its own sensors via Wear
 * Health Services (steps / distance / calories / speed / heart-rate) — NOT
 * Health Connect — so it needs no `android.permission.health.*` and doesn't
 * trip Google Play's Health-apps declaration gate. When the match ends the
 * watch's `WearPhysicalSender` sends the totals here as a single MessageClient
 * message at [PHYSICAL_PATH] whose payload is a JSON object
 * `{ gameId, distanceM, steps, calories, topSpeedKmh, avgSpeedKmh, sprints,
 *    avgHr, maxHr, effortScore, source:"wear" }`.
 *
 * We CAN'T write to Firestore here — that needs the signed-in user's auth,
 * which only the React-Native JS process holds, and the app may not even be
 * running when the watch sends. So we QUEUE the session in SharedPreferences.
 * `WatchBridgeModule.consumePendingPhysical()` drains the queue the next time
 * the app is foregrounded (the evening-summary screen calls it), and the JS
 * side persists each entry via the `saveGamePhysical` callable — signed as the
 * authenticated user, the single canonical write path.
 *
 * The queue is a bounded JSON array keyed per gameId (a newer session for the
 * same game replaces the older one), capped so a phone that never opens the app
 * can't accumulate unbounded pending sessions.
 */
class WearPhysicalService : WearableListenerService() {

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != PHYSICAL_PATH) return
        val raw = String(event.data, Charsets.UTF_8)
        val obj = try {
            JSONObject(raw)
        } catch (e: Exception) {
            Log.w(TAG, "malformed physical payload", e)
            return
        }
        val gameId = obj.optString("gameId").trim()
        if (gameId.isEmpty()) {
            Log.w(TAG, "physical payload without gameId; dropping")
            return
        }
        enqueue(this, gameId, obj)
    }

    companion object {
        private const val TAG = "WearPhysical"
        private const val PHYSICAL_PATH = "/teamder/physical"

        /** Own prefs file (distinct from the widget's) so the two never race. */
        const val PREFS = "TeamderWatchPhysical"
        const val KEY_QUEUE = "pending"

        /** Never keep more than this many pending sessions (one per game). */
        private const val MAX_PENDING = 20

        private val LOCK = Any()

        /**
         * Append (or replace-by-gameId) a session in the pending queue.
         * Synchronized so the Data-Layer callback thread and a concurrent JS
         * drain don't clobber each other's read-modify-write.
         */
        private fun enqueue(context: Context, gameId: String, session: JSONObject) {
            synchronized(LOCK) {
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                val arr = try {
                    JSONArray(prefs.getString(KEY_QUEUE, "[]"))
                } catch (_: Exception) {
                    JSONArray()
                }
                // metrics = the payload minus gameId (the callable takes a
                // separate gameId + a metrics bag).
                val metrics = JSONObject(session.toString())
                metrics.remove("gameId")

                // The queue holds one entry per game. If a session for this game
                // is already queued (e.g. the watch re-sent, or a rare mid-match
                // restart produced a second shorter recording), keep whichever
                // reports the LARGER totals — never let a shorter partial
                // overwrite a fuller session. Weight distance first, then steps.
                var best = metrics
                val out = JSONArray()
                for (i in 0 until arr.length()) {
                    val e = arr.optJSONObject(i) ?: continue
                    if (e.optString("gameId") != gameId) {
                        out.put(e)
                    } else {
                        val existing = e.optJSONObject("metrics")
                        if (existing != null && magnitude(existing) > magnitude(best)) {
                            best = existing
                        }
                    }
                }
                out.put(JSONObject().put("gameId", gameId).put("metrics", best))
                // Trim oldest-first if we somehow exceed the cap.
                val trimmed = if (out.length() > MAX_PENDING) {
                    val t = JSONArray()
                    for (i in (out.length() - MAX_PENDING) until out.length()) {
                        t.put(out.get(i))
                    }
                    t
                } else {
                    out
                }
                prefs.edit().putString(KEY_QUEUE, trimmed.toString()).apply()
                Log.i(TAG, "queued physical for $gameId (${trimmed.length()} pending)")
            }
        }

        /** Comparable "size" of a session: distance dominates, steps break ties.
         *  Used to keep the fuller of two sessions for the same game. */
        private fun magnitude(metrics: JSONObject): Double =
            metrics.optDouble("distanceM", 0.0) * 1_000_000.0 +
                metrics.optDouble("steps", 0.0)

        /** Read + clear the pending queue. Returns the JSON array string
         *  `[{gameId, metrics}]` (or "[]"). Called by WatchBridgeModule. */
        fun drain(context: Context): String = synchronized(LOCK) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString(KEY_QUEUE, "[]") ?: "[]"
            prefs.edit().remove(KEY_QUEUE).apply()
            json
        }
    }
}

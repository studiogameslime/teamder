package com.studiogameslime.soccerapp.widget

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import java.util.concurrent.TimeUnit

/** Network boundary: production uses the signed-in native Firebase session.
 * Android instrumentation supplies a local deterministic backend, never production writes. */
interface WidgetBackend {
    fun userId(): String?
    fun games(uid: String, floor: Long): List<WidgetGameModel.Game>
    fun identities(ids: List<String>): Map<String, Map<String, Any?>>
    fun mutate(gameId: String, uid: String, round: String, action: String, name: String, command: String, now: () -> Long): Map<String, Any?>
}

class FirebaseWidgetBackend : WidgetBackend {
    override fun userId(): String? = FirebaseAuth.getInstance().currentUser?.takeUnless { it.isAnonymous }?.uid
    override fun games(uid: String, floor: Long): List<WidgetGameModel.Game> {
        val col = FirebaseFirestore.getInstance().collection("games")
        val tasks = listOf(col.whereArrayContains("participantIds", uid).whereGreaterThanOrEqualTo("startsAt", floor).get(Source.SERVER),
            col.whereEqualTo("createdBy", uid).whereGreaterThanOrEqualTo("startsAt", floor).get(Source.SERVER))
        val snapshots = Tasks.await(Tasks.whenAllSuccess<com.google.firebase.firestore.QuerySnapshot>(tasks), 25, TimeUnit.SECONDS)
        return snapshots.flatMap { it.documents }.distinctBy { it.id }.mapNotNull { row -> row.data?.let { WidgetGameModel.Game(row.id, it) } }
    }
    override fun identities(ids: List<String>): Map<String, Map<String, Any?>> {
        val result = mutableMapOf<String, Map<String, Any?>>()
        for (batch in ids.chunked(12)) {
            val tasks = batch.map { FirebaseFirestore.getInstance().collection("usersPublic").document(it).get(Source.SERVER) }
            Tasks.await(Tasks.whenAllSuccess<DocumentSnapshot>(tasks), 20, TimeUnit.SECONDS).forEach { row -> row.data?.let { result[row.id] = it } }
        }
        return result
    }
    override fun mutate(gameId: String, uid: String, round: String, action: String, name: String, command: String, now: () -> Long): Map<String, Any?> {
        val db = FirebaseFirestore.getInstance()
        val ref = db.collection("games").document(gameId)
        return Tasks.await(db.runTransaction { tx ->
            if (userId() != uid) throw WidgetTimerModel.NotController()
            val game = tx.get(ref).data
            val at = now()
            val fields = WidgetTimerModel.mutate(game, uid, round, action, at, command)?.toMutableMap()
            if (fields != null) {
                fields["timerControlledByName"] = name
                @Suppress("UNCHECKED_CAST")
                fields["timerEvents"] = (fields["timerEvents"] as? List<*>)?.map { value ->
                    val event = value as? Map<String, Any?> ?: return@map value
                    if (event["at"] == at && !event.containsKey("byName")) event + ("byName" to name) else event
                } ?: emptyList<Any>()
                tx.update(ref, fields.mapKeys { "liveMatch.${it.key}" } + ("updatedAt" to at))
            }
            val oldLive = game?.get("liveMatch") as? Map<*, *> ?: emptyMap<Any, Any>()
            (game ?: emptyMap()) + mapOf("liveMatch" to (oldLive + (fields ?: emptyMap<String, Any?>())), "updatedAt" to at)
        }, 25, TimeUnit.SECONDS)
    }
}

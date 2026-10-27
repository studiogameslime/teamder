package com.studiogameslime.soccerapp.wear.activity

object StandaloneSessionPolicy {
    const val MAX_DURATION_MS=12*60*60_000L
    fun canStart(source:ActivitySourceBinding?,serverNow:Double):Boolean = source?.fresh(serverNow)==true
    /** Source freshness fences starts and publication, not a user-started local workout. */
    fun canContinue(original:ActivitySourceBinding?,latestKnown:ActivitySourceBinding?,startedAt:Long,now:Long):Boolean =
        original?.valid()==true && original.sameSource(latestKnown) && now-startedAt in 0 until MAX_DURATION_MS
}

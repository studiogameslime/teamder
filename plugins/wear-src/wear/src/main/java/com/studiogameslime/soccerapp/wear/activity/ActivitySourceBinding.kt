package com.studiogameslime.soccerapp.wear.activity

/** The source fence is immutable for the lifetime of one recorder and every pending chunk. */
data class ActivitySourceBinding(
    val userId:String,val connectionId:String,val sourceGeneration:Long,
    val readerInstallationId:String,val deviceId:String,val validUntilMs:Long,val phoneNodeId:String
) {
    fun valid():Boolean = userId.isNotBlank() && connectionId.isNotBlank() && sourceGeneration>0 && readerInstallationId.isNotBlank() && deviceId.isNotBlank()
    fun sameSource(other:ActivitySourceBinding?):Boolean = other!=null && userId==other.userId && connectionId==other.connectionId &&
        sourceGeneration==other.sourceGeneration && readerInstallationId==other.readerInstallationId && deviceId==other.deviceId && phoneNodeId==other.phoneNodeId
    fun fresh(serverNow:Double):Boolean = valid() && serverNow.isFinite() && validUntilMs>serverNow && validUntilMs-serverNow<=92_000
}

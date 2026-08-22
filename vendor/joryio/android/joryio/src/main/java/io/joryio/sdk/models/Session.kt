package io.joryio.sdk.models

import java.util.Date

/**
 * Session information
 */
data class SessionInfo(
    val sessionId: String,
    val sessionStart: Date,
    var lastActivity: Date
)

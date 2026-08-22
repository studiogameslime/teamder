package io.joryio.sdk.core

import io.joryio.sdk.models.UserAttributes

/**
 * Manages user identity and attributes
 */
internal class IdentityManager(
    private val storage: StorageManager,
    private val logger: Logger,
    initialUserId: String? = null
) {
    // The user-attribute trait bag (email/phone/name/custom) is PII and is held
    // IN MEMORY ONLY for the session — never persisted at rest. The server is
    // the source of truth, and increment/append/remove are now server-atomic,
    // so no local value is needed for correctness. Only used for in-session
    // read-back (getUserAttributes / getAttribute).
    private val attributes: MutableMap<String, Any?> = mutableMapOf()

    init {
        // Set initial user ID if provided
        if (initialUserId != null && storage.getUserId() == null) {
            storage.setUserId(initialUserId)
        }

        // One-time purge: delete any attributes bag persisted by an older SDK
        // build so previously-stored PII is removed from existing installs.
        storage.clearUserAttributes()
    }

    // MARK: - Anonymous ID

    fun getAnonymousId(): String {
        return storage.getAnonymousId()
    }

    // MARK: - User ID

    fun getUserId(): String? {
        return storage.getUserId()
    }

    fun identify(userId: String) {
        logger.info("Identifying user: ${maskIdentifier(userId)}")

        // Store user ID
        storage.setUserId(userId)
    }

    fun alias(userId: String) {
        logger.info("Aliasing user: ${maskIdentifier(getAnonymousId())} -> ${maskIdentifier(userId)}")
        storage.setUserId(userId)
    }

    fun reset() {
        // Drop un-acked writes for the OUTGOING user - sending them after a
        // reset would attribute one person's traits to the next.
        pending.clear()
        logger.info("Resetting user identity")
        storage.setUserId(null)
        // Clear the in-memory trait bag and purge any orphaned persisted bag.
        attributes.clear()
        storage.clearUserAttributes()
        // Note: Anonymous ID is NOT cleared on reset
    }

    // MARK: - User Attributes (in-memory only — never persisted)

    fun getUserAttributes(): UserAttributes {
        return attributes.toMap()
    }

    /** Current in-session value of a single attribute (null if unset). */
    fun getAttribute(key: String): Any? {
        return attributes[key]
    }

    /**
     * Attributes written locally but not acknowledged by the server. Lives here
     * because it is identity state, and because both the SDK facade (to flush
     * it) and the in-app sync (to send it) already hold this manager -
     * threading a new dependency through their constructors would have changed
     * signatures the RN bridge and demo app compile against.
     */
    internal val pending = PendingAttributes(storage = storage)

    fun setAttributes(attributes: UserAttributes) {
        logger.debug("Setting ${attributes.size} user attributes")
        // Merge in memory only — NOT persisted (PII stays off durable storage).
        this.attributes.putAll(attributes)
    }

    fun setAttribute(key: String, value: Any) {
        logger.debug("Setting user attribute: $key")
        // In-memory only — NOT persisted (PII stays off durable storage).
        attributes[key] = value
    }

    fun incrementAttribute(key: String, by: Number = 1) {
        logger.debug("Incrementing user attribute: $key by $by")
        // In-memory optimistic echo only. The server receives the delta as an
        // atomic `$inc`; this local value is just for in-session read-back.
        val currentValue = attributes[key]

        val newValue: Any = when (currentValue) {
            is Int -> currentValue + by.toInt()
            is Long -> currentValue + by.toLong()
            is Float -> currentValue + by.toFloat()
            is Double -> currentValue + by.toDouble()
            else -> by
        }

        attributes[key] = newValue
    }

    fun unsetAttribute(key: String) {
        logger.debug("Unsetting user attribute: $key")
        // In-memory only — NOT persisted (PII stays off durable storage).
        attributes.remove(key)
    }
}

// REQUIRES: androidx.security:security-crypto:1.1.0-alpha06 (EncryptedSharedPreferences + MasterKey).
// Consuming apps / the published AAR MUST provide this dependency. See packages/sdk-android/README.md ("Dependencies").
package io.joryio.sdk.core

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

/**
 * Factory for the SDK's sensitive key-value stores.
 *
 * Returns an [EncryptedSharedPreferences] instance (AES256_GCM values / AES256_SIV keys,
 * backed by a [MasterKey] in the Android Keystore) so identity, session and the FCM token
 * are encrypted at rest — satisfying "encrypt all data at rest".
 *
 * Robustness guarantees (never crash the host app):
 *  - minSdk is 23, exactly the floor this scheme requires, so there is no "unencrypted on old
 *    Android" path any more. Encryption at rest is unconditional.
 *  - EncryptedSharedPreferences.create() can THROW on some devices with a corrupted keystore
 *    or after a keystore reset (e.g. lock-screen credential change, factory-key rotation). Any
 *    failure is caught and we fall back to plaintext [SharedPreferences] with a clear warning
 *    rather than crashing.
 *
 * The SharedPreferences interface returned is identical in both branches, so call sites do
 * NOT change — only the construction goes through here.
 */
internal object SecurePrefs {

    private const val ENC_SUFFIX = "_enc"
    private const val MIGRATION_FLAG = "__joryio_migrated_from_plaintext"

    /**
     * One instance per backing file, for the process lifetime.
     *
     * Without this, EVERY call rebuilt the MasterKey, re-created the
     * EncryptedSharedPreferences and re-ran the migration check — all Android
     * Keystore work, measured at ~163ms for the first build on a healthy
     * emulator. [PendingTokenStore] calls this on every token read AND write, so
     * that cost was paid repeatedly rather than once.
     *
     * SharedPreferences is documented as a singleton per file and is thread-safe,
     * so sharing one instance is also what the platform expects.
     */
    private val cache = java.util.concurrent.ConcurrentHashMap<String, SharedPreferences>()

    /**
     * Returns the sensitive store for [plaintextFileName].
     *
     * When encryption is available, the encrypted store lives in a separate backing file
     * ("<name>$ENC_SUFFIX") because EncryptedSharedPreferences cannot read a plaintext file.
     * On first run with the new code, values from any pre-existing plaintext file are migrated
     * into the encrypted store and the plaintext file's cleartext contents are then removed.
     *
     * @param logger optional; PendingTokenStore has no Logger instance, so nulls are tolerated.
     */
    fun get(context: Context, plaintextFileName: String, logger: Logger? = null): SharedPreferences {
        // Cached per file: keystore setup is the single most expensive thing the
        // SDK does, and it must be paid at most once per process.
        cache[plaintextFileName]?.let { return it }
        synchronized(this) {
            cache[plaintextFileName]?.let { return it }
            val created = create(context, plaintextFileName, logger)
            cache[plaintextFileName] = created
            return created
        }
    }

    /** Pay the keystore cost now, off the caller's thread, so the first real use is free. */
    fun prewarm(context: Context, plaintextFileName: String, logger: Logger? = null) {
        if (cache.containsKey(plaintextFileName)) return
        Thread({ runCatching { get(context, plaintextFileName, logger) } }, "joryio-prefs-warm")
            .apply { isDaemon = true }
            .start()
    }

    private fun create(
        context: Context,
        plaintextFileName: String,
        logger: Logger?,
    ): SharedPreferences {
        val appContext = context.applicationContext

        // No API floor to check: minSdk is 23, EXACTLY the floor the keystore-backed
        // MasterKey scheme needs. The plaintext fallback that used to live here was
        // the only path on which identity, session and the FCM token were written
        // UNENCRYPTED; raising minSdk from 21 to 23 removed a weakened mode rather
        // than merely deleting dead code, and 23 is the lowest floor that does it.

        return try {
            val masterKey = MasterKey.Builder(appContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            val encrypted = EncryptedSharedPreferences.create(
                appContext,
                plaintextFileName + ENC_SUFFIX,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )

            migratePlaintextIfNeeded(appContext, plaintextFileName, encrypted, logger)
            encrypted
        } catch (t: Throwable) {
            // Corrupted keystore / reset / unsupported OEM crypto provider. Do NOT crash.
            logger?.warn("EncryptedSharedPreferences init failed, falling back to plaintext SharedPreferences: ${t.message}")
            appContext.getSharedPreferences(plaintextFileName, Context.MODE_PRIVATE)
        }
    }

    /**
     * One-time copy of a pre-existing plaintext prefs file into the encrypted store, then wipe
     * the plaintext copy so existing installs no longer keep cleartext values on disk. Guarded
     * by [MIGRATION_FLAG] stored inside the encrypted file so it runs exactly once.
     */
    private fun migratePlaintextIfNeeded(
        context: Context,
        plaintextFileName: String,
        encrypted: SharedPreferences,
        logger: Logger?
    ) {
        if (encrypted.getBoolean(MIGRATION_FLAG, false)) return

        try {
            val old = context.getSharedPreferences(plaintextFileName, Context.MODE_PRIVATE)
            val entries = old.all

            val editor = encrypted.edit()
            if (entries.isNotEmpty()) {
                for ((key, value) in entries) {
                    when (value) {
                        is String -> editor.putString(key, value)
                        is Int -> editor.putInt(key, value)
                        is Long -> editor.putLong(key, value)
                        is Float -> editor.putFloat(key, value)
                        is Boolean -> editor.putBoolean(key, value)
                        is Set<*> -> {
                            @Suppress("UNCHECKED_CAST")
                            editor.putStringSet(key, value as Set<String>)
                        }
                        // null / unexpected types are skipped.
                    }
                }
            }
            editor.putBoolean(MIGRATION_FLAG, true)
            editor.apply()

            if (entries.isNotEmpty()) {
                // Remove cleartext values from the old file, then delete the file itself.
                old.edit().clear().apply()
                deletePlaintextFile(context, plaintextFileName)
                logger?.info("Migrated ${entries.size} entries from plaintext to encrypted storage")
            }
        } catch (e: Exception) {
            // A failed migration must not crash init; encrypted store simply starts empty.
            logger?.warn("Plaintext -> encrypted prefs migration failed: ${e.message}")
        }
    }

    /** Best-effort deletion of the backing plaintext .xml file. */
    private fun deletePlaintextFile(context: Context, plaintextFileName: String) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                context.deleteSharedPreferences(plaintextFileName)
            } else {
                // API 23: deleteSharedPreferences arrived in 24. clear().apply()
                // above already removed the cleartext; drop the empty file too.
                val file = File(context.applicationInfo.dataDir, "shared_prefs/$plaintextFileName.xml")
                if (file.exists()) file.delete()
            }
        } catch (e: Exception) {
            // Non-fatal: cleartext is already cleared via clear().apply().
        }
    }
}

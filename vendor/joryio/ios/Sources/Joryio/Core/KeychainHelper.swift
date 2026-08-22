import Foundation
import Security

/// Thin wrapper over the iOS/macOS Keychain (SecItem*) for storing small string
/// secrets at rest.
///
/// Why the Keychain (vs UserDefaults):
/// UserDefaults is already encrypted at rest by iOS Data Protection (the app
/// sandbox is encrypted; the default class is CompleteUntilFirstUserAuthentication).
/// The Keychain adds a dedicated, hardware-backed secure store for the few
/// identity-linking secrets (APNs device token, userId) that warrant the
/// strongest available at-rest handling. No third-party crypto is used — this is
/// entirely OS-native.
///
/// Accessibility is `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`:
///  - AfterFirstUnlock: the item is readable in the background once the device
///    has been unlocked at least once since boot, so background/terminate event
///    flushes and silent-push handling still work.
///  - ThisDeviceOnly: the item is never synced to iCloud Keychain and does not
///    migrate to a new device via encrypted backup — it stays on the device that
///    created it, which is the right semantics for a per-device push token.
///
/// Items are scoped per SDK key (service + account) so multiple SDK instances in
/// the same app do not collide.
final class KeychainHelper {
    private let service: String
    private let logger: Logger?

    init(sdkKey: String, logger: Logger? = nil) {
        // One service namespace per SDK key so separate instances stay isolated.
        self.service = "com.joryio.sdk.\(sdkKey)"
        self.logger = logger
    }

    /// Store (insert or update) a string value under `account`.
    @discardableResult
    func setString(_ value: String, forKey account: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }

        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        // Try to update an existing item first.
        let attributesToUpdate: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributesToUpdate as CFDictionary)
        if updateStatus == errSecSuccess {
            return true
        }

        if updateStatus == errSecItemNotFound {
            // Not present yet — add it.
            var addQuery = baseQuery
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus == errSecSuccess {
                return true
            }
            logger?.error("Keychain add failed for \(account): OSStatus \(addStatus)")
            return false
        }

        logger?.error("Keychain update failed for \(account): OSStatus \(updateStatus)")
        return false
    }

    /// Read a string value stored under `account` (nil if absent).
    func getString(forKey account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status != errSecItemNotFound {
                logger?.error("Keychain read failed for \(account): OSStatus \(status)")
            }
            return nil
        }

        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        return value
    }

    /// Delete the value stored under `account` (no-op if absent).
    func removeItem(forKey account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            logger?.error("Keychain delete failed for \(account): OSStatus \(status)")
        }
    }
}

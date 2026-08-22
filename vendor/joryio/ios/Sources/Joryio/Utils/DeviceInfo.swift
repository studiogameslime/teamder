import Foundation
import UIKit

/// Device information utilities
struct DeviceInfo {
    /// Get comprehensive device information
    static func getDeviceInfo() -> [String: Any] {
        var info: [String: Any] = [:]

        // Device model
        info["model"] = getDeviceModel()

        // OS version
        info["os_version"] = UIDevice.current.systemVersion
        info["os_name"] = UIDevice.current.systemName

        // App version
        if let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            info["app_version"] = appVersion
        }

        // Build number
        if let buildNumber = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String {
            info["build_number"] = buildNumber
        }

        // Bundle ID
        if let bundleId = Bundle.main.bundleIdentifier {
            info["bundle_id"] = bundleId
        }

        // Screen dimensions
        let screen = UIScreen.main.bounds
        info["screen_width"] = Int(screen.width)
        info["screen_height"] = Int(screen.height)

        // Device locale
        info["locale"] = Locale.current.identifier

        // Timezone
        info["timezone"] = TimeZone.current.identifier

        // Carrier (if available)
        #if !targetEnvironment(simulator)
        // Carrier info would go here if CTTelephonyNetworkInfo is available
        #endif

        return info
    }

    /// Build tracking properties for Session Start
    static func getTrackingProperties(deviceId: String) -> [String: Any] {
        var properties: [String: Any] = [:]
        let info = getDeviceInfo()

        properties["$device_id"] = deviceId
        properties["$platform"] = "ios"
        properties["$model"] = info["model"]
        properties["$os_name"] = info["os_name"]
        properties["$os_version"] = info["os_version"]
        properties["$app_version"] = info["app_version"]
        properties["$build_number"] = info["build_number"]
        properties["$bundle_id"] = info["bundle_id"]
        properties["$screen_width"] = info["screen_width"]
        properties["$screen_height"] = info["screen_height"]
        properties["$locale"] = info["locale"]
        properties["$timezone"] = info["timezone"]

        let preferredLanguages = Locale.preferredLanguages
        if let primaryLanguage = preferredLanguages.first {
            properties["$language"] = Locale(identifier: primaryLanguage).languageCode ?? primaryLanguage
            properties["$languages"] = preferredLanguages
        }

        return properties
    }

    /// Get device model name
    static func getDeviceModel() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machineMirror = Mirror(reflecting: systemInfo.machine)
        let identifier = machineMirror.children.reduce("") { identifier, element in
            guard let value = element.value as? Int8, value != 0 else { return identifier }
            return identifier + String(UnicodeScalar(UInt8(value)))
        }
        return mapToDevice(identifier: identifier)
    }

    /// Map device identifier to friendly name
    private static func mapToDevice(identifier: String) -> String {
        switch identifier {
        // iPhone
        case "iPhone14,2": return "iPhone 13 Pro"
        case "iPhone14,3": return "iPhone 13 Pro Max"
        case "iPhone14,4": return "iPhone 13 mini"
        case "iPhone14,5": return "iPhone 13"
        case "iPhone14,7": return "iPhone 14"
        case "iPhone14,8": return "iPhone 14 Plus"
        case "iPhone15,2": return "iPhone 14 Pro"
        case "iPhone15,3": return "iPhone 14 Pro Max"
        case "iPhone15,4": return "iPhone 15"
        case "iPhone15,5": return "iPhone 15 Plus"
        case "iPhone16,1": return "iPhone 15 Pro"
        case "iPhone16,2": return "iPhone 15 Pro Max"

        // iPad
        case "iPad13,18": return "iPad 10th Gen"
        case "iPad13,19": return "iPad 10th Gen"
        case "iPad14,3": return "iPad Pro 11-inch (4th Gen)"
        case "iPad14,4": return "iPad Pro 11-inch (4th Gen)"
        case "iPad14,5": return "iPad Pro 12.9-inch (6th Gen)"
        case "iPad14,6": return "iPad Pro 12.9-inch (6th Gen)"

        // Simulator
        case "i386", "x86_64", "arm64":
            return "Simulator (\(identifier))"

        default:
            return identifier
        }
    }
}

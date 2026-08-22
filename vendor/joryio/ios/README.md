# Joryio iOS SDK

Native iOS SDK for Joryio customer engagement platform. Track events, identify users, manage sessions, and display in-app messages with a lightweight, privacy-first SDK.

## Installation

The package provides two products:

| Product | Contains |
|---------|----------|
| `JoryioUI` | everything, including in-app message display (pulls `Joryio`) |
| `Joryio` | tracking, identity and push only - no WebKit linked |

CocoaPods: `pod 'Joryio/UI'` or `pod 'Joryio'`. Note the CocoaPods default is
the UI-free `Joryio`, so a bare `pod 'Joryio'` will not display in-app messages.

## Features

- 🚀 **Lightweight** - Minimal footprint (~300KB)
- ⚡ **Fast** - Optimized for performance
- 💾 **Offline Support** - SQLite-based event queue
- 🔄 **Auto-Retry** - Exponential backoff on failures
- 📊 **Batching** - Efficient event batching (50 events / 5s)
- 💬 **In-App Messaging** - native and HTML messages, 5 types, with frequency capping
- 🎯 **Privacy-First** - GDPR compliant, respects user consent
- 🔐 **Secure** - Keychain storage for sensitive data
- 📱 **iOS 14+** - Support for modern iOS versions
- 🧪 **Type-Safe** - Full Swift type safety

## Requirements

- iOS 14.0+
- Xcode 14.0+
- Swift 5.9+

## Installation

### Swift Package Manager (Recommended)

Add the following to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/joryio/joryio-ios.git", from: "1.0.0")
]
```

Or in Xcode:
1. File → Add Package Dependencies
2. Enter: `https://github.com/joryio/joryio-ios.git`
3. Select version and add to target

### CocoaPods

```ruby
pod 'Joryio', '~> 1.0'
```

Then run:
```bash
pod install
```

## Quick Start

### 1. Initialize the SDK

In your `AppDelegate.swift`:

```swift
import Joryio

func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
) -> Bool {

    // Simple initialization
    Joryio.shared.initialize(
        sdkKey: "jry_sdk_ios_YOUR_SDK_KEY",
        apiHost: "us-01.joryio.com"
    )

    // Or with additional configuration
    Joryio.shared.initialize(
        sdkKey: "jry_sdk_ios_YOUR_SDK_KEY",
        apiHost: "eu-01.joryio.com",
        config: JoryioConfig(
            enableDebug: true,        // Enable for development
            batchSize: 50,
            flushInterval: 5.0
        )
    )

    return true
}
```

**Parameters Explained:**
- **sdkKey**: Your SDK key for authentication and app identification (from Settings → API Keys)
- **apiHost**: Data center endpoint based on your region

### Choosing Your API Host

Select the appropriate API host based on your data residency requirements:

```swift
// United States - us-01
Joryio.shared.initialize(
    sdkKey: "jry_sdk_ios_YOUR_KEY",
    apiHost: "us-01.joryio.com"
)

// United States - us-02
Joryio.shared.initialize(
    sdkKey: "jry_sdk_ios_YOUR_KEY",
    apiHost: "us-02.joryio.com"
)

// European Union - eu-01 (GDPR)
Joryio.shared.initialize(
    sdkKey: "jry_sdk_ios_YOUR_KEY",
    apiHost: "eu-01.joryio.com"
)

// Asia Pacific - ap-01
Joryio.shared.initialize(
    sdkKey: "jry_sdk_ios_YOUR_KEY",
    apiHost: "ap-01.joryio.com"
)

// Self-hosted / Custom domain
Joryio.shared.initialize(
    sdkKey: "jry_sdk_ios_YOUR_KEY",
    apiHost: "https://your-custom-domain.com"
)
```

### 2. Track Events

```swift
// Basic event
Joryio.shared.track("Button Tapped")

// Event with properties
Joryio.shared.track("Product Viewed", properties: [
    "product_id": "abc123",
    "product_name": "Wireless Headphones",
    "price": 99.99,
    "category": "Electronics"
])

// Screen view
Joryio.shared.trackScreen("ProductDetail", properties: [
    "product_id": "abc123"
])
```

### 3. Identify Users

```swift
// Identify a user
Joryio.shared.identify("user-123")
Joryio.shared.setAttributes([
    "email": "user@example.com",
    "name": "John Doe",
    "plan": "premium",
    "signup_date": Date()
])

// Set attributes later
Joryio.shared.setAttribute("last_purchase", value: Date())
Joryio.shared.incrementAttribute("lifetime_value", by: 99.99)

// On logout
Joryio.shared.reset()
```

### Automatic Session Data

The iOS SDK enriches **Session Start** events with device and environment data:

- `$device_id`
- `$platform` (ios)
- `$model`
- `$os_name` / `$os_version`
- `$app_version` / `$build_number`
- `$bundle_id`
- `$screen_width` / `$screen_height`
- `$locale`
- `$language` / `$languages`
- `$timezone`
- `country` (ISO-3166-1 alpha-2, derived from IP at session start)

### 4. User Aliasing

When a user signs up or logs in for the first time:

```swift
// User was browsing anonymously, now they signed up
Joryio.shared.alias("user-123")

// This links their anonymous activity to their new user ID
```

## Configuration Options

The `JoryioConfig` is optional and allows you to customize SDK behavior:

```swift
JoryioConfig(
    // User Identification
    userId: String?,                   // Initialize with known user ID
    anonymousId: String?,              // Custom anonymous ID

    // Batching & Performance
    batchSize: Int,                    // Default: 50
    flushInterval: TimeInterval,       // Default: 5.0 seconds
    sendImmediately: Bool,             // Default: false
    maxQueueSize: Int,                 // Default: 1000

    // Session Management
    sessionTimeout: TimeInterval,      // Default: 1800 (30 minutes)
    trackSessionStart: Bool,           // Default: true

    // UTM Tracking
    captureUTM: Bool,                  // Default: true
    resetSessionOnNewCampaign: Bool,   // Default: false
    trackPageProperties: Bool,         // Default: true

    // In-App Messaging
    inApp: InAppConfig,                // In-app messaging config

    // Storage
    persistQueue: Bool,                // Default: true

    // Network & Retry
    maxRetries: Int,                   // Default: 3
    retryBackoffMs: Double,            // Default: 1000.0
    requestTimeout: TimeInterval,      // Default: 10.0

    // Privacy & GDPR
    respectDoNotTrack: Bool,           // Default: true
    optOut: Bool,                      // Default: false
    trackingConsent: TrackingConsent,  // Default: .granted

    // Debugging
    enableDebug: Bool,                 // Default: false
    logLevel: LogLevel                 // Default: .error
)
```

### Available API Hosts

| Host | Region | Use Case |
|------|--------|----------|
| `us-01.joryio.com` | United States | Primary US data center |
| `us-02.joryio.com` | United States | Secondary US data center |
| `eu-01.joryio.com` | European Union | GDPR compliance, EU data residency |
| `ap-01.joryio.com` | Asia Pacific | APAC data residency |
| Custom URL | Any | Self-hosted or custom deployment |

## Advanced Usage

### User Attributes Management

```swift
// Set multiple attributes
Joryio.shared.setAttributes([
    "age": 28,
    "city": "San Francisco",
    "premium": true
])

// Set single attribute
Joryio.shared.setAttribute("language", value: "en")

// Increment numeric attribute
Joryio.shared.incrementAttribute("page_views", by: 1)
Joryio.shared.incrementAttribute("total_spent", by: 29.99)

// Remove attribute
Joryio.shared.unsetAttribute("temporary_flag")
```

### Manual Queue Flushing

```swift
// Flush immediately (e.g., before app termination)
Joryio.shared.flush()

// Check queue size
let queueSize = Joryio.shared.getQueueSize()
print("Pending events: \(queueSize)")
```

### Privacy Controls

```swift
// Opt out of tracking
Joryio.shared.optOut()

// Opt back in
Joryio.shared.optIn()

// Check opt-out status
if Joryio.shared.isUserOptedOut() {
    print("User has opted out")
}

// Get identity info
let (userId, anonymousId) = Joryio.shared.getIdentity()
print("User: \(userId ?? "anonymous"), Anonymous ID: \(anonymousId)")
```

### In-App Messaging

Display targeted in-app messages to your users based on their behavior and attributes.

```swift
// Manually sync campaigns from server
await Joryio.shared.syncInAppCampaigns()

// Manually trigger campaign evaluation
// (useful when user performs a key action)
await Joryio.shared.evaluateInAppCampaigns()

// Reset displayed campaigns (for testing)
Joryio.shared.resetDisplayedCampaigns()
```

**Automatic Campaign Sync**

The SDK automatically syncs and evaluates campaigns when:
- App enters foreground
- User identification changes
- User attributes are updated

**Message content**

Messages arrive in one of two shapes:

- **Native** - structured data (headline, body, image, buttons) drawn with real UIKit
  views, honouring your app's tint colour, Dynamic Type, dark mode and VoiceOver.
  No web view.
- **HTML** - author-supplied markup, CSS and JavaScript, shown in a `WKWebView`.

**HTML messages are off by default.** An HTML message runs author-supplied JavaScript
inside your app, so opting in is a decision your app team makes:

```swift
let config = JoryioConfig(
    inApp: InAppConfig(allowHtmlJsInAppMessages: true)   // default: false
)
```

Leaving it off does **not** disable in-app messaging - native messages still display,
because they are data rendered by this SDK's own views with no interpreter involved.
HTML campaigns are skipped and logged. tvOS has no web view at all, so HTML never
displays there regardless of this setting.

**Message Types**

The SDK supports 5 message types:

1. **Modal** - Center of screen with backdrop
2. **Banner** - Top of screen
3. **Slide-Up** - Small notification from the bottom
4. **Full-Screen** - Takeover message
5. **Custom** - Your app decides placement

**Frequency Capping**

Messages respect workspace-level touching rules and campaign-level frequency caps:
- Maximum impressions per time window
- Minimum delay between messages
- Per-campaign frequency limits

**Button Actions**

Messages can have buttons with different actions:
- `dismiss` - Close the message
- `url` - Open external URL
- `deepLink` - Deep link into app
- `custom` - Custom handling by your app

### Push Notifications

Send targeted push notifications to your users via Apple Push Notification Service (APNS).

#### 1. Setup Push Notifications

In your `AppDelegate.swift`:

```swift
import Joryio

class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Initialize SDK
        Joryio.shared.initialize(
            sdkKey: "jry_sdk_ios_YOUR_KEY",
            apiHost: "us-01.joryio.com"
        )

        // Request push permissions
        Task {
            let granted = await Joryio.shared.requestPushPermissions()
            if granted {
                print("Push notifications enabled")
            }
        }

        return true
    }

    // Handle device token registration
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Joryio.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    // Handle registration failure
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Joryio.shared.didFailToRegisterForRemoteNotifications(error: error)
    }

    // Handle received push notification
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Joryio.shared.didReceiveRemoteNotification(userInfo, completionHandler: completionHandler)
    }
}
```

#### 2. Push Notification Features

```swift
// Check if push is enabled
let isEnabled = await Joryio.shared.isPushEnabled()

// Get device token
if let token = Joryio.shared.getDeviceToken() {
    print("Device token: \(token)")
}

// Badge management
Joryio.shared.updateBadgeCount(5)
Joryio.shared.clearBadge()

// Unregister from push
Joryio.shared.unregisterFromPushNotifications()
```

#### 3. Configure APNS in Dashboard

To send push notifications, configure your APNS credentials in the workspace settings:

1. Go to **Settings → Apps → [Your App]**
2. Navigate to **Push Notifications** tab
3. Upload your APNS certificate (.p12) or auth key (.p8)
4. Enter your Team ID and Key ID (for .p8)
5. Select environment (Development/Production)

**Push Notification Payload:**

The SDK automatically handles notifications with the following format:
```json
{
  "aps": {
    "alert": {
      "title": "Your Title",
      "body": "Your message"
    },
    "badge": 1,
    "sound": "default"
  },
  "hippo_campaign_id": "campaign_123",
  "hippo_deep_link": "myapp://product/123",
  "hippo_url": "https://example.com"
}
```

### Session Management

```swift
// Get session info
let (sessionId, sessionStart, duration) = Joryio.shared.getSessionInfo()
print("Session: \(sessionId), Duration: \(duration)s")

// Sessions automatically renew after timeout (default 30 min)
// Or manually start new session
// (This is handled automatically by the SDK)
```

## Lifecycle Handling

The SDK automatically handles app lifecycle events:

- **App Background**: Flushes pending events
- **App Foreground**: Checks session expiry, starts new session if needed, syncs in-app campaigns
- **App Terminate**: Flushes all pending events

No additional code required!

## Examples

### E-commerce Tracking

```swift
// Product view
Joryio.shared.track("Product Viewed", properties: [
    "product_id": "abc123",
    "name": "Wireless Headphones",
    "price": 99.99,
    "category": "Electronics"
])

// Add to cart
Joryio.shared.track("Product Added", properties: [
    "product_id": "abc123",
    "quantity": 1,
    "cart_total": 99.99
])

// Purchase
Joryio.shared.track("Order Completed", properties: [
    "order_id": "order-456",
    "total": 99.99,
    "items": 1,
    "payment_method": "credit_card"
])
```

### User Lifecycle

```swift
// User signs up
Joryio.shared.identify("user-123")
Joryio.shared.setAttributes([
    "email": "user@example.com",
    "signup_date": Date(),
    "plan": "free"
])

Joryio.shared.track("User Signed Up", properties: [
    "source": "organic",
    "referrer": "google"
])

// User upgrades
Joryio.shared.track("Subscription Upgraded", properties: [
    "from_plan": "free",
    "to_plan": "premium",
    "mrr": 29.99
])

Joryio.shared.setAttribute("plan", value: "premium")

// User logs out
Joryio.shared.reset()
```

## Architecture

```
┌───────────────────────────────────────────────────┐
│           Public API (Joryio)                 │
│  track, identify, alias, reset, syncCampaigns...  │
└───────────────────────────────────────────────────┘
                          │
┌───────────────────────────────────────────────────┐
│              Core Managers                         │
│  Identity │ Session │ Queue │ Network │ InApp     │
└───────────────────────────────────────────────────┘
                          │
┌───────────────────────────────────────────────────┐
│              Storage Layer                         │
│  SQLite (events, campaigns) │ UserDefaults (cfg)  │
└───────────────────────────────────────────────────┘
```

## Data Storage

- **Events**: SQLite database for offline queue
- **User Identity**: UserDefaults + Keychain (sensitive data)
- **Session**: UserDefaults
- **Campaigns**: SQLite cache

All data is scoped to your SDK key for multi-app support.

## Privacy & GDPR

The SDK is designed with privacy in mind:

- **Anonymous by Default**: Users get anonymous ID until identified
- **Opt-Out Support**: Full opt-out capability
- **Data Minimization**: Only collect what's needed
- **Consent Management**: Respect tracking consent preferences
- **Right to be Forgotten**: `reset()` clears all user data

## Performance

- **Bundle Size**: ~300KB
- **Memory Usage**: < 5MB typical
- **Battery Impact**: Minimal (< 0.5% daily)
- **Cold Start**: < 10ms overhead
- **Network**: Batched requests, automatic retry

## Troubleshooting

### Events not appearing in dashboard

1. Check SDK key is correct: `jry_sdk_ios_*`
2. Enable debug logging: `enableDebug: true`
3. Check console logs for errors
4. Verify network connectivity
5. Call `flush()` to send immediately

### Session not tracking

1. Verify `trackSessionStart: true` in config
2. Check session timeout setting
3. Review app lifecycle handling

### Build errors

1. Ensure iOS 14.0+ deployment target
2. Clean build folder: Cmd+Shift+K
3. Update Swift Package dependencies

## Migration from Other SDKs

### From Mixpanel

```swift
// Mixpanel
Mixpanel.track("Event", properties: ["key": "value"])
Mixpanel.identify("user-123")

// Joryio
Joryio.shared.track("Event", properties: ["key": "value"])
Joryio.shared.identify("user-123")
```

### From Segment

```swift
// Segment
Analytics.shared().track("Event", properties: ["key": "value"])
Analytics.shared().identify("user-123")

// Joryio
Joryio.shared.track("Event", properties: ["key": "value"])
Joryio.shared.identify("user-123")
```

## API Reference

See [API Documentation](./docs/API.md) for complete reference.

## Support

- 📖 Documentation: https://docs.joryio.com
- 💬 Community: https://community.joryio.com
- 🐛 Issues: https://github.com/joryio/joryio-ios/issues
- ✉️ Email: support@joryio.com

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

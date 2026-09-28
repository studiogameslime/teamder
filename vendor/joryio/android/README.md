# Joryio Android SDK

Native Android SDK for Joryio customer engagement platform. Track events, identify users, manage sessions, and display in-app messages with a lightweight, privacy-first SDK.

## Features

- 🚀 **Lightweight** - Minimal footprint
- ⚡ **Fast** - Optimized for performance
- 💾 **Offline Support** - SQLite-based event queue
- 🔄 **Auto-Retry** - Exponential backoff on failures
- 📊 **Batching** - Efficient event batching (50 events / 5s)
- 💬 **In-App Messaging** - native and HTML messages, 5 types, with frequency capping
- 🔔 **Push Notifications** - Firebase Cloud Messaging (FCM)
- 🎯 **Privacy-First** - GDPR compliant, respects user consent
- 📱 **Android 6.0+** - Support for Android API 23+
- 🧪 **Type-Safe** - Full Kotlin type safety

## Requirements

- Android 6.0 (API level 23) or higher
- Kotlin 1.9.20 or higher
- Gradle 8.0 or higher

## Dependencies

The SDK's own transitive dependencies (Kotlin, AndroidX, Retrofit/OkHttp, Gson, Room) are
declared in `joryio/build.gradle.kts` and ship with the AAR. Two things worth calling out:

- **`androidx.security:security-crypto` (required, recommended `1.1.0-alpha06`).** Powers
  `EncryptedSharedPreferences` + `MasterKey`, which encrypt the sensitive key-value store
  (anonymous ID, user ID, session, FCM device token) at rest using an AES-256-GCM key held in
  the Android Keystore. The dependency is declared in `build.gradle.kts`; if you repackage or
  shade the SDK, the consuming app / published AAR **must** still provide it.
- **`com.google.firebase:firebase-messaging` (optional, `compileOnly`).** Only needed if you
  use push notifications; provide it in the host app.

### Data-at-rest encryption

- **Sensitive key-value data** (anonymous/user ID, session, FCM token) is stored in
  `EncryptedSharedPreferences`. On **API 23+** values and keys are encrypted with a
  Keystore-backed master key. On first run with this version, any pre-existing plaintext
  `SharedPreferences` values are migrated into the encrypted store and the old cleartext file
  is removed.
  - There is **no unencrypted path**. `minSdk` is **23**, exactly the floor the Keystore-backed
    scheme requires, so the plaintext fallback for older Android is gone rather than dormant.
    23 is also the minimum Firebase Cloud Messaging itself requires, so it excludes no device
    that could have received a push anyway.
  - If `EncryptedSharedPreferences` initialization fails on a device (corrupted keystore /
    keystore reset), the SDK logs a warning and falls back to plaintext rather than crashing the
    host app.
- **Event queue** (the offline Room/SQLite database) relies on **Android File-Based Encryption
  (FBE)** — the device-level at-rest encryption enabled by default on modern Android — rather
  than encrypting the DB file itself. If DB-file-level encryption is later required,
  [SQLCipher](https://www.zetetic.net/sqlcipher/) is the drop-in option (not currently bundled).

## Local SDK Setup

For local builds, set the Android SDK path in `local.properties`:

```
sdk.dir=/Users/your-user/Library/Android/sdk
```

Alternatively, export `ANDROID_HOME`/`ANDROID_SDK_ROOT` before running Gradle.

## Installation

### Gradle (Recommended)

Add to your `build.gradle.kts`:

```kotlin
dependencies {
    // Everything, including in-app message display. Start here.
    implementation("io.joryio:joryio-android-ui:1.0.0")

    // Or, for tracking/identity/push only - no in-app rendering, no WebView:
    // implementation("io.joryio:joryio-android:1.0.0")
}
```

`joryio-android-ui` depends on `joryio-android`, so declare **one**, never both.

Or using Groovy (`build.gradle`):

```groovy
dependencies {
    implementation 'io.joryio:joryio-android:1.0.0'
}
```

## Quick Start

### 1. Initialize the SDK

In your `Application` class:

```kotlin
import io.joryio.sdk.Joryio
import io.joryio.sdk.JoryioConfig

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // Simple initialization
        Joryio.initialize(
            context = this,
            sdkKey = "jry_sdk_android_YOUR_SDK_KEY",
            apiHost = "us-01.joryio.com"
        )

        // Or with additional configuration
        Joryio.initialize(
            context = this,
            sdkKey = "jry_sdk_android_YOUR_SDK_KEY",
            apiHost = "us-01.joryio.com",
            config = JoryioConfig(
                enableDebug = true,
                batchSize = 50,
                flushInterval = 5000
            )
        )
    }
}
```

### 2. Track Events

```kotlin
// Basic event
Joryio.track("Button Tapped")

// Event with properties
Joryio.track("Product Viewed", mapOf(
    "product_id" to "abc123",
    "product_name" to "Wireless Headphones",
    "price" to 99.99,
    "category" to "Electronics"
))

// Screen view
Joryio.trackScreen("ProductDetail", mapOf(
    "product_id" to "abc123"
))
```

### 3. Identify Users

```kotlin
// Identify a user
Joryio.identify("user-123")
Joryio.setAttributes(mapOf(
    "email" to "user@example.com",
    "name" to "John Doe",
    "plan" to "premium"
))

// Set attributes later
Joryio.setAttribute("last_purchase", Date())
Joryio.incrementAttribute("lifetime_value", 99.99)

// On logout
Joryio.reset()
```

### Automatic Session Data

The Android SDK enriches **Session Start** events with device and environment data:

- `$device_id`
- `$platform` (android)
- `$manufacturer` / `$model`
- `$os_name` / `$os_version` / `$os_sdk_int`
- `$app_version` / `$build_number`
- `$package_name`
- `$screen_width` / `$screen_height`
- `$locale`
- `$language` / `$languages`
- `$timezone`
- `country` (ISO-3166-1 alpha-2, derived from IP at session start)

## Advanced Features

### Session Management

Sessions automatically track user engagement:

```kotlin
// Sessions are managed automatically with 30-minute timeout
// Get current session ID
val sessionId = Joryio.getInstance().getSessionId()

// Sessions refresh on user activity
```

### In-App Messaging

The SDK displays in-app messages for you - eligible campaigns appear on their own and
impressions, clicks and dismissals are tracked automatically.

Messages arrive in one of two shapes:

- **Native** - structured data (headline, body, image, buttons) drawn with real Android
  views, using your app's theme, fonts, dark mode and TalkBack. No WebView.
- **HTML** - author-supplied markup, CSS and JavaScript, shown in a WebView.

**HTML messages are off by default.** An HTML message runs author-supplied JavaScript
inside your app, so opting in is a decision your app team makes:

```kotlin
val config = JoryioConfig(
    allowHtmlJsInAppMessages = true   // default: false
)
Joryio.initialize(context = this, sdkKey = "...", apiHost = "...", config = config)
```

Leaving it off does **not** disable in-app messaging - native messages still display,
because they are data rendered by your app's own views with no interpreter involved.
HTML campaigns are skipped and logged.

To draw your own UI instead, set a callback. It **overrides** the SDK's rendering, so you
will not get two copies of the message:

```kotlin
Joryio.getInstance().setInAppMessageCallback { campaign ->
    showInAppMessage(campaign)   // your UI
}

// Report what happened - the SDK only tracks automatically for messages it displays itself
Joryio.trackInAppImpression(campaignId, "viewed")
Joryio.trackInAppImpression(campaignId, "clicked")
Joryio.trackInAppImpression(campaignId, "dismissed")
```

### Push Notifications

Enable push notifications with Firebase Cloud Messaging:

1. Add Firebase to your project
2. Add the service to your `AndroidManifest.xml`:

```xml
<service
    android:name="io.joryio.sdk.push.JoryioFirebaseMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

3. Register for push notifications:

```kotlin
// Get FCM token and register
FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
    if (task.isSuccessful) {
        val token = task.result
        Joryio.getInstance().registerPushToken(token)
    }
}

// Check if push is enabled
val isEnabled = Joryio.isPushEnabled()

// Unregister when needed
Joryio.getInstance().unregisterPush()
```

## Configuration Options

Full configuration options for `JoryioConfig`:

```kotlin
val config = JoryioConfig(
    // Initial user ID (optional)
    userId = "user-123",

    // Event batching
    batchSize = 50,              // Events per batch
    flushInterval = 5000,        // Flush interval in ms (5s)

    // Session management
    sessionTimeout = 1800000,    // Session timeout in ms (30 min)
    trackSessionStart = true,    // Auto-track session start

    // Network retry
    maxRetries = 3,              // Max retry attempts

    // Privacy controls
    optOut = false,              // Opt out of tracking
    trackingConsent = TrackingConsent.GRANTED,

    // Debugging
    enableDebug = false,         // Enable debug logging
    logLevel = null              // VERBOSE, DEBUG, INFO, WARN or ERROR. Default null:
                                 // follows enableDebug (DEBUG when on, ERROR when off)
)
```

### Tracking Consent

Manage user tracking consent:

```kotlin
// Tracking consent levels
enum class TrackingConsent {
    GRANTED,        // Full tracking allowed
    PENDING,        // Waiting for user decision
    DENIED          // User denied tracking
}
```

### Log Levels

Available log levels:

```kotlin
enum class LogLevel {
    VERBOSE,   // All logs
    DEBUG,     // Debug and above
    INFO,      // Info and above
    WARN,      // Warnings and errors
    ERROR      // Errors only
}
```

## Best Practices

### 1. Initialize Early

Initialize in your `Application` class for best results:

```kotlin
class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Joryio.initialize(
            context = this,
            sdkKey = "jry_sdk_android_YOUR_SDK_KEY",
            apiHost = "us-01.joryio.com"
        )
    }
}
```

### 2. Flush on Critical Events

Flush events before app termination:

```kotlin
override fun onDestroy() {
    super.onDestroy()
    Joryio.flush()
}
```

### 3. Handle User Logout

Always reset on logout:

```kotlin
fun logout() {
    // Clear user session
    clearUserSession()

    // Reset SDK
    Joryio.reset()
}
```

### 4. Track Screen Views

Use screen tracking for navigation:

```kotlin
override fun onResume() {
    super.onResume()
    Joryio.trackScreen(this::class.simpleName ?: "Unknown")
}
```

## API Reference

### Event Tracking

```kotlin
// Track event
Joryio.track(eventName: String, properties: Map<String, Any?> = emptyMap())

// Track screen view
Joryio.trackScreen(screenName: String, properties: Map<String, Any?> = emptyMap())

// Flush events immediately
Joryio.flush()
```

### User Identity

```kotlin
// Identify user
Joryio.identify(userId: String)

// Alias user
Joryio.alias(userId: String)

// Reset user (logout)
Joryio.reset()

// Get IDs
Joryio.getInstance().getAnonymousId(): String
Joryio.getInstance().getUserId(): String?
Joryio.getInstance().getSessionId(): String
```

### User Attributes

```kotlin
// Set multiple attributes
Joryio.getInstance().setAttributes(attributes: UserAttributes)

// Set single attribute
Joryio.setAttribute(key: String, value: Any)

// Increment numeric attribute
Joryio.incrementAttribute(key: String, by: Number = 1)

// Remove attribute
Joryio.getInstance().unsetAttribute(key: String)
```

### In-App Messaging

```kotlin
// Set message callback
Joryio.getInstance().setInAppMessageCallback { campaign ->
    // Handle message display
}

// Track impressions
Joryio.getInstance().trackInAppImpression(campaignId: String, action: String)
```

### Push Notifications

```kotlin
// Register token
Joryio.getInstance().registerPushToken(token: String)

// Check status
Joryio.getInstance().isPushEnabled(): Boolean

// Unregister
Joryio.getInstance().unregisterPush()
```

## Status

✅ **Complete** - Android SDK is fully implemented and ready for use.

Implementation status:
- ✅ Project structure and Gradle configuration
- ✅ Data models (Event, Session, InAppMessage)
- ✅ Configuration system (JoryioConfig)
- ✅ Logger implementation
- ✅ Core managers (Storage, Identity, Session)
- ✅ Network client with Retrofit
- ✅ Queue manager with Room Database
- ✅ In-app messaging with targeting
- ✅ Push notifications (FCM)
- ✅ Complete documentation
- ✅ Lifecycle management
- ✅ Automatic batching and retry

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

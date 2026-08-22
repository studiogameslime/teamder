# @joryio/react-native-sdk

React Native wrapper for the Joryio native iOS and Android SDKs.

## Installation

```bash
npm install @joryio/react-native-sdk
```

### iOS

```bash
cd ios && pod install
```

### Android

Add to `android/app/src/main/java/.../MainApplication.kt`:

```kotlin
import io.joryio.reactnative.JoryioPackage

override fun getPackages() = PackageList(this).packages.apply {
    add(JoryioPackage())
}
```

## Usage

```typescript
import Joryio from '@joryio/react-native-sdk';

// Initialize (call once in App.tsx)
await Joryio.initialize('jry_sdk_ios_your_key', 'https://api-eu1.joryio.com', {
  enableDebug: __DEV__,
  trackSessionStart: true,
  // HTML in-app messages run author-supplied JavaScript in your app, so they
  // are OFF by default. Native messages arrive either way.
  allowHtmlJsInAppMessages: false,
});

// Track events
Joryio.track('Product Added', { productId: '123', price: 29.99 });
Joryio.trackScreen('ProductDetail', { productId: '123' });

// Identify users
Joryio.identify('user-123');

// Set attributes
Joryio.setAttributes({ firstName: 'John', plan: 'premium' });
Joryio.incrementAttribute('loginCount', 1);

// Push notifications
const token = await messaging().getToken(); // Firebase
Joryio.registerPushToken(token);

// In-app messages render themselves - install and they appear.
// Subscribe ONLY if you want to draw them in React instead; doing so stops
// the SDK rendering, so you will not get two copies.
const unsubscribe = Joryio.onInAppMessage((message) => {
  if (message.kind === 'native') {
    // Structured data: title / body / imageUrl / buttons.
    // It is TEXT - put it in a <Text>, never in a WebView.
  } else {
    // message.html + message.css - render in a WebView
  }
});

// Logout
Joryio.reset();
```

## API Reference

### Initialization
- `initialize(sdkKey, apiHost, config?)` — Initialize the SDK

### Event Tracking
- `track(eventName, properties?)` — Track a custom event
- `trackScreen(screenName, properties?)` — Track a screen view

### Identity
- `identify(userId)` — Identify the current user
- `alias(userId)` — Link anonymous user to known user
- `reset()` — Clear identity (logout)

### User Attributes
- `setAttributes(attributes)` — Set multiple attributes
- `setAttribute(key, value)` — Set a single attribute
- `incrementAttribute(key, by?)` — Increment a numeric attribute
- `unsetAttribute(key)` — Remove an attribute

### Push Notifications
- `registerPushToken(token)` — Register FCM/APNs token
- `unregisterPush()` — Unregister from push
- `isPushEnabled()` — Check if push is enabled
- `trackPushClick(trackingId)` — Track push notification click

### In-App Messaging
- `onInAppMessage(callback)` — Listen for messages (returns unsubscribe fn)
- `trackInAppImpression(campaignId, action)` — Track impression/click/dismiss

### Utilities
- `flush()` — Flush event queue immediately
- `getAnonymousId()` — Get anonymous ID
- `getUserId()` — Get current user ID
- `getSessionId()` — Get current session ID

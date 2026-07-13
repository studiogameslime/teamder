// withHealth — wires the OS wearable-data hubs so Teamder can READ a player's
// session metrics (steps / distance / heart-rate / calories / speed) from
// whatever watch or band they own, plus the exercise route for the heatmap.
//
//   • iOS      → HealthKit: read-usage Info.plist string + the HealthKit
//                entitlement (Apple Watch + any tracker that writes to Health).
//   • Android  → Health Connect: READ permissions + the <queries> entry so the
//                app can see the Health Connect provider (Samsung/Garmin/Fitbit/
//                Xiaomi/… all sync into it).
//
// Read-only: no WRITE permissions are requested (we never write health data).
// The JS binding (react-native-health-connect / react-native-health) is added
// as a normal dependency; this plugin only declares the native capabilities so
// a build can grant them.
//
// NOTE: intentionally NOT yet registered in app.json's `plugins` array — the
// native health bindings aren't installed, and the iOS HealthKit entitlement
// needs the App ID capability + a regenerated provisioning profile first
// (same class as Associated Domains on the local profile). Add it to app.json
// in the same change that installs the bindings + provisions the capability.

const {
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
  AndroidConfig,
} = require('expo/config-plugins');

const HC_READ_PERMISSIONS = [
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_SPEED',
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_EXERCISE_ROUTE',
];

function withHealthIos(config) {
  const usage =
    'Teamder קורא את נתוני הפעילות שלך מהשעון (מרחק, דופק, קלוריות) כדי להציג לך סיכום פיזי אחרי המשחק. הנתונים נשארים אישיים.';
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSHealthShareUsageDescription = usage;
    // We never write to Health, but some HealthKit bindings expect the key to
    // exist; keep it explicit and honest.
    cfg.modResults.NSHealthUpdateUsageDescription = usage;
    return cfg;
  });
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.healthkit'] = true;
    cfg.modResults['com.apple.developer.healthkit.access'] = [];
    return cfg;
  });
  return config;
}

function withHealthAndroid(config) {
  return withAndroidManifest(config, (cfg) => {
    // cfg.modResults is the WRAPPER { manifest: {...} }. uses-permission and
    // <queries> are children of the <manifest> node — writing them on the
    // wrapper corrupts the XML root.
    const root = cfg.modResults;
    const manifest = root.manifest;
    // 1) READ permissions (uses-permission entries). The library's own config
    //    plugin (react-native-health-connect/app.plugin.js) adds ONLY the
    //    permissions-rationale intent-filter — NOT these READ grants, so we add
    //    them here.
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    const have = new Set(
      manifest['uses-permission'].map((p) => p.$?.['android:name']),
    );
    for (const name of HC_READ_PERMISSIONS) {
      if (!have.has(name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    // 2) <queries> so the app can see the Health Connect provider package.
    manifest.queries = manifest.queries ?? [];
    const hasHcQuery = manifest.queries.some((q) =>
      (q.package ?? []).some(
        (p) => p.$?.['android:name'] === 'com.google.android.apps.healthdata',
      ),
    );
    if (!hasHcQuery) {
      manifest.queries.push({
        package: [{ $: { 'android:name': 'com.google.android.apps.healthdata' } }],
      });
    }
    // NOTE: the permissions-rationale intent-filter is intentionally NOT added
    // here — the library's plugin already pushes it. Adding a second identical
    // filter would just duplicate it.
    return cfg;
  });
}

// Android-only for now. iOS (withHealthIos) is deferred: HealthKit needs the
// capability enabled on the Apple App ID + a regenerated provisioning profile
// first. Restore `config = withHealthIos(config)` here in the same change that
// provisions the iOS capability.
function withHealth(config) {
  config = withHealthAndroid(config);
  return config;
}

module.exports = withHealth;

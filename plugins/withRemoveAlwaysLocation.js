// withRemoveAlwaysLocation — the `expo-location` config plugin always
// injects the "Always" location purpose strings
// (NSLocationAlwaysUsageDescription +
// NSLocationAlwaysAndWhenInUseUsageDescription) with a GENERIC default
// ("Allow $(PRODUCT_NAME) to access your location"), even when we only
// configure `locationWhenInUsePermission`.
//
// On iOS the app only reads a one-shot location for nearby communities.
// The Android-only phone test uses an explicitly started foreground service,
// without ACCESS_BACKGROUND_LOCATION. A
// generic, unused "Always" purpose string is exactly the kind of thing
// App Review flags ("why do you need background location?"), so we
// strip both keys after expo-location has run. Listed AFTER
// `expo-location` in app.json so this withInfoPlist mod wins.

const { withInfoPlist } = require('expo/config-plugins');

function withRemoveAlwaysLocation(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.NSLocationAlwaysUsageDescription;
    delete cfg.modResults.NSLocationAlwaysAndWhenInUseUsageDescription;
    return cfg;
  });
}

module.exports = withRemoveAlwaysLocation;

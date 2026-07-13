/**
 * Teamder Apple Watch companion — native watchOS app injected into the iOS
 * Xcode project at prebuild by @bacons/apple-targets (the iOS analogue of
 * plugins/withWearApp.js for Wear OS). Mirrors the Wear companion: a thin
 * SwiftUI client that shows the LIVE match timer + the next game, fed from the
 * phone over WatchConnectivity (the same WatchPayload the Wear Data Layer gets).
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'watch',
  // watchOS 9.4 = the apple-targets default; supports SwiftUI + WCSession.
  deploymentTarget: '9.4',
  // Apple requires the watch app's bundle id to be <main>.watchkitapp.
  // ⚠️ This id must be provisioned in the Apple Developer portal + added to the
  // production-ios-local profile (same class as Associated Domains / HealthKit).
  bundleIdentifier: 'com.studiogameslime.soccerapp.watchkitapp',
  frameworks: ['WatchConnectivity'],
};

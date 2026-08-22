import Foundation
// RCTEventEmitter, RCTPromiseResolveBlock and friends live in React-Core. The
// podspec already depends on it, but a Swift file still has to import the
// module - without this the whole bridge fails to compile with "cannot find
// type 'RCTEventEmitter' in scope", which is what happened here: iOS had never
// been built for either demo app, so nothing had ever compiled this file.
import React
import Joryio

/// React Native bridge for the Joryio iOS SDK.
/// Each method delegates to the native `Joryio.shared` singleton using its
/// real public API (see sdk-ios `JoryioSDK.swift`).
@objc(JoryioModule)
class JoryioModule: RCTEventEmitter {

  private var hasListeners = false

  // `requiresMainQueueSetup` is declared in JoryioModule.m (the RCT_EXTERN
  // category) to avoid a duplicate Objective-C selector definition.

  override func supportedEvents() -> [String]! {
    return ["JoryioInAppMessage", "JoryioSdkAuthError"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  // MARK: - Initialization

  @objc func initialize(
    _ sdkKey: String,
    apiHost: String,
    config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // JoryioConfig is an immutable struct — build it via its initializer
    // rather than mutating fields (which are `let`).
    let enableDebug = config["enableDebug"] as? Bool ?? false

    let logLevel: JoryioConfig.LogLevel = {
      if let raw = config["logLevel"] as? String,
         let level = JoryioConfig.LogLevel(rawValue: raw) {
        return level
      }
      return enableDebug ? .debug : .error
    }()

    let batchSize = config["batchSize"] as? Int ?? ConfigDefaults.batchSize
    // JS sends milliseconds; the iOS SDK expects seconds.
    let flushInterval = (config["flushInterval"] as? Double).map { $0 / 1000.0 }
      ?? ConfigDefaults.flushInterval
    let sessionTimeout = (config["sessionTimeout"] as? Double).map { $0 / 1000.0 }
      ?? ConfigDefaults.sessionTimeout
    let trackSessionStart = config["trackSessionStart"] as? Bool ?? true
    // Opt-in auto-prompt; see JoryioConfig.requestPushPermissionAtLaunch.
    let requestPushPermissionAtLaunch = config["requestPushPermissionAtLaunch"] as? Bool ?? false
    let userId = config["userId"] as? String

    // Optional SDK authentication (opt-in). Mirrors the sdk-ios
    // JoryioConfig fields; both default off/nil so behaviour is unchanged.
    let enableSdkAuthentication = config["enableSdkAuthentication"] as? Bool ?? false
    let sdkAuthenticationToken = config["sdkAuthenticationToken"] as? String

    // In-app: HTML messages render in a web view that can execute script (the
    // SDK's own bridge runs there), so this is opt-in and OFF by default. The
    // server strips <script> and on* handlers, so author JS does not run in
    // normal operation - the residual risk is a sanitiser bypass. The Android bridge already forwarded
    // it; without this arm the same JS config silently did nothing on iOS and
    // an app that opted in still had every HTML campaign skipped.
    let allowHtmlJsInAppMessages = config["allowHtmlJsInAppMessages"] as? Bool ?? false

    let joryioConfig = JoryioConfig(
      userId: userId,
      batchSize: batchSize,
      flushInterval: flushInterval,
      sessionTimeout: sessionTimeout,
      trackSessionStart: trackSessionStart,
      requestPushPermissionAtLaunch: requestPushPermissionAtLaunch,
      inApp: InAppConfig(allowHtmlJsInAppMessages: allowHtmlJsInAppMessages),
      enableSdkAuthentication: enableSdkAuthentication,
      sdkAuthenticationToken: sdkAuthenticationToken,
      enableDebug: enableDebug,
      logLevel: logLevel
    )

    DispatchQueue.main.async {
      Joryio.shared.initialize(sdkKey: sdkKey, apiHost: apiHost, config: joryioConfig)

      // Forward SDK-authentication rejections to JS via the event emitter so the
      // RN layer can mint a fresh token and call setSdkAuthenticationToken.
      // Harmless when SDK auth is disabled (the handler simply never fires).
      Joryio.shared.setSdkAuthenticationErrorHandler { [weak self] authError in
        self?.emitSdkAuthError(authError)
      }

      resolve(nil)
    }
  }

  // MARK: - Event Tracking

  @objc func track(_ eventName: String, properties: NSDictionary) {
    let props = properties as? [String: Any] ?? [:]
    Joryio.shared.track(eventName, properties: props)
  }

  @objc func trackScreen(_ screenName: String, properties: NSDictionary) {
    let props = properties as? [String: Any] ?? [:]
    Joryio.shared.trackScreen(screenName, properties: props)
  }

  // MARK: - Identity

  @objc func identify(_ userId: String) {
    Joryio.shared.identify(userId)
  }

  @objc func alias(_ userId: String) {
    Joryio.shared.alias(userId)
  }

  @objc func reset() {
    Joryio.shared.reset()
  }

  // MARK: - Attributes

  @objc func setAttributes(_ attributes: NSDictionary) {
    let attrs = attributes as? [String: Any] ?? [:]
    Joryio.shared.setAttributes(attrs)
  }

  @objc func setAttribute(_ key: String, value: Any) {
    Joryio.shared.setAttribute(key, value: value)
  }

  @objc func incrementAttribute(_ key: String, by: NSNumber) {
    Joryio.shared.incrementAttribute(key, by: by.doubleValue)
  }

  @objc func unsetAttribute(_ key: String) {
    Joryio.shared.unsetAttribute(key)
  }

  // MARK: - Push

  @objc func registerPushToken(_ token: String) {
    Joryio.shared.registerPushToken(token)
  }

  @objc func unregisterPush() {
    Joryio.shared.unregisterPush()
  }

  /// Show the system notification prompt, resolving the resulting status.
  ///
  /// Resolves a status string rather than a bare boolean so JS can tell "denied"
  /// from "we could not ask" - that difference decides whether showing a primer
  /// again is worth anything. Vocabulary matches the Android bridge.
  @objc func requestPushPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      _ = await Joryio.shared.requestPushPermission()
      resolve(await Joryio.shared.getPushPermissionStatus())
    }
  }

  @objc func getPushPermissionStatus(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task { resolve(await Joryio.shared.getPushPermissionStatus()) }
  }

  @objc func isPushEnabled(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // isPushEnabled() is async on the iOS SDK — await it before resolving.
    Task {
      let enabled = await Joryio.shared.isPushEnabled()
      resolve(enabled)
    }
  }

  @objc func trackPushClick(_ trackingId: String) {
    Joryio.shared.trackPushClick(trackingId: trackingId)
  }

  // MARK: - In-App Messaging

  /// The iOS SDK renders in-app messages natively (UIKit views), so there is no
  /// HTML/CSS callback to forward to JS like on Android/web. This is a
  /// documented no-op: `onInAppMessage` in JS simply never fires on iOS; the
  /// SDK presents and tracks in-app messages itself.
  @objc func enableInAppMessages() {
    // No-op on iOS — in-app messages are presented by the native SDK.
  }

  /// No-op on iOS: the native SDK tracks its own in-app impressions when it
  /// presents/dismisses a message. Kept for API parity with the JS/Android SDK.
  @objc func trackInAppImpression(_ campaignId: String, action: String) {
    // No-op on iOS — impressions are tracked natively by the SDK.
  }

  // MARK: - SDK Authentication

  /// Supply/replace the customer-minted SDK-authentication JWT.
  /// Mirrors sdk-ios `Joryio.setSdkAuthenticationToken(_:)`.
  @objc func setSdkAuthenticationToken(_ token: String) {
    Joryio.shared.setSdkAuthenticationToken(token)
  }

  /// Forward an SDK-authentication rejection to JS. Only emits when the JS side
  /// has an active listener (RCTEventEmitter requirement).
  private func emitSdkAuthError(_ authError: SdkAuthError) {
    guard hasListeners else { return }
    sendEvent(withName: "JoryioSdkAuthError", body: [
      "reason": authError.reason.rawValue,
      "endpoint": authError.endpoint,
      "refreshExhausted": authError.refreshExhausted
    ])
  }

  // MARK: - Utilities

  @objc func flush() {
    Joryio.shared.flush()
  }

  @objc func getAnonymousId(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Joryio.shared.getAnonymousId())
  }

  /// What the SDK is ACTUALLY doing, as opposed to what the app configured.
  ///
  /// A host app can only display the config it set, which stays cheerfully
  /// green while every request is rejected. Returns the live endpoint and the
  /// last transport failure so a status view can tell the truth.
  /// Fetch in-app campaigns now, and display any that are eligible.
  ///
  /// The SDK syncs on session start and on foreground; this is for the moments
  /// in between - after a reset, or after the user does something that should
  /// make them newly eligible. The RN bridge had no sync at all, so a React
  /// Native app could only wait for the next lifecycle event.
  @objc func syncInAppCampaigns() {
    Task { await Joryio.shared.syncInAppCampaigns() }
  }

  /// Forget which campaigns have already been shown on this device.
  ///
  /// The SDK filters out any campaign in `displayedCampaigns`, and that set is
  /// PERSISTED - so a message shows once per install and then never again.
  /// Native apps could already call this; React Native could not, which made a
  /// campaign untestable after its first display without deleting the app.
  @objc func resetDisplayedCampaigns() {
    Joryio.shared.resetDisplayedCampaigns()
  }

  @objc func getDiagnostics(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    var result: [String: Any] = [
      "apiEndpoint": Joryio.shared.currentApiEndpoint ?? NSNull(),
    ]
    if let err = Joryio.shared.lastTransportError {
      result["lastError"] = [
        "message": err.message,
        "isUnauthorized": err.isUnauthorized,
        "at": err.at.timeIntervalSince1970 * 1000,
      ]
    }
    resolve(result)
  }

  @objc func getUserId(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Joryio.shared.getUserId())
  }

  @objc func getSessionId(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Joryio.shared.getSessionId())
  }
}

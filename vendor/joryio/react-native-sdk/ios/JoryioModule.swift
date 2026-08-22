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

  // MARK: - E-commerce

  /// ONE bridge method, not nineteen - see the Android module for the reasoning.
  /// The canonical event names and purchase property keys live in the native
  /// tracker; rebuilding them in JS would be a fifth copy of a vocabulary that
  /// has no server-side alias layer, so a near-miss is stored verbatim and
  /// matches no report.
  ///
  /// The case list here MUST match the Android `when` and the JS surface. A spec
  /// compares all three, because nothing else can: three languages, none
  /// importing another.
  @objc func ecommerce(_ method: String, payload: NSDictionary) {
    let tracker = Joryio.shared.ecommerce()
    let p = payload as? [String: Any] ?? [:]

    switch method {
    case "viewProduct":
      tracker.viewProduct(Self.product(p["product"]))
    case "viewCategory":
      tracker.viewCategory(
        categoryId: p["categoryId"] as? String ?? "",
        categoryName: p["categoryName"] as? String ?? "")
    case "search":
      tracker.search(query: p["query"] as? String ?? "", resultCount: p["resultCount"] as? Int)
    case "addToCart":
      tracker.addToCart(item: Self.cartItem(p["item"]), cartValue: p["cartValue"] as? Double)
    case "removeFromCart":
      tracker.removeFromCart(product: Self.product(p["product"]), quantity: p["quantity"] as? Int ?? 1)
    case "cartViewed":
      tracker.cartViewed(
        items: Self.cartItems(p["items"]),
        cartValue: p["cartValue"] as? Double ?? 0)
    case "updateCart":
      tracker.updateCart(
        items: Self.cartItems(p["items"]),
        cartValue: p["cartValue"] as? Double ?? 0)
    case "startCheckout":
      tracker.startCheckout(
        items: Self.cartItems(p["items"]),
        cartValue: p["cartValue"] as? Double ?? 0)
    case "addPaymentInfo":
      tracker.addPaymentInfo(paymentMethod: p["paymentMethod"] as? String ?? "")
    case "purchase":
      tracker.purchase(order: Self.order(p["order"]))
    case "orderFulfilled":
      tracker.orderFulfilled(
        orderId: p["orderId"] as? String ?? "",
        trackingNumber: p["trackingNumber"] as? String,
        carrier: p["carrier"] as? String)
    case "orderDelivered":
      tracker.orderDelivered(orderId: p["orderId"] as? String ?? "")
    case "orderCancelled":
      tracker.orderCancelled(orderId: p["orderId"] as? String ?? "", reason: p["reason"] as? String)
    case "orderRefunded":
      tracker.orderRefunded(
        orderId: p["orderId"] as? String ?? "",
        refundAmount: p["refundAmount"] as? Double,
        reason: p["reason"] as? String)
    case "addToWishlist":
      tracker.addToWishlist(product: Self.product(p["product"]))
    case "removeFromWishlist":
      tracker.removeFromWishlist(product: Self.product(p["product"]))
    case "shareProduct":
      tracker.shareProduct(
        product: Self.product(p["product"]),
        shareMethod: p["shareMethod"] as? String ?? "")
    case "applyCoupon":
      tracker.applyCoupon(
        couponCode: p["couponCode"] as? String ?? "",
        discountAmount: p["discountAmount"] as? Double,
        discountType: p["discountType"] as? String)
    case "removeCoupon":
      tracker.removeCoupon(couponCode: p["couponCode"] as? String ?? "")
    case "submitReview":
      tracker.submitReview(
        productId: p["productId"] as? String ?? "",
        rating: p["rating"] as? Int ?? 0,
        reviewText: p["reviewText"] as? String)
    default:
      // Loudly, not silently: a typo'd method name would otherwise be a no-op
      // that looks exactly like the SDK working.
      NSLog("[Joryio] Unknown ecommerce method '\(method)' - event NOT sent")
    }
  }

  private static func product(_ raw: Any?) -> EcommerceProduct {
    let m = raw as? [String: Any] ?? [:]
    return EcommerceProduct(
      productId: m["productId"] as? String ?? "",
      name: m["name"] as? String ?? "",
      price: m["price"] as? Double ?? 0,
      quantity: m["quantity"] as? Int,
      category: m["category"] as? String,
      brand: m["brand"] as? String,
      variant: m["variant"] as? String,
      variantId: m["variantId"] as? String,
      sku: m["sku"] as? String,
      imageUrl: m["imageUrl"] as? String,
      url: m["url"] as? String)
  }

  private static func cartItem(_ raw: Any?) -> EcommerceCartItem {
    let m = raw as? [String: Any] ?? [:]
    return EcommerceCartItem(
      productId: m["productId"] as? String ?? "",
      name: m["name"] as? String ?? "",
      price: m["price"] as? Double ?? 0,
      // Defaults to 1, not 0: a cart line with zero quantity has an item total
      // of zero, which is a silently wrong revenue number rather than an
      // obviously wrong one. Matches Android.
      quantity: m["quantity"] as? Int ?? 1,
      category: m["category"] as? String,
      brand: m["brand"] as? String,
      variant: m["variant"] as? String,
      variantId: m["variantId"] as? String,
      sku: m["sku"] as? String,
      imageUrl: m["imageUrl"] as? String,
      url: m["url"] as? String)
  }

  private static func cartItems(_ raw: Any?) -> [EcommerceCartItem] {
    guard let arr = raw as? [Any] else { return [] }
    return arr.map { cartItem($0) }
  }

  private static func order(_ raw: Any?) -> EcommerceOrder {
    let m = raw as? [String: Any] ?? [:]
    return EcommerceOrder(
      orderId: m["orderId"] as? String ?? "",
      items: cartItems(m["items"]),
      value: m["value"] as? Double ?? 0,
      currency: m["currency"] as? String,
      shipping: m["shipping"] as? Double,
      tax: m["tax"] as? Double,
      discount: m["discount"] as? Double,
      coupon: m["coupon"] as? String)
  }

  // MARK: - In-App Messaging

  /// Hand in-app messages to JS, exactly as the Android module does.
  ///
  /// This was a no-op, on a premise that had expired: the comment said the iOS
  /// SDK "renders natively, so there is no callback to forward", which was true
  /// when written. iOS later gained setInAppMessageCallback and the bridge was
  /// never updated - so onInAppMessage fired on Android and never on iOS, and
  /// one React Native app showed its own branded UI on Android and a
  /// native-styled dialog on iOS. The docs promised the first for both.
  ///
  /// THE PAYLOAD MUST MATCH ANDROID FIELD FOR FIELD, because the same
  /// JavaScript renders both. Two places where reflection would have been
  /// wrong, and silently:
  ///
  ///   - `deepLink` in Swift is `DEEP_LINK` in Kotlin, whose lowercased name is
  ///     `deep_link`. String(describing:) yields "deepLink", which no JS
  ///     renderer branches on - every deep-link button would quietly do nothing
  ///     on iOS only.
  ///   - MessageType is already a String enum with the right raw values, so it
  ///     uses rawValue rather than a second spelling of the same list.
  ///
  /// So the mapping is written out explicitly. It is longer, and it cannot
  /// drift into a wrong string without someone editing that string.
  @objc func enableInAppMessages(_ capabilities: NSArray?) {
    // What THIS app can render, declared from JS - see the Android module.
    // Null keeps the previous behaviour rather than asserting anything.
    let declared = (capabilities as? [String])?.filter { !$0.isEmpty }

    Joryio.shared.setInAppMessageCallback({ [weak self] campaign in
      guard let self else { return }

      // RCTEventEmitter requires an active listener; matches emitSdkAuthError.
      // Deliberately checked BEFORE the content guard so the two reasons a
      // message is dropped stay distinguishable in the log.
      guard self.hasListeners else {
        NSLog("[Joryio] No JS listener for JoryioInAppMessage; dropping \(campaign.id)")
        return
      }

      guard let content = campaign.content else {
        // A campaign with no renderable document is DROPPED rather than emitted
        // with empty strings - JS would otherwise render a blank container the
        // user has to dismiss, and count an impression for it. Matches Android.
        NSLog("[Joryio] Campaign \(campaign.id) has no content; not emitting")
        return
      }

      var params: [String: Any] = [
        "id": campaign.id,
        "name": campaign.name,
        // Wire value, not the case name: JS types this as
        // 'modal' | 'banner' | 'slideup' | 'fullscreen' | 'custom'.
        "type": campaign.type.rawValue,
        "priority": campaign.priority,
      ]

      switch content {
      case let .html(html, css):
        params["kind"] = "html"
        params["html"] = html
        params["css"] = css

      case let .native(native):
        params["kind"] = "native"
        if let title = native.title { params["title"] = title }
        params["body"] = native.body
        if let imageUrl = native.imageUrl { params["imageUrl"] = imageUrl }
        params["closeButton"] = native.closeButton
        params["backdropDismissible"] = native.backdropDismissible

        // Author style overrides. Forwarded rather than applied: the HOST draws
        // the message, so resolving these here would compute the campaign's
        // colours and then throw them away.
        if let st = native.style {
          var style: [String: Any] = [:]
          if let v = st.backgroundColor { style["backgroundColor"] = v }
          if let v = st.textColor { style["textColor"] = v }
          if let v = st.primaryButtonColor { style["primaryButtonColor"] = v }
          if let v = st.primaryButtonTextColor { style["primaryButtonTextColor"] = v }
            if let v = st.cornerRadius { style["cornerRadius"] = v }
        if let v = st.fontSize { style["fontSize"] = v }
          if let v = st.titleWeight { style["titleWeight"] = v }
          if let v = st.textAlign { style["textAlign"] = v }
          if let v = st.fontFamily { style["fontFamily"] = v }
          params["style"] = style
        }

        params["buttons"] = native.buttons.map { b -> [String: Any] in
          var button: [String: Any] = [
            "id": b.id,
            "text": b.text,
            "action": Self.buttonActionWireValue(b.action),
          ]
          if let url = b.url { button["url"] = url }
          return button
        }
      }

      self.sendEvent(withName: "JoryioInAppMessage", body: params)
    }, capabilities: declared)
  }

  /// The wire spelling Android sends, written out rather than derived.
  ///
  /// Kotlin's DEEP_LINK.lowercase() is "deep_link"; Swift's `.deepLink`
  /// described is "deepLink". Deriving either from the case name produces a
  /// value the JS renderer does not branch on, on one platform only.
  private static func buttonActionWireValue(_ action: ButtonAction) -> String {
    switch action {
    case .dismiss: return "dismiss"
    case .url: return "url"
    case .deepLink: return "deep_link"
    case .requestPushPermission: return "request_push_permission"
    }
  }

  /// Report an impression for a message JS rendered.
  ///
  /// Also previously a no-op, and it could not stay one once the callback above
  /// works: the SDK cannot see a message it did not draw. An unreported
  /// campaign still spends the frequency budget - so it suppresses the
  /// campaigns behind it - while emitting no in_app.displayed at all, which
  /// reads as delivered to nobody and breaks revenue attribution.
  @objc func trackInAppImpression(_ campaignId: String, action: String) {
    Joryio.shared.trackInAppImpression(campaignId: campaignId, action: action)
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

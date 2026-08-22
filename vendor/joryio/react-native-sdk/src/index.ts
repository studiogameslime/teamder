import { NativeModules, NativeEventEmitter } from 'react-native';

const { JoryioModule } = NativeModules;

const MODULE_MISSING_MESSAGE =
  '@joryio/react-native-sdk: NativeModule not found. ' +
  'Make sure you ran `pod install` (iOS) / rebuilt the app (Android). ' +
  'All Joryio calls will be no-ops until the native module is linked.';

// Degrade instead of crashing the whole JS bundle on import: if the native
// module isn't linked, warn once and turn every method into a safe no-op.
const isModuleAvailable = !!JoryioModule;
if (!isModuleAvailable) {
  // eslint-disable-next-line no-console
  console.warn(MODULE_MISSING_MESSAGE);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JoryioConfig {
  /**
   * Ask for notification permission automatically, soon after initialize().
   *
   * **Off by default, and that default is the recommendation.** The system
   * prompt can be shown exactly once and a refusal is permanent short of a trip
   * to Settings, so firing it at launch - before the user has any reason to
   * want notifications from you - is how apps spend their single ask for
   * nothing. Prefer a primer (the `request_push_permission` in-app button) and
   * call `requestPushPermission()` when the user says yes.
   *
   * Turn this on only when notifications ARE the product.
   *
   * Works on both platforms. On iOS the prompt fires straight after
   * initialize(); on Android it waits for the first foreground, because the
   * system prompt there needs an Activity.
   */
  requestPushPermissionAtLaunch?: boolean;
  /** Enable debug logging (default: false) */
  enableDebug?: boolean;
  /** Log level: 'debug' | 'info' | 'warn' | 'error' (default: 'info') */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Event batch size before auto-flush. Omit to use the native default (50). */
  batchSize?: number;
  /** Event flush interval in ms. Omit to use the native default (5000). */
  flushInterval?: number;
  /** Session timeout in ms. Omit to use the native default (1800000 / 30 min). */
  sessionTimeout?: number;
  /** Automatically track session start (default: true) */
  trackSessionStart?: boolean;
  /** Initial user ID if known at init time */
  userId?: string;
  /**
   * Enable JWT-based SDK Authentication (default: false). When enabled, supply a
   * customer-minted JWT via `sdkAuthenticationToken` and/or
   * `setSdkAuthenticationToken()`; it is attached to every ingest request.
   */
  enableSdkAuthentication?: boolean;
  /** Initial SDK-authentication JWT, if known at init time. */
  sdkAuthenticationToken?: string;

  /**
   * Allow in-app messages authored as HTML, which can execute JavaScript
   * inside your app.
   *
   * OFF BY DEFAULT. The server strips `<script>` and every `on*` handler
   * before sending, so author JavaScript does not run in normal operation. The
   * document is still rendered in a web view that can execute script, so the
   * residual risk is a sanitiser bypass - and because the document is authored
   * server-side, a compromised marketing account would then mean code
   * executing in every user's session, which is why regulated apps often
   * prohibit it outright.
   *
   * Leaving this off does NOT disable in-app messaging: native messages still
   * display, because they are data your app renders with its own components.
   */
  allowHtmlJsInAppMessages?: boolean;
}

export type UserAttributes = Record<string, string | number | boolean | null>;

/**
 * Notification permission state, identical on iOS and Android.
 *
 * `unavailable` means we could not ask at all (no Activity, SDK not ready, or a
 * platform with no notification support) - distinct from `denied`, which means
 * the user said no and the prompt will not appear again.
 */
export type PushPermissionStatus =
  | 'granted'
  | 'denied'
  | 'notDetermined'
  | 'unavailable';

/** Reason an ingest request was rejected with a 401 `sdk_authentication_error`. */
export interface SdkAuthError {
  reason: 'missing' | 'invalid' | 'expired' | 'sub_mismatch' | 'unknown';
  /** Raw wire `reason` string, for logging / forward-compat. */
  rawReason?: string;
}

/**
 * An in-app message to display.
 *
 * `kind` discriminates the content. BOTH kinds reach JS: a React Native app
 * renders its own UI, so dropping native here would mean native campaigns never
 * display in RN apps while still counting as delivered server-side.
 *
 * Native fields are TEXT, not markup - the server does not HTML-escape them
 * (escaping would show the user `A &amp; B`), so rendering one into a WebView
 * or `dangerouslySetInnerHTML` would reintroduce the injection native avoids.
 * Put them in a <Text>.
 */
export type InAppMessage = InAppMessageBase &
  (
    | { kind: 'html'; html: string; css: string }
    | {
        kind: 'native';
        title?: string;
        body: string;
        imageUrl?: string;
        buttons: Array<{
          id: string;
          text: string;
          action: 'dismiss' | 'url' | 'deep_link';
          url?: string;
        }>;
        closeButton: boolean;
        backdropDismissible: boolean;
        /**
         * Optional presentation overrides set by the campaign author.
         *
         * Every field is optional and an absent one means INHERIT your app's
         * own styling - which is why a message with no overrides looks like the
         * rest of your UI. Apply the ones that are present; do not substitute
         * defaults of your own for the ones that are not.
         *
         * `fontFamily` is best effort: apply it only if your app bundles that
         * font, and keep your own typeface when it does not - substituting an
         * arbitrary font looks worse than ignoring the override.
         */
        style?: {
          backgroundColor?: string;
          textColor?: string;
          primaryButtonColor?: string;
          primaryButtonTextColor?: string;
          cornerRadius?: number;
          /** Body size; scale the headline from it to keep the hierarchy. */
          fontSize?: number;
          titleWeight?: 'regular' | 'medium' | 'semibold' | 'bold';
          /**
           * `auto` (or absent) means align by the MESSAGE's own language, not
           * the device locale - `I18nManager.isRTL` is the wrong test, because
           * one workspace sends Hebrew and English to the same app. React
           * Native's `writingDirection: 'auto'` does this for you.
           */
          textAlign?: 'auto' | 'start' | 'center' | 'end';
          /** Apply only if your app bundles it; otherwise keep your own. */
          fontFamily?: string;
        };
      }
  );

export interface InAppMessageBase {
  id: string;
  name: string;
  type: 'modal' | 'banner' | 'slideup' | 'fullscreen' | 'custom';
  priority: number;
}

// ─── Event Emitter ───────────────────────────────────────────────────────────

// Only construct the emitter when the native module exists — NativeEventEmitter
// throws if handed a null module.
const emitter = isModuleAvailable ? new NativeEventEmitter(JoryioModule) : null;

// ─── SDK Class ───────────────────────────────────────────────────────────────

/**
 * How long a value-returning call waits for initialize() before giving up and
 * returning its documented "not available" value. See _awaitReady.
 */
const READY_TIMEOUT_MS = 5000;

class JoryioSDK {
  /**
   * Resolves once initialize() has completed. This is the SDK's readiness
   * primitive, and BOTH call shapes are built on it:
   *
   *  - fire-and-forget calls (track, identify, …) chain onto it, so they run
   *    after init instead of hitting an uninitialized native module;
   *  - value-returning calls (getAnonymousId, getUserId, …) AWAIT it, which a
   *    callback queue could never do — you cannot buffer something the caller
   *    is waiting on the answer to.
   *
   * That gap is what broke React Native in-app messaging: the queue covered the
   * void calls, so every getter called before init threw "Joryio SDK not
   * initialized" straight through to a red box.
   */
  private _ready: Promise<void>;
  private _markReady!: () => void;
  /** True once initialize() has completed SUCCESSFULLY. */
  private _initialized = false;
  /**
   * True when initialize() ran and FAILED. Distinct from "not yet initialized":
   * that one is temporary and worth waiting for, this one never resolves, so
   * every subsequent call must degrade instead of waiting or throwing.
   */
  private _initFailed = false;

  constructor() {
    this._ready = new Promise<void>((resolve) => {
      this._markReady = resolve;
    });
  }

  /**
   * Wait for initialize(), but never forever.
   *
   * An unbounded await would be WORSE than the throw it replaces: a host app
   * that forgets initialize() (or whose init failed) would hang on the first
   * getter with no error to search for. On timeout the caller gets the same
   * "not available" value it already gets when the native module is missing,
   * plus a warning naming the actual cause.
   *
   * @returns true if the SDK became ready, false if it timed out.
   */
  private async _awaitReady(caller: string): Promise<boolean> {
    if (this._initialized) return true;
    if (this._initFailed) return false;
    const timedOut = Symbol('timeout');
    const result = await Promise.race([
      this._ready,
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), READY_TIMEOUT_MS),
      ),
    ]);
    if (result === timedOut) {
      // eslint-disable-next-line no-console
      console.warn(
        `[Joryio] ${caller}() was called but initialize() has not completed after ` +
          `${READY_TIMEOUT_MS}ms — returning a default. Call Joryio.initialize() at app start.`,
      );
      return false;
    }
    return true;
  }

  /**
   * Route a fire-and-forget native call safely:
   *  - no-op when the native module isn't linked,
   *  - defer until initialize() resolves so we never hit native before init,
   *  - swallow (and warn) native errors so a bad call can't crash the host app.
   */
  private _dispatch(fn: () => void): void {
    if (!isModuleAvailable) return;
    void this._ready.then(() => {
      // initialize() failed: the native SDK will throw on every call. Drop them
      // the same way a missing native module is dropped — a broken SDK must not
      // take the HOST APP down with it, and on React Native an unhandled native
      // throw is a full-screen red box.
      if (this._initFailed) return;
      try {
        fn();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Joryio] native call failed', e);
      }
    });
  }

  /**
   * Initialize the SDK. Must be called before any other method.
   *
   * @example
   * ```ts
   * import Joryio from '@joryio/react-native-sdk';
   *
   * Joryio.initialize('jry_sdk_ios_abc123', 'api-eu1.joryio.com', {
   *   enableDebug: __DEV__,
   *   trackSessionStart: true,
   * });
   * ```
   */
  async initialize(
    sdkKey: string,
    apiHost: string,
    config: JoryioConfig = {},
  ): Promise<void> {
    if (!isModuleAvailable) {
      // eslint-disable-next-line no-console
      console.warn(`${MODULE_MISSING_MESSAGE} initialize() is a no-op.`);
      return;
    }
    try {
      await JoryioModule.initialize(sdkKey, apiHost, config);
      this._initialized = true;
    } catch (e) {
      // Record the failure rather than rethrowing into the host app's startup.
      // Everything downstream then degrades to a no-op with one clear warning,
      // instead of each call throwing its own "SDK not initialized".
      this._initFailed = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[Joryio] initialize() failed; the SDK is disabled for this session. ' +
          'Tracking and in-app messaging will no-op.',
        e,
      );
    } finally {
      // Settle READINESS even when native init THREW. Leaving it unresolved
      // would hang every deferred call and every getter for the life of the
      // process — a failed init must degrade, not deadlock. `_initFailed` is
      // what makes that degradation quiet: deferred calls are dropped and
      // getters return defaults, rather than each throwing its own red box.
      this._markReady();
    }
  }

  // ─── Event Tracking ──────────────────────────────────────────────────────

  /**
   * Track a custom event.
   *
   * @example
   * ```ts
   * Joryio.track('Product Added', { productId: '123', price: 29.99 });
   * ```
   */
  track(eventName: string, properties: Record<string, unknown> = {}): void {
    this._dispatch(() => JoryioModule.track(eventName, properties));
  }

  /**
   * Track a screen view.
   *
   * @example
   * ```ts
   * Joryio.trackScreen('ProductDetail', { productId: '123' });
   * ```
   */
  trackScreen(
    screenName: string,
    properties: Record<string, unknown> = {},
  ): void {
    this._dispatch(() => JoryioModule.trackScreen(screenName, properties));
  }

  // ─── User Identity ───────────────────────────────────────────────────────

  /**
   * Identify the current user by their user ID.
   * Call this after login or when you know who the user is.
   *
   * @example
   * ```ts
   * Joryio.identify('user-123');
   * ```
   */
  identify(userId: string): void {
    this._dispatch(() => JoryioModule.identify(userId));
  }

  /**
   * Alias the current anonymous user to a known user ID.
   * Links the anonymous session history to the identified user.
   */
  alias(userId: string): void {
    this._dispatch(() => JoryioModule.alias(userId));
  }

  /**
   * Reset the user identity. Call this on logout.
   * Clears user ID, starts new anonymous session, clears in-app messages.
   */
  reset(): void {
    this._dispatch(() => JoryioModule.reset());
  }

  // ─── User Attributes ─────────────────────────────────────────────────────

  /**
   * Set multiple user attributes at once.
   *
   * @example
   * ```ts
   * Joryio.setAttributes({
   *   firstName: 'John',
   *   plan: 'premium',
   *   age: 28,
   * });
   * ```
   */
  setAttributes(attributes: UserAttributes): void {
    this._dispatch(() => JoryioModule.setAttributes(attributes));
  }

  /**
   * Set a single user attribute.
   */
  setAttribute(key: string, value: string | number | boolean): void {
    this._dispatch(() => JoryioModule.setAttribute(key, value));
  }

  /**
   * Increment a numeric user attribute.
   *
   * @example
   * ```ts
   * Joryio.incrementAttribute('loginCount', 1);
   * ```
   */
  incrementAttribute(key: string, by: number = 1): void {
    this._dispatch(() => JoryioModule.incrementAttribute(key, by));
  }

  /**
   * Remove a user attribute.
   */
  unsetAttribute(key: string): void {
    this._dispatch(() => JoryioModule.unsetAttribute(key));
  }

  // ─── Push Notifications ──────────────────────────────────────────────────

  /**
   * Register a push notification token (FCM on Android, APNs on iOS).
   * Typically called after receiving the token from Firebase or Apple.
   *
   * @example
   * ```ts
   * // With @react-native-firebase/messaging
   * const token = await messaging().getToken();
   * Joryio.registerPushToken(token);
   * ```
   */
  registerPushToken(token: string): void {
    this._dispatch(() => JoryioModule.registerPushToken(token));
  }

  /**
   * Unregister from push notifications.
   */
  unregisterPush(): void {
    this._dispatch(() => JoryioModule.unregisterPush());
  }

  /**
   * Where the user stands on notifications, without asking them anything.
   *
   * Check this BEFORE showing a primer: `notDetermined` is the ONLY state in
   * which the system prompt can still appear. Push permission is one-shot on
   * iOS and Android 13+ - a denial is recoverable only in system Settings - so a
   * primer shown to an already-denied user spends their goodwill on a prompt
   * that can never be displayed.
   */
  async getPushPermissionStatus(): Promise<PushPermissionStatus> {
    if (!isModuleAvailable) return 'unavailable';
    if (!(await this._awaitReady('getPushPermissionStatus'))) return 'unavailable';
    return JoryioModule.getPushPermissionStatus();
  }

  /**
   * Show the system notification prompt, resolving the resulting status.
   *
   * The SDK never calls this for you. The prompt can only be shown once, and
   * neither `initialize()` nor a dashboard toggle can know when your app has
   * earned the right to ask - so the moment is yours. Ask after a booking, a
   * purchase, or from a notification settings screen; not on first launch.
   *
   * ```ts
   * if ((await Joryio.getPushPermissionStatus()) === 'notDetermined') {
   *   // show your own primer first, then:
   *   const status = await Joryio.requestPushPermission();
   * }
   * ```
   *
   * On Android this covers the API 33+ POST_NOTIFICATIONS runtime permission and
   * registers the FCM token on a grant. Below API 33 nothing is shown and the
   * current Settings state is reported.
   */
  async requestPushPermission(): Promise<PushPermissionStatus> {
    if (!isModuleAvailable) return 'unavailable';
    if (!(await this._awaitReady('requestPushPermission'))) return 'unavailable';
    return JoryioModule.requestPushPermission();
  }

  /**
   * Check if push notifications are enabled.
   */
  async isPushEnabled(): Promise<boolean> {
    if (!isModuleAvailable) return false;
    if (!(await this._awaitReady('isPushEnabled'))) return false;
    return JoryioModule.isPushEnabled();
  }

  /**
   * Track a push notification click (for analytics).
   * Call this when the user taps a push notification.
   */
  trackPushClick(trackingId: string): void {
    this._dispatch(() => JoryioModule.trackPushClick(trackingId));
  }

  // ─── In-App Messaging ────────────────────────────────────────────────────

  /**
   * Listen for in-app messages that are ready to display.
   * Returns an unsubscribe function.
   *
   * @example
   * ```ts
   * const unsubscribe = Joryio.onInAppMessage((message) => {
   *   console.log('Show in-app:', message.name);
   *   // Render the message in your UI
   * });
   *
   * // Later:
   * unsubscribe();
   * ```
   */
  onInAppMessage(callback: (message: InAppMessage) => void): () => void {
    if (!isModuleAvailable || !emitter) {
      return () => {};
    }
    const subscription = emitter.addListener(
      'JoryioInAppMessage',
      callback,
    );
    // Via _dispatch, like every other native call. Called directly, this threw
    // "Joryio SDK not initialized" and RN surfaced a red box: a host app
    // naturally subscribes on mount, which is BEFORE initialize() resolves, so
    // in-app messaging never enabled at all. _dispatch queues the call until the
    // SDK is ready and then replays it.
    this._dispatch(() => JoryioModule.enableInAppMessages());
    return () => subscription.remove();
  }

  /**
   * Track an in-app message impression or action.
   *
   * @param campaignId - The campaign ID from the message
   * @param action - 'displayed' | 'clicked' | 'dismissed'
   */
  trackInAppImpression(campaignId: string, action: string): void {
    this._dispatch(() => JoryioModule.trackInAppImpression(campaignId, action));
  }

  // ─── SDK Authentication ──────────────────────────────────────────────────

  /**
   * Set/replace the customer-minted JWT used for SDK Authentication.
   * Attached as the `X-Joryio-Auth` header on every subsequent ingest request.
   * Call after login, and again from your `onSdkAuthenticationError` handler to
   * supply a freshly minted token.
   *
   * @example
   * ```ts
   * const jwt = await mintJoryioJwt(); // your backend mints it
   * Joryio.setSdkAuthenticationToken(jwt);
   * ```
   */
  setSdkAuthenticationToken(token: string): void {
    this._dispatch(() => JoryioModule.setSdkAuthenticationToken(token));
  }

  /**
   * Listen for SDK-authentication failures (the backend rejected the JWT with a
   * 401 `sdk_authentication_error`). Mint a fresh JWT in the callback and call
   * `setSdkAuthenticationToken()`; the refreshed token is carried on the next
   * flush. Returns an unsubscribe function.
   *
   * @example
   * ```ts
   * const unsubscribe = Joryio.onSdkAuthenticationError(async ({ reason }) => {
   *   const jwt = await mintJoryioJwt(); // re-mint (esp. on 'expired')
   *   Joryio.setSdkAuthenticationToken(jwt);
   * });
   * ```
   */
  // Works on BOTH platforms, by different routes: Android exposes an explicit
  // enable call, iOS registers the handler during initialize(). The asymmetry is
  // invisible to callers and is handled below.
  onSdkAuthenticationError(callback: (error: SdkAuthError) => void): () => void {
    if (!isModuleAvailable || !emitter) {
      return () => {};
    }
    const subscription = emitter.addListener(
      'JoryioSdkAuthError',
      callback,
    );
    // Via _dispatch AND optional-call, for two independent reasons:
    //
    //  - _dispatch: a host app subscribes on mount, BEFORE initialize() resolves.
    //    Called directly this threw "Joryio SDK not initialized" (the same bug
    //    onInAppMessage had), which on React Native is a full-screen red box.
    //  - `?.()`: the method exists on ANDROID ONLY. iOS registers the same
    //    handler inside initialize() instead, so the callback works there
    //    either way — but calling a method iOS does not export would throw
    //    "undefined is not a function". Same convention as syncInAppCampaigns.
    this._dispatch(() => JoryioModule.enableSdkAuthenticationErrors?.());
    return () => subscription.remove();
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  /**
   * Flush the event queue immediately.
   * Events are normally batched and sent periodically.
   */
  flush(): void {
    this._dispatch(() => JoryioModule.flush());
  }

  /**
   * Get the anonymous ID assigned to this device.
   */
  /**
   * What the SDK is ACTUALLY doing - the live endpoint and the last transport
   * failure - as opposed to the config your app believes it set.
   *
   * Those diverge exactly when someone is debugging: `initialize()` ignores a
   * second call, so changing settings without restarting leaves the SDK on the
   * old values while your UI shows the new ones. And a rejected key produces a
   * 401 on every request while the app still looks initialised.
   */
  /**
   * Fetch in-app campaigns now and display any that are eligible.
   *
   * The SDK already syncs on session start and on foreground; use this for the
   * moments in between - after resetDisplayedCampaigns(), or once the user has
   * done something that should make them newly eligible.
   *
   * iOS only for now: the Android facade exposes no public sync.
   */
  syncInAppCampaigns(): void {
    this._dispatch(() => JoryioModule.syncInAppCampaigns?.());
  }

  /**
   * Forget which in-app campaigns have already been shown on this device.
   *
   * The SDK skips any campaign it has displayed before, and that set is
   * persisted - so a message appears once per install and then never again.
   * Useful when testing: without it you must delete and reinstall the app to
   * see the same campaign twice.
   *
   * iOS ONLY today. Android has no already-displayed filter at all - the same
   * campaign can show repeatedly there - so there is nothing to reset. That
   * divergence is a real behavioural difference between the platforms, not a
   * missing binding.
   */
  resetDisplayedCampaigns(): void {
    // `?.()` like its sibling syncInAppCampaigns: iOS-only, so a plain call is
    // "undefined is not a function" on Android. _dispatch's catch would swallow
    // it, but a warning-per-call is not the same as a documented no-op.
    this._dispatch(() => JoryioModule.resetDisplayedCampaigns?.());
  }

  /**
   * What the SDK is EXPERIENCING: which server it talks to, and the last
   * transport failure (null once a call succeeds again).
   *
   * "Initialized" and "the server accepts us" are different claims. Without
   * this, a wrong SDK key looks identical to a healthy integration - the SDK
   * reports itself up while every request is rejected 401.
   *
   * Implemented on BOTH platforms. It was iOS-only, which meant the one call you
   * reach for when an integration misbehaves was absent on Android.
   */
  async getDiagnostics(): Promise<{
    apiEndpoint: string | null;
    lastError?: {message: string; isUnauthorized: boolean; at: number};
  }> {
    if (!isModuleAvailable) return {apiEndpoint: null};
    // Gated like the other getters. "initialize() never completed" IS the
    // diagnostic in that case, and _awaitReady logs exactly that.
    if (!(await this._awaitReady('getDiagnostics'))) return {apiEndpoint: null};
    return JoryioModule.getDiagnostics();
  }

  async getAnonymousId(): Promise<string> {
    if (!isModuleAvailable) return '';
    if (!(await this._awaitReady('getAnonymousId'))) return '';
    return JoryioModule.getAnonymousId();
  }

  /**
   * Get the current user ID (null if not identified).
   */
  async getUserId(): Promise<string | null> {
    if (!isModuleAvailable) return null;
    if (!(await this._awaitReady('getUserId'))) return null;
    return JoryioModule.getUserId();
  }

  /**
   * Get the current session ID.
   */
  async getSessionId(): Promise<string> {
    if (!isModuleAvailable) return '';
    if (!(await this._awaitReady('getSessionId'))) return '';
    return JoryioModule.getSessionId();
  }
}

// Export singleton
const Joryio = new JoryioSDK();
export default Joryio;

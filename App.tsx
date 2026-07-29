import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  I18nManager,
  LogBox,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ExpoSplash from 'expo-splash-screen';

// Hold the OS-level splash up until our custom animation has actually
// taken over the screen. This avoids the brief flash of plain bg
// between the native splash dismissing and Reanimated's first frame.
ExpoSplash.preventAutoHideAsync().catch(() => {
  // Already hidden / not available — non-fatal.
});

// Suppress LogBox red overlays for known-noisy errors that the app
// already swallows internally. expo-notifications throws in Expo Go /
// dev clients without the native module linked; the JS layer catches
// it and returns null, but Metro's global error handler still surfaces
// it as an "Uncaught Error" red box during dev. Listing the message
// pattern here keeps the dev session clean without affecting prod.
LogBox.ignoreLogs([
  "Cannot find native module 'ExpoPushTokenManager'",
  'Cannot find native module',
  // AdMob warns on every "no fill" response. The BannerAd component
  // already handles this with setFailed(true) → renders null. The
  // warning stays in console.log for debugging; this just keeps the
  // dev-mode LogBox overlay clean.
  '[ads] banner load failed',
  'googleMobileAds/error-code-internal-error',
  'googleMobileAds/error-code-no-fill',
]);

// Screenshot capture: fully silence LogBox (incl. the "open debugger to view
// warnings" toast) so marketing screenshots carry zero dev chrome. Gated by
// the same EXPO_PUBLIC_SCREENSHOT_MODE flag that hides the mock banner + ads.
if ((process.env.EXPO_PUBLIC_SCREENSHOT_MODE ?? '').trim() === '1') {
  LogBox.ignoreAllLogs(true);
}

// A single notification-action tap can be DELIVERED more than once:
//   • On a cold start, `addNotificationResponseReceivedListener` AND
//     `getLastNotificationResponseAsync` both surface the same response.
//   • `getLastNotificationResponseAsync` re-delivers the same "last
//     response" again every time the response effect remounts.
// Each delivery re-ran the side-effect (confirm spot / join / cancel) and
// posted another local confirmation, so users saw "אישרת הגעה — נכנסת
// למשחק" 2–3 times for one tap (report: "ליעוז קיבל 3 פעמים"). The final
// state is correct (the writes are idempotent) — only the confirmation
// push is spammed. Dedupe by source-notification id + action so a given
// action tap runs its side-effect exactly once per JS context. Module
// scope (not component state) so it survives effect remounts.
const handledActionTaps = new Set<string>();

// Foreground notification behavior. Without this, a push that arrives
// while the user has the app open is delivered silently to the JS
// side and never shows as a banner. Lazy-required + try/catch so we
// don't crash in environments where the native module isn't linked
// (Expo Go / dev clients before rebuild).
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require('expo-notifications');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isActiveChatNotification } = require('@/services/activeChat');
  Notifications.setNotificationHandler({
    handleNotification: async (notification: {
      request?: { content?: { data?: unknown } };
    }) => {
      // Suppress the heads-up banner for the chat the user is ALREADY viewing —
      // otherwise two people chatting live each get a banner per message (the
      // server re-arms its one-push gate every time the open chat resets its
      // unread to 0). Other notifications behave as before.
      if (isActiveChatNotification(notification?.request?.content?.data)) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldShowAlert: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      // expo-notifications split `shouldShowAlert` into the more
      // granular `shouldShowBanner` (head-up alert) +
      // `shouldShowList` (notification center) in newer SDKs. We set
      // both true to mirror the old `shouldShowAlert: true` behaviour
      // — and keep the legacy field too so older SDKs still honour it.
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    },
  });
  // Register the GAME_REMINDER category — when a `gameReminder`
  // push arrives with `categoryIdentifier: 'GAME_REMINDER'` in its
  // payload, iOS / Android render these two action buttons under
  // the notification body. Tapping a button fires the response
  // listener with `actionIdentifier === 'JOIN_GAME' | 'CANCEL_GAME'`.
  // `opensAppToForeground: true` runs the action in background
  // without launching the app — the broadcast fires the response
  // listener directly while JS is alive (foreground / recent
  // background). On a fully-killed app the broadcast still reaches
  // the native `NotificationsService` receiver and the response is
  // queued; it's then dispatched via `getLastNotificationResponseAsync`
  // on the next app launch. The handler below dismisses the
  // notification explicitly so the user doesn't see a stale card
  // after the RSVP has been recorded.
  // NOTE: the `gameRsvpNudge` push no longer carries action buttons — it's a
  // plain tap-to-open reminder now (the GAME_REMINDER category was removed per
  // product decision). JOIN_GAME still exists for the new-game announcement
  // below; CANCEL_GAME is retired.
  // "אני מגיע" → JOIN_GAME. `opensAppToForeground: false` (user request): the
  // join runs in the BACKGROUND without launching the app, and the handler
  // posts a local confirmation so the user still sees the result. requestJoinGame
  // is idempotent (already-registered → instant no-op) so a reminder "confirm"
  // tap is instant and safe. Tradeoff: on a FULLY-KILLED app the OS defers the
  // response to the next launch (expo-notifications has no headless task here) —
  // harmless for a reminder (the user is already in), and the deferred join still
  // runs when they next open the app.
  Notifications.setNotificationCategoryAsync('NEW_GAME_RSVP', [
    {
      identifier: 'JOIN_GAME',
      buttonTitle: 'אני מגיע',
      // Was a BACKGROUND action (opensAppToForeground:false) — but on Android a
      // background action button is DROPPED when the app is fully killed (no
      // headless JS task; getLastNotificationResponseAsync never sees it), so
      // "אני מגיע" silently did nothing (user report). Open the app so the
      // response is always delivered → the handler joins + lands on the game.
      options: { opensAppToForeground: true },
    },
  ]).catch(() => {});
  // Waitlist promotion offer: someone cancelled, head of waitlist
  // gets a chance to claim the spot. CONFIRM_SPOT moves them into
  // players[]; PASS_SPOT removes them from waitlist entirely (so
  // the next person in line can be offered).
  Notifications.setNotificationCategoryAsync('SPOT_OFFER', [
    {
      identifier: 'CONFIRM_SPOT',
      // Background action (no app launch) → confirms the spot instantly; the
      // handler posts a local confirmation so the user still gets feedback.
      buttonTitle: 'מאשר/ת',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'PASS_SPOT',
      buttonTitle: 'ויתור',
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]).catch(() => {});
  // NOTE: the cross-community filler opportunity push (`fillerOpportunity`)
  // deliberately has NO action-button category — tapping the push opens the
  // game screen where the candidate expresses interest. The old "לא הפעם"
  // button was a silent no-op and "מעוניין" was redundant with tap-to-open.
} catch {
  // expo-notifications native module not available — no-op.
}
import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  installGlobalErrorHandlers,
  logRenderError,
} from '@/services/errorLog';
import { RootNavigator } from '@/navigation/RootNavigator';
import { CampaignGate } from '@/components/CampaignGate';
import { navigationRef, navigateInvite } from '@/navigation/navigationRef';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import {
  parseInviteUrl,
  stashPendingInvite,
} from '@/services/deepLinkService';
import { consumeInstallReferrerIfFresh } from '@/services/installReferrerService';
import { consumeClipboardInviteIfFresh } from '@/services/clipboardInviteService';
import { storage } from '@/services/storage';
import { MockModeBanner } from '@/components/MockModeBanner';
import { SplashScreen } from '@/screens/SplashScreen';
import { ToastHost } from '@/components/Toast';
import { AppDialogHost } from '@/components/AppDialog';
import { ScreenshotReportSheet } from '@/components/ScreenshotReportSheet';
import { BannerHost } from '@/components/Banner';
import { adsService, AdDebugOverlay } from '@/services/adsService';
import { MaintenanceGate, AnnouncementBanner } from '@/components/RemoteGates';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { checkForUpdate, type UpdateKind } from '@/services/updateService';
import { useWatchSync } from '@/services/watchSyncService';
import { UpdateModal } from '@/components/UpdateModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, isDarkTheme } from '@/theme';
import { DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';

// ── Force RTL on first launch ───────────────────────────────────────────────
// Hebrew is RTL. Setting this once at startup mirrors the entire layout.
// In production you'd typically force RTL at the native side too (see README).
I18nManager.allowRTL(true);
if (!I18nManager.isRTL) {
  I18nManager.forceRTL(true);
  // NOTE: a forced RTL switch normally requires a JS reload to take effect.
  // Expo Go users: shake → Reload after first launch.
}

// ── Global text-alignment defaults (RTL-bulletproof) ────────────────────────
// On Android (and on iOS dev clients that didn't fully restart after the
// forceRTL call) RN sometimes leaves <Text> with default left alignment
// even though the layout is mirrored. We set defaultProps so EVERY Text
// and TextInput in the tree starts with `textAlign:'right'` and an
// explicit RTL writingDirection. Components that genuinely want a
// different alignment (e.g., button labels) can still override per
// instance via their own style.
//
// Note: defaultProps on RN core components is the supported escape hatch
// for global typography overrides; we deliberately accept the deprecation
// noise it produces in newer RN dev builds because the alternative
// (wrapping every Text in a custom component) would touch dozens of
// screens and is much more invasive than this single hook.
{
  type WithDefaultProps = {
    defaultProps?: {
      style?: unknown;
      allowFontScaling?: boolean;
    };
  };
  const RTL_TEXT_DEFAULTS = {
    textAlign: 'right',
    writingDirection: 'rtl',
  } as const;
  const baseText = (Text as unknown as WithDefaultProps).defaultProps ?? {};
  (Text as unknown as WithDefaultProps).defaultProps = {
    ...baseText,
    style: [RTL_TEXT_DEFAULTS, (baseText as { style?: unknown }).style],
  };
  const baseInput = (TextInput as unknown as WithDefaultProps).defaultProps ?? {};
  (TextInput as unknown as WithDefaultProps).defaultProps = {
    ...baseInput,
    style: [RTL_TEXT_DEFAULTS, (baseInput as { style?: unknown }).style],
  };
}

// Optional ("later"-dismissable) update prompts snooze for 24h after a
// dismissal so they don't reappear on every cold start. Force updates
// ignore this entirely.
const OPTIONAL_UPDATE_SNOOZE_KEY = 'optionalUpdateSnoozeUntil';
const OPTIONAL_UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

// Install global crash + unhandled-rejection catch-alls as early as
// possible (module load), so failures before/around mount are captured.
installGlobalErrorHandlers();

export default function App() {
  // The kickoff splash plays once per app launch. We render it OVER the
  // navigator (not in place of it) so RootNavigator can mount + hydrate
  // stores in parallel — the splash fades out at the end and the user
  // lands on a ready UI without an extra spinner step.
  const [splashDone, setSplashDone] = useState(false);
  // Load the Ionicons font at runtime. Expo SDK 53 removed
  // @expo/vector-icons autolinking — without this hook the font
  // family `ionicons` isn't registered with the RN font registry,
  // every `<Ionicons />` glyph renders as a blank box. We don't
  // gate the UI on `fontsLoaded`: a one-frame fallback to empty
  // glyphs is preferable to a blocked render, and the loader
  // resolves within ~50 ms on real devices.
  // Ionicons.ttf is shipped as `android/app/src/main/assets/fonts/ionicons.ttf`
  // (lowercase, matching the fontFamily `@expo/vector-icons` registers via
  // `createIconSet(glyphMap, 'ionicons', font)`). Android RN auto-registers
  // any TTF in that folder under its filename, so no JS-side `useFonts`
  // dance is needed — and `useFonts` would actually fail on SDK 53 because
  // expo-asset's `downloadAsync` requires the legacy `AppDirectoriesModule`
  // interface, which expo-file-system 18.x dropped.
  const currentScreenRef = useRef<string | null>(null);

  // App-update prompt. Single source of truth: a plain enum kept
  // here at the App root.
  const [updateKind, setUpdateKind] = useState<UpdateKind>('none');
  // Guard so the post-splash check fires exactly once even if the
  // splash effect re-runs.
  const updateCheckedRef = useRef(false);
  // Once the user taps "later" on an optional prompt we suppress
  // re-showing it for the rest of the session — even if the
  // AppState listener re-runs the check after returning from the
  // store. Force-update results still win unconditionally.
  const optionalUpdateDismissedRef = useRef(false);

  // Live "navigator is mounted and ready to navigate" flag. Flipped
  // by NavigationContainer's `onReady`. We pair it with `pendingLink`
  // below so a deep link that arrives before navigation is ready
  // gets retried the moment readiness flips on. RootNavigator's
  // one-shot `consumedRef` covers cold-start storage stash; this
  // pair covers warm-app URLs that race the navigator mount.
  const [navReady, setNavReady] = useState(false);
  // In-memory pending deep link. Set by the warm URL handler when
  // it can't navigate immediately (auth not ready, navigator still
  // mounting). Last-write-wins semantics: the most recent URL
  // overwrites any prior pending — taps are explicit user intent
  // and the stale one is no longer interesting.
  const [pendingLink, setPendingLink] = useState<{
    type: 'session' | 'team';
    id: string;
  } | null>(null);
  // Auth signals — already maintained by the user store. We watch
  // them here so the consumer effect re-fires the moment the user
  // finishes signing in / completes onboarding while the link is
  // sitting in pendingLink.
  const currentUserId = useUserStore((s) => s.currentUser?.id ?? null);
  const profileComplete = useUserStore((s) => s.isProfileComplete());
  const onboardingComplete = useUserStore((s) => s.hasCompletedOnboarding());
  // Hydration signals from the stores. When both flip true the splash
  // is allowed to fade out — that way the user never sees the small
  // "still loading" spinner that RootNavigator used to render under
  // the splash. A single big-ball state covers the whole boot.
  const userHydrated = useUserStore((s) => s.hydrated);
  const groupHydrated = useGroupStore((s) => s.hydrated);

  // Keep the paired Wear OS watch in sync with the user's current game
  // state (live stopwatch / next game / not-registered). Android-only,
  // best-effort — no-ops everywhere else.
  useWatchSync(currentUserId);

  useEffect(() => {
    // NOTE: ExpoSplash.hideAsync() is intentionally NOT called here.
    // It's now called from inside SplashScreen on its first effect, so
    // the native splash dismisses only AFTER the React layer has painted
    // its first frame. Hiding here would create a brief black flash
    // between native dismiss and React first paint.
    // Place for one-time bootstraps: analytics init, FCM token registration, etc.
  }, []);

  // Invite-link plumbing. Three potential sources on COLD start, in
  // strict priority order:
  //   1. `Linking.getInitialURL()` — app launched FROM a deep link.
  //   2. Existing stash in storage — set by a previous launch that
  //      didn't get consumed (auth incomplete, navigation race).
  //   3. Play Install Referrer — the user installed via the store and
  //      this is their first launch.
  //
  // For WARM/background URLs (app already mounted), we take a
  // different path: try to navigate IMMEDIATELY and bypass the
  // stash + RootNavigator consumer entirely. The consumer there
  // uses a one-shot `consumedRef` so it never re-fires after the
  // first cold-start consumption — which used to silently swallow
  // every subsequent deep link until the user fully restarted the
  // app. The `forWarm` branch below is the fix.
  //
  // De-duplication: tapping the same URL twice within DUP_WINDOW
  // triggers navigation only once. Without this, iOS sometimes
  // delivers the same URL via getInitialURL AND the listener on
  // the same launch, double-navigating into the target.
  useEffect(() => {
    const DUP_WINDOW_MS = 3000;
    let lastUrl: string | null = null;
    let lastUrlAt = 0;

    const isDuplicate = (url: string): boolean => {
      const now = Date.now();
      const dup = url === lastUrl && now - lastUrlAt < DUP_WINDOW_MS;
      lastUrl = url;
      lastUrlAt = now;
      return dup;
    };

    // Cold-start handler — stash and let RootNavigator consume after
    // auth is ready. This is the legacy path; behavior unchanged.
    const handleCold = async (url: string | null) => {
      if (!url) return;
      if (isDuplicate(url)) return;
      const parsed = parseInviteUrl(url);
      if (!parsed) return;
      // Opened via an invite link → suppress the next app-open ad.
      adsService.noteIntentfulOpen();
      try {
        await stashPendingInvite(parsed);
      } catch (err) {
        if (__DEV__) console.warn('[invite] stash failed', err);
      }
    };

    // Warm-start handler — fired by `addEventListener` while the
    // app is mounted. If the user is signed in & onboarded AND the
    // navigator is ready, navigate DIRECTLY. Otherwise stash both
    // in-memory (pendingLink, consumed by the effect below) AND in
    // storage (recovery across cold restarts).
    //
    // The dual-store matters: RootNavigator's one-shot `consumedRef`
    // could already have fired by the time a warm URL arrives, so
    // we can't rely on the storage stash alone — that path runs
    // exactly once per launch. The in-memory pendingLink + consumer
    // effect runs whenever (navReady, auth, pendingLink) flip,
    // which is the only setup that survives an
    // already-passed-by-consumer state.
    const handleWarm = async (url: string) => {
      if (!url) return;
      if (isDuplicate(url)) return;
      const parsed = parseInviteUrl(url);
      if (!parsed) return;
      // Opened via an invite link → suppress the next app-open ad.
      adsService.noteIntentfulOpen();

      // Generic app invite — no target to navigate to. Stash for
      // attribution (a no-op for an already-signed-up user) and stop.
      if (parsed.type === 'app') {
        await storage.setPendingInvite(parsed).catch(() => undefined);
        return;
      }

      const userState = useUserStore.getState();
      const isAuthReady =
        !!userState.currentUser &&
        userState.isProfileComplete() &&
        userState.hasCompletedOnboarding();

      if (isAuthReady && navigationRef.isReady()) {
        const cachedGroups = useGroupStore.getState().groups;
        const isMember =
          parsed.type === 'team'
            ? cachedGroups.some((g) => g.id === parsed.id)
            : false;
        const ok = navigateInvite({
          type: parsed.type,
          id: parsed.id,
          isMember,
        });
        if (ok) {
          await storage.clearPendingInvite().catch(() => undefined);
          if (__DEV__) {
            console.info('[invite] warm — navigated directly', parsed);
          }
          return;
        }
      }

      // Not ready — last-link-wins overwrite of in-memory pending.
      // Also write through to storage so a cold restart picks it up.
      setPendingLink({ type: parsed.type, id: parsed.id });
      await storage.clearPendingInvite().catch(() => undefined);
      try {
        await stashPendingInvite(parsed);
        if (__DEV__) {
          console.info('[invite] warm — pending (not ready)', parsed);
        }
      } catch (err) {
        if (__DEV__) console.warn('[invite] warm stash failed', err);
      }
    };

    (async () => {
      // 1. Initial URL.
      const initialUrl = await Linking.getInitialURL();
      if (__DEV__) console.info('[invite] getInitialURL →', initialUrl);
      await handleCold(initialUrl);

      // 2. Already-stashed invite? If so, skip the referrer call —
      //    we have a target, no need to re-derive one from the past.
      const existing = await storage.getPendingInvite();
      if (__DEV__) console.info('[invite] existing pending →', existing);
      if (existing) return;

      // 3. Last resort (Android): Play Install Referrer. No-op on
      //    iOS / Expo Go / sideload. The service has its own internal
      //    set-once guard as a second line of defence.
      try {
        await consumeInstallReferrerIfFresh();
        if (__DEV__) {
          const after = await storage.getPendingInvite();
          console.info('[invite] after install-referrer →', after);
        }
      } catch (err) {
        if (__DEV__) console.warn('[invite] install-referrer threw', err);
      }

      // 4. Last resort (iOS): deferred deep link via the clipboard.
      //    Apple has no install-referrer API, so the landing page copies
      //    the invite URL to the clipboard on the "install" tap and we
      //    recover it here on first launch. No-op on Android and after a
      //    deep link already stashed an invite (checked at step 2 above
      //    and again inside the service).
      try {
        await consumeClipboardInviteIfFresh();
        if (__DEV__) {
          const after = await storage.getPendingInvite();
          console.info('[invite] after clipboard →', after);
        }
      } catch (err) {
        if (__DEV__) console.warn('[invite] clipboard invite threw', err);
      }
    })();

    const sub = Linking.addEventListener('url', (e) => handleWarm(e.url));
    return () => sub.remove();
  }, []);

  // Pending-link consumer. Re-runs on every change of (pendingLink,
  // navReady, currentUserId, profileComplete, onboardingComplete) —
  // this guarantees a deep link sitting in pendingLink fires the
  // moment the navigator AND the user are both ready, regardless of
  // which one became ready last. RootNavigator's storage-stash
  // consumer covers cold-start; this covers warm URLs that arrived
  // mid-launch or while the user was on Auth/Onboarding.
  useEffect(() => {
    if (!pendingLink) return;
    if (!navReady) return;
    if (!navigationRef.isReady()) return;
    if (!currentUserId || !profileComplete || !onboardingComplete) return;
    const cachedGroups = useGroupStore.getState().groups;
    const isMember =
      pendingLink.type === 'team'
        ? cachedGroups.some((g) => g.id === pendingLink.id)
        : false;
    const ok = navigateInvite({
      type: pendingLink.type,
      id: pendingLink.id,
      isMember,
    });
    if (ok) {
      // Clear both stores so a stale link can never re-fire on the
      // next ready-tick.
      setPendingLink(null);
      storage.clearPendingInvite().catch(() => undefined);
      if (__DEV__) {
        console.info('[invite] consumer (pending) — navigated', pendingLink);
      }
    }
  }, [
    pendingLink,
    navReady,
    currentUserId,
    profileComplete,
    onboardingComplete,
  ]);

  // Resolve the freshly-fetched UpdateKind into a UI verdict. Force
  // wins always; optional is suppressed when already dismissed this
  // session.
  const applyUpdateResult = useCallback((kind: UpdateKind) => {
    if (kind === 'force') {
      setUpdateKind('force');
      return;
    }
    if (kind === 'optional' && optionalUpdateDismissedRef.current) {
      setUpdateKind('none');
      return;
    }
    setUpdateKind(kind);
  }, []);

  // Run the version check only after the splash animation has
  // finished. Guarded by `updateCheckedRef` so we never fire twice.
  // Before checking, restore any recent "later" dismissal so an
  // OPTIONAL prompt doesn't nag on every cold start — it stays hidden
  // for OPTIONAL_UPDATE_SNOOZE_MS after the user taps "אולי אחר כך".
  // (Force updates ignore this and always show.)
  useEffect(() => {
    if (!splashDone || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(OPTIONAL_UPDATE_SNOOZE_KEY);
        const until = raw ? Number(raw) : 0;
        if (until && Date.now() < until) {
          optionalUpdateDismissedRef.current = true;
        }
      } catch {
        // ignore — worst case the prompt shows once
      }
      const kind = await checkForUpdate();
      applyUpdateResult(kind);
    })();
  }, [splashDone, applyUpdateResult]);

  // Re-check when the app returns from background → active. Catches
  // the "user updated from the store and came back" case so the
  // modal disappears on its own. Force results re-appear regardless
  // of any prior optional dismissal.
  //
  // The same listener doubles as our app-lifecycle analytics signal:
  // every active/background transition fires one AppForegrounded /
  // AppBackgrounded event. `type: 'warm'` because cold starts are
  // logged separately at boot. Useful for measuring session length
  // and "abandons after N minutes" funnels.
  useEffect(() => {
    let lastState: string = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && lastState !== 'active') {
        logEvent(AnalyticsEvent.AppForegrounded, { type: 'warm' });
      } else if (next === 'background' && lastState === 'active') {
        logEvent(AnalyticsEvent.AppBackgrounded);
      }
      lastState = next;
      if (next !== 'active' || !updateCheckedRef.current) return;
      checkForUpdate().then(applyUpdateResult);
    });
    return () => sub.remove();
  }, [applyUpdateResult]);

  // ─── Push-notification tap → screen navigation ──────────────────────
  // Two paths to cover:
  //   1. App is running (background or foreground): the user taps a
  //      push from the OS shade → addNotificationResponseReceivedListener
  //      fires synchronously.
  //   2. App was killed: the OS launches us cold; the response is
  //      retrievable via getLastNotificationResponseAsync. We may fire
  //      before the navigator is ready, so retry briefly until isReady.
  useEffect(() => {
    let Notifications: typeof import('expo-notifications') | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Notifications = require('expo-notifications');
    } catch {
      return; // native module not linked (Expo Go) — no-op
    }
    if (!Notifications) return;
    // Capture once for use inside the closure below — TS can't carry
    // the null-narrow from the early-return through async callbacks.
    const Notif = Notifications;

    const dismissNotificationSafely = async (
      notifId: string | undefined,
    ): Promise<void> => {
      if (!notifId) return;
      try {
        await Notif.dismissNotificationAsync(notifId);
      } catch {
        // Best-effort — older expo-notifications versions / iOS
        // foreground-not-shown cases throw. The OS will dismiss the
        // notification itself when the user taps it anyway.
      }
    };

    const handleResponse = async (response: {
      actionIdentifier?: string;
      notification: {
        request: { identifier?: string; content: { data?: Record<string, unknown> } };
      };
    }) => {
      const data = response.notification.request.content.data ?? {};
      const type = typeof data.type === 'string' ? data.type : '';
      if (!type) return;
      // Opened by tapping a push → suppress the next app-open ad.
      adsService.noteIntentfulOpen();
      // Admin broadcast (Pulse campaign) tapped → report the open so the
      // campaign report shows received-vs-opened. Fire-and-forget.
      if (type === 'adminBroadcast' && typeof data.campaignId === 'string') {
        const { trackCampaignEvent } = await import('@/services/campaignService');
        void trackCampaignEvent(data.campaignId, 'open');
      }
      // Identifier of the source notification — needed to dismiss it
      // explicitly after an action button runs. Without an explicit
      // dismiss the notification card lingers in the tray even though
      // its action ("אני בא" / "לא בא" / etc.) has already taken
      // effect, which confuses users into tapping it again.
      const notifId = response.notification.request.identifier;
      // Action button taps from the notification (e.g. "אני בא" /
      // "לא בא") arrive with `actionIdentifier` set to the button id
      // we registered. Plain notification taps (the user tapped the
      // body itself) carry `actionIdentifier === 'expo.modules.notifications.actions.DEFAULT'`
      // — fall through to the navigation flow for those.
      const action = response.actionIdentifier ?? '';
      // Guard action-button taps against duplicate delivery (see
      // `handledActionTaps` above). Only the buttons with side-effects are
      // deduped; a plain body tap (DEFAULT) falls through to navigation,
      // which is idempotent and safe to re-run. Keyed by the source
      // notification id + action so the SAME tap replayed via a second
      // delivery / remount is collapsed, while a genuinely new tap on a
      // fresh notification still gets through.
      const SIDE_EFFECT_ACTIONS = [
        'JOIN_GAME',
        'CANCEL_GAME',
        'CONFIRM_SPOT',
        'PASS_SPOT',
        'DISMISS_NEW_GAME',
      ];
      if (SIDE_EFFECT_ACTIONS.includes(action)) {
        const tapKey = `${notifId ?? ''}|${action}|${
          typeof data.gameId === 'string' ? data.gameId : ''
        }`;
        if (handledActionTaps.has(tapKey)) return;
        handledActionTaps.add(tapKey);
      }
      // For JOIN/CANCEL and SPOT actions: run the side-effect, dismiss
      // the notification, then FALL THROUGH to the navigation block
      // below so the app lands on MatchDetails for the affected game.
      // Without that fall-through the user taps "אני בא", the app
      // launches because of `opensAppToForeground: true`, and they're
      // dropped on the home screen with no visible confirmation of
      // what just happened.
      if (action === 'JOIN_GAME' || action === 'CANCEL_GAME') {
        const gameId = typeof data.gameId === 'string' ? data.gameId : '';
        if (!gameId) return;
        const { handleGameReminderAction } = await import(
          '@/services/notificationActionService'
        );
        await handleGameReminderAction(action, gameId);
        await dismissNotificationSafely(notifId);
        // "אני מגיע" now opens the app (opensAppToForeground:true) — after the
        // join, FALL THROUGH to navigation so the user lands on the game and
        // sees they're registered, instead of being dropped on home.
      } else if (action === 'CONFIRM_SPOT' || action === 'PASS_SPOT') {
        const gameId = typeof data.gameId === 'string' ? data.gameId : '';
        if (!gameId) return;
        const { handleSpotOfferAction } = await import(
          '@/services/notificationActionService'
        );
        await handleSpotOfferAction(action, gameId);
        await dismissNotificationSafely(notifId);
        // Background action (opensAppToForeground:false) — the handler posts a
        // local confirmation; don't drag the app to MatchDetails behind the
        // user's back, so DON'T fall through to navigation.
        return;
      }
      if (action === 'DISMISS_NEW_GAME') {
        // "לא מגיע" on a new-game announcement → just clear the card, no
        // side-effect (the user has no registration to cancel).
        await dismissNotificationSafely(notifId);
        return;
      }
      // (The `fillerOpportunity` push no longer carries action buttons — a
      // plain tap falls through to navigation, opening the game screen where
      // the candidate expresses interest. The in-app "מעוניין" button still
      // calls handleFillerOpportunityAction directly.)
      // Wait for the navigator to be ready. A COLD start runs through
      // the splash (+ a possible app-open ad) + Firebase auth restore
      // before the navigator mounts — easily 10-20s. The old 3s cap gave
      // up long before then, so a push tapped while the app was killed
      // silently landed on the home screen instead of its target. Poll
      // up to ~30s; it resolves the instant nav is ready, so a fast warm
      // tap is unaffected, and a genuinely-broken nav still bails out.
      for (let i = 0; i < 300; i++) {
        if (navigationRef.isReady()) {
          const { navigateForPush } = await import('@/navigation/navigationRef');
          navigateForPush(type, data);
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Cold-start tap: the listener above only fires for live taps;
    // launching from a tap delivers via getLastNotificationResponseAsync.
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleResponse(resp);
    });

    return () => sub.remove();
  }, []);

  // After the animation finishes, try to show the App Open ad. If the
  // SDK already pre-loaded one (initializeAds() runs on app boot), the
  // call resolves when the ad is closed; if nothing is ready it returns
  // immediately. Either way we then drop the splash and reveal the app.
  const handleSplashFinish = async () => {
    // Reveal the app no matter what. Two guards so a slow/stuck app-open ad
    // can never freeze startup (the Google "unresponsive app" rejection):
    //   1. Skip the ad entirely until the user is signed in — a fresh
    //      install (incl. the Play reviewer) goes straight to the app, never
    //      sitting on the splash behind an ad.
    //   2. Even for signed-in users, race the ad against a hard timeout so a
    //      hung show() can't block setSplashDone.
    if (useUserStore.getState().currentUser) {
      try {
        await Promise.race([
          adsService.showAppOpenAdIfAvailable(),
          new Promise<void>((resolve) => setTimeout(resolve, 3500)),
        ]);
      } catch {
        // never block reveal on an ad failure
      }
    }
    setSplashDone(true);
  };

  // Build a React Navigation theme so headers / cards / focus tints
  // pick up the active palette without per-screen refactors.
  const navTheme: Theme = {
    ...(isDarkTheme ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDarkTheme ? DarkTheme : DefaultTheme).colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
      notification: colors.danger,
    },
  };

  return (
    // ErrorBoundary wraps everything below so an uncaught render-time
    // error inside the navigator, the splash, the toasts, or any
    // mounted screen falls through to a single Hebrew RTL fallback UI
    // instead of leaving the user with a frozen white screen. The
    // boundary lives OUTSIDE NavigationContainer on purpose — a crash
    // inside the navigator itself still surfaces here.
    <ErrorBoundary onError={logRenderError}>
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDarkTheme ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <NavigationContainer
        theme={navTheme}
        ref={navigationRef}
        onReady={() => {
          // Flag readiness so the pendingLink consumer effect above
          // can fire the queued deep link (if any). Without this the
          // warm URL sits forever waiting for an event it would
          // never get on its own.
          setNavReady(true);
          // Seed the initial route so the first screen_view fires before
          // any subsequent state change (otherwise it'd only fire on the
          // *second* navigation).
          const r = navigationRef.isReady()
            ? navigationRef.getCurrentRoute()
            : null;
          if (r) {
            currentScreenRef.current = r.name;
            logEvent(AnalyticsEvent.ScreenView, { screen: r.name });
          }
        }}
        onStateChange={() => {
          if (!navigationRef.isReady()) return;
          const next = navigationRef.getCurrentRoute()?.name;
          if (next && next !== currentScreenRef.current) {
            currentScreenRef.current = next;
            logEvent(AnalyticsEvent.ScreenView, { screen: next });
          }
        }}
      >
        {/* Stack the navigator under a dev-only banner. The banner renders
            nothing in real mode, so production layouts are untouched.
            RTL is pinned via two paths:
              1. I18nManager.forceRTL above — flips flex direction
              2. Text.defaultProps above — applies textAlign:'right' +
                 writingDirection:'rtl' to every Text in the tree
            That combination is bulletproof across iOS + Android. */}
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <MockModeBanner />
          <AnnouncementBanner />
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <RootNavigator />
          </View>
        </View>
        {/* Mounted at the navigator level so toasts overlay every screen
            but stay below RN's modal dialogs. */}
        <ToastHost />
        <AppDialogHost />
        <BannerHost />
        {/* Global: a device screenshot slides up a pre-filled bug report. */}
        <ScreenshotReportSheet />
      </NavigationContainer>

      {/* Splash sits ABOVE everything. RootNavigator keeps mounting +
          hydrating behind it. We pass `ready` so the splash stays up
          until the minimum hold elapsed AND we know where to route —
          guaranteeing the user only ever sees the big-ball loader,
          never the small spinner that RootNavigator used to show as a
          "still loading" fallback.

          "Know where to route" differs by auth state:
            • signed OUT — once the user store is hydrated we already
              know to show SignIn / Onboarding. Group state is never
              hydrated while signed out (hydrateGroup only runs once a
              currentUser exists, see RootNavigator), so waiting on
              groupHydrated here would pin the splash FOREVER for every
              signed-out / fresh-install user. Hence the `!currentUserId`
              short-circuit.
            • signed IN — wait for groupHydrated too so membership state
              is real before MainTabs paints. */}
      {!splashDone ? (
        <SplashScreen
          ready={userHydrated && (!currentUserId || groupHydrated)}
          onFinish={handleSplashFinish}
        />
      ) : null}

      <AdDebugOverlay />

      {splashDone && updateKind === 'force' ? (
        <UpdateModal type="force" />
      ) : null}
      {splashDone && updateKind === 'optional' ? (
        <UpdateModal
          type="optional"
          onClose={() => {
            optionalUpdateDismissedRef.current = true;
            // Persist the snooze so the optional prompt doesn't reappear
            // on the next cold start (it used to show every launch).
            void AsyncStorage.setItem(
              OPTIONAL_UPDATE_SNOOZE_KEY,
              String(Date.now() + OPTIONAL_UPDATE_SNOOZE_MS),
            );
            setUpdateKind('none');
          }}
        />
      ) : null}

      {/* Remote-Config blocking overlay — covers everything when
          maintenance_mode is turned on in the Firebase console. */}
      <MaintenanceGate />

      {/* In-app popup campaigns (authored in Pulse). Only after splash +
          when signed in and no blocking update modal is up. */}
      <CampaignGate active={splashDone && updateKind === 'none' && !!currentUserId} />
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}

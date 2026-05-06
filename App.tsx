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

// Foreground notification behavior. Without this, a push that arrives
// while the user has the app open is delivered silently to the JS
// side and never shows as a banner. Lazy-required + try/catch so we
// don't crash in environments where the native module isn't linked
// (Expo Go / dev clients before rebuild).
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // expo-notifications split `shouldShowAlert` into the more
      // granular `shouldShowBanner` (head-up alert) +
      // `shouldShowList` (notification center) in newer SDKs. We set
      // both true to mirror the old `shouldShowAlert: true` behaviour
      // — and keep the legacy field too so older SDKs still honour it.
      shouldShowBanner: true,
      shouldShowList: true,
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  // Register the GAME_REMINDER category — when a `gameReminder`
  // push arrives with `categoryIdentifier: 'GAME_REMINDER'` in its
  // payload, iOS / Android render these two action buttons under
  // the notification body. Tapping a button fires the response
  // listener with `actionIdentifier === 'JOIN_GAME' | 'CANCEL_GAME'`.
  // `opensAppToForeground: false` asks the OS to run the action
  // handler without bringing the app forward when supported (most
  // Android, iOS background); on iOS-after-force-quit the app does
  // launch foreground briefly.
  Notifications.setNotificationCategoryAsync('GAME_REMINDER', [
    {
      identifier: 'JOIN_GAME',
      buttonTitle: 'אני בא',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'CANCEL_GAME',
      buttonTitle: 'לא בא',
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]).catch(() => {
    // Best-effort — older expo-notifications versions throw; the
    // worst case is the buttons don't render and the user taps
    // through to the app, which is the existing behaviour.
  });
} catch {
  // expo-notifications native module not available — no-op.
}
import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from '@/navigation/RootNavigator';
import { navigationRef, navigateInvite } from '@/navigation/navigationRef';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import {
  parseInviteUrl,
  stashPendingInvite,
} from '@/services/deepLinkService';
import { consumeInstallReferrerIfFresh } from '@/services/installReferrerService';
import { storage } from '@/services/storage';
import { MockModeBanner } from '@/components/MockModeBanner';
import { SplashScreen } from '@/screens/SplashScreen';
import { ToastHost } from '@/components/Toast';
import { BannerHost } from '@/components/Banner';
import { adsService, AdDebugOverlay } from '@/services/adsService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { checkForUpdate, type UpdateKind } from '@/services/updateService';
import { UpdateModal } from '@/components/UpdateModal';
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

export default function App() {
  // The kickoff splash plays once per app launch. We render it OVER the
  // navigator (not in place of it) so RootNavigator can mount + hydrate
  // stores in parallel — the splash fades out at the end and the user
  // lands on a ready UI without an extra spinner step.
  const [splashDone, setSplashDone] = useState(false);
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

  useEffect(() => {
    // Hand the screen over from the OS splash to our React layer the
    // moment App mounts. The custom SplashScreen component is already
    // in the tree, so there's no flicker.
    ExpoSplash.hideAsync().catch(() => {
      // already hidden — non-fatal
    });
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

      // 3. Last resort: Play Install Referrer (Android-only). No-op on
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
  useEffect(() => {
    if (!splashDone || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    checkForUpdate().then(applyUpdateResult);
  }, [splashDone, applyUpdateResult]);

  // Re-check when the app returns from background → active. Catches
  // the "user updated from the store and came back" case so the
  // modal disappears on its own. Force results re-appear regardless
  // of any prior optional dismissal.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
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

    const handleResponse = async (response: {
      actionIdentifier?: string;
      notification: { request: { content: { data?: Record<string, unknown> } } };
    }) => {
      const data = response.notification.request.content.data ?? {};
      const type = typeof data.type === 'string' ? data.type : '';
      if (!type) return;
      // Action button taps from the notification (e.g. "אני בא" /
      // "לא בא") arrive with `actionIdentifier` set to the button id
      // we registered. Plain notification taps (the user tapped the
      // body itself) carry `actionIdentifier === 'expo.modules.notifications.actions.DEFAULT'`
      // — fall through to the navigation flow for those.
      const action = response.actionIdentifier ?? '';
      if (action === 'JOIN_GAME' || action === 'CANCEL_GAME') {
        const gameId = typeof data.gameId === 'string' ? data.gameId : '';
        if (!gameId) return;
        const { handleGameReminderAction } = await import(
          '@/services/notificationActionService'
        );
        await handleGameReminderAction(action, gameId);
        return;
      }
      // Wait briefly for the navigator to be ready (cold-start case);
      // give up after ~3s so a permanently broken nav doesn't stall.
      for (let i = 0; i < 30; i++) {
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
    try {
      await adsService.showAppOpenAdIfAvailable();
    } catch {
      // showAppOpenAdIfAvailable swallows internally; this is just a
      // belt-and-suspenders guard against future signature changes.
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
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <RootNavigator />
          </View>
        </View>
        {/* Mounted at the navigator level so toasts overlay every screen
            but stay below RN's modal dialogs. */}
        <ToastHost />
        <BannerHost />
      </NavigationContainer>

      {/* Splash sits ABOVE everything. RootNavigator keeps mounting +
          hydrating behind it; when the animation finishes we hand off
          to the ad flow → once that resolves (or no-ops) we unmount the
          splash and the navigator is already live. */}
      {!splashDone ? <SplashScreen onFinish={handleSplashFinish} /> : null}

      <AdDebugOverlay />

      {splashDone && updateKind === 'force' ? (
        <UpdateModal type="force" />
      ) : null}
      {splashDone && updateKind === 'optional' ? (
        <UpdateModal
          type="optional"
          onClose={() => {
            optionalUpdateDismissedRef.current = true;
            setUpdateKind('none');
          }}
        />
      ) : null}
    </SafeAreaProvider>
  );
}

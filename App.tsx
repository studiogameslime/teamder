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
} catch {
  // expo-notifications native module not available — no-op.
}
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from '@/navigation/RootNavigator';
import { MockModeBanner } from '@/components/MockModeBanner';
import { SplashScreen } from '@/screens/SplashScreen';
import { ToastHost } from '@/components/Toast';
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
  const [navContainerRef] = useState(() => createNavigationContainerRef());
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

  useEffect(() => {
    // Hand the screen over from the OS splash to our React layer the
    // moment App mounts. The custom SplashScreen component is already
    // in the tree, so there's no flicker.
    ExpoSplash.hideAsync().catch(() => {
      // already hidden — non-fatal
    });
    // Place for one-time bootstraps: analytics init, FCM token registration, etc.
  }, []);

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
        ref={navContainerRef}
        onReady={() => {
          // Seed the initial route so the first screen_view fires before
          // any subsequent state change (otherwise it'd only fire on the
          // *second* navigation).
          const r = navContainerRef.isReady()
            ? navContainerRef.getCurrentRoute()
            : null;
          if (r) {
            currentScreenRef.current = r.name;
            logEvent(AnalyticsEvent.ScreenView, { screen: r.name });
          }
        }}
        onStateChange={() => {
          if (!navContainerRef.isReady()) return;
          const next = navContainerRef.getCurrentRoute()?.name;
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

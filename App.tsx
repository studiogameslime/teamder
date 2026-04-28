import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { I18nManager, LogBox, StatusBar, View } from 'react-native';

// Suppress LogBox red overlays for known-noisy errors that the app
// already swallows internally. expo-notifications throws in Expo Go /
// dev clients without the native module linked; the JS layer catches
// it and returns null, but Metro's global error handler still surfaces
// it as an "Uncaught Error" red box during dev. Listing the message
// pattern here keeps the dev session clean without affecting prod.
LogBox.ignoreLogs([
  "Cannot find native module 'ExpoPushTokenManager'",
  'Cannot find native module',
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
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {
  // expo-notifications native module not available — no-op.
}
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from '@/navigation/RootNavigator';
import { MockModeBanner } from '@/components/MockModeBanner';
import { ToastHost } from '@/components/Toast';
import { colors, isDarkTheme } from '@/theme';
import { DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';

// ── Force RTL on first launch ───────────────────────────────────────────────
// Hebrew is RTL. Setting this once at startup mirrors the entire layout.
// In production you'd typically force RTL at the native side too (see README).
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
  // NOTE: a forced RTL switch normally requires a JS reload to take effect.
  // Expo Go users: shake → Reload after first launch.
}

export default function App() {
  useEffect(() => {
    // Place for one-time bootstraps: analytics init, FCM token registration, etc.
  }, []);

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
      <NavigationContainer theme={navTheme}>
        {/* Stack the navigator under a dev-only banner. The banner renders
            nothing in real mode, so production layouts are untouched. */}
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
    </SafeAreaProvider>
  );
}

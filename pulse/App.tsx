import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';

// Silence noisy dev-only warnings (e.g. expo-background-fetch deprecation)
// so the LogBox toast doesn't cover the UI during development.
LogBox.ignoreLogs([
  'expo-background-fetch',
  '`Background Fetch` functionality is not available',
]);
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './src/theme';
import { RootTabs } from './src/navigation/RootTabs';
import { navRef } from './src/navigation/navRef';
import { DashboardProvider } from './src/state/DashboardContext';
import { ensureNotificationSetup, openInitialOnboardingNotification } from './src/services/notify';
import {
  unregisterBackgroundPoll,
  registerBackgroundQuota,
  POLL_TASK,
} from './src/background';
import { checkAndNotifyQuota } from './src/services/quota';
import { registerForRealtimeAlerts } from './src/services/pushToken';

// Importing ./src/background also registers the TaskManager task definition.
void POLL_TASK;

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    primary: colors.primary,
    text: colors.text,
  },
};

export default function App() {
  useEffect(() => {
    (async () => {
      await ensureNotificationSetup();
      // No periodic background REVIEW polling — the dashboard refreshes only
      // when opened (and on pull-to-refresh), to keep Firestore reads minimal.
      await unregisterBackgroundPoll();
      // Cheap (Cloud Monitoring, no Firestore) check → push if any free quota
      // crosses 50%. Runs on open AND in the background (~every 15 min) so the
      // alert reaches us even when Pulse is closed.
      await checkAndNotifyQuota();
      await registerBackgroundQuota();
      // Register this device for real-time "מישהו נרשם!" pushes.
      await registerForRealtimeAlerts();
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <DashboardProvider>
        <NavigationContainer theme={navTheme} ref={navRef} onReady={() => { void openInitialOnboardingNotification(); }}>
          <StatusBar style="light" />
          <RootTabs />
        </NavigationContainer>
      </DashboardProvider>
    </SafeAreaProvider>
  );
}

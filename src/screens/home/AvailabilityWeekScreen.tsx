// AvailabilityWeekScreen — the full-week "פנויים לידך" view, opened from the
// home podium's "הצג שבוע מלא" link (Pulse: it should NAVIGATE here, not expand
// inline). Renders the complete 7-day × 3-window availability grid.

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { AvailabilityCalendarCard } from '@/components/home/AvailabilityCalendarCard';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, spacing } from '@/theme';
import { he } from '@/i18n/he';

export function AvailabilityWeekScreen() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = useNavigation<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const route = useRoute<any>();
  // The podium's "הצג שבוע מלא" link tags itself; anything else is a direct open.
  const source =
    typeof route.params?.source === 'string' ? route.params.source : 'direct';
  React.useEffect(() => {
    logEvent(AnalyticsEvent.AvailabilityWeekOpened, { source });
    // Mount-only: one event per opening of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.homeWindowsTitle} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <AvailabilityCalendarCard
          fullScreen
          onCreateGame={(dateMs, window, city) => {
            logEvent(AnalyticsEvent.AvailabilityDayPicked, {
              dateMs,
              window,
              ...(city ? { city } : {}),
              source: 'week_screen',
            });
            nav.navigate('GameTab', {
              screen: 'GameCreate',
              params: {
                quick: true,
                prefillDateMs: dateMs,
                prefillWindow: window,
                prefillCity: city ?? undefined,
                inviteAvailable: true,
              },
            });
          }}
          onSetAvailability={() => {
            logEvent(AnalyticsEvent.AvailabilityPromptTapped, {
              source: 'week_screen',
            });
            nav.navigate('AvailabilityEdit');
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
});

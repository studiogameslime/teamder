// Sticky dev-only strip shown when the app is running against mock data.
// Renders nothing in real mode so production builds are unaffected.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { USE_MOCK_DATA } from '@/firebase/config';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

// ⚠️ SCREENSHOT MODE — flip SCREENSHOT_MODE back to false when finished
// capturing for the Play Store. While true, the orange "demo data"
// strip is suppressed.
const SCREENSHOT_MODE = false;

export function MockModeBanner(): React.ReactElement | null {
  if (SCREENSHOT_MODE) return null;
  if (!USE_MOCK_DATA) return null;
  return (
    <View style={styles.bar} accessibilityLabel="mock-mode-banner">
      <Ionicons name="construct-outline" size={14} color={colors.textOnPrimary} />
      <Text style={styles.text} numberOfLines={1}>
        {he.mockBanner}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  text: {
    ...typography.caption,
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
});

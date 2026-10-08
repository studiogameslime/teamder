import React from 'react';
import { StyleSheet } from 'react-native';
import {
  SafeAreaProvider, SafeAreaView, useSafeAreaFrame, useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { safeContentMetrics } from '@/utils/safeContentMetrics';

/** Own the system insets once. Descendants measure the already-safe viewport,
 * so existing screen padding and React Navigation do not add them again.
 * A native Modal needs its own outer provider because it has a separate window.
 */
export function SystemSafeArea({ children, transparent = false }: {
  children: React.ReactNode; transparent?: boolean;
}) {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={[styles.fill, !transparent && { backgroundColor: colors.bg }]}>
      <SafeAreaProvider initialMetrics={safeContentMetrics(frame, insets)}>
        {children}
      </SafeAreaProvider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

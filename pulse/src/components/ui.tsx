import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius } from '../theme';
import type { StoreSource } from '../types';

export function Screen({
  title,
  subtitle,
  right,
  onBack,
  children,
  scroll = true,
  refreshControl,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<any>;
}) {
  const Header = (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={font.h1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          {Header}
          {children}
        </ScrollView>
      ) : (
        // flex:1 so a non-scrolling screen fills the height — lets children use
        // flex:1 (e.g. a full-height map) or bound an inner ScrollView.
        <View style={[styles.scroll, { flex: 1 }]}>
          {Header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'green' | 'amber' | 'red';
}) {
  const toneColor =
    tone === 'green'
      ? colors.green
      : tone === 'amber'
        ? colors.amber
        : tone === 'red'
          ? colors.red
          : colors.text;
  return (
    <Card style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color: toneColor }]}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </Card>
  );
}

export function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  const full = Math.round(rating);
  return (
    <Text style={{ color: colors.star, fontSize: size, letterSpacing: 1 }}>
      {'★★★★★'.slice(0, full)}
      <Text style={{ color: colors.border }}>{'★★★★★'.slice(0, 5 - full)}</Text>
    </Text>
  );
}

export function SourceBadge({ source }: { source: StoreSource }) {
  const isApple = source === 'appstore';
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: isApple ? colors.appstore : colors.googleplay },
      ]}
    >
      <Text style={styles.badgeText}>{isApple ? 'App Store' : 'Google Play'}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Text style={{ color: colors.textMuted }}>{text}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 14, paddingBottom: 36, gap: 10 },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginBottom: 2,
    gap: 12,
  },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  subtitle: { ...font.small, marginTop: 2, textAlign: 'right' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  section: { ...font.h2, marginTop: 12, marginBottom: 2, textAlign: 'right' },
  tile: { flex: 1, gap: 4, minWidth: 0 },
  tileLabel: { ...font.small },
  tileValue: { fontSize: 24, fontWeight: '800' },
  tileSub: { ...font.small, color: colors.textMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

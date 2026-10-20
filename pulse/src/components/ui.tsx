import React, { createContext, useContext, useState } from 'react';
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
import { RTL_LABEL_ALIGN, colors, font, radius  } from '../theme';
import type { StoreSource } from '../types';

export const EmbeddedScreen = createContext(false);

export function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  return <View style={{ gap: 12 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setVisited(true); setOpen(v => !v); }} style={{ minHeight: 48, flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', justifyContent: 'space-between' }}><Text style={font.title}>{title}</Text><Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} /></Pressable>{visited ? <View style={{ display: open ? 'flex' : 'none', gap: 12 }}>{children}</View> : null}</View>;
}

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
  const embedded = useContext(EmbeddedScreen);
  const Header = (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {!embedded ? <Text style={font.h1}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={embedded ? [] : ['top']}>
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
  scroll: { padding: 18, paddingBottom: 36, gap: 14 },
  header: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    marginBottom: 2,
    gap: 12,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  subtitle: {  ...font.small, marginTop: 2, textAlign: RTL_LABEL_ALIGN },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  section: {  ...font.h2, marginTop: 12, marginBottom: 2, textAlign: RTL_LABEL_ALIGN },
  tile: { flex: 1, gap: 4, minWidth: 0 },
  tileLabel: { ...font.small },
  tileValue: { fontSize: 24, fontWeight: '800' },
  tileSub: { ...font.small, color: colors.textMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});


/** Local sections do not initiate reads; panels mount once on first visit. */
export function SectionTabs<T extends string>({ value, onChange, items }: {
  value: T; onChange: (value: T) => void; items: readonly { key: T; label: string }[];
}) {
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', direction: 'rtl' as const, gap: 6, flexWrap: 'wrap' }}>
    {items.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: value === item.key }}
      onPress={() => onChange(item.key)} style={{ flexGrow: 1, minHeight: 48, paddingHorizontal: 12, paddingVertical: 13, alignItems: 'center', borderRadius: radius.sm, backgroundColor: value === item.key ? colors.primarySoft : colors.surface, borderWidth: 1, borderColor: value === item.key ? colors.primary : colors.border }}>
      <Text style={{ ...font.small, color: value === item.key ? colors.primary : colors.textSoft, fontWeight: '700' }}>{item.label}</Text>
    </Pressable>)}
  </View>;
}
export function Panel({ active, children }: { active: boolean; children: React.ReactNode }) {
  const [visited, setVisited] = useState(active);
  React.useEffect(() => { if (active) setVisited(true); }, [active]);
  return active || visited ? <View style={{ display: active ? 'flex' : 'none', gap: 14 }}>{children}</View> : null;
}

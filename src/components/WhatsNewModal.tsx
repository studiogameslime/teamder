// WhatsNewModal — the one-time "מה חדש באפליקציה" bottom sheet shown after a
// version update. Content (highlights) is passed in by WhatsNewGate; this is a
// pure presentational sheet. Flat list of highlights, newest first — no
// per-version grouping (a multi-version jump reads as one clean list).

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { WhatsNewItem } from '@/services/whatsNewService';

interface Props {
  version: string;
  items: WhatsNewItem[];
  onClose: () => void;
}

// Soft tile backgrounds cycled per item so a flat list still feels lively. The
// jersey-colored accents echo the app's palette without implying a category.
const TILE_TINTS = [
  { bg: 'rgba(37,99,235,0.12)' },
  { bg: 'rgba(249,115,22,0.14)' },
  { bg: 'rgba(22,163,74,0.13)' },
  { bg: 'rgba(124,58,237,0.13)' },
];

// A few static confetti dots for a touch of celebration (no animation → cheap,
// and respects reduced-motion by simply being still).
const CONFETTI = [
  { left: '12%', top: 14, color: '#F97316', rot: '20deg' },
  { left: '26%', top: 34, color: '#2563EB', rot: '0deg' },
  { left: '64%', top: 12, color: '#F59E0B', rot: '15deg' },
  { left: '80%', top: 22, color: '#16A34A', rot: '35deg' },
  { left: '90%', top: 46, color: '#7C3AED', rot: '10deg' },
];

export function WhatsNewModal({ version, items, onClose }: Props) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area above the sheet dismisses (like the OS). */}
        <Pressable style={styles.fill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grab} />

          <View style={styles.hero}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {CONFETTI.map((c, i) => (
                <View
                  key={i}
                  style={[
                    styles.confetti,
                    {
                      left: c.left as `${number}%`,
                      top: c.top,
                      backgroundColor: c.color,
                      transform: [{ rotate: c.rot }],
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeTx}>
                {he.whatsNewBadge(version)}
              </Text>
            </View>
            <Text style={styles.title}>{he.whatsNewTitle}</Text>
          </View>

          <ScrollView
            style={styles.listWrap}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {items.map((it, i) => (
              <View key={`${it.version}-${i}`} style={styles.item}>
                <View
                  style={[
                    styles.tile,
                    { backgroundColor: TILE_TINTS[i % TILE_TINTS.length].bg },
                  ]}
                >
                  <Text style={styles.tileEmoji}>{it.emoji || '⚽'}</Text>
                </View>
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>{it.title}</Text>
                  {it.body ? (
                    <Text style={styles.itemDesc}>{it.body}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.ctaWrap}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.cta, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
            >
              <Text style={styles.ctaTx}>{he.whatsNewCta}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  fill: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '86%',
    overflow: 'hidden',
  },
  grab: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginTop: 10,
  },
  hero: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    overflow: 'hidden',
  },
  confetti: { position: 'absolute', width: 7, height: 7, borderRadius: 2, opacity: 0.9 },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 13,
    marginBottom: spacing.sm,
  },
  badgeTx: { color: '#fff', fontWeight: '800', fontSize: 12 },
  title: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  listWrap: { flexGrow: 0 },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tileEmoji: { fontSize: 22 },
  itemBody: { flex: 1 },
  itemTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    fontSize: 15,
    textAlign: RTL_LABEL_ALIGN,
  },
  itemDesc: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  ctaWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  ctaTx: { color: '#fff', fontWeight: '800', fontSize: 16 },
});

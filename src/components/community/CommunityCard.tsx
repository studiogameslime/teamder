// CommunityCard — premium card for the redesigned communities feed.
//
// Layout under forceRTL (visual):
//
//   ┌──────────────────────────────────────────────┐
//   │ [badge]                       שם הקבוצה      │
//   │                              עיר · מגרש 📍    │
//   │                            👥 12 שחקנים       │
//   └──────────────────────────────────────────────┘
//   ↑                                              ↑
//   absolute top-LEFT pin                      content column
//   (physical left, never                      right-aligned via
//    flips under RTL)                           alignSelf:flex-start
//                                              (which under forceRTL
//                                              maps to the visual RIGHT
//                                              edge of the card)
//
// We deliberately avoid `justifyContent: 'space-between'` for the
// header — testing showed inconsistent RTL flipping for that property
// vs the column-cross-axis `alignSelf` (which DOES flip reliably).
// Pinning the badge with absolute `left:` removes any ambiguity:
// physical LEFT regardless of writing direction.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { PressableScale } from '@/components/PressableScale';

export type CommunityCardStatus =
  | 'admin'
  | 'member'
  | 'pending'
  | 'none';

interface Props {
  name: string;
  /** "עיר · מגרש" — pre-joined by the caller, falsy → hidden line. */
  locationLine: string;
  memberCount: number;
  status: CommunityCardStatus;
  /** Tap whole card → details. */
  onPress: () => void;
}

export function CommunityCard({
  name,
  locationLine,
  memberCount,
  status,
  onPress,
}: Props) {
  const palette = paletteFor(status);

  return (
    <PressableScale
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      {/* Status pin — absolute top-LEFT. `left:` is physical so it
          stays put regardless of writing direction. */}
      {palette ? (
        <View style={[styles.badge, { backgroundColor: palette.badgeBg }]}>
          <Ionicons name={palette.icon} size={12} color={palette.badgeFg} />
          <Text style={[styles.badgeText, { color: palette.badgeFg }]}>
            {palette.label}
          </Text>
        </View>
      ) : null}

      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>

      {/* Meta row — location + players chip share ONE row to tighten
          the card vertically and put both bits of info at the same
          glance. Under forceRTL `row-reverse` lays them right→left:
          location first (visual right), then a centered dot, then
          the players chip on the visual left. */}
      <View style={styles.infoRow}>
        {locationLine ? (
          <View style={styles.metaInline}>
            <Text style={styles.metaText} numberOfLines={1}>
              {locationLine}
            </Text>
            <Ionicons name="location" size={13} color="#94A3B8" />
          </View>
        ) : null}
        <View style={styles.playersChip}>
          <Text style={styles.playersText}>
            {he.groupsSearchMembers(memberCount)}
          </Text>
          <Ionicons name="people" size={12} color="#3B82F6" />
        </View>
      </View>
    </PressableScale>
  );
}

interface Palette {
  badgeBg: string;
  badgeFg: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

function paletteFor(status: CommunityCardStatus): Palette | null {
  if (status === 'admin') {
    return {
      badgeBg: '#1D4ED8',
      badgeFg: '#FFFFFF',
      label: he.communityDetailsAdminBadge,
      icon: 'star',
    };
  }
  if (status === 'member') {
    return {
      badgeBg: '#16A34A',
      badgeFg: '#FFFFFF',
      label: he.communitiesCardMemberBadge,
      icon: 'checkmark-circle',
    };
  }
  if (status === 'pending') {
    return {
      badgeBg: '#64748B',
      badgeFg: '#FFFFFF',
      label: he.groupsActionPending,
      icon: 'time',
    };
  }
  return null;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: 6,
    position: 'relative',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  // Pin to the LEFT physical edge under forceRTL. RN's default
  // `swapLeftAndRightInRTL` flips physical `left:` to the trailing
  // edge under RTL, so we use the RTL-aware `end:` instead — `end`
  // under forceRTL resolves to the visual LEFT edge, which is what we
  // want here. `top` is aligned with the name's first text line so
  // the badge sits in the same horizontal band as the title.
  badge: {
    position: 'absolute',
    top: spacing.md,
    end: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  // Name lives on the SAME row as the (absolute) badge. We need a
  // gutter on the badge's side so the right-aligned Hebrew text
  // never bleeds into the badge area. Use `marginEnd` (RTL-aware)
  // because under forceRTL `marginLeft` is swapped to the trailing
  // edge — `marginEnd` always lands on the badge's side (the visual
  // LEFT under RTL).
  name: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    marginEnd: 110,
  },
  // Combined location + players row — `row-reverse` keeps the location
  // (with its leading-icon) on the visual right and the players chip
  // tucked on the visual left edge of the card.
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: 2,
  },
  metaInline: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  metaText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  // Players chip — compact, sits inline on the visual LEFT of the row.
  playersChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(59,130,246,0.10)',
    marginStart: 'auto',
  },
  playersText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },
});

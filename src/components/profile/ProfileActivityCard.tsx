// ProfileActivityCard — "פעילות אחרונה" on the user's own profile.
//
// There is no activity-log collection in the backend, so this feed is
// MERGED from the two real, timestamped event sources we already have:
//   • achievements the user unlocked   (user.achievements.unlocked[])
//   • players who joined via the user  (userService.listInvitedUsers)
//
// We deliberately do NOT include finished games: getHistory is
// per-community and its summaries don't record whether THIS user
// actually attended, so "you played in X" would be a guess. When both
// real sources are empty the card shows a neutral empty line rather
// than inventing filler.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ACHIEVEMENTS } from '@/data/achievements';
import type { User } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDateShort, formatTime } from '@/utils/format';

export interface ProfileActivityItem {
  id: string;
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  timestamp: number;
}

interface ReferralLike {
  id: string;
  name?: string;
  invitedAt?: number;
}

/**
 * Build the merged, newest-first activity list from the real sources.
 * Pure — the screen fetches the referrals and passes them in.
 */
export function buildProfileActivity(
  user: Pick<User, 'achievements'>,
  referrals: ReferralLike[],
  limit = 6,
): ProfileActivityItem[] {
  const items: ProfileActivityItem[] = [];

  for (const unlock of user.achievements?.unlocked ?? []) {
    const def = ACHIEVEMENTS.find((a) => a.id === unlock.id);
    if (!def || !unlock.unlockedAt) continue;
    items.push({
      id: `ach:${unlock.id}`,
      text: he.profileActivityAchievement(def.titleHe),
      icon: 'trophy',
      iconColor: def.tint,
      timestamp: unlock.unlockedAt,
    });
  }

  for (const r of referrals) {
    if (!r.invitedAt) continue;
    items.push({
      id: `ref:${r.id}`,
      text: r.name
        ? he.profileActivityReferral(r.name)
        : he.profileActivityReferralAnon,
      icon: 'person-add',
      iconColor: '#3B82F6',
      timestamp: r.invitedAt,
    });
  }

  return items
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

// Calendar-aware "היום / אתמול / DD.MM" so an event from 1am today
// still reads "היום", not yesterday's date.
function dayLabel(ms: number, now = Date.now()): string {
  const dayStart = (x: number) => {
    const d = new Date(x);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diffDays = Math.round((dayStart(now) - dayStart(ms)) / 86_400_000);
  if (diffDays <= 0) return he.profileActivityToday;
  if (diffDays === 1) return he.profileActivityYesterday;
  return formatDateShort(ms);
}

interface Props {
  items: ProfileActivityItem[];
}

export function ProfileActivityCard({ items }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="pulse-outline" size={18} color={colors.text} />
        <Text style={styles.title}>{he.profileActivityTitle}</Text>
      </View>
      <View style={styles.card}>
        {items.length === 0 ? (
          <Text style={styles.empty}>{he.profileActivityEmpty}</Text>
        ) : (
          items.map((it, i) => (
            <View
              key={it.id}
              style={[styles.row, i > 0 && styles.rowDivider]}
            >
              {/* `row` under forceRTL puts the FIRST child on the visual
                  RIGHT: icon (right) → text (middle) → time block (left),
                  matching the mockup's activity rows. */}
              <View
                style={[styles.iconWrap, { backgroundColor: tint(it.iconColor) }]}
              >
                <Ionicons name={it.icon} size={16} color={it.iconColor} />
              </View>
              <Text style={styles.rowText} numberOfLines={2}>
                {it.text}
              </Text>
              <View style={styles.timeBlock}>
                <Text style={styles.dayText}>{dayLabel(it.timestamp)}</Text>
                <Text style={styles.timeText}>{formatTime(it.timestamp)}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

// Soft 12%-alpha background behind the glyph from its own hue.
function tint(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#EFF6FF';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.12)`;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  // `row` flips under forceRTL → icon (first child) on the visual
  // RIGHT, text in the middle, time block on the visual LEFT.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 18,
  },
  timeBlock: {
    alignItems: 'center',
    minWidth: 44,
  },
  dayText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  timeText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
});

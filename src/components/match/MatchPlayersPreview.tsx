// MatchPlayersPreview — compact "social glance" of who's in. Sits
// on the main MatchDetailsScreen INSTEAD of a full roster list.
//
// Layout:
//   שחקנים (1/10)                                        צפה בכל ↤
//   [👕] [👕] [👕] [+9 פנויים]
//   מתן לוי, דניאל כהן ועוד 7
//
// Whole card is one tap target → full roster screen. The
// "+N פנויים / +N נוספים" chip's wording flips with state:
//   • all registered fit on the row → show "+N פנויים" (open spots)
//   • registered overflows the row → show "+N נוספים" (more hidden)

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import type { User } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  registered: number;
  capacity: number;
  members: Array<Pick<User, 'id' | 'name' | 'jersey'>>;
  onPress: () => void;
}

const MAX_VISIBLE = 5;
const JERSEY_SIZE = 44;
const OVERLAP = Math.round(JERSEY_SIZE * 0.32);
const MAX_NAMES = 3;

export function MatchPlayersPreview({
  registered,
  capacity,
  members,
  onPress,
}: Props) {
  const visible = members.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, registered - visible.length);
  const open = Math.max(0, capacity - registered);
  // Chip wording: prefer "open spots" when nothing's hidden, else
  // "more registered". Hide chip entirely when both are zero (full
  // game with everyone shown — unlikely at MAX_VISIBLE=5 but safe).
  const chip =
    hidden > 0
      ? { kind: 'more' as const, count: hidden }
      : open > 0
        ? { kind: 'open' as const, count: open }
        : null;

  // Names line — first 2-3 first-words from registered members.
  // Showing first-word-only keeps the line short on small phones
  // and matches how Israelis introduce themselves casually.
  const namedFirst = members
    .slice(0, MAX_NAMES)
    .map((m) => m.name.split(' ')[0]);
  let namesLine = '';
  if (namedFirst.length === 0) {
    namesLine = '';
  } else if (registered <= namedFirst.length) {
    namesLine = joinNames(namedFirst);
  } else {
    namesLine = `${joinNames(namedFirst)} ${he.matchPlayersAndMore(
      registered - namedFirst.length,
    )}`;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {he.matchPlayersTitle}{' '}
          <Text style={styles.count}>
            ({registered}/{capacity})
          </Text>
        </Text>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{he.matchPlayersSeeAll}</Text>
          <Ionicons name="chevron-back" size={14} color={colors.primary} />
        </View>
      </View>

      {registered === 0 ? (
        <Text style={styles.empty}>{he.matchPlayersNobodyYet}</Text>
      ) : (
        <>
          <View style={styles.stack}>
            {visible.map((m, i) => (
              <View
                key={m.id}
                style={[
                  styles.stackCell,
                  i > 0 ? { marginEnd: -OVERLAP } : null,
                  // Reverse z-index so the leftmost (last visually
                  // in RTL) sits on top — same pattern as iOS group
                  // avatars.
                  { zIndex: visible.length - i },
                ]}
              >
                <View style={styles.avatarRing}>
                  <PlayerIdentity user={m} size={JERSEY_SIZE} />
                </View>
              </View>
            ))}
            {chip ? (
              <View
                style={[
                  styles.chip,
                  chip.kind === 'open' ? styles.chipOpen : styles.chipMore,
                  visible.length > 0 ? { marginEnd: spacing.xs } : null,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    chip.kind === 'open'
                      ? styles.chipTextOpen
                      : styles.chipTextMore,
                  ]}
                >
                  {chip.kind === 'open'
                    ? he.matchPlayersOpenChip(chip.count)
                    : he.matchPlayersMoreChip(chip.count)}
                </Text>
              </View>
            ) : null}
          </View>
          {namesLine ? (
            <Text style={styles.namesLine} numberOfLines={1}>
              {namesLine}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

function joinNames(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ו${parts[1]}`;
  // 3+ → "A, B ו-C"
  return `${parts.slice(0, -1).join(', ')} ו${parts[parts.length - 1]}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  count: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ctaText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackCell: {
    // sized by the inner avatarRing
  },
  avatarRing: {
    width: JERSEY_SIZE,
    height: JERSEY_SIZE,
    borderRadius: JERSEY_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  chip: {
    paddingHorizontal: 10,
    height: JERSEY_SIZE,
    borderRadius: JERSEY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: JERSEY_SIZE + 12,
  },
  chipOpen: {
    backgroundColor: colors.primaryLight,
  },
  chipMore: {
    backgroundColor: colors.surfaceMuted,
  },
  chipText: {
    fontWeight: '700',
    fontSize: 12,
  },
  chipTextOpen: { color: colors.primary },
  chipTextMore: { color: colors.textMuted },
  namesLine: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});

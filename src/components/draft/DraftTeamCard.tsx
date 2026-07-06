// DraftTeamCard — one team, one COMPACT full-width row. The team label
// sits on the left; the captain (avatar ringed in brand blue, no "קפטן"
// text) sits on the right with their first name; each drafted player is
// added beside the captain as a smaller avatar + first name, flowing
// leftward and wrapping as the team grows. Height is content-driven — no
// wasted space.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GrowIn, ShrinkOut } from './DraftScalePop';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography, shadows } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { teamName } from '@/utils/draft';
import { teamColor, teamPaletteEntry } from '@/components/match/rotationView';

export interface DraftUserLite {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

interface Props {
  index: number;
  captain: DraftUserLite;
  /** Drafted players (excludes the captain). */
  members: DraftUserLite[];
  /** Highlight the team whose turn it is to pick. */
  highlight?: boolean;
  /** Tap a player chip → open their card. */
  onPressUser?: (id: string) => void;
  /** Live board only: members grow in when drafted (off for static views). */
  growMembers?: boolean;
  /** A just-un-picked player still shrinking out of this card. */
  ghostMember?: DraftUserLite;
  /** Called when the ghost finishes shrinking, so the parent drops it. */
  onGhostDone?: () => void;
  /** Admin-chosen team colour key — names the team by colour ("האדומים"). */
  colorKey?: string;
  /** Tap the colour swatch to change it (admin only). */
  onPickColor?: () => void;
  /** Average internal rating of the team. Shown as a small ⭐ badge next to the
   *  team name ONLY when provided — the caller decides visibility (internal
   *  rating on, and either not hidden or the viewer is an admin). */
  teamRating?: number;
}

/** First token only — "מתן לוי" → "מתן", "Itay Davidi" → "Itay". */
function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}

export function DraftTeamCard({
  index,
  captain,
  members,
  highlight,
  onPressUser,
  growMembers,
  ghostMember,
  onGhostDone,
  colorKey,
  onPickColor,
  teamRating,
}: Props) {
  // Each team carries its own colour. When the admin chose one, the team is
  // named by that colour in plural ("האדומים") and tinted it; otherwise the
  // default per-index colour + name.
  const chosen = teamPaletteEntry(colorKey);
  const tColor = chosen ? chosen.hex : teamColor(index);
  const tLabel = chosen ? chosen.plural : teamName(index);
  return (
    <View
      style={[
        styles.card,
        { borderColor: tColor },
        highlight && styles.cardHighlight,
      ]}
    >
      {/* QA: team label on the right, players start from the LEFT. The
          captain (first chip) lands on the left; members flow right. */}
      <View style={styles.chips}>
        <Chip user={captain} captain onPressUser={onPressUser} />
        {members.map((m) =>
          growMembers ? (
            <GrowIn key={m.id}>
              <Chip user={m} onPressUser={onPressUser} />
            </GrowIn>
          ) : (
            <Chip key={m.id} user={m} onPressUser={onPressUser} />
          ),
        )}
        {ghostMember && onGhostDone ? (
          <ShrinkOut key={`ghost-${ghostMember.id}`} onDone={onGhostDone}>
            <Chip user={ghostMember} />
          </ShrinkOut>
        ) : null}
      </View>
      <View style={styles.teamNameRow}>
        {onPickColor ? (
          <Pressable
            onPress={onPickColor}
            hitSlop={8}
            style={[styles.colorSwatch, { backgroundColor: tColor, borderColor: chosen?.light ? colors.border : tColor }]}
            accessibilityRole="button"
            accessibilityLabel="בחר צבע קבוצה"
          >
            <Ionicons name="color-palette" size={12} color={chosen?.light ? colors.textMuted : '#FFFFFF'} />
          </Pressable>
        ) : (
          <View style={[styles.teamDot, { backgroundColor: tColor }]} />
        )}
        <Text style={[styles.teamName, { color: tColor }]}>{tLabel}</Text>
        {typeof teamRating === 'number' ? (
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={11} color={colors.primary} />
            <Text style={styles.ratingText}>{teamRating.toFixed(1)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Chip({
  user,
  captain,
  onPressUser,
}: {
  user: DraftUserLite;
  captain?: boolean;
  onPressUser?: (id: string) => void;
}) {
  const body = (
    <>
      {/* Fixed-height area so a smaller member avatar centers on the same
          line as the larger captain avatar (not pinned to the top). */}
      <View style={styles.avatarArea}>
        <View style={captain ? styles.captainRing : undefined}>
          <UserAvatar user={user} size={captain ? 34 : 30} />
        </View>
      </View>
      <Text style={styles.chipName} numberOfLines={1}>
        {firstName(user.name)}
      </Text>
    </>
  );
  return onPressUser ? (
    <Pressable
      style={styles.chip}
      onPress={() => onPressUser(user.id)}
      accessibilityRole="button"
      accessibilityLabel={user.name}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.chip}>{body}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    // row-reverse → team label pinned to the RIGHT, the players block on
    // the LEFT (QA request). Under forceRTL this reads as a plain LTR row.
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  cardHighlight: { borderColor: colors.primary, borderWidth: 2 },
  teamNameRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
  },
  ratingBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  ratingText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    // row-reverse so the captain starts at the LEFT and members flow
    // rightward (QA request); under forceRTL this reads as a plain LTR row.
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    // center (not flex-start) so when a big team WRAPS, the leftover avatars
    // sit centered under the row instead of a lonely orphan hugging the edge
    // (user report 2026-06-21). No effect on teams that fit one row — the
    // chips block is content-sized via the parent's `space-between`, so a
    // single full row equals the block width and centering is a no-op there.
    justifyContent: 'center',
    // Tightened (2026-06-12) so a 7-a-side team fits a row without
    // wrapping to a lonely 5th/6th avatar.
    columnGap: 4,
    rowGap: spacing.xs,
    flexShrink: 1,
  },
  chip: { width: 40, alignItems: 'center', gap: 3 },
  avatarArea: { height: 44, justifyContent: 'center', alignItems: 'center' },
  captainRing: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 99,
    padding: 1.5,
  },
  chipName: {
    ...typography.caption,
    fontSize: 11,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
});

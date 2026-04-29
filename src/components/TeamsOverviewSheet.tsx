// TeamsOverviewSheet — the "צפייה בקבוצות" bottom-sheet modal opened
// from LiveMatchScreen. Read-only summary of every team in the match
// (2 or 3) plus their current score and per-player avg rating.
//
// Layout per row card:
//   ┌────────────────────────────────────────────┐
//   │  [score]                          [name]   │  header (RTL)
//   │  [⭐ avg]                                   │
//   │                                            │
//   │  • player A                                │  player rows, RTL
//   │  • player B                                │
//   └────────────────────────────────────────────┘

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PlayerIdentity } from './PlayerIdentity';
import { ratingsService } from '@/services/ratingsService';
import {
  GameGuest,
  GroupId,
  parseGuestRosterId,
  UserId,
} from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useGameStore } from '@/store/gameStore';

export interface TeamSlot {
  /** Stable index 0..2, used for the localized team name. */
  index: number;
  /** Tint color used by the score chip. */
  tint: string;
  /** Roster ids (mix of real uids and `guest:<id>` markers). */
  playerIds: UserId[];
  /** Score for this team (taken from LiveMatchState). */
  score: number;
  /** True when team is sitting out the current matchup (3-team mode). */
  isWaiting?: boolean;
}

interface Props {
  visible: boolean;
  groupId: GroupId | null;
  teams: TeamSlot[];
  guests: GameGuest[];
  onClose: () => void;
}

export function TeamsOverviewSheet({
  visible,
  groupId,
  teams,
  guests,
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {/* Drag handle (visual only — close happens via backdrop / X button). */}
        <View style={styles.grabber} />

        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityLabel={he.liveTeamsModalClose}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>{he.liveTeamsModalTitle}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scrollBody}>
          {teams.map((t) => (
            <TeamCard
              key={t.index}
              slot={t}
              groupId={groupId}
              guests={guests}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── One team card ────────────────────────────────────────────────────────

function TeamCard({
  slot,
  groupId,
  guests,
}: {
  slot: TeamSlot;
  groupId: GroupId | null;
  guests: GameGuest[];
}) {
  const playersMap = useGameStore((s) => s.players);

  // Resolve real-user ratings async. Guests carry an `estimatedRating`
  // field that the coach set when adding them; we use that as their
  // contribution. Real users without a rating contribute 0 ratings to
  // the count (so the average represents only rated members).
  const [ratings, setRatings] = useState<Record<UserId, number>>({});

  useEffect(() => {
    if (!groupId) return;
    const realIds = slot.playerIds.filter((id) => !parseGuestRosterId(id));
    let alive = true;
    Promise.all(
      realIds.map(async (uid) => {
        const s = await ratingsService.getSummary(groupId, uid).catch(() => null);
        return [uid, s?.average ?? 0] as const;
      }),
    ).then((entries) => {
      if (!alive) return;
      const map: Record<UserId, number> = {};
      for (const [uid, avg] of entries) map[uid] = avg;
      setRatings(map);
    });
    return () => {
      alive = false;
    };
  }, [groupId, slot.playerIds.join('|')]);

  // Average of (real-user community ratings > 0) ∪ (guest estimatedRating)
  const ratingValues: number[] = [];
  for (const id of slot.playerIds) {
    const guestId = parseGuestRosterId(id);
    if (guestId) {
      const g = guests.find((x) => x.id === guestId);
      if (g?.estimatedRating) ratingValues.push(g.estimatedRating);
    } else {
      const v = ratings[id];
      if (v && v > 0) ratingValues.push(v);
    }
  }
  const avg =
    ratingValues.length > 0
      ? ratingValues.reduce((s, v) => s + v, 0) / ratingValues.length
      : null;

  return (
    <View style={[styles.card, slot.isWaiting && styles.cardWaiting]}>
      {/* HEADER — name (RIGHT) + score chip (LEFT). RTL flexDirection
          row auto-flips so first JSX child renders to the right. */}
      <View style={styles.cardHeader}>
        <View style={styles.cardNameWrap}>
          <View style={[styles.colorDot, { backgroundColor: slot.tint }]} />
          <Text style={styles.cardName} numberOfLines={1}>
            {he.liveTeamLabel(slot.index)}
          </Text>
          {slot.isWaiting ? (
            <View style={styles.waitingPill}>
              <Text style={styles.waitingPillText}>{he.liveTeamWaiting}</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.scoreChip, { backgroundColor: slot.tint }]}>
          <Text style={styles.scoreChipText}>{slot.score}</Text>
        </View>
      </View>

      {/* AVG rating row */}
      <View style={styles.avgRow}>
        <Text style={styles.avgLabel}>{he.liveAvgRating}</Text>
        <View style={styles.avgValue}>
          <Ionicons name="star" size={13} color={colors.warning} />
          <Text style={styles.avgValueText}>
            {avg === null ? '—' : avg.toFixed(1)}
          </Text>
        </View>
      </View>

      {/* PLAYER LIST */}
      <View style={styles.playerList}>
        {slot.playerIds.length === 0 ? (
          <Text style={styles.empty}>{he.liveTeamRosterEmpty}</Text>
        ) : (
          slot.playerIds.map((pid) => {
            const guestId = parseGuestRosterId(pid);
            const guest = guestId
              ? guests.find((g) => g.id === guestId)
              : undefined;
            const u = playersMap[pid];
            const name = guest?.name ?? u?.displayName ?? '—';
            const jersey = guest ? undefined : u?.jersey;
            return (
              <View key={pid} style={styles.playerRow}>
                <PlayerIdentity
                  user={{ id: pid, name, jersey }}
                  size={28}
                />
                <Text style={styles.playerName} numberOfLines={1}>
                  {name}
                </Text>
                {guest ? (
                  <View style={styles.guestPill}>
                    <Text style={styles.guestPillText}>{he.guestBadge}</Text>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  title: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  scrollBody: {
    padding: spacing.lg,
    gap: spacing.md,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardWaiting: {
    opacity: 0.85,
    borderStyle: 'dashed',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cardName: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: 'right',
  },
  waitingPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
  },
  waitingPillText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  scoreChip: {
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  scoreChipText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },

  avgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avgLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  avgValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  avgValueText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },

  playerList: {
    gap: 6,
    marginTop: spacing.xs,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playerName: {
    ...typography.body,
    color: colors.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  guestPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: colors.warning,
  },
  guestPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    paddingVertical: spacing.sm,
  },
});

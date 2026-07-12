// One team's "scoreboard" block. Two layouts:
//   • variant="list" (live scoreboard) — a wins box on the outer edge + the
//     team name/count, then a numbered roster list (rank · name · avatar),
//     mirrored so avatars sit on the outer edge and ranks toward the divider.
//   • variant="grid" (winner picker / roster peek) — trophies + streak pill +
//     a 3-up avatar grid with names.
// A blue star badge marks a borrowed filler. Shared by both surfaces.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { teamName, teamColor, firstName, type RosterMember } from '@/components/match/rotationView';
import { MeasurablePressable, type MenuAnchor } from '@/components/match/PlayerActionMenu';

const GOLD = '#F4B73E';
const TEAM_BLUE = '#2563EB';

/** Pulsing opacity — marks the swap-target candidates during "החלפה". */
function Blink({ active, children }: { active: boolean; children: React.ReactNode }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      op.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.25, duration: 450, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, op]);
  return <Animated.View style={{ opacity: op }}>{children}</Animated.View>;
}

interface Props {
  teamIdx: number;
  roster: RosterMember[];
  wins: number;
  align: 'right' | 'left';
  avatarSize?: number;
  variant?: 'list' | 'grid';
  /** Goals per player this round — shown in the list badge instead of a rank. */
  goalsByPlayer?: Record<string, number>;
  /** Draft teams (carry the admin-chosen colour) so the name/tint reflect it. */
  teams?: { index: number; colorKey?: string }[];
  /** Tap a player (list variant only) → reports the avatar's on-screen rect so
   *  the caller can anchor a popover menu beside them. */
  onPlayerPress?: (m: RosterMember, rect: MenuAnchor) => void;
  /** "החלפה" mode: blink every candidate (all but the picked source). */
  swapMode?: boolean;
  swapSourceId?: string | null;
}

export function TeamScore({
  teamIdx,
  roster,
  wins,
  align,
  avatarSize,
  variant = 'grid',
  goalsByPlayer,
  teams,
  onPlayerPress,
  swapMode,
  swapSourceId,
}: Props) {
  const star = (
    <View style={styles.star}>
      <Ionicons name="star" size={11} color="#FFFFFF" />
    </View>
  );

  // Disambiguate players who share a first name WITHIN this team (common in
  // pickup groups) by appending a last-name initial — otherwise the live
  // scoreboard + goal badges are ambiguous ("which גיא scored?").
  const firstNameCounts = roster.reduce<Record<string, number>>((acc, m) => {
    const f = firstName(m.name);
    acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});
  const labelOf = (m: RosterMember): string => {
    const f = firstName(m.name);
    if ((firstNameCounts[f] ?? 0) < 2) return f;
    const parts = m.name.trim().split(/\s+/);
    const initial = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return initial ? `${f} ${initial}׳` : f;
  };

  // ─── List layout (live scoreboard) ──────────────────────────────────────
  // Both teams use the IDENTICAL structure (not mirrored): in RTL the avatar
  // leads on the right, the name follows, and the rank sits on the left.
  if (variant === 'list') {
    const size = avatarSize ?? 36;
    return (
      <View style={styles.listCol}>
        <View style={styles.headerRow}>
          <Text style={[styles.nameOnly, { color: teamColor(teamIdx, teams) }]}>{teamName(teamIdx, teams)}</Text>
          <View style={styles.winsBox}>
            <Text style={styles.winsNum}>{wins}</Text>
            <Text style={styles.winsLabel}>{he.rotationWinsLabel}</Text>
          </View>
        </View>
        <View style={styles.list}>
          {roster.map((m) => {
            const goals = goalsByPlayer?.[m.id] ?? 0;
            const isSource = swapMode && m.id === swapSourceId;
            const avatar = (
              <Blink active={!!swapMode && !isSource}>
                <View style={isSource ? styles.swapSource : undefined}>
                  <UserAvatar
                    user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                    size={size}
                    ring
                  />
                  {m.isFiller ? star : null}
                </View>
              </Blink>
            );
            return (
              <View key={m.id} style={styles.playerRow}>
                {onPlayerPress ? (
                  <MeasurablePressable
                    onMeasured={(rect) => onPlayerPress(m, rect)}
                    hitSlop={6}
                    accessibilityLabel={m.name}
                  >
                    {avatar}
                  </MeasurablePressable>
                ) : (
                  avatar
                )}
                <Text style={styles.playerName} numberOfLines={1}>
                  {labelOf(m)}
                </Text>
                {/* Goal count for this round (replaces the old rank number).
                    Uniform, flat stat chip — never a filled/tappable look. */}
                <View style={styles.goalBadge}>
                  <Ionicons name="football" size={11} color="#64748B" />
                  <Text style={styles.goalNum}>{goals}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  // ─── Grid layout (winner picker / roster peek) ──────────────────────────
  const size = avatarSize ?? 40;
  const trophyCount = Math.min(Math.max(wins, 0), 3);
  const trophyFirst = align === 'left';
  const trophies =
    trophyCount > 0 ? (
      <View style={styles.trophyRow}>
        {Array.from({ length: trophyCount }).map((_, i) => (
          <Ionicons key={i} name="trophy" size={20} color={GOLD} style={styles.trophy} />
        ))}
      </View>
    ) : null;
  return (
    <View style={styles.gridCol}>
      <View style={styles.gridHeader}>
        <View style={styles.gridHeadRow}>
          {trophyFirst ? trophies : null}
          <Text style={[styles.name, { color: teamColor(teamIdx, teams) }]}>{teamName(teamIdx, teams)}</Text>
          {trophyFirst ? null : trophies}
        </View>
        {wins > 0 ? (
          <View style={styles.streakPill}>
            <Text style={styles.streakText}>{he.rotationStreak(wins)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.grid}>
        {roster.map((m) => (
          <View key={m.id} style={styles.cell}>
            <View>
              <UserAvatar
                user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                size={size}
                ring
              />
              {m.isFiller ? star : null}
            </View>
            <Text style={styles.playerNameGrid} numberOfLines={1}>
              {labelOf(m)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // shared
  name: { fontSize: 18, fontWeight: '800', color: TEAM_BLUE, textAlign: RTL_LABEL_ALIGN },
  count: { fontSize: 13, fontWeight: '600', color: '#64748B', textAlign: RTL_LABEL_ALIGN },
  star: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },

  // list variant
  listCol: { flex: 1, minWidth: 0, gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  winsBox: {
    minWidth: 52,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#EFF3FA',
    alignItems: 'center',
  },
  winsNum: { fontSize: 18, fontWeight: '800', color: TEAM_BLUE, fontVariant: ['tabular-nums'] },
  winsLabel: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  nameOnly: {
    flex: 1,
    minWidth: 0,
    fontSize: 18,
    fontWeight: '800',
    color: TEAM_BLUE,
    textAlign: RTL_LABEL_ALIGN,
  },
  list: { gap: 6 },
  swapSource: {
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: '#1D4ED8',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#EEF1F6',
    backgroundColor: '#FFFFFF',
  },
  // Goal-count chip (replaces the rank). Uniform + flat for every player so it
  // reads as a stat, not a tappable button.
  goalBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 3,
    minWidth: 36,
    height: 22,
    paddingHorizontal: 7,
    justifyContent: 'center',
  },
  goalNum: { fontSize: 13, fontWeight: '800', color: '#334155', fontVariant: ['tabular-nums'] },
  // `flex: 1` + `minWidth: 0` makes a long name ellipsize instead of pushing
  // the goal badge outside the card (the "Eliran Tzabari" overflow bug).
  playerName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    textAlign: RTL_LABEL_ALIGN,
  },

  // grid variant
  gridCol: { width: '100%', gap: 6, alignItems: 'center' },
  gridHeader: { width: '100%', minHeight: 52, gap: 6, alignItems: 'center' },
  gridHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  trophyRow: { flexDirection: 'row', alignItems: 'center' },
  trophy: { marginHorizontal: -1 },
  streakPill: {
    backgroundColor: TEAM_BLUE,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  streakText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 4,
    rowGap: 8,
    marginTop: 4,
    alignSelf: 'stretch',
  },
  cell: { width: '31%', alignItems: 'center', gap: 4 },
  playerNameGrid: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
});

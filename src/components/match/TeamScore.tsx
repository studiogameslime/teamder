// One team's "scoreboard" block. Two layouts:
//   • variant="list" (live scoreboard) — a wins box on the outer edge + the
//     team name/count, then a numbered roster list (rank · name · avatar),
//     mirrored so avatars sit on the outer edge and ranks toward the divider.
//   • variant="grid" (winner picker / roster peek) — trophies + streak pill +
//     a 3-up avatar grid with names.
// A blue star badge marks a borrowed filler. Shared by both surfaces.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { he } from '@/i18n/he';
import { teamName, type RosterMember } from '@/components/match/rotationView';

const GOLD = '#F4B73E';
const TEAM_BLUE = '#2563EB';

interface Props {
  teamIdx: number;
  roster: RosterMember[];
  wins: number;
  align: 'right' | 'left';
  avatarSize?: number;
  variant?: 'list' | 'grid';
}

export function TeamScore({
  teamIdx,
  roster,
  wins,
  align,
  avatarSize,
  variant = 'grid',
}: Props) {
  const star = (
    <View style={styles.star}>
      <Ionicons name="star" size={11} color="#FFFFFF" />
    </View>
  );

  // ─── List layout (live scoreboard) ──────────────────────────────────────
  // Both teams use the IDENTICAL structure (not mirrored): in RTL the avatar
  // leads on the right, the name follows, and the rank sits on the left.
  if (variant === 'list') {
    const size = avatarSize ?? 36;
    return (
      <View style={styles.listCol}>
        <View style={styles.headerRow}>
          <View style={styles.nameStack}>
            <Text style={styles.name}>{teamName(teamIdx)}</Text>
            <Text style={styles.count}>{he.rotationPlayersCount(roster.length)}</Text>
          </View>
          <View style={styles.winsBox}>
            <Text style={styles.winsNum}>{wins}</Text>
            <Text style={styles.winsLabel}>{he.rotationWinsLabel}</Text>
          </View>
        </View>
        <View style={styles.list}>
          {roster.map((m, i) => (
            <View key={m.id} style={styles.playerRow}>
              <View>
                <UserAvatar
                  user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                  size={size}
                  ring
                />
                {m.isFiller ? star : null}
              </View>
              <Text style={styles.playerName} numberOfLines={1}>
                {m.name}
              </Text>
              <View style={styles.rowSpacer} />
              <View style={styles.rank}>
                <Text style={styles.rankText}>{i + 1}</Text>
              </View>
            </View>
          ))}
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
          <Text style={styles.name}>{teamName(teamIdx)}</Text>
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
              {m.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // shared
  name: { fontSize: 18, fontWeight: '800', color: TEAM_BLUE, textAlign: 'right' },
  count: { fontSize: 13, fontWeight: '600', color: '#64748B', textAlign: 'right' },
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
  nameStack: { flex: 1, minWidth: 0, gap: 1, alignItems: 'stretch' },
  list: { gap: 6 },
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
  rank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontSize: 12, fontWeight: '800', color: TEAM_BLUE },
  playerName: { fontSize: 13, fontWeight: '700', color: '#1E293B', textAlign: 'right' },
  rowSpacer: { flex: 1, minWidth: 4 },

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

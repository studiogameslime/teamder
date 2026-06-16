// One team's "scoreboard" block: gold trophies + team name + a blue
// "win streak" pill, the player count, and the roster. Two layouts:
//   • singleRow (live scoreboard) — one clean avatar row, no names.
//   • grid (winner picker / roster peek) — 3-up avatars with names.
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
  /** Live scoreboard: one centered avatar row + player count, no names. */
  singleRow?: boolean;
}

export function TeamScore({
  teamIdx,
  roster,
  wins,
  align,
  avatarSize,
  singleRow = false,
}: Props) {
  const size = avatarSize ?? (singleRow ? 28 : 40);
  const trophyCount = Math.min(Math.max(wins, 0), 3);
  // Trophies on the inner side (toward the divider) so the two teams mirror.
  const trophyFirst = align === 'left';
  const trophies =
    trophyCount > 0 ? (
      <View style={styles.trophyRow}>
        {Array.from({ length: trophyCount }).map((_, i) => (
          <Ionicons key={i} name="trophy" size={20} color={GOLD} style={styles.trophy} />
        ))}
      </View>
    ) : null;

  const Star = (
    <View style={styles.star}>
      <Ionicons name="star" size={11} color="#FFFFFF" />
    </View>
  );

  return (
    <View style={styles.col}>
      {/* Fixed-height header so both teams' rosters start at the same Y even
          when only one team has a win-streak pill. */}
      <View style={styles.headerBlock}>
        <View style={styles.headRow}>
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

      {singleRow ? (
        <>
          <Text style={styles.count}>{he.rotationPlayersCount(roster.length)}</Text>
          <View style={styles.rowAvatars}>
            {roster.map((m) => (
              <View key={m.id} style={styles.rowAvatarWrap}>
                <UserAvatar
                  user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                  size={size}
                  ring
                />
                {m.isFiller ? Star : null}
              </View>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.grid}>
          {roster.map((m) => (
            <View key={m.id} style={styles.cell}>
              <View>
                <UserAvatar
                  user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                  size={size}
                  ring
                />
                {m.isFiller ? Star : null}
              </View>
              <Text style={styles.playerName} numberOfLines={1}>
                {m.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { width: '100%', gap: 6, alignItems: 'center' },
  headerBlock: { width: '100%', minHeight: 52, gap: 6, alignItems: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  trophyRow: { flexDirection: 'row', alignItems: 'center' },
  trophy: { marginHorizontal: -1 },
  name: { fontSize: 18, fontWeight: '800', color: TEAM_BLUE },
  streakPill: {
    backgroundColor: TEAM_BLUE,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  streakText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  count: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  // Each team's avatars sit on their own tinted strip so the two teams read
  // as separate groups instead of one continuous row of 10.
  rowAvatars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  rowAvatarWrap: { position: 'relative' },
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
  playerName: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
});

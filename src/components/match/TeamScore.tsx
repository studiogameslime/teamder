// One team's "scoreboard" block: gold trophies + team name + a blue
// "win streak" pill + the on-pitch roster as an avatar grid (3-up), with a
// blue star badge on any borrowed filler. Shared by the live scoreboard card
// and the winner-picker modal so both render identically.

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
}

export function TeamScore({ teamIdx, roster, wins, align, avatarSize = 40 }: Props) {
  const trophyCount = Math.min(Math.max(wins, 0), 3);
  const trophyFirst = align === 'right';
  const trophies =
    trophyCount > 0 ? (
      <View style={styles.trophyRow}>
        {Array.from({ length: trophyCount }).map((_, i) => (
          <Ionicons key={i} name="trophy" size={20} color={GOLD} style={styles.trophy} />
        ))}
      </View>
    ) : null;

  return (
    <View style={[styles.col, align === 'right' ? styles.alignRight : styles.alignLeft]}>
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

      <View style={styles.grid}>
        {roster.map((m) => (
          <View key={m.id} style={styles.cell}>
            <View>
              <UserAvatar
                user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }}
                size={avatarSize}
                ring
              />
              {m.isFiller ? (
                <View style={styles.star}>
                  <Ionicons name="star" size={11} color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            <Text style={styles.playerName} numberOfLines={1}>
              {m.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { width: '100%', gap: 8 },
  alignRight: { alignItems: 'flex-end' },
  alignLeft: { alignItems: 'flex-start' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
    right: -2,
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

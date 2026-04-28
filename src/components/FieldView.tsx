// 5v5 field with avatars in formation. Visual only — no interactions.

import React from 'react';
import { StyleSheet, Text, View, ImageBackground } from 'react-native';
import { PlayerIdentity } from './PlayerIdentity';
import { Player, TeamColor } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  teamA: { color: TeamColor; players: Player[]; goalkeeperId: string };
  teamB: { color: TeamColor; players: Player[]; goalkeeperId: string };
}

const TEAM_LABEL: Record<TeamColor, string> = {
  team1: he.team1,
  team2: he.team2,
  team3: he.team3,
};

const TEAM_BG: Record<TeamColor, string> = {
  team1: colors.team1,
  team2: colors.team2,
  team3: colors.team3,
};

// Formation: 1 GK + 4 outfield. We arrange 2-2 outfield + 1 GK on each half.
// Positions are percentages relative to the field box.
const FORMATION_TOP = [
  { x: 0.5, y: 0.06 },   // GK at top center
  { x: 0.25, y: 0.18 },  // back-left
  { x: 0.75, y: 0.18 },  // back-right
  { x: 0.30, y: 0.32 },  // mid-left
  { x: 0.70, y: 0.32 },  // mid-right
];

const FORMATION_BOTTOM = [
  { x: 0.5, y: 0.94 },   // GK at bottom center
  { x: 0.25, y: 0.82 },
  { x: 0.75, y: 0.82 },
  { x: 0.30, y: 0.68 },
  { x: 0.70, y: 0.68 },
];

export function FieldView({ teamA, teamB }: Props) {
  return (
    <View>
      {/* Score header banners */}
      <View style={styles.bannerRow}>
        <View style={[styles.banner, { backgroundColor: TEAM_BG[teamA.color] }]}>
          <Text style={styles.bannerText}>{TEAM_LABEL[teamA.color]}</Text>
        </View>
        <Text style={styles.vs}>{he.vs}</Text>
        <View style={[styles.banner, { backgroundColor: TEAM_BG[teamB.color] }]}>
          <Text style={styles.bannerText}>{TEAM_LABEL[teamB.color]}</Text>
        </View>
      </View>

      <View style={styles.field}>
        <View style={styles.fieldStripes}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.stripe,
                { backgroundColor: i % 2 === 0 ? colors.field : colors.fieldStripe },
              ]}
            />
          ))}
        </View>
        {/* Center line */}
        <View style={styles.centerLine} />
        <View style={styles.centerCircle} />
        {/* Penalty boxes */}
        <View style={[styles.penaltyBox, styles.penaltyTop]} />
        <View style={[styles.penaltyBox, styles.penaltyBottom]} />

        {/* Place team A on top half */}
        {orderForFormation(teamA).map(({ player, isGk }, i) => {
          const pos = FORMATION_TOP[i];
          return (
            <PlayerToken
              key={player.id}
              player={player}
              color={TEAM_BG[teamA.color]}
              isGk={isGk}
              x={pos.x}
              y={pos.y}
            />
          );
        })}
        {/* Team B on bottom half */}
        {orderForFormation(teamB).map(({ player, isGk }, i) => {
          const pos = FORMATION_BOTTOM[i];
          return (
            <PlayerToken
              key={player.id}
              player={player}
              color={TEAM_BG[teamB.color]}
              isGk={isGk}
              x={pos.x}
              y={pos.y}
            />
          );
        })}
      </View>
    </View>
  );
}

function orderForFormation(team: { players: Player[]; goalkeeperId: string }) {
  const gk = team.players.find((p) => p.id === team.goalkeeperId);
  const others = team.players.filter((p) => p.id !== team.goalkeeperId);
  const arr = [gk, ...others].filter(Boolean) as Player[];
  return arr.map((p) => ({ player: p, isGk: p.id === team.goalkeeperId }));
}

function PlayerToken({
  player,
  color,
  isGk,
  x,
  y,
}: {
  player: Player;
  color: string;
  isGk: boolean;
  x: number;
  y: number;
}) {
  return (
    <View
      style={[
        styles.token,
        {
          left: `${x * 100}%`,
          top: `${y * 100}%`,
        },
      ]}
    >
      <View style={{ alignItems: 'center' }}>
        <PlayerIdentity
          user={{
            id: player.id,
            name: player.displayName,
            jersey: player.jersey,
          }}
          size={isGk ? 44 : 38}
          highlight
        />
        {isGk && <Text style={styles.gloveBadge}>🧤</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  banner: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  bannerText: { ...typography.bodyBold, color: '#fff' },
  vs: { ...typography.bodyBold, marginHorizontal: spacing.md, color: colors.text },
  field: {
    height: 380,
    backgroundColor: colors.field,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  fieldStripes: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  stripe: { flex: 1 },
  centerLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.fieldLine,
    opacity: 0.5,
  },
  centerCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 60,
    height: 60,
    marginLeft: -30,
    marginTop: -30,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: colors.fieldLine,
    opacity: 0.5,
  },
  penaltyBox: {
    position: 'absolute',
    left: '20%',
    right: '20%',
    height: 50,
    borderWidth: 2,
    borderColor: colors.fieldLine,
    opacity: 0.5,
  },
  penaltyTop: { top: 0, borderTopWidth: 0 },
  penaltyBottom: { bottom: 0, borderBottomWidth: 0 },
  token: {
    position: 'absolute',
    transform: [{ translateX: -22 }, { translateY: -22 }],
  },
  gloveBadge: {
    position: 'absolute',
    bottom: -6,
    fontSize: 14,
  },
});

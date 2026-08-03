// MatchRoundsScreen — "היסטוריית המשחקים" for a finished game.
//
// Reached from the finished-game MatchDetails ("היסטוריית המשחקים" CTA).
// Renders one card per committed mini-game (games/{id}/roundHistory):
// the two teams, the score, the winner, the goal log (scorer + assister +
// own-goal) and — when the mini-game was decided on penalties — the shootout
// kicks (kicker → keeper, scored/missed). Pure read/display: all the data is
// already persisted by commitRoundStats. Access is gated to game participants
// (same rule as the evening summary); a denied read degrades to the empty
// state, never a crash.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { UserAvatar } from '@/components/UserAvatar';
import { gameService } from '@/services/gameService';
import { useGameStore } from '@/store/gameStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Game, GameGuest } from '@/types';
import type {
  RoundHistoryDoc,
  RoundGoalRec,
  RoundPenaltyRec,
} from '@/utils/eveningStats';
import type { GameStackParamList } from '@/navigation/GameStack';

type Params = RouteProp<GameStackParamList, 'MatchRounds'>;

// Team A = warm (orange), Team B = cool (blue). The real jersey COLOR isn't
// persisted on the round-history doc, so these are UI accents for telling the
// two sides apart, paired with the neutral "קבוצה א׳/ב׳" labels — never a claim
// about the actual bib colour.
const TEAM_A_COLOR = '#F97316';
const TEAM_B_COLOR = colors.primary;

interface Resolved {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

export function MatchRoundsScreen() {
  const { gameId } = useRoute<Params>().params;
  const players = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [game, setGame] = useState<Game | null>(null);
  const [rounds, setRounds] = useState<RoundHistoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const [g, rs] = await Promise.all([
        gameService.getGameById(gameId).catch(() => null),
        gameService.getRoundHistory(gameId).catch(() => []),
      ]);
      if (!alive) return;
      setGame(g);
      setRounds(rs);
      // Hydrate every REAL player id referenced across the rounds so names +
      // avatars resolve (guests come from the game doc, not /users).
      const guestIds = new Set((g?.guests ?? []).map((x) => x.id));
      const ids = new Set<string>();
      for (const r of rs) {
        [...r.teamA, ...r.teamB].forEach((id) => id && ids.add(id));
        for (const gl of r.goals) {
          if (gl.scorerId) ids.add(gl.scorerId);
          if (gl.assisterId) ids.add(gl.assisterId);
        }
        for (const p of r.penalties ?? []) {
          if (p.kickerId) ids.add(p.kickerId);
          if (p.keeperId) ids.add(p.keeperId);
        }
      }
      const realIds = [...ids].filter((id) => !guestIds.has(id));
      if (realIds.length) hydratePlayers(realIds);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers]);

  const guestsById = useMemo(() => {
    const m = new Map<string, GameGuest>();
    (game?.guests ?? []).forEach((g) => m.set(g.id, g));
    return m;
  }, [game?.guests]);

  const resolve = useMemo(() => {
    return (id: string | null | undefined): Resolved => {
      if (!id) return { id: '', name: he.matchRoundsUnknownPlayer };
      const guest = guestsById.get(id);
      if (guest) return { id, name: guest.name || he.matchRoundsGuest };
      const p = players[id];
      const name = (p?.displayName ?? '').trim();
      return {
        id,
        name: name || he.matchRoundsUnknownPlayer,
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
      };
    };
  }, [players, guestsById]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchRoundsTitle} />
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.matchRoundsTitle} />
      {rounds.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="football-outline" size={46} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{he.matchRoundsEmptyTitle}</Text>
          <Text style={styles.emptySub}>{he.matchRoundsEmptySub}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.summaryPill}>
            <Ionicons name="list" size={15} color={colors.primary} />
            <Text style={styles.summaryPillTx}>
              {he.matchRoundsCount(rounds.length)}
            </Text>
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: TEAM_A_COLOR }]} />
              <Text style={styles.legendTx}>{he.matchRoundsTeamA}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: TEAM_B_COLOR }]} />
              <Text style={styles.legendTx}>{he.matchRoundsTeamB}</Text>
            </View>
          </View>

          {rounds.map((r, idx) => (
            <RoundCard
              key={r.roundId || String(idx)}
              round={r}
              index={idx}
              resolve={resolve}
              expanded={!!expanded[r.roundId || String(idx)]}
              onToggle={() =>
                setExpanded((s) => ({
                  ...s,
                  [r.roundId || String(idx)]:
                    !s[r.roundId || String(idx)],
                }))
              }
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RoundCard({
  round,
  index,
  resolve,
  expanded,
  onToggle,
}: {
  round: RoundHistoryDoc;
  index: number;
  resolve: (id: string | null | undefined) => Resolved;
  expanded: boolean;
  onToggle: () => void;
}) {
  const goalsA = round.goals.filter((g) => g.team === 'A');
  const goalsB = round.goals.filter((g) => g.team === 'B');
  const pens = round.penalties ?? [];
  const penA = pens.filter((p) => p.team === 'A' && p.scored).length;
  const penB = pens.filter((p) => p.team === 'B' && p.scored).length;

  // Winner: a shootout resolves a tie → the side with more converted kicks;
  // otherwise the mini-game's recorded winnerSide.
  const shootoutWinner =
    pens.length > 0 ? (penA === penB ? null : penA > penB ? 'A' : 'B') : null;
  const winnerSide = shootoutWinner ?? round.winnerSide;
  const winner =
    winnerSide === 'A'
      ? {
          label: shootoutWinner
            ? he.matchRoundsWonPens(he.matchRoundsTeamA)
            : he.matchRoundsWon(he.matchRoundsTeamA),
          color: TEAM_A_COLOR,
          icon: shootoutWinner ? ('hand-left' as const) : ('trophy' as const),
        }
      : winnerSide === 'B'
        ? {
            label: shootoutWinner
              ? he.matchRoundsWonPens(he.matchRoundsTeamB)
              : he.matchRoundsWon(he.matchRoundsTeamB),
            color: TEAM_B_COLOR,
            icon: shootoutWinner ? ('hand-left' as const) : ('trophy' as const),
          }
        : { label: he.matchRoundsTie, color: colors.textMuted, icon: 'remove' as const };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardIdx}>{he.matchRoundsRoundN(index + 1)}</Text>
        <View style={[styles.winBadge, { backgroundColor: winner.color + '22' }]}>
          <Ionicons name={winner.icon} size={13} color={winner.color} />
          <Text style={[styles.winBadgeTx, { color: winner.color }]}>
            {winner.label}
          </Text>
        </View>
      </View>

      {/* Score row */}
      <View style={styles.scoreRow}>
        <View style={styles.scoreTeam}>
          <View style={styles.teamName}>
            <View style={[styles.swatch, { backgroundColor: TEAM_A_COLOR }]} />
            <Text style={styles.teamNameTx}>{he.matchRoundsTeamA}</Text>
          </View>
        </View>
        <Text style={styles.scoreNum}>{round.scoreA}</Text>
        <Text style={styles.scoreSep}>:</Text>
        <Text style={styles.scoreNum}>{round.scoreB}</Text>
        <View style={styles.scoreTeam}>
          <View style={styles.teamName}>
            <View style={[styles.swatch, { backgroundColor: TEAM_B_COLOR }]} />
            <Text style={styles.teamNameTx}>{he.matchRoundsTeamB}</Text>
          </View>
        </View>
      </View>

      {/* Goals */}
      {round.goals.length > 0 ? (
        <View style={styles.goalsWrap}>
          <GoalColumn
            title={he.matchRoundsTeamA}
            color={TEAM_A_COLOR}
            goals={goalsA}
            resolve={resolve}
          />
          <GoalColumn
            title={he.matchRoundsTeamB}
            color={TEAM_B_COLOR}
            goals={goalsB}
            resolve={resolve}
          />
        </View>
      ) : (
        <Text style={styles.noGoals}>{he.matchRoundsNoGoals}</Text>
      )}

      {/* Penalty shootout */}
      {pens.length > 0 ? (
        <View style={styles.pens}>
          <View style={styles.pensHead}>
            <View style={styles.teamName}>
              <Ionicons name="hand-left" size={14} color={colors.text} />
              <Text style={styles.pensHeadTx}>{he.matchRoundsShootout}</Text>
            </View>
            <Text style={styles.pensScore}>
              {penA} : {penB}
            </Text>
          </View>
          {pens.map((p, i) => {
            const kicker = resolve(p.kickerId);
            const keeper = resolve(p.keeperId);
            return (
              <View key={i} style={styles.penRow}>
                <Ionicons
                  name={p.scored ? 'checkmark-circle' : 'close-circle'}
                  size={15}
                  color={p.scored ? colors.success : colors.danger}
                />
                <View
                  style={[
                    styles.swatchSm,
                    {
                      backgroundColor:
                        p.team === 'A' ? TEAM_A_COLOR : TEAM_B_COLOR,
                    },
                  ]}
                />
                <Text style={styles.penKicker}>{kicker.name}</Text>
                {keeper.id ? (
                  <Text style={styles.penKeeper}>
                    {he.matchRoundsVsKeeper(keeper.name)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Rosters (collapsible) */}
      <Pressable style={styles.rosterToggle} onPress={onToggle}>
        <Ionicons name="people-outline" size={15} color={colors.textMuted} />
        <Text style={styles.rosterToggleTx}>{he.matchRoundsWhoPlayed}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.textMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.rosterBody}>
          <RosterRow
            color={TEAM_A_COLOR}
            title={he.matchRoundsTeamA}
            ids={round.teamA}
            resolve={resolve}
          />
          <RosterRow
            color={TEAM_B_COLOR}
            title={he.matchRoundsTeamB}
            ids={round.teamB}
            resolve={resolve}
          />
        </View>
      ) : null}
    </View>
  );
}

function GoalColumn({
  title,
  color,
  goals,
  resolve,
}: {
  title: string;
  color: string;
  goals: RoundGoalRec[];
  resolve: (id: string | null | undefined) => Resolved;
}) {
  if (goals.length === 0) return null;
  return (
    <View style={[styles.goalCol, { borderStartColor: color }]}>
      <Text style={[styles.goalColTitle, { color }]}>{title}</Text>
      {goals.map((g, i) => {
        const scorer = resolve(g.scorerId);
        const assist = g.assisterId ? resolve(g.assisterId) : null;
        return (
          <View key={i} style={styles.goalRow}>
            <Ionicons
              name="football"
              size={14}
              color={g.ownGoal ? colors.textMuted : color}
            />
            <Text style={styles.goalScorer} numberOfLines={1}>
              {scorer.name}
            </Text>
            {g.ownGoal ? (
              <Text style={styles.goalOwn}>{he.matchRoundsOwnGoal}</Text>
            ) : assist ? (
              <Text style={styles.goalAssist} numberOfLines={1}>
                {he.matchRoundsAssist(assist.name)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function RosterRow({
  title,
  color,
  ids,
  resolve,
}: {
  title: string;
  color: string;
  ids: string[];
  resolve: (id: string | null | undefined) => Resolved;
}) {
  return (
    <View style={styles.rosterTeam}>
      <View style={styles.teamName}>
        <View style={[styles.swatch, { backgroundColor: color }]} />
        <Text style={styles.rosterTeamTitle}>{title}</Text>
      </View>
      <View style={styles.rosterChips}>
        {ids.map((id) => {
          const p = resolve(id);
          return (
            <View key={id} style={styles.rosterChip}>
              <UserAvatar
                user={{
                  id: p.id,
                  name: p.name,
                  avatarId: p.avatarId,
                  photoUrl: p.photoUrl,
                }}
                size={22}
              />
              <Text style={styles.rosterChipTx} numberOfLines={1}>
                {p.name}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptySub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summaryPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  summaryPillTx: { ...typography.caption, color: colors.text, fontWeight: '700' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendTx: { ...typography.caption, color: colors.textMuted },
  swatch: { width: 11, height: 11, borderRadius: 3 },
  swatchSm: { width: 9, height: 9, borderRadius: 2 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 18,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg,
  },
  cardIdx: { ...typography.body, fontWeight: '800', color: colors.text },
  winBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  winBadgeTx: { fontSize: 11.5, fontWeight: '800' },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  scoreTeam: { flex: 1 },
  teamName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamNameTx: { ...typography.caption, fontWeight: '800', color: colors.text },
  scoreNum: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.text,
    minWidth: 30,
    textAlign: 'center',
  },
  scoreSep: { fontSize: 20, color: colors.textMuted, fontWeight: '700' },

  goalsWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  goalCol: {
    borderStartWidth: 3,
    paddingStart: spacing.sm,
    marginBottom: spacing.sm,
  },
  goalColTitle: { fontSize: 11.5, fontWeight: '800', marginBottom: 4 },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 3,
  },
  goalScorer: { ...typography.body, fontWeight: '700', color: colors.text },
  goalAssist: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  goalOwn: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic' },
  noGoals: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingBottom: spacing.md,
  },

  pens: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: spacing.md,
  },
  pensHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  pensHeadTx: { ...typography.body, fontWeight: '800', color: colors.text },
  pensScore: { ...typography.body, fontWeight: '900', color: colors.text },
  penRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 3 },
  penKicker: { ...typography.caption, fontWeight: '700', color: colors.text },
  penKeeper: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },

  rosterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rosterToggleTx: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  rosterBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  rosterTeam: { gap: 6 },
  rosterTeamTitle: { ...typography.caption, fontWeight: '800', color: colors.text },
  rosterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderRadius: 999,
    paddingVertical: 3,
    paddingEnd: 10,
    paddingStart: 3,
  },
  rosterChipTx: { ...typography.caption, color: colors.text, maxWidth: 110 },
});

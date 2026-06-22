// CommunityStatsScreen — the club's collective statistics dashboard.
//
// Aggregates everything the community has accumulated: total goals / assists /
// mini-games / evenings, the leaderboards (top scorer, assister, winner, most
// loyal), a top-10 scorers table, and a few fun superlatives (deadliest
// goals-per-mini-game ratio, organisation rate, average attendance).
//
// Data comes from two rollups already maintained by the backend:
//   • getCommunityChampionship → cumulative per-player goals/assists/rounds/
//     wins/games (communityPlayerStats) + club totals.
//   • getCommunityStats → evenings held, organisation rate, attendance, and
//     active-member counts.
// No new collection needed — everything here is derived client-side.

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { userService } from '@/services';
import { groupService } from '@/services';
import { type ChampionshipRow } from '@/utils/championship';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
import type { User } from '@/types';

type Params = RouteProp<CommunitiesStackParamList, 'CommunityStats'>;
type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;

const MEDALS = ['#F4B73E', '#9AA4B2', '#CD7F32']; // gold / silver / bronze

interface ChampData {
  totalGoals: number;
  totalRounds: number;
  players: ChampionshipRow[];
}
interface StatsData {
  totalFinished: number;
  organizationRate: number;
  avgAttendance: number;
  activeThisMonth: number;
  activeThisYear: number;
}

function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}
function oneDecimal(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
/** Highest-by-metric row, ignoring zeros. */
function leaderBy(
  players: ChampionshipRow[],
  pick: (r: ChampionshipRow) => number,
): ChampionshipRow | null {
  let best: ChampionshipRow | null = null;
  let bestV = 0;
  for (const p of players) {
    const v = pick(p);
    if (v > bestV) {
      bestV = v;
      best = p;
    }
  }
  return best;
}

export function CommunityStatsScreen() {
  const nav = useNavigation();
  const { groupId } = useRoute<Params>().params;
  const [champ, setChamp] = useState<ChampData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [people, setPeople] = useState<Record<string, Resolved>>({});
  const [subtitle, setSubtitle] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, s, g] = await Promise.all([
        gameService.getCommunityChampionship(groupId).catch(() => null),
        gameService.getCommunityStats(groupId).catch(() => null),
        groupService.get(groupId).catch(() => null),
      ]);
      if (!alive) return;
      if (g) setSubtitle(g.name);
      setChamp(c ?? { totalGoals: 0, totalRounds: 0, players: [] });
      setStats(
        s ?? {
          totalFinished: 0,
          organizationRate: 0,
          avgAttendance: 0,
          activeThisMonth: 0,
          activeThisYear: 0,
        },
      );
      // Resolve the players we'll actually show (top scorers + any leader).
      const ids = new Set<string>();
      (c?.players ?? []).slice(0, 10).forEach((r) => ids.add(r.uid));
      (c?.players ?? []).forEach((r) => {
        if (r.assists > 0 || r.wins > 0 || r.games > 0) ids.add(r.uid);
      });
      const fetched = await Promise.all(
        Array.from(ids).map((id) => userService.getUserById(id).catch(() => null)),
      );
      if (!alive) return;
      const map: Record<string, Resolved> = {};
      fetched.forEach((u) => {
        if (u) map[u.id] = u;
      });
      setPeople(map);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  const derived = useMemo(() => {
    const players = champ?.players ?? [];
    const totalAssists = players.reduce((a, p) => a + p.assists, 0);
    const totalWins = players.reduce((a, p) => a + p.wins, 0);
    const totalGoals = champ?.totalGoals ?? 0;
    const totalRounds = champ?.totalRounds ?? 0;
    const goalsPerMini = totalRounds > 0 ? totalGoals / totalRounds : 0;
    const deadliest =
      leaderBy(
        players.filter((p) => p.rounds >= 5 && p.goals > 0),
        (p) => p.goals / p.rounds,
      ) ?? null;
    return {
      players,
      totalGoals,
      totalRounds,
      totalAssists,
      totalWins,
      goalsPerMini,
      topScorer: players[0] ?? null, // already ranked by goals
      topAssister: leaderBy(players, (p) => p.assists),
      topWinner: leaderBy(players, (p) => p.wins),
      mostLoyal: leaderBy(players, (p) => p.games),
      deadliest,
    };
  }, [champ]);

  const name = (uid?: string) =>
    uid && people[uid] ? firstName(people[uid].name) : '—';
  const resolved = (uid: string): Resolved => people[uid] ?? { id: uid, name: '' };

  const isEmpty =
    !loading &&
    derived.totalGoals === 0 &&
    (stats?.totalFinished ?? 0) === 0 &&
    derived.players.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.communityStatsScreenTitle} subtitle={subtitle || undefined} />

      {loading ? (
        <View style={styles.center}>
          <SoccerBallLoader />
          <Text style={styles.loadingText}>{he.communityStatsLoading}</Text>
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="stats-chart-outline" size={56} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{he.communityStatsEmptyTitle}</Text>
          <Text style={styles.emptyBody}>{he.communityStatsEmptyBody}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── המועדון במספרים ── */}
          <SectionTitle icon="bar-chart" text={he.communityStatsSectionNumbers} />
          <View style={styles.heroGrid}>
            <HeroTile icon="football" tint={colors.primary} value={derived.totalGoals} label={he.communityStatsGoals} />
            <HeroTile icon="git-network" tint="#7C3AED" value={derived.totalAssists} label={he.communityStatsAssists} />
            <HeroTile icon="repeat" tint="#0EA5E9" value={derived.totalRounds} label={he.communityStatsMiniGames} />
            <HeroTile icon="calendar" tint={colors.success} value={stats?.totalFinished ?? 0} label={he.communityStatsEvenings} />
            <HeroTile icon="flame" tint={colors.danger} value={stats?.activeThisMonth ?? 0} label={he.communityStatsActiveMonth} />
            <HeroTile icon="speedometer" tint={colors.warning} value={oneDecimal(derived.goalsPerMini)} label={he.communityStatsGoalsPerMini} />
          </View>

          {/* ── מובילי המועדון ── */}
          <SectionTitle icon="trophy" text={he.communityStatsSectionLeaders} />
          <View style={styles.leadersGrid}>
            <LeaderCard
              crown="👑"
              title={he.communityStatsTopScorer}
              row={derived.topScorer}
              user={derived.topScorer ? resolved(derived.topScorer.uid) : null}
              valueText={derived.topScorer ? he.communityStatsGoalsUnit(derived.topScorer.goals) : ''}
              tint={colors.primary}
            />
            <LeaderCard
              crown="🅰️"
              title={he.communityStatsTopAssister}
              row={derived.topAssister}
              user={derived.topAssister ? resolved(derived.topAssister.uid) : null}
              valueText={derived.topAssister ? he.communityStatsAssistsUnit(derived.topAssister.assists) : ''}
              tint="#7C3AED"
            />
            <LeaderCard
              crown="🏆"
              title={he.communityStatsTopWinner}
              row={derived.topWinner}
              user={derived.topWinner ? resolved(derived.topWinner.uid) : null}
              valueText={derived.topWinner ? he.communityStatsWinsUnit(derived.topWinner.wins) : ''}
              tint={colors.warning}
            />
            <LeaderCard
              crown="🔥"
              title={he.communityStatsMostLoyal}
              row={derived.mostLoyal}
              user={derived.mostLoyal ? resolved(derived.mostLoyal.uid) : null}
              valueText={derived.mostLoyal ? he.communityStatsEveningsUnit(derived.mostLoyal.games) : ''}
              tint={colors.success}
            />
          </View>

          {/* ── טבלת המבקיעים ── */}
          {derived.players.length > 0 ? (
            <>
              <SectionTitle icon="list" text={he.communityStatsSectionScorers} />
              <Card style={styles.tableCard}>
                {derived.players.slice(0, 10).map((p, i) => (
                  <View key={p.uid} style={[styles.scorerRow, i > 0 && styles.scorerDivider]}>
                    <View
                      style={[
                        styles.rankBadge,
                        i < 3 && { backgroundColor: MEDALS[i] },
                      ]}
                    >
                      <Text style={[styles.rankText, i < 3 && styles.rankTextMedal]}>
                        {i + 1}
                      </Text>
                    </View>
                    <UserAvatar user={resolved(p.uid)} size={34} />
                    <Text style={styles.scorerName} numberOfLines={1}>
                      {name(p.uid)}
                    </Text>
                    {p.assists > 0 ? (
                      <View style={styles.assistPill}>
                        <Ionicons name="git-network" size={11} color="#7C3AED" />
                        <Text style={styles.assistPillText}>{p.assists}</Text>
                      </View>
                    ) : null}
                    <View style={styles.goalsPill}>
                      <Ionicons name="football" size={12} color={colors.primary} />
                      <Text style={styles.goalsPillText}>{p.goals}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* ── נתונים מעניינים ── */}
          <SectionTitle icon="sparkles" text={he.communityStatsSectionFun} />
          <Card style={styles.funCard}>
            {derived.deadliest ? (
              <FunRow
                icon="skull-outline"
                tint={colors.danger}
                label={he.communityStatsDeadliest}
                who={name(derived.deadliest.uid)}
                value={he.communityStatsDeadliestValue(
                  oneDecimal(derived.deadliest.goals / derived.deadliest.rounds),
                )}
              />
            ) : null}
            <FunRow
              icon="checkmark-done-outline"
              tint={colors.success}
              label={he.communityStatsOrgRate}
              value={`${Math.round((stats?.organizationRate ?? 0) * 100)}%`}
            />
            <FunRow
              icon="people-outline"
              tint={colors.info}
              label={he.communityStatsAvgAttendance}
              value={he.communityStatsAvgAttendanceValue(
                oneDecimal(stats?.avgAttendance ?? 0),
              )}
            />
            <FunRow
              icon="trophy-outline"
              tint={colors.warning}
              label={he.communityStatsTotalWins}
              value={String(derived.totalWins)}
            />
            <FunRow
              icon="calendar-outline"
              tint={colors.primary}
              label={he.communityStatsActiveYear}
              value={String(stats?.activeThisYear ?? 0)}
              last
            />
          </Card>

          <View style={{ height: spacing.xl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionTitle({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={styles.sectionTitleText}>{text}</Text>
    </View>
  );
}

function HeroTile({
  icon,
  tint,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  value: number | string;
  label: string;
}) {
  return (
    <Card style={styles.heroTile}>
      <View style={[styles.heroIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.heroValue}>{value}</Text>
      <Text style={styles.heroLabel} numberOfLines={1}>{label}</Text>
    </Card>
  );
}

function LeaderCard({
  crown,
  title,
  row,
  user,
  valueText,
  tint,
}: {
  crown: string;
  title: string;
  row: ChampionshipRow | null;
  user: Resolved | null;
  valueText: string;
  tint: string;
}) {
  return (
    <Card style={styles.leaderCard}>
      <View style={styles.leaderHead}>
        <Text style={styles.leaderCrown}>{crown}</Text>
        <Text style={[styles.leaderTitle, { color: tint }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {row && user ? (
        <>
          <UserAvatar user={user} size={48} ring />
          <Text style={styles.leaderName} numberOfLines={1}>
            {firstName(user.name)}
          </Text>
          <Text style={[styles.leaderValue, { color: tint }]}>{valueText}</Text>
        </>
      ) : (
        <Text style={styles.leaderEmpty}>—</Text>
      )}
    </Card>
  );
}

function FunRow({
  icon,
  tint,
  label,
  who,
  value,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  who?: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.funRow, !last && styles.funDivider]}>
      <View style={[styles.funIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <View style={styles.funTextWrap}>
        <Text style={styles.funLabel} numberOfLines={1}>{label}</Text>
        {who ? <Text style={styles.funWho} numberOfLines={1}>{who}</Text> : null}
      </View>
      <Text style={[styles.funValue, { color: tint }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  loadingText: { ...typography.body, color: colors.textMuted },
  emptyTitle: { ...typography.h3, color: colors.text, fontWeight: '800', marginTop: spacing.sm },
  emptyBody: { ...typography.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  scroll: { padding: spacing.md, gap: spacing.sm },

  sectionTitle: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionTitleText: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },

  // hero grid
  heroGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  heroTile: {
    width: '31.5%',
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 4,
  },
  heroIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  heroValue: { ...typography.h2, color: colors.text, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },

  // leaders
  leadersGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  leaderCard: { width: '48.5%', minWidth: 0, alignItems: 'center', paddingVertical: spacing.md, gap: 6 },
  leaderHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  leaderCrown: { fontSize: 16 },
  leaderTitle: { ...typography.caption, fontWeight: '800', textAlign: 'center' },
  leaderName: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: 'center' },
  leaderValue: { ...typography.caption, fontWeight: '800' },
  leaderEmpty: { ...typography.h2, color: colors.textMuted, paddingVertical: spacing.md },

  // scorers table
  tableCard: { padding: spacing.sm },
  scorerRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  scorerDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { ...typography.caption, color: colors.textMuted, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rankTextMedal: { color: '#FFFFFF' },
  scorerName: { flex: 1, minWidth: 0, ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  assistPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3, paddingHorizontal: 7, height: 24, borderRadius: 12, backgroundColor: '#7C3AED14' },
  assistPillText: { ...typography.caption, color: '#7C3AED', fontWeight: '800', fontVariant: ['tabular-nums'] },
  goalsPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 26, borderRadius: 13, backgroundColor: colors.primary + '14' },
  goalsPillText: { ...typography.body, color: colors.primary, fontWeight: '900', fontVariant: ['tabular-nums'] },

  // fun facts
  funCard: { padding: 0, overflow: 'hidden' },
  funRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  funDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  funIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  funTextWrap: { flex: 1, minWidth: 0 },
  funLabel: { ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  funWho: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: 1 },
  funValue: { ...typography.body, fontWeight: '900', fontVariant: ['tabular-nums'] },
});

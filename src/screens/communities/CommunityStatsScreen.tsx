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
import { AchievementBadge } from '@/components/AchievementBadge';
import { appAlert } from '@/components/AppDialog';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { CountUp } from '@/components/anim/CountUp';
import {
  computeClubBadges,
  type ClubMetrics,
  type ClubBadge,
} from '@/data/clubAchievements';
import { computeClubLevel } from '@/utils/clubLevel';
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
  tiedRounds: number;
  players: ChampionshipRow[];
}
interface StatsData {
  totalFinished: number;
  organizationRate: number;
  avgAttendance: number;
  activeThisMonth: number;
  activeThisYear: number;
  longestStreak: number;
  longestStreakUid: string | null;
}
interface DeadlyDuo {
  uidA: string;
  uidB: string;
  assists: number;
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
  const [duo, setDuo] = useState<DeadlyDuo | null>(null);
  const [people, setPeople] = useState<Record<string, Resolved>>({});
  const [subtitle, setSubtitle] = useState<string>('');
  // Members + founding date for the club achievements/level (the rest of the
  // club metrics come from champ/stats already fetched).
  const [clubMeta, setClubMeta] = useState<{ members: number; createdAt: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, s, g, d] = await Promise.all([
        gameService.getCommunityChampionship(groupId).catch(() => null),
        gameService.getCommunityStats(groupId).catch(() => null),
        groupService.get(groupId).catch(() => null),
        gameService.getCommunityDeadlyDuo(groupId).catch(() => null),
      ]);
      if (!alive) return;
      if (g) {
        setSubtitle(g.name);
        setClubMeta({
          members: g.playerIds?.length ?? 0,
          createdAt: g.createdAt ?? Date.now(),
        });
      }
      setChamp(c ?? { totalGoals: 0, totalRounds: 0, tiedRounds: 0, players: [] });
      setStats(
        s ?? {
          totalFinished: 0,
          organizationRate: 0,
          avgAttendance: 0,
          activeThisMonth: 0,
          activeThisYear: 0,
          longestStreak: 0,
          longestStreakUid: null,
        },
      );
      setDuo(d);
      // Resolve the players we'll actually show (top scorers + any leader +
      // the deadly duo + the longest-streak holder).
      const ids = new Set<string>();
      (c?.players ?? []).slice(0, 10).forEach((r) => ids.add(r.uid));
      (c?.players ?? []).forEach((r) => {
        if (r.assists > 0 || r.wins > 0 || r.games > 0) ids.add(r.uid);
      });
      if (d) { ids.add(d.uidA); ids.add(d.uidB); }
      if (s?.longestStreakUid) ids.add(s.longestStreakUid);
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
    const tiedRounds = champ?.tiedRounds ?? 0;
    const goalsPerMini = totalRounds > 0 ? totalGoals / totalRounds : 0;
    const drawPct = totalRounds > 0 ? Math.round((tiedRounds / totalRounds) * 100) : 0;
    const topScorer = players[0] ?? null; // already ranked by goals
    const kingSharePct =
      topScorer && totalGoals > 0 ? Math.round((topScorer.goals / totalGoals) * 100) : 0;
    return {
      players,
      totalGoals,
      totalRounds,
      tiedRounds,
      drawPct,
      totalAssists,
      totalWins,
      goalsPerMini,
      kingSharePct,
      topScorer,
      topAssister: leaderBy(players, (p) => p.assists),
      topWinner: leaderBy(players, (p) => p.wins),
      mostLoyal: leaderBy(players, (p) => p.games),
    };
  }, [champ]);

  // Club achievements + level — derived from the same aggregates, client-side.
  const club = useMemo(() => {
    const metrics: ClubMetrics = {
      gameNights: stats?.totalFinished ?? 0,
      clubGoals: champ?.totalGoals ?? 0,
      members: clubMeta?.members ?? 0,
      ageYears: clubMeta
        ? Math.floor((Date.now() - clubMeta.createdAt) / (365.25 * 24 * 3600 * 1000))
        : 0,
      activeThisMonth: stats?.activeThisMonth ?? 0,
      organizationRatePct: Math.round((stats?.organizationRate ?? 0) * 100),
    };
    return { badges: computeClubBadges(metrics), level: computeClubLevel(metrics) };
  }, [stats, champ, clubMeta]);

  const onBadgePress = (b: ClubBadge) => {
    const target = b.next?.threshold ?? b.def.tiers[b.def.tiers.length - 1].threshold;
    const progress =
      b.tier && !b.next
        ? he.clubAchievementGold
        : he.clubAchievementProgress(b.value, target);
    appAlert(b.def.titleHe, `${b.def.howHe}\n\n${progress}`);
  };

  const name = (uid?: string) =>
    uid && people[uid] ? firstName(people[uid].name) : '—';
  const resolved = (uid: string): Resolved => people[uid] ?? { id: uid, name: '' };

  const isEmpty =
    !loading &&
    derived.totalGoals === 0 &&
    (stats?.totalFinished ?? 0) === 0 &&
    derived.players.length === 0;

  // Leaders/goal-based tiles only make sense once goals have been recorded —
  // otherwise every card is a "—". A club with finished evenings but no scoring
  // still shows the attendance/evenings tiles + achievements, just not leaders.
  const hasScoring = derived.totalGoals > 0 && derived.players.length > 0;

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
          {/* ── רמת המועדון (למעלה, מעל הכל) ── */}
          <Card style={styles.levelCard}>
            <View style={styles.levelDisc}>
              <Text style={styles.levelDiscLabel}>{he.clubLevelLabel}</Text>
              <Text style={styles.levelDiscNum}>{club.level.level}</Text>
            </View>
            <View style={styles.levelInfo}>
              <Text style={styles.levelTier} numberOfLines={1}>
                {club.level.tierName}
              </Text>
              <View style={styles.levelBarTrack}>
                <View
                  style={[
                    styles.levelBarFill,
                    { width: `${Math.round(club.level.progressPct * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.levelHint} numberOfLines={1}>
                {club.level.pointsToNext == null
                  ? he.clubLevelMaxHint
                  : he.clubLevelNextHint(club.level.pointsToNext)}
              </Text>
            </View>
          </Card>

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

          {/* ── הישגי המועדון (תארים) ── */}
          <SectionTitle icon="medal" text={he.communityStatsSectionAchievements} />
          <Card style={styles.badgeCard}>
            <View style={styles.badgeGrid}>
              {club.badges.map((b) => (
                <AchievementBadge
                  key={b.def.id}
                  def={b.def}
                  tier={b.tier}
                  size={64}
                  showTierLabel
                  onPress={() => onBadgePress(b)}
                  style={styles.badgeItem}
                />
              ))}
            </View>
          </Card>

          {/* ── מובילי המועדון ── (only once goals exist; else all "—") */}
          {hasScoring ? (
          <>
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
          </>
          ) : null}

          {/* טבלת המבקיעים הוסרה — כפילות מול טבלת הליגה במסך פרטי המועדון. */}

          {/* ── נתונים מעניינים ── */}
          <SectionTitle icon="sparkles" text={he.communityStatsSectionFun} />
          <Card style={styles.funCard}>
            {derived.topScorer && derived.totalGoals > 0 ? (
              <FunRow
                icon="ribbon-outline"
                tint={colors.warning}
                parts={[
                  { t: `${derived.kingSharePct}% `, em: 'num' },
                  { t: 'מכמות השערים במועדון הכניס ' },
                  { t: name(derived.topScorer.uid), em: 'name' },
                ]}
              />
            ) : null}
            {duo && duo.assists > 0 ? (
              <FunRow
                icon="git-network-outline"
                tint="#7C3AED"
                parts={[
                  { t: name(duo.uidA), em: 'name' },
                  { t: ' ו' },
                  { t: name(duo.uidB), em: 'name' },
                  { t: ' הם הצמד עם הכי הרבה בישולים משותפים (' },
                  { t: `${duo.assists}`, em: 'num' },
                  { t: ')' },
                ]}
              />
            ) : null}
            {derived.totalRounds > 0 ? (
              <FunRow
                icon="git-compare-outline"
                tint={colors.info}
                parts={[
                  { t: `${derived.drawPct}% `, em: 'num' },
                  { t: 'מהמשחקונים הסתיימו בתיקו' },
                ]}
              />
            ) : null}
            {stats && stats.longestStreak >= 2 ? (
              <FunRow
                icon="flame-outline"
                tint={colors.danger}
                parts={[
                  { t: name(stats.longestStreakUid ?? undefined), em: 'name' },
                  { t: ' הגיע ' },
                  { t: `${stats.longestStreak} ערבים`, em: 'num' },
                  { t: ' ברצף — הרצף הארוך במועדון' },
                ]}
              />
            ) : null}
            <FunRow
              icon="checkmark-done-outline"
              tint={colors.success}
              parts={[
                { t: `${Math.round((stats?.organizationRate ?? 0) * 100)}% `, em: 'num' },
                { t: 'מהמשחקים המתוכננים יצאו לפועל' },
              ]}
            />
            <FunRow
              icon="calendar-outline"
              tint={colors.primary}
              parts={[
                { t: `${stats?.activeThisYear ?? 0} שחקנים`, em: 'num' },
                { t: ' היו פעילים השנה' },
              ]}
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
      {/* Numbers count up (0 → value) as the stats resolve — a small entrance
          that makes the tiles feel alive. Pre-formatted strings (e.g. the
          one-decimal average) render as-is. */}
      {typeof value === 'number' ? (
        <CountUp to={value} durationMs={800} style={styles.heroValue} />
      ) : (
        <Text style={styles.heroValue}>{value}</Text>
      )}
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

// One row = a single flowing sentence (not columns), with the stat number and
// the player names emphasised inline (user request). `em:'num'` → bold + the
// row tint; `em:'name'` → bold in the main text colour.
type FunPart = { t: string; em?: 'num' | 'name' };

function FunRow({
  icon,
  tint,
  parts,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  parts: FunPart[];
  last?: boolean;
}) {
  return (
    <View style={[styles.funRow, !last && styles.funDivider]}>
      <View style={[styles.funIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.funSentence}>
        {parts.map((p, i) => (
          <Text
            key={i}
            style={
              p.em === 'num'
                ? [styles.funEm, { color: tint }]
                : p.em === 'name'
                  ? styles.funEmName
                  : undefined
            }
          >
            {p.t}
          </Text>
        ))}
      </Text>
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
    // Under forceRTL, 'row' packs the first child (icon) to the RIGHT and
    // anchors the whole header right. ('row-reverse' wrongly pushed it left.)
    flexDirection: 'row',
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
  // `row` (not row-reverse): under forceRTL the first child (icon) sits on the
  // visual RIGHT, with the sentence flowing to its left (user request).
  funRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  funDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  funIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  funSentence: { ...typography.body, flex: 1, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, lineHeight: 24 },
  funEm: { fontWeight: '900', fontVariant: ['tabular-nums'] },
  funEmName: { fontWeight: '800', color: colors.text },

  // club level + achievements
  levelCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  levelDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelDiscLabel: { ...typography.caption, color: '#FFFFFF', fontWeight: '700', opacity: 0.9, marginBottom: -4 },
  levelDiscNum: { ...typography.h1, color: '#FFFFFF', fontWeight: '900', fontVariant: ['tabular-nums'] },
  levelInfo: { flex: 1, minWidth: 0, gap: 6 },
  levelTier: { ...typography.h3, color: colors.text, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  levelBarTrack: { height: 10, borderRadius: 999, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  levelBarFill: { height: '100%', borderRadius: 999, backgroundColor: colors.primary },
  levelHint: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  badgeCard: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  badgeGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.md,
  },
  badgeItem: { width: '33.3%' },
});

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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { AchievementBadge } from '@/components/AchievementBadge';
import { appAlert } from '@/components/AppDialog';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { CountUp } from '@/components/anim/CountUp';
import { AppearItem } from '@/components/anim/AppearItem';
import { StatDonut } from '@/components/community/StatDonut';
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
import { penaltyKing, penaltyKeeperKing, pctOf } from '@/utils/penaltyStats';
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
  shootoutRounds: number;
  scorelessRounds: number;
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
  // Most-loyal-by-attendance, from the SAME finished-nights scan as the streak
  // (so "הכי מתמיד" can never be smaller than "הרצף הארוך" — both count the
  // exact same attendance events, unlike the communityPlayerStats rollup which
  // can lag). topPlayers[0] = the player who attended the most nights.
  topPlayers: Array<{ uid: string; attended: number }>;
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
      setChamp(
        c ?? {
          totalGoals: 0,
          totalRounds: 0,
          tiedRounds: 0,
          shootoutRounds: 0,
          scorelessRounds: 0,
          players: [],
        },
      );
      setStats(
        s ?? {
          totalFinished: 0,
          organizationRate: 0,
          avgAttendance: 0,
          activeThisMonth: 0,
          activeThisYear: 0,
          longestStreak: 0,
          longestStreakUid: null,
          topPlayers: [],
        },
      );
      setDuo(d);
      // Resolve the players we'll actually show (top scorers + any leader +
      // the deadly duo + the longest-streak holder).
      const ids = new Set<string>();
      (c?.players ?? []).slice(0, 10).forEach((r) => ids.add(r.uid));
      (c?.players ?? []).forEach((r) => {
        if (r.assists > 0 || r.wins > 0 || r.games > 0 || r.penScored > 0 || r.penSaved > 0)
          ids.add(r.uid);
      });
      if (d) { ids.add(d.uidA); ids.add(d.uidB); }
      if (s?.longestStreakUid) ids.add(s.longestStreakUid);
      if (s?.topPlayers?.[0]?.uid) ids.add(s.topPlayers[0].uid);
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
    const shootoutRounds = champ?.shootoutRounds ?? 0;
    const scorelessRounds = champ?.scorelessRounds ?? 0;
    const goalsPerMini = totalRounds > 0 ? totalGoals / totalRounds : 0;
    const drawPct = totalRounds > 0 ? Math.round((tiedRounds / totalRounds) * 100) : 0;
    const shootoutPct =
      totalRounds > 0 ? Math.round((shootoutRounds / totalRounds) * 100) : 0;
    const scorelessPct =
      totalRounds > 0 ? Math.round((scorelessRounds / totalRounds) * 100) : 0;
    // Club-wide penalty conversion — sum every player's scored/taken. Drives
    // the "דיוק מהנקודה הלבנה" fun fact. Gated on penTakenTotal > 0.
    const penTakenTotal = players.reduce((a, p) => a + (p.penTaken ?? 0), 0);
    const penScoredTotal = players.reduce((a, p) => a + (p.penScored ?? 0), 0);
    const penAccuracyPct = pctOf(penScoredTotal, penTakenTotal);
    // `players` is ranked by POINTS (goals*2+assists), so players[0] is NOT
    // necessarily the top scorer — pick the max-goals player explicitly.
    const topScorer = players.length
      ? players.reduce((best, p) => (p.goals > best.goals ? p : best))
      : null;
    const kingSharePct =
      topScorer && totalGoals > 0 ? Math.round((topScorer.goals / totalGoals) * 100) : 0;
    // Share of goals that came off an assist — each assisted goal carries exactly
    // one assist, so assists ÷ goals is the assisted-goal rate. Capped at 100%
    // defensively. Uses the reliable per-player assist totals (not the partial
    // communityPairStats), so it's accurate for historical goals too.
    const assistedGoalsPct =
      totalGoals > 0 ? Math.min(100, Math.round((totalAssists / totalGoals) * 100)) : 0;
    return {
      players,
      totalGoals,
      totalRounds,
      tiedRounds,
      drawPct,
      shootoutRounds,
      shootoutPct,
      scorelessRounds,
      scorelessPct,
      penTakenTotal,
      penAccuracyPct,
      totalAssists,
      totalWins,
      goalsPerMini,
      kingSharePct,
      assistedGoalsPct,
      topScorer,
      topAssister: leaderBy(players, (p) => p.assists),
      topWinner: leaderBy(players, (p) => p.wins),
      // Penalty leaders — tested derivation (tie-break on success%, then
      // attempts, then uid). null when nobody has scored/saved a penalty yet.
      penaltyKing: penaltyKing(
        players.map((p) => ({ userId: p.uid, penScored: p.penScored, penTaken: p.penTaken })),
      ),
      penaltyKeeperKing: penaltyKeeperKing(
        players.map((p) => ({ userId: p.uid, penSaved: p.penSaved, penFaced: p.penFaced })),
      ),
    };
  }, [champ]);

  // "הכי מתמיד" = most nights attended, taken from the finished-nights scan in
  // getCommunityStats (topPlayers[0]) — NOT the communityPlayerStats `games`
  // rollup, which can lag behind and produced the "4 vs 5-in-a-row" mismatch
  // (a streak can never exceed total attendance when both share a source).
  const mostLoyal = useMemo(() => {
    const top = stats?.topPlayers?.[0];
    return top && top.attended > 0 ? { uid: top.uid, nights: top.attended } : null;
  }, [stats]);

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
        <EmptyState
          icon="stats-chart-outline"
          title={he.communityStatsEmptyTitle}
          hint={he.communityStatsEmptyBody}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── המצטיין (מלך השערים) — הגיבור בראש המסך ── */}
          {derived.topScorer && derived.totalGoals > 0 ? (
            <AppearItem index={0}>
              <Card style={styles.mvpCard}>
                <View style={styles.mvpRibbon}>
                  <Ionicons name="star" size={11} color="#fff" />
                  <Text style={styles.mvpRibbonText}>{he.communityStatsMvp}</Text>
                </View>
                <View style={styles.mvpRow}>
                  <UserAvatar user={resolved(derived.topScorer.uid)} size={64} ring />
                  <View style={styles.mvpMid}>
                    <Text style={styles.mvpCat}>{he.communityStatsTopScorer}</Text>
                    <Text style={styles.mvpName} numberOfLines={1}>
                      {firstName(resolved(derived.topScorer.uid).name)}
                    </Text>
                    <Text style={styles.mvpSub} numberOfLines={1}>
                      {he.communityStatsMvpShare(derived.kingSharePct)}
                    </Text>
                  </View>
                  <View style={styles.mvpBig}>
                    <CountUp
                      from={0}
                      to={derived.topScorer.goals}
                      durationMs={1100}
                      style={styles.mvpBigNum}
                    />
                    <Text style={styles.mvpBigLabel}>{he.communityStatsGoals}</Text>
                  </View>
                </View>
              </Card>
            </AppearItem>
          ) : null}

          {/* ── המועדון במספרים (4) ── */}
          <SectionTitle icon="bar-chart" text={he.communityStatsSectionNumbers} />
          <View style={styles.heroGrid}>
            <HeroTile icon={<MaterialCommunityIcons name="soccer" size={24} color={colors.primary} />} tint={colors.primary} value={derived.totalGoals} label={he.communityStatsGoals} />
            <HeroTile icon={<MaterialCommunityIcons name="shoe-cleat" size={24} color="#7C3AED" />} tint="#7C3AED" value={derived.totalAssists} label={he.communityStatsAssists} />
            <HeroTile icon={<MaterialCommunityIcons name="soccer-field" size={24} color="#0EA5E9" />} tint="#0EA5E9" value={derived.totalRounds} label={he.communityStatsMiniGames} />
            <HeroTile icon={<MaterialCommunityIcons name="calendar-month" size={24} color={colors.success} />} tint={colors.success} value={stats?.totalFinished ?? 0} label={he.communityStatsEvenings} />
          </View>

          {/* ── מובילי המועדון ── (only once goals exist; else all "—") */}
          {hasScoring ? (
          <>
          <SectionTitle icon="trophy" text={he.communityStatsSectionLeaders} />
          {/* מלך השערים מוצג למעלה כ"מצטיין" — כאן רק שאר המובילים, כרשימה
              מיושרת-לימין: אווטאר בימין, קטגוריה+שם, וערך מונפש בשמאל. */}
          <Card style={styles.leadersCard}>
            {(
              [
                derived.topAssister && {
                  title: he.communityStatsTopAssister,
                  uid: derived.topAssister.uid,
                  value: derived.topAssister.assists,
                  unit: 'בישולים',
                  tint: '#7C3AED',
                },
                derived.topWinner && {
                  title: he.communityStatsTopWinner,
                  uid: derived.topWinner.uid,
                  value: derived.topWinner.wins,
                  unit: 'נצחונות',
                  tint: colors.warning,
                },
                mostLoyal && {
                  title: he.communityStatsMostLoyal,
                  uid: mostLoyal.uid,
                  value: mostLoyal.nights,
                  unit: 'ערבים',
                  tint: colors.success,
                },
                derived.penaltyKing && {
                  title: he.communityStatsPenaltyKing,
                  uid: derived.penaltyKing.userId,
                  // Headline the CONVERSION RATE (8% of 1000 ≠ 80% of 5). The raw
                  // "scored / attempts" sits below as the ratio.
                  value: derived.penaltyKing.pct,
                  suffix: '%',
                  unit: `${derived.penaltyKing.count}/${derived.penaltyKing.attempts}`,
                  tint: '#EF4444',
                },
                derived.penaltyKeeperKing && {
                  title: he.communityStatsPenaltyKeeperKing,
                  uid: derived.penaltyKeeperKing.userId,
                  value: derived.penaltyKeeperKing.pct,
                  suffix: '%',
                  unit: `${derived.penaltyKeeperKing.count}/${derived.penaltyKeeperKing.attempts}`,
                  tint: '#16A34A',
                },
              ].filter(Boolean) as {
                title: string;
                uid: string;
                value: number;
                unit: string;
                tint: string;
                suffix?: string;
              }[]
            ).map((r, i, arr) => (
              <LeaderRow
                key={r.title}
                title={r.title}
                user={resolved(r.uid)}
                value={r.value}
                unit={r.unit}
                suffix={r.suffix}
                tint={r.tint}
                index={i}
                last={i === arr.length - 1}
              />
            ))}
          </Card>
          </>
          ) : null}

          {/* טבלת המבקיעים הוסרה — כפילות מול טבלת הליגה במסך פרטי המועדון. */}

          {/* ── נתונים מעניינים ── */}
          <SectionTitle icon="sparkles" text={he.communityStatsSectionFun} />
          <Card style={styles.funCard}>
            {/* חלק המלך מוצג למעלה באריח "המצטיין". האחוזים כאן = דונאטים מונפשים. */}
            {derived.totalGoals > 0 && derived.totalAssists > 0 ? (
              <FunDonutRow index={0} pct={derived.assistedGoalsPct} tint="#7C3AED"
                text="מהגולים במועדון הגיעו אחרי בישול — כדורגל של עבודת צוות" />
            ) : null}
            {derived.penTakenTotal > 0 ? (
              <FunDonutRow index={1} pct={derived.penAccuracyPct} tint={colors.success}
                text="מהפנדלים במועדון הסתיימו בגול" />
            ) : null}
            {derived.totalRounds > 0 && derived.drawPct > 0 ? (
              <FunDonutRow index={2} pct={derived.drawPct} tint={colors.info}
                text="מהמשחקונים הסתיימו בתיקו" />
            ) : null}
            {derived.scorelessRounds > 0 ? (
              <FunDonutRow index={3} pct={derived.scorelessPct} tint={colors.textMuted}
                text="מהמשחקונים הסתיימו 0:0" />
            ) : null}
            {derived.shootoutRounds > 0 ? (
              <FunDonutRow index={4} pct={derived.shootoutPct} tint={colors.danger}
                text="מהמשחקונים הוכרעו בפנדלים" />
            ) : null}
            <FunDonutRow index={5} pct={Math.round((stats?.organizationRate ?? 0) * 100)}
              tint={colors.success} text="מהמשחקים המתוכננים יצאו לפועל" />
            {/* עובדות טקסט (בלי אחוז) */}
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
              icon="calendar-outline"
              tint={colors.primary}
              parts={[
                { t: `${stats?.activeThisYear ?? 0} שחקנים`, em: 'num' },
                { t: ' היו פעילים השנה' },
              ]}
              last
            />
          </Card>

          {/* ── הישגי המועדון (תארים) — הכי למטה ── */}
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
  icon: React.ReactNode;
  tint: string;
  value: number | string;
  label: string;
}) {
  return (
    <Card style={styles.heroTile}>
      <View style={[styles.heroIcon, { backgroundColor: tint + '1A' }]}>
        {icon}
      </View>
      <View style={styles.heroText}>
        {/* Numbers count up (0 → value) as the stats resolve. */}
        {typeof value === 'number' ? (
          <CountUp from={0} to={value} durationMs={1000} style={styles.heroValue} />
        ) : (
          <Text style={styles.heroValue}>{value}</Text>
        )}
        <Text style={styles.heroLabel} numberOfLines={1}>{label}</Text>
      </View>
    </Card>
  );
}

// One leader = a right-aligned list row: avatar (right), category + name
// (right-aligned) beside it, and the value (counts up) pinned to the left.
function LeaderRow({
  title,
  user,
  value,
  unit,
  tint,
  index,
  last,
  suffix,
}: {
  title: string;
  user: Resolved;
  value: number;
  unit: string;
  tint: string;
  index: number;
  last?: boolean;
  /** e.g. "%" for penalty leaders whose headline value is a success rate. */
  suffix?: string;
}) {
  return (
    <AppearItem index={index}>
      <View style={[styles.leaderRow, !last && styles.funDivider]}>
        <UserAvatar user={user} size={40} ring />
        <View style={styles.leaderMid}>
          <Text style={styles.leaderCat} numberOfLines={1}>{title}</Text>
          <Text style={styles.leaderName} numberOfLines={1}>{firstName(user.name)}</Text>
        </View>
        <View style={styles.leaderVal}>
          <CountUp
            from={0}
            to={value}
            durationMs={1000}
            suffix={suffix}
            style={[styles.leaderValNum, { color: tint }]}
          />
          <Text style={styles.leaderValUnit}>{unit}</Text>
        </View>
      </View>
    </AppearItem>
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

// A fun fact whose stat is a percentage → an animated donut (the "graph") on
// the right that sweeps to the value, with the descriptive sentence beside it.
function FunDonutRow({
  pct,
  tint,
  text,
  index,
  last,
}: {
  pct: number;
  tint: string;
  text: string;
  index: number;
  last?: boolean;
}) {
  return (
    <View style={[styles.funRow, !last && styles.funDivider]}>
      <StatDonut pct={pct} tint={tint} size={48} delayMs={index * 90} />
      <Text style={styles.funSentence}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  loadingText: { ...typography.body, color: colors.textMuted },
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

  // MVP hero (top scorer) — the dominant element at the top.
  mvpCard: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  // Corner ribbon, top-right. paddingStart clears the card's rounded corner so
  // the last Hebrew letter isn't clipped.
  mvpRibbon: {
    position: 'absolute',
    top: 0,
    // forceRTL swaps left/right, so `left:0` pins the ribbon to the visual
    // RIGHT corner (matching the sketch). paddingStart clears the rounded corner.
    left: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.warning,
    paddingStart: spacing.md,
    paddingEnd: spacing.sm,
    paddingVertical: 4,
    borderBottomEndRadius: radius.md,
    zIndex: 2,
  },
  mvpRibbonText: { ...typography.caption, color: '#fff', fontWeight: '900' },
  // `row` (not row-reverse): under forceRTL first child (avatar) → visual RIGHT,
  // text block to its left, and the big number pinned far LEFT (like the sketch).
  mvpRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mvpMid: { flex: 1, minWidth: 0 },
  mvpCat: { ...typography.caption, color: colors.warning, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  mvpName: { ...typography.h3, color: colors.text, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  mvpSub: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, marginTop: 2 },
  mvpBig: { alignItems: 'center' },
  mvpBigNum: { ...typography.h1, color: colors.warning, fontWeight: '900', fontVariant: ['tabular-nums'] },
  mvpBigLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '800' },

  // hero grid — 2×2, compact horizontal tiles (icon + number/label)
  heroGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  heroTile: {
    width: '48.5%',
    minWidth: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  heroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, minWidth: 0 },
  heroValue: { ...typography.h2, color: colors.text, fontWeight: '900', fontVariant: ['tabular-nums'], textAlign: RTL_LABEL_ALIGN },
  heroLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, marginTop: 2 },

  // leaders — right-aligned list rows
  leadersCard: { padding: 0, overflow: 'hidden' },
  // `row` (not row-reverse): under forceRTL the first child (avatar) sits on the
  // visual RIGHT, category/name flow to its left, value pinned far LEFT.
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  leaderMid: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  leaderCat: { ...typography.caption, color: colors.textMuted, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  leaderName: { ...typography.body, color: colors.text, fontWeight: '900', textAlign: RTL_LABEL_ALIGN, marginTop: 1 },
  leaderVal: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  leaderValNum: { ...typography.h3, fontWeight: '900', fontVariant: ['tabular-nums'] },
  leaderValUnit: { ...typography.caption, color: colors.textMuted, fontWeight: '800' },

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

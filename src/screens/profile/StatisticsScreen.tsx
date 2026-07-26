// StatisticsScreen — a dedicated page that gathers the player's numbers and
// their "people" superlatives (most played with, winning duo, biggest
// victim, nemesis). All derived by playerStatsService in ≤3 reads; names for
// the relational cards are resolved here.

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { AppearItem } from '@/components/anim/AppearItem';
import { userService } from '@/services';
import {
  playerStatsService,
  type NamedStat,
  type PlayerStatsSummary,
} from '@/services/playerStatsService';
import { useUserStore } from '@/store/userStore';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;

export function StatisticsScreen() {
  const localUser = useUserStore((s) => s.currentUser);
  const [stats, setStats] = useState<PlayerStatsSummary | null>(null);
  const [people, setPeople] = useState<Record<string, Resolved>>({});
  const [pen, setPen] = useState<{
    penTaken: number;
    penScored: number;
    penFaced: number;
    penSaved: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = localUser?.id;
    if (!uid) return;
    let alive = true;
    setLoading(true);
    // Goals are incremented SERVER-side (commitRoundStats), so the local store
    // copy lags. Fetch the fresh user doc for an accurate goal count + goals/
    // evening rather than trusting the (possibly stale) cached stats.
    userService
      .getUserById(uid)
      .catch(() => null)
      .then((fresh) => {
        // Penalty-shootout stats (server-maintained) — captured for the tiles.
        const st = fresh?.stats;
        setPen(
          st
            ? {
                penTaken: st.penTaken ?? 0,
                penScored: st.penScored ?? 0,
                penFaced: st.penFaced ?? 0,
                penSaved: st.penSaved ?? 0,
              }
            : null,
        );
        return playerStatsService.compute(uid, {
          goals: fresh?.stats?.goals ?? localUser?.stats?.goals ?? 0,
          assists: fresh?.stats?.assists ?? localUser?.stats?.assists ?? 0,
        });
      })
      .then(async (s) => {
        if (!alive) return;
        setStats(s);
        // Resolve the (few) distinct uids the named cards reference.
        const ids = Array.from(
          new Set(
            [
              s.mostPlayedWith,
              s.mostWinsWith,
              s.biggestVictim,
              s.nemesis,
              s.mostAssistedTo,
              s.mostAssistedBy,
            ]
              .filter((x): x is NamedStat => !!x)
              .map((x) => x.uid),
          ),
        );
        const fetched = await Promise.all(
          ids.map((id) => userService.getUserById(id).catch(() => null)),
        );
        if (!alive) return;
        const map: Record<string, Resolved> = {};
        fetched.forEach((u) => {
          if (u) map[u.id] = u;
        });
        setPeople(map);
      })
      .catch(() => {
        /* leave stats null → empty state */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // assists must be a dep too — the effect reads it, so an assists-only
    // server bump (no goal change) otherwise left the assist tile stale.
  }, [localUser?.id, localUser?.stats?.goals, localUser?.stats?.assists]);

  const hasData = !!stats && stats.attendedGames > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.statsScreenTitle} />
      {loading && !stats ? (
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      ) : !hasData ? (
        <EmptyState icon="stats-chart-outline" title={he.statsScreenEmpty} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* ── Numbers ─────────────────────────────────────────────── */}
          <Text style={styles.section}>{he.statsSectionNumbers}</Text>
          <View style={styles.tileGrid}>
            <NumberTile icon="calendar-outline" value={String(stats!.attendedGames)} label={he.statGames} />
            <NumberTile icon="football" value={String(stats!.goals)} label={he.statGoals} />
            {/* "בישול" (assist) = cooking pun → a food icon, not a hand
               (user request). Dropped the "גולים לערב" + "שחקנים שונים"
               tiles entirely (user request). */}
            <NumberTile icon="restaurant-outline" value={String(stats!.assists)} label={he.statAssists} />
          </View>

          {/* ── Penalties AS KICKER (only when the player took any) ───── */}
          {pen && pen.penTaken > 0 ? (
            <>
              <Text style={[styles.section, styles.sectionGap]}>
                {he.statsSectionPenaltiesKicker}
              </Text>
              <View style={styles.tileGrid}>
                <NumberTile
                  icon="football-outline"
                  value={`${pen.penScored}/${pen.penTaken}`}
                  label={he.statPenScored}
                />
                <NumberTile
                  icon="stats-chart-outline"
                  value={`${Math.round((pen.penScored / pen.penTaken) * 100)}%`}
                  label={he.statPenRate}
                />
              </View>
            </>
          ) : null}

          {/* ── Penalties AS KEEPER (only when the player faced any) ──── */}
          {pen && pen.penFaced > 0 ? (
            <>
              <Text style={[styles.section, styles.sectionGap]}>
                {he.statsSectionPenaltiesKeeper}
              </Text>
              <View style={styles.tileGrid}>
                <NumberTile
                  icon="hand-left-outline"
                  value={String(pen.penSaved)}
                  label={he.statPenSaves}
                />
                <NumberTile
                  icon="shield-checkmark-outline"
                  value={`${Math.round((pen.penSaved / pen.penFaced) * 100)}%`}
                  label={he.statPenSaveRate}
                />
              </View>
            </>
          ) : null}

          {/* ── People (named superlatives) ─────────────────────────── */}
          <Text style={[styles.section, styles.sectionGap]}>
            {he.statsSectionPeople}
          </Text>
          <View style={styles.peopleWrap}>
            <PersonCard
              index={0}
              icon="people"
              tint={colors.primary}
              title={he.statMostPlayedWith}
              stat={stats!.mostPlayedWith}
              sub={(n) => he.statMostPlayedWithSub(n)}
              person={resolve(stats!.mostPlayedWith, people)}
            />
            <PersonCard
              index={1}
              icon="trophy"
              tint="#F4B73E"
              title={he.statMostWinsWith}
              stat={stats!.mostWinsWith}
              sub={(n) => he.statMostWinsWithSub(n)}
              person={resolve(stats!.mostWinsWith, people)}
            />
            <PersonCard
              index={2}
              icon="thumbs-up"
              tint={colors.success}
              title={he.statBiggestVictim}
              stat={stats!.biggestVictim}
              sub={(n) => he.statBiggestVictimSub(n)}
              person={resolve(stats!.biggestVictim, people)}
            />
            <PersonCard
              index={3}
              icon="flame"
              tint={colors.danger}
              title={he.statNemesis}
              stat={stats!.nemesis}
              sub={(n) => he.statNemesisSub(n)}
              person={resolve(stats!.nemesis, people)}
            />
            <PersonCard
              index={4}
              icon="hand-left"
              tint="#0EA5E9"
              title={he.statMostAssistedTo}
              stat={stats!.mostAssistedTo}
              sub={(n) => he.statMostAssistedToSub(n)}
              person={resolve(stats!.mostAssistedTo, people)}
            />
            <PersonCard
              index={5}
              icon="hand-right"
              tint="#8B5CF6"
              title={he.statMostAssistedBy}
              stat={stats!.mostAssistedBy}
              sub={(n) => he.statMostAssistedBySub(n)}
              person={resolve(stats!.mostAssistedBy, people)}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function resolve(
  stat: NamedStat | null,
  people: Record<string, Resolved>,
): Resolved | null {
  if (!stat) return null;
  return people[stat.uid] ?? null;
}

function NumberTile({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <Card style={styles.tile}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Card>
  );
}

function PersonCard({
  index,
  icon,
  tint,
  title,
  stat,
  sub,
  person,
}: {
  index: number;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  stat: NamedStat | null;
  sub: (n: number) => string;
  person: Resolved | null;
}) {
  return (
    <AppearItem index={index}>
      <Card style={styles.person}>
        <View style={[styles.personIcon, { backgroundColor: tint }]}>
          <Ionicons name={icon} size={18} color="#FFFFFF" />
        </View>
        <View style={styles.personText}>
          <Text style={styles.personTitle}>{title}</Text>
          {stat ? (
            // Show the EARNED stat even if the partner's user doc failed to
            // resolve (deleted / fetch error) — previously a legit superlative
            // rendered as "no data" just because `person` was null.
            <Text style={styles.personSub} numberOfLines={1}>
              {sub(stat.count)}
            </Text>
          ) : (
            <Text style={styles.personEmpty}>{he.statsPersonEmpty}</Text>
          )}
        </View>
        {stat && person ? (
          <View style={styles.personAvatar}>
            <UserAvatar user={person} size={44} ring />
            <Text style={styles.personName} numberOfLines={1}>
              {firstName(person.name)}
            </Text>
          </View>
        ) : (
          <View style={[styles.personAvatar, styles.personAvatarEmpty]}>
            <Ionicons name="person-outline" size={22} color={colors.textMuted} />
          </View>
        )}
      </Card>
    </AppearItem>
  );
}

function firstName(name: string): string {
  return (name ?? '').trim().split(/\s+/)[0] || name;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  section: { ...typography.h3, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  sectionGap: { marginTop: spacing.lg },
  // numbers grid
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.md,
  },
  tileValue: { ...typography.h2, color: colors.text, fontWeight: '900' },
  tileLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textAlign: 'center' },
  // people cards
  peopleWrap: { gap: spacing.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  personIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personText: { flex: 1, minWidth: 0, gap: 2 },
  personTitle: { ...typography.bodyBold, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  personSub: { ...typography.caption, color: colors.textMuted, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
  personEmpty: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  personAvatar: { alignItems: 'center', gap: 2, width: 56 },
  personAvatarEmpty: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personName: { ...typography.caption, color: colors.text, fontWeight: '700', width: '100%', textAlign: 'center' },
});

// SeasonSummaryScreen — "סיכום העונה שלי".
//
// The season's answer to סיכום הערב: everything that happened to ONE player
// between the season opening and now (or its closing), and nothing cumulative.
// The distinction is the whole feature — a career total is already on the
// profile, and a number that never resets tells you nothing about this year.
//
// Two halves. The counters come off the player's own club row; the people —
// who I played beside most, who I faced most, who I beat most — come out of
// the pair counters the round rollup has been filling all along. Both are
// zeroed when a season closes, which is exactly what makes them season-scoped.

import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
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
import {
  seasonSummaryService,
  type SeasonSummaryModel,
} from '@/services/seasonSummaryService';
import type { SeasonPeer } from '@/utils/seasonPersonal';
import { useUserStore } from '@/store/userStore';
import { colors, spacing, typography } from '@/theme';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { he } from '@/i18n/he';
import type { ProfileStackParamList } from '@/navigation/ProfileStack';

type Params = RouteProp<ProfileStackParamList, 'SeasonSummary'>;

/** A percentage, or a dash when the rate has no denominator. */
const pct = (v: number | null): string =>
  v === null ? '—' : `${Math.round(v * 100)}%`;
const per = (v: number | null): string => (v === null ? '—' : v.toFixed(2));

function formatRange(startsAt: number, endsAt: number | null): string {
  const f = (ms: number) =>
    new Date(ms).toLocaleDateString('he-IL', { month: 'short', year: 'numeric' });
  if (!startsAt) return '';
  return endsAt ? `${f(startsAt)} – ${f(endsAt)}` : `${f(startsAt)} – ${he.seasonNow}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PeerRow({
  icon,
  label,
  peer,
  names,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  peer: SeasonPeer | null;
  names: Record<string, string>;
  detail: (p: SeasonPeer) => string;
}) {
  // A line with no answer is left out rather than shown empty: in a first
  // season half of these are genuinely unanswerable, and six greyed-out rows
  // read as a broken screen instead of a young one.
  if (!peer) return null;
  return (
    <View style={styles.peerRow}>
      <View style={styles.peerIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.peerText}>
        <Text style={styles.peerLabel}>{label}</Text>
        <Text style={styles.peerName}>{names[peer.userId] ?? '—'}</Text>
        <Text style={styles.peerDetail}>{detail(peer)}</Text>
      </View>
    </View>
  );
}

export function SeasonSummaryScreen() {
  const params = useRoute<Params>().params;
  const groupId = params?.groupId ?? '';
  const seasonId = params?.seasonId;
  const currentUser = useUserStore((s) => s.currentUser);

  const [model, setModel] = useState<SeasonSummaryModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!currentUser?.id || !groupId) {
      setModel(null);
      setLoading(false);
      return;
    }
    const m = await seasonSummaryService.load({
      groupId,
      userId: currentUser.id,
      seasonId,
    });
    setModel(m);
    setLoading(false);
  }, [currentUser?.id, groupId, seasonId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load().finally(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={he.seasonSummaryTitle} />
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      </SafeAreaView>
    );
  }

  if (!model) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={he.seasonSummaryTitle} />
        <View style={styles.center}>
          <Text style={styles.empty}>{he.seasonSummaryUnavailable}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { me, names } = model;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.seasonSummaryTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.hero}>
          <Text style={styles.heroSeason}>
            {he.seasonNumberLabel(model.seasonNo)} · {model.groupName}
          </Text>
          <Text style={styles.heroRange}>{formatRange(model.startsAt, model.endsAt)}</Text>
          {model.closed ? (
            <Text style={styles.heroClosed}>{he.seasonClosedBadge}</Text>
          ) : null}
        </View>

        {!me.hasData ? (
          <View style={styles.card}>
            <Text style={styles.empty}>{he.seasonSummaryNoRounds}</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{he.seasonSectionNumbers}</Text>
              <View style={styles.statGrid}>
                <Stat label={he.statGoals} value={String(me.goals)} />
                <Stat label={he.statAssists} value={String(me.assists)} />
                <Stat label={he.seasonStatContributions} value={String(me.contributions)} />
                <Stat label={he.seasonStatRounds} value={String(me.rounds)} />
                <Stat label={he.seasonStatWins} value={String(me.wins)} />
                <Stat label={he.seasonStatLosses} value={String(me.losses)} />
                <Stat label={he.seasonStatTies} value={String(me.ties)} />
                <Stat label={he.seasonStatWinPct} value={pct(me.winPct)} />
                <Stat label={he.seasonStatCleanSheets} value={String(me.cleanSheets)} />
                <Stat label={he.seasonStatCleanSheetPct} value={pct(me.cleanSheetPct)} />
                <Stat label={he.seasonStatGoalsPerRound} value={per(me.goalsPerRound)} />
                <Stat label={he.seasonStatAssistsPerRound} value={per(me.assistsPerRound)} />
              </View>
              {me.penTaken > 0 || me.penFaced > 0 || me.ownGoals > 0 ? (
                <View style={styles.statGrid}>
                  {me.penTaken > 0 ? (
                    <Stat
                      label={he.seasonStatPenalties}
                      value={`${me.penScored}/${me.penTaken}`}
                    />
                  ) : null}
                  {me.penFaced > 0 ? (
                    <Stat
                      label={he.seasonStatPenSaves}
                      value={`${me.penSaved}/${me.penFaced}`}
                    />
                  ) : null}
                  {me.ownGoals > 0 ? (
                    <Stat label={he.seasonStatOwnGoals} value={String(me.ownGoals)} />
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{he.seasonSectionStanding}</Text>
              <View style={styles.statGrid}>
                <Stat
                  label={he.statGoals}
                  value={me.ranks.goals ? he.seasonRankOf(me.ranks.goals, me.ranks.of) : '—'}
                />
                <Stat
                  label={he.statAssists}
                  value={me.ranks.assists ? he.seasonRankOf(me.ranks.assists, me.ranks.of) : '—'}
                />
                <Stat
                  label={he.seasonStatWins}
                  value={me.ranks.wins ? he.seasonRankOf(me.ranks.wins, me.ranks.of) : '—'}
                />
              </View>
              <Text style={styles.cardNote}>
                {he.seasonClubRounds(model.completedRounds)}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{he.seasonSectionPeople}</Text>
              <PeerRow
                icon="people-outline"
                label={he.seasonPeerPartner}
                peer={me.partner}
                names={names}
                detail={(p) => he.seasonPeerPartnerDetail(p.count, p.myWins)}
              />
              <PeerRow
                icon="flame-outline"
                label={he.seasonPeerNemesis}
                peer={me.nemesis}
                names={names}
                detail={(p) => he.seasonPeerNemesisDetail(p.count, p.myWins, p.theirWins)}
              />
              <PeerRow
                icon="trophy-outline"
                label={he.seasonPeerVictim}
                peer={me.victim}
                names={names}
                detail={(p) => he.seasonPeerVictimDetail(p.count)}
              />
              <PeerRow
                icon="skull-outline"
                label={he.seasonPeerTormentor}
                peer={me.tormentor}
                names={names}
                detail={(p) => he.seasonPeerTormentorDetail(p.count)}
              />
              <PeerRow
                icon="football-outline"
                label={he.seasonPeerAssistedMost}
                peer={me.assistedMost}
                names={names}
                detail={(p) => he.seasonPeerAssistsDetail(p.count)}
              />
              <PeerRow
                icon="hand-left-outline"
                label={he.seasonPeerAssistedBy}
                peer={me.assistedBy}
                names={names}
                detail={(p) => he.seasonPeerAssistsDetail(p.count)}
              />
              {!me.partner && !me.nemesis ? (
                <Text style={styles.cardNote}>{he.seasonPeersEmpty}</Text>
              ) : null}
            </View>
          </>
        )}
        <Text style={styles.footnote}>{he.seasonSummaryFootnote}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  hero: { gap: spacing.xs },
  heroSeason: {
    ...typography.h2,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  heroRange: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  heroClosed: {
    ...typography.caption,
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  cardNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    minWidth: 96,
    flexGrow: 1,
    flexBasis: '30%',
    // Sits ON a card, so it needs the muted surface — the page background
    // would be invisible against white in light mode.
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: 2,
  },
  statValue: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Icon first in source order: under forceRTL the first child renders
  // rightmost, which puts the icon on the right of the Hebrew text.
  peerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  peerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerText: { flex: 1, gap: 1 },
  peerLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  peerName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  peerDetail: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});

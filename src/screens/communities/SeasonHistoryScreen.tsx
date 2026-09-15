// SeasonHistoryScreen — the club's hall of fame.
//
// Every season the club has finished, newest first, with the people who won
// something in it. Read straight out of the sealed archives and never
// recomputed: a past season is a record.
//
// It is the answer to the question a season creates — "so who actually won?" —
// and without it the whole competition would end in a push notification and
// then vanish.

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import {
  seasonHistoryService,
  type FinishedSeason,
} from '@/services/seasonHistoryService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Params = RouteProp<CommunitiesStackParamList, 'SeasonHistory'>;

function formatRange(startsAt: number, endsAt: number): string {
  const f = (ms: number) =>
    ms > 0
      ? new Date(ms).toLocaleDateString('he-IL', { month: 'short', year: 'numeric' })
      : '';
  const from = f(startsAt);
  const to = f(endsAt);
  // Season 1 of a club that sealed its history began whenever the club did,
  // which nothing recorded. Say so rather than leaving the line blank.
  if (!from) return to ? he.seasonRangeUntil(to) : he.seasonRangeUnknown;
  return to ? `${from} – ${to}` : from;
}

function SeasonCard({ season }: { season: FinishedSeason }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{he.seasonNumberLabel(season.no)}</Text>
      <Text style={styles.cardMeta}>{formatRange(season.startsAt, season.endsAt)}</Text>
      <Text style={styles.cardMeta}>
        {he.seasonHistoryLine(
          season.completedRounds,
          season.totals.rounds,
          season.players,
        )}
      </Text>
      {season.endedEarly ? (
        <Text style={styles.flag}>{he.seasonHistoryEndedEarly}</Text>
      ) : null}
      {season.partialData ? (
        <Text style={styles.flag}>{he.seasonHistoryPartial}</Text>
      ) : null}

      {season.winners.length === 0 ? (
        // A season can genuinely end with nothing awarded — a club that played
        // four rounds has nobody past the half-season gate. Say so.
        <Text style={styles.cardMeta}>{he.seasonHistoryNoTitles}</Text>
      ) : (
        <View style={styles.winners}>
          {season.winners.map((w) => (
            <View key={w.key} style={styles.winnerRow}>
              <Text style={styles.medal}>🏆</Text>
              <View style={styles.winnerText}>
                <Text style={styles.winnerTitle}>{he.seasonTitleNames[w.key]}</Text>
                <Text style={styles.winnerName}>
                  {w.names.join(' · ')}
                  {/* The number it was won on. A title without it is a label;
                      with it, it is the argument people actually have. Same
                      line as the summary's champions card, so the two agree. */}
                  <Text style={styles.winnerValue}>
                    {'  '}
                    {he.seasonTitleValue(w.key, w.value)}
                  </Text>
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function SeasonHistoryScreen() {
  const params = useRoute<Params>().params;
  const groupId = params?.groupId ?? '';
  const [seasons, setSeasons] = useState<FinishedSeason[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await seasonHistoryService.list(groupId);
    setFailed(r === 'error');
    setSeasons(r === 'error' ? [] : r);
    if (r !== 'error') {
      logEvent(AnalyticsEvent.SeasonHistoryViewed, { groupId, seasons: r.length });
    }
  }, [groupId]);

  useEffect(() => {
    let alive = true;
    void seasonHistoryService.list(groupId).then((r) => {
      if (!alive) return;
      setFailed(r === 'error');
      setSeasons(r === 'error' ? [] : r);
      if (r !== 'error') {
        logEvent(AnalyticsEvent.SeasonHistoryViewed, { groupId, seasons: r.length });
      }
    });
    return () => {
      alive = false;
    };
  }, [groupId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!seasons) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={he.seasonHistoryTitle} />
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.seasonHistoryTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {seasons.length === 0 ? (
          <Text style={styles.empty}>
            {failed ? he.seasonHistoryLoadFailed : he.seasonHistoryEmpty}
          </Text>
        ) : (
          seasons.map((s) => <SeasonCard key={s.seasonId} season={s} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardTitle: { ...typography.h3, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  cardMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  flag: { ...typography.caption, color: colors.primary, textAlign: RTL_LABEL_ALIGN },
  winners: { gap: spacing.sm, paddingTop: spacing.sm },
  // Medal first in source order → rightmost under forceRTL.
  winnerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  medal: { fontSize: 20 },
  winnerText: { flex: 1, gap: 1 },
  winnerTitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  winnerName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  winnerValue: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});

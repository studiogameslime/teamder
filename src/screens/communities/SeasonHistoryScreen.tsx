// SeasonHistoryScreen — the club's hall of fame.
//
// Every season the club has finished, newest first, with the people who won
// something in it. Read straight out of the sealed archives and never
// recomputed: a past season is a record.
//
// It is the answer to the question a season creates — "so who actually won?" —
// and without it the whole competition would end in a push notification and
// then vanish.
//
// It used to answer that question the way a settings screen answers anything:
// a white card, two grey lines, and nine identical rows in which the club's
// champion was row three. A season is a ceremony and this is the only place it
// is ever held, so it is staged as one now — a floodlit plate per season, the
// champion as the headline, and the nine titles as a cabinet of medals with an
// engraved socket where a title went unclaimed.

import { Ionicons } from '@expo/vector-icons';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';

import { ScreenEntrance } from '@/components/anim/ScreenEntrance';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SeasonMedal } from '@/components/community/SeasonMedal';
import { SeasonPoster } from '@/components/community/SeasonPoster';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';
import { medalTier, titleStreak } from '@/utils/seasonMedalTier';
import {
  heroSeasonId,
  heroWinner,
  seasonCardVariant,
} from '@/utils/seasonCardVariant';
import {
  seasonHistoryService,
  type FinishedSeason,
} from '@/services/seasonHistoryService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
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
  // A season 1 that CARRIED the club's history has a startsAt of the moment
  // seasons were switched on, not of the first evening it contains — so the
  // club's only sealed season, spanning 28.06 to 17.09, printed
  // "ספט׳ 2026 – ספט׳ 2026" over "22 מחזורים". Two identical months on a
  // season that holds twenty-two evenings is not a date range, it is a
  // contradiction, so it says the one thing it actually knows instead.
  if (from === to) return to ? he.seasonRangeUntil(to) : he.seasonRangeUnknown;
  return to ? `${from} – ${to}` : from;
}

/** A one-day season needs a day, not a month — otherwise a season that lasted
 *  a minute prints the same string as one that lasted five weeks. */
function formatDay(ms: number): string {
  return ms > 0
    ? new Date(ms).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
    : '';
}

/** The seeding-bug season: a line between two real ones, not a card. */
function VoidRibbon({ season }: { season: FinishedSeason }) {
  return (
    <View style={styles.ribbon}>
      <Text style={styles.ribbonNo} allowFontScaling={false}>
        {he.seasonNumberLabel(season.no)}
      </Text>
      <Text style={styles.ribbonText} numberOfLines={2}>
        {he.seasonVoidLine(season.no, formatDay(season.endsAt)).replace(
          `${he.seasonNumberLabel(season.no)} · `,
          '',
        )}
      </Text>
    </View>
  );
}

function Cabinet({
  season,
  all,
  index,
}: {
  season: FinishedSeason;
  all: readonly FinishedSeason[];
  index: number;
}) {
  const byKey = useMemo(() => {
    const m = new Map<string, FinishedSeason['winners'][number]>();
    season.winners.forEach((w) => m.set(w.key, w));
    return m;
  }, [season.winners]);

  // Nine fixed places in the canonical order, every season. That is what makes
  // a column of seasons scannable — the same title sits in the same spot — and
  // it is why a title nobody won is drawn as an empty socket rather than
  // closing the gap.
  const rows: SeasonTitleKey[][] = [];
  for (let i = 0; i < SEASON_TITLE_KEYS.length; i += 3) {
    rows.push(SEASON_TITLE_KEYS.slice(i, i + 3) as SeasonTitleKey[]);
  }

  return (
    <View style={styles.cabinet}>
      {rows.map((row, r) => (
        <View
          key={r}
          style={[styles.shelf, r === rows.length - 1 && styles.shelfLast]}
        >
          {row.map((key) => {
            const w = byKey.get(key);
            const streak = w ? titleStreak(all, index, key) : 1;
            return (
              <View key={key} style={styles.slot}>
                <SeasonMedal
                  titleKey={key}
                  tier={
                    w
                      ? // Against what the title was DECIDED on, not against
                        // the season's length. Those are two counters over two
                        // eras, and grading 19-of-19 attendance as 19-of-22
                        // put gold on the one record in the app that is
                        // unarguably perfect.
                        medalTier(
                          key,
                          w.value,
                          season.awardsDenominator ?? season.completedRounds,
                        )
                      : 'bronze'
                  }
                  streak={streak}
                  empty={!w}
                />
                <Text style={styles.slotTitle} numberOfLines={2}>
                  {he.seasonTitleNames[key]}
                </Text>
                {w ? (
                  <>
                    {/* A name, then how many shared it. It used to render the
                        suffix INSTEAD of the names — "במשותף עם עוד 6 שחקנים"
                        with "עוד" pointing at nobody — so on the one club that
                        has closed a season, the שחקן העונה medal named none of
                        its seven winners. The screen exists to answer "so who
                        actually won?". */}
                    <Text style={styles.slotName} numberOfLines={2}>
                      {w.names.slice(0, 2).join(' · ')}
                    </Text>
                    {w.names.length > 2 ? (
                      <Text style={styles.slotShared} numberOfLines={1}>
                        {he.seasonTitleSharedWith(w.names.length - 2)}
                      </Text>
                    ) : null}
                    <Text style={styles.slotValue} numberOfLines={1}>
                      {he.seasonTitleValue(key, w.value)}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.slotEmpty}>{he.seasonTitleNotAwarded}</Text>
                )}
              </View>
            );
          })}
          {/* Keep the last shelf on a 3-column grid when the row is short. */}
          {row.length < 3
            ? Array.from({ length: 3 - row.length }, (_, i) => (
                <View key={`pad${i}`} style={styles.slot} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

function SeasonCard({
  season,
  all,
  index,
  celebrate,
}: {
  season: FinishedSeason;
  all: readonly FinishedSeason[];
  index: number;
  celebrate: boolean;
}) {
  const hero = heroWinner(season);
  return (
    <View style={styles.card}>
      <SeasonPoster season={season} hero={hero} celebrate={celebrate} />
      {season.winners.length === 0 ? (
        // A club that played four evenings has nobody past the half-season
        // gate. The season happened; say so, and keep the card.
        <Text style={styles.noTitles}>{he.seasonHistoryNoTitles}</Text>
      ) : (
        <Cabinet season={season} all={all} index={index} />
      )}
      <View style={styles.foot}>
        <Text style={styles.range}>{formatRange(season.startsAt, season.endsAt)}</Text>
        {season.endedEarly ? (
          <Text style={styles.chip}>{he.seasonHistoryEndedEarlyChip}</Text>
        ) : null}
        {season.partialData ? (
          <Text style={styles.chip}>{he.seasonHistoryPartialChip}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function SeasonHistoryScreen() {
  const params = useRoute<Params>().params;
  const groupId = params?.groupId ?? '';
  const [seasons, setSeasons] = useState<FinishedSeason[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // A failed load must never overwrite a good list.
  //
  // It used to do exactly that — `setSeasons(r === 'error' ? [] : r)` — so one
  // dropped connection on a pull-to-refresh replaced a club's whole history
  // with the empty state, which reads as "the seasons are gone". The list is
  // kept and the failure is said above it.
  const apply = useCallback((r: FinishedSeason[] | 'error') => {
    setFailed(r === 'error');
    if (r === 'error') return;
    setSeasons(r);
    logEvent(AnalyticsEvent.SeasonHistoryViewed, { groupId, seasons: r.length });
  }, [groupId]);

  const load = useCallback(async () => {
    apply(await seasonHistoryService.list(groupId));
  }, [apply, groupId]);

  useEffect(() => {
    let alive = true;
    void seasonHistoryService.list(groupId).then((r) => {
      if (!alive) return;
      apply(r);
      // Only the FIRST load is allowed to end with nothing on screen.
      if (r === 'error') setSeasons([]);
    });
    return () => {
      alive = false;
    };
  }, [apply, groupId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const heroId = useMemo(() => heroSeasonId(seasons ?? []), [seasons]);

  const totals = useMemo(() => {
    const list = seasons ?? [];
    return {
      rounds: list.reduce((n, s) => n + s.completedRounds, 0),
      mini: list.reduce((n, s) => n + s.totals.rounds, 0),
      players: list.reduce((n, s) => Math.max(n, s.players), 0),
    };
  }, [seasons]);

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
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {failed && seasons.length > 0 ? (
          <Text style={styles.refreshFailed}>{he.seasonHistoryRefreshFailed}</Text>
        ) : null}

        {seasons.length === 0 ? (
          <Text style={styles.empty}>
            {failed ? he.seasonHistoryLoadFailed : he.seasonHistoryEmpty}
          </Text>
        ) : (
          <>
            <ScreenEntrance hero>
              <View style={styles.crest}>
                <View style={styles.crestBadge}>
                  <Ionicons name="trophy" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.crestText}>
                  <Text style={styles.crestTitle}>{he.seasonHallTitle}</Text>
                  <Text style={styles.crestMeta} numberOfLines={1}>
                    {he.seasonHallClosed(seasons.length)}
                  </Text>
                </View>
                <View style={styles.crestNums}>
                  <CrestNum n={totals.rounds} label={he.seasonStatRoundsShort} />
                  {totals.mini > 0 ? (
                    <CrestNum n={totals.mini} label={he.seasonStatMiniShort} />
                  ) : null}
                  <CrestNum n={totals.players} label={he.seasonStatPlayersShort} />
                </View>
              </View>
            </ScreenEntrance>

            {seasons.map((s, i) =>
              seasonCardVariant(s) === 'void' ? (
                <ScreenEntrance key={s.seasonId} index={i + 1}>
                  <VoidRibbon season={s} />
                </ScreenEntrance>
              ) : (
                <ScreenEntrance key={s.seasonId} index={i + 1}>
                  <SeasonCard
                    season={s}
                    all={seasons}
                    index={i}
                    celebrate={s.seasonId === heroId}
                  />
                </ScreenEntrance>
              ),
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CrestNum({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.crestNum}>
      <Text style={styles.crestNumValue} allowFontScaling={false}>
        {n}
      </Text>
      <Text style={styles.crestNumLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },

  refreshFailed: {
    ...typography.caption,
    color: colors.warning,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.md,
    padding: spacing.sm,
    textAlign: RTL_LABEL_ALIGN,
  },

  // ── crest ────────────────────────────────────────────────────────────────
  crest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  crestBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestText: { flexShrink: 1 },
  crestTitle: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  crestMeta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  crestNums: { marginStart: 'auto', flexDirection: 'row', gap: spacing.md },
  crestNum: { alignItems: 'center' },
  crestNumValue: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  crestNumLabel: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },

  // ── void ribbon ──────────────────────────────────────────────────────────
  ribbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#D6DAE2',
    borderStyle: 'dashed',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ribbonNo: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '900',
    color: '#9AA3B2',
    backgroundColor: '#E7EAF0',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  ribbonText: {
    ...typography.caption,
    fontSize: 12,
    color: '#8A93A3',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },

  // ── card ─────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.card,
  },
  noTitles: {
    ...typography.caption,
    color: colors.textMuted,
    padding: spacing.lg,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 20,
  },

  // ── cabinet ──────────────────────────────────────────────────────────────
  cabinet: { padding: spacing.lg },
  shelf: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    // The shelf itself: a hairline and the shadow it casts. Cheaper and
    // steadier than an image, and it survives any card width.
    borderBottomWidth: 2,
    borderBottomColor: '#ECEFF4',
  },
  shelfLast: { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 },
  slot: { flex: 1, alignItems: 'center', paddingTop: spacing.xs },
  slotTitle: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#9AA3B2',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  slotName: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: 2,
  },
  slotShared: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#9AA3B2',
    textAlign: 'center',
  },
  slotValue: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  slotEmpty: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: '#B3BAC6',
    textAlign: 'center',
    marginTop: 2,
  },

  // ── footer ───────────────────────────────────────────────────────────────
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  range: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  chip: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },

  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});

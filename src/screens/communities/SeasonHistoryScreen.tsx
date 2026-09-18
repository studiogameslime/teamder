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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type ListRenderItemInfo,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';

import { ScreenEntrance } from '@/components/anim/ScreenEntrance';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SeasonMedal } from '@/components/community/SeasonMedal';
import { SeasonPoster } from '@/components/community/SeasonPoster';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';
import {
  medalTier,
  titleStreak,
  TIER_NAME,
  type MedalTier,
} from '@/utils/seasonMedalTier';
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

/** How many cards get the staggered entrance — roughly a screenful. */
const ENTRANCE_ROWS = 3;

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

/** The seeding-bug season: a line between two real ones, not a card.
 *
 *  The whole sentence, as i18n wrote it. It used to render the season number in
 *  its own chip and then strip that number back out of the sentence with
 *  `.replace('עונה N · ', '')` — a screen reaching into a string to undo part
 *  of it, which survives exactly until the copy owner changes the separator or
 *  drops the prefix, and then silently prints the number twice or not at all.
 *  The line is short enough to be one line. */
function VoidRibbon({ season }: { season: FinishedSeason }) {
  const line = he.seasonVoidLine(season.no, formatDay(season.endsAt));
  return (
    <View style={styles.ribbon} accessible accessibilityLabel={line}>
      <View style={styles.ribbonDot} />
      <Text style={styles.ribbonText} numberOfLines={2}>
        {line}
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
            // The SEASON's length.
            //
            // For half a day this divided by an `awardsDenominator` on the
            // card instead, on a finding that said 19-of-19 attendance was
            // drawing gold where platinum was due. Both the finding and the fix
            // were wrong: 19 is `max(games)` — the best attendance IN a season
            // of 22 evenings — so 19 of 22 is gold, and that is the right
            // answer. And the denominator was, by construction, the loyalty
            // winner's own value: the maximum of the very array the title takes
            // its maximum from. Dividing a number by itself crowned perfect
            // attendance on every future season regardless of who turned up,
            // and made silver and gold on this scale unreachable code. The
            // field and the code that wrote it are both gone now.
            const tier: MedalTier = w
              ? medalTier(key, w.value, season.completedRounds)
              : 'bronze';
            const names = w ? w.names.slice(0, 2).join(' · ') : '';
            const shared = w && w.names.length > 2 ? w.names.length - 2 : 0;
            // One slot, one thing said once. Nine medals of icon fonts and
            // gradients are nine unlabelled images to TalkBack, and the tier —
            // the entire second axis of the design — was carried by the colour
            // of a ring and by nothing else, so a reader who cannot see it was
            // told only that somebody won something.
            const label = [
              he.seasonTitleNames[key],
              w ? names : he.seasonTitleNotAwarded,
              shared > 0 ? he.seasonTitleSharedWith(shared) : '',
              w ? he.seasonTitleValue(key, w.value) : '',
              w ? TIER_NAME[tier] : '',
              w && streak > 1 ? `×${streak}` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <View
                key={key}
                style={styles.slot}
                accessible
                accessibilityLabel={label}
              >
                <SeasonMedal
                  titleKey={key}
                  tier={tier}
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
                        has closed a season, the כתר העונה medal named none of
                        its seven winners. The screen exists to answer "so who
                        actually won?". */}
                    <Text style={styles.slotName} numberOfLines={2}>
                      {names}
                    </Text>
                    {shared > 0 ? (
                      <Text style={styles.slotShared} numberOfLines={1}>
                        {he.seasonTitleSharedWith(shared)}
                      </Text>
                    ) : null}
                    <Text style={styles.slotValue} numberOfLines={1}>
                      {he.seasonTitleValue(key, w.value)}
                    </Text>
                    {/* The metal, in words. TIER_NAME has existed since the
                        medal was built and nothing ever rendered it, which left
                        ארד and פלטינה distinguishable only by hue — on a 54pt
                        disc, to a sighted reader, in Hebrew. */}
                    <Text style={styles.slotTier} numberOfLines={1}>
                      {TIER_NAME[tier]}
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

const SeasonCard = React.memo(function SeasonCard({
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
  // On the VARIANT, not on `winners.length`. The two answered the same question
  // in two places and drifted: a season in which nobody played at all still
  // reached this branch and was handed the half-season-gate explanation, which
  // blames a roster that never existed. seasonCardVariant owns that decision —
  // a season with nothing recorded anywhere never gets here at all, it is a
  // ribbon — and this reads it rather than deciding it again.
  const full = seasonCardVariant(season) === 'full';
  return (
    <View style={styles.card}>
      <SeasonPoster season={season} hero={hero} celebrate={celebrate} />
      {full ? (
        <Cabinet season={season} all={all} index={index} />
      ) : (
        // A club that played four evenings has nobody past the half-season
        // gate. The season happened; say so, and keep the card.
        <Text style={styles.noTitles}>{he.seasonHistoryNoTitles}</Text>
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
});

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
  // One view per visit. The event fired from `apply`, which also runs on every
  // pull-to-refresh, so a club scrolling its own hall of fame and tugging the
  // list four times reported four views and made the funnel behind the season
  // push unreadable. A refresh is not a new view.
  const viewLogged = useRef(false);

  const apply = useCallback((r: FinishedSeason[] | 'error') => {
    setFailed(r === 'error');
    if (r === 'error') return;
    setSeasons(r);
    if (viewLogged.current) return;
    viewLogged.current = true;
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

  const list = seasons ?? [];
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<FinishedSeason>) => {
      const row =
        seasonCardVariant(item) === 'void' ? (
          <VoidRibbon season={item} />
        ) : (
          <SeasonCard
            season={item}
            all={list}
            index={index}
            celebrate={item.seasonId === heroId}
          />
        );
      // The entrance belongs to the screen arriving, not to scrolling. A
      // virtualised row mounts when it comes into view, and ScreenEntrance is
      // one-shot per MOUNT — so past the first screenful every card would fade
      // and rise again each time the list was scrolled back over it.
      return index < ENTRANCE_ROWS ? (
        <ScreenEntrance index={index + 1}>{row}</ScreenEntrance>
      ) : (
        row
      );
    },
    [heroId, list],
  );

  // Two sums, and only sums.
  //
  // There was a third number here, labelled "שחקנים", and it was
  // `Math.max(players)` sitting between two `reduce(+)` totals — the same row,
  // the same type, one of them answering a different question. A sum is the
  // wrong answer too: the same fourteen people across four seasons are not
  // fifty-six players. The club's roster size is a fact this screen does not
  // hold, and each season's own players count is already on its poster, where
  // it is exactly right.
  const totals = useMemo(() => {
    const list = seasons ?? [];
    return {
      rounds: list.reduce((n, s) => n + s.completedRounds, 0),
      mini: list.reduce((n, s) => n + s.totals.rounds, 0),
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
      {/* VIRTUALISED, and it has to be.
          Every season card is a floodlit plate (a gradient, a six-primitive
          chalk Svg, an elevation layer) over a cabinet of nine medals, and each
          medal is its own Svg plus three gradients. A club with twelve sealed
          seasons therefore mounted 228 Svg roots, 336 gradients and ~1,584 SVG
          nodes into a plain ScrollView in one frame, none of which it could
          ever see at once. FlatList mounts the window and nothing else; the
          count-ups are down to the one celebrated poster; and SeasonCard is
          memoised so a pull-to-refresh that returns the same rows re-renders
          nothing. */}
      <FlatList
        data={seasons}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <>
            {failed && seasons.length > 0 ? (
              <Text style={styles.refreshFailed}>
                {he.seasonHistoryRefreshFailed}
              </Text>
            ) : null}
            {seasons.length > 0 ? (
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
                    <CrestNum
                      n={totals.rounds}
                      label={he.seasonStatRoundsShort}
                    />
                    {/* Mini-games exist only in advanced mode, so most clubs
                        have none and are not told a zero about it. */}
                    {totals.mini > 0 ? (
                      <CrestNum n={totals.mini} label={he.seasonStatMiniShort} />
                    ) : null}
                  </View>
                </View>
              </ScreenEntrance>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {failed ? he.seasonHistoryLoadFailed : he.seasonHistoryEmpty}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const keyExtractor = (s: FinishedSeason) => s.seasonId;

function CrestNum({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.crestNum} accessible accessibilityLabel={`${n} ${label}`}>
      <Text style={styles.crestNumValue} maxFontSizeMultiplier={1.4}>
        {n}
      </Text>
      <Text
        style={styles.crestNumLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
      >
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
  // A mark where the season-number chip used to be, so the ribbon still reads
  // as an entry in the column rather than as a loose sentence. It carries no
  // text: the line names its own season.
  ribbonDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#C3CAD6',
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
  slotTier: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    color: '#9AA3B2',
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

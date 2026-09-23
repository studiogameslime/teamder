// "ארון התארים" — nine fixed slots, one season, in the canonical order.
//
// Lifted out of SeasonHistoryScreen on 23.09 when that screen was removed and
// its medal grid moved into the personal season summary, where it replaced a
// plain list of champion rows. It is the same grid: same nine slots, same
// tiers, same empty sockets, same accessibility label.
//
// Nine fixed places EVERY season is the point. It is what makes a column of
// seasons scannable — the same title sits in the same spot — and it is why a
// title nobody won is drawn as an empty socket rather than closing the gap.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SeasonMedal } from '@/components/community/SeasonMedal';
import {
  medalTier,
  titleStreak,
  TIER_NAME,
  type MedalTier,
} from '@/utils/seasonMedalTier';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

/** One awarded title, in the shape both callers already hold. */
export interface CabinetWinner {
  key: SeasonTitleKey;
  names: readonly string[];
  value: number;
  /** How much of the season a RATING was built from. Optional by design. */
  coverage?: { rated: number; of: number };
}

/** A season, as the streak calculation needs it. */
export interface CabinetSeason {
  no: number;
  winners: readonly { key: string; names: readonly string[] }[];
}

export function SeasonTitlesCabinet({
  winners,
  completedRounds,
  history,
  index = -1,
}: {
  /** Every title this season awarded. Missing keys draw an empty socket. */
  winners: readonly CabinetWinner[];
  /** The season's own length — the denominator the medal tier is decided on. */
  completedRounds: number;
  /**
   * Every season of the club, newest first, for the streak badge.
   *
   * Optional: a caller showing ONE season (the personal summary) has no
   * history to compare against and gets no badges, which is right — "×3" with
   * nothing on screen to count is a number the reader cannot check.
   */
  history?: readonly CabinetSeason[];
  index?: number;
}) {
  const byKey = useMemo(() => {
    const m = new Map<string, CabinetWinner>();
    winners.forEach((w) => m.set(w.key, w));
    return m;
  }, [winners]);

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
            const streak =
              w && history && index >= 0 ? titleStreak(history, index, key) : 1;
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
              ? medalTier(key, w.value, completedRounds)
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
                        has closed a season, the מלך העונה medal named none of
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
                    {/* What the rating actually covers, directly beneath it.
                        שחקן העונה is an average, and on this club's only
                        closed season the rating exists for nine of its
                        twenty-two evenings — the accumulator shipped two days
                        before it ended. "ציון 7.7" reads as a whole-season
                        figure and is not one.
                        Under the number rather than in the season's chip row:
                        a chip beside "נתונים חלקיים" would say the season is
                        partial, and its goals, assists, wins and attendance
                        are complete. Absent on every title that carries no
                        coverage, which is all of them until a season is closed
                        under the new rules. */}
                    {w.coverage ? (
                      <Text style={styles.slotCoverage} numberOfLines={3}>
                        {he.seasonTitleCoverage(w.coverage.rated, w.coverage.of)}
                      </Text>
                    ) : null}
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

const styles = StyleSheet.create({
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
  // The coverage note under a rating. Quieter than the value it qualifies and
  // allowed to wrap — it is a sentence, not a figure.
  slotCoverage: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginTop: 2,
    paddingHorizontal: 2,
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
});

// The seasons decision, for a club that does not exist yet.
//
// `SeasonsSettings` is the full article and it does not belong here. Most of
// it is about a club WITH a past: what to do with the history already played,
// whether to seal it as season 1, how to move a finish line a club is already
// standing on, and how to end the season running now. A club being created has
// none of that — no history, no running season, nothing to close — and every
// one of those controls would be a question about something that cannot exist.
//
// So this asks the two things that are real at creation time (owner, 24.09):
//   • are we running seasons at all?
//   • measured in evenings, or in time?
// …and the number for whichever was chosen. That is the whole form.
//
// It writes NOTHING. `GroupFormValues` carries the answer out, the create
// screen turns it into one `enableClubSeasons` call after the club document
// exists, and a failure there leaves the club created and seasons off — which
// is recoverable from the edit screen, unlike a half-made club.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InfoTip } from '@/components/InfoTip';
import { BallSwitch } from '@/components/anim/BallSwitch';
// The SAME chip and stepper the edit screen draws — exported from it rather
// than copied, so the two screens asking one question cannot drift into
// looking like two different settings.
import { Chip, Stepper } from '@/components/community/SeasonsSettings';
import { MIN_SEASON_ROUNDS } from '@/utils/seasonActivation';
import {
  CLUB_TZ,
  formatCalendarDate,
  nextSeasonStart,
  seasonEndDate,
  todayIn,
} from '@/utils/seasonDates';
import type { NewClubSeasonsValue } from '@/utils/newClubSeasons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** Same shortcuts the edit screen offers, so the two do not disagree. */
const MONTH_CHOICES = [3, 6, 12] as const;
const ROUND_CHOICES = [24, 48, 96] as const;

// The value and its default live in `@/utils/newClubSeasons` — data, not UI,
// so the contract the create screen sends can be tested without dragging a
// React Native component into a unit test. Re-exported so callers that already
// import from here keep working.
export {
  NEW_CLUB_SEASONS_DEFAULT,
  newClubSeasonsArgs,
  type NewClubSeasonsValue,
} from '@/utils/newClubSeasons';

export function NewClubSeasons({
  value,
  onChange,
}: {
  value: NewClubSeasonsValue;
  onChange: (v: NewClubSeasonsValue) => void;
}) {
  const set = (patch: Partial<NewClubSeasonsValue>) =>
    onChange({ ...value, ...patch });
  const byRounds = value.cadenceType === 'rounds';

  /**
   * The two dates the choice above just fixed.
   *
   * The edit screen's confirmation sheet has shown these since seasons
   * shipped, and their absence here was reported ("להוסיף הצגה של תאריך סיום
   * של העונה ותאריך התחלה של העונה החדשה כמו שיש בעריכת מועדון"): an admin
   * picking "אחרי 24 חודשים" was choosing a finish line without being told
   * where it lands.
   *
   * Computed exactly the way the activation plan computes them for a club
   * with no history — which is every club on this screen — so the dates shown
   * here and the dates written moments later cannot disagree. Rounds cadence
   * has no date to show; it finishes on a count, not a day.
   */
  const dates = React.useMemo(() => {
    if (!value.enabled || byRounds) return null;
    const endsOn = seasonEndDate(todayIn(CLUB_TZ), value.months);
    return { endsOn, nextStartsOn: nextSeasonStart(endsOn) };
  }, [value.enabled, byRounds, value.months]);

  return (
    <View style={styles.section}>
      {/* The same card the three toggles above this one are drawn as — a
          surface, a radius, the whole row pressable, and the BallSwitch. This
          block used to be a bare row with the platform Switch, so on the
          create screen "עונות" read as a different kind of setting from
          "מועדון פתוח", "דירוג פנימי" and "כרטיסים" sitting directly above it.
          Reported by the owner with the row circled. */}
      <Pressable
        accessible={false}
        style={styles.toggleCard}
        onPress={() => set({ enabled: !value.enabled })}
      >
        <View style={styles.toggleText}>
          <View style={styles.titleRow}>
            <Text style={styles.label}>{he.seasonsToggleLabel}</Text>
            {/* The same explanation the edit screen carries. An admin meeting
                this feature for the first time meets it HERE now. */}
            <InfoTip title={he.seasonsToggleLabel} text={he.seasonsToggleInfo} />
          </View>
          <Text style={styles.hint}>{he.newClubSeasonsHint}</Text>
        </View>
        <BallSwitch
          accessibilityLabel={he.seasonsToggleLabel}
          value={value.enabled}
          onValueChange={(enabled) => set({ enabled })}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      </Pressable>

      {value.enabled ? (
        <>
          <View style={styles.head}>
            <Text style={styles.headText}>{he.seasonsCadenceQuestion}</Text>
            <Ionicons name="flag-outline" size={16} color={colors.primary} />
          </View>
          <View style={styles.chipRow}>
            <Chip
              label={he.seasonsCadenceRounds}
              active={byRounds}
              onPress={() => set({ cadenceType: 'rounds' })}
            />
            <Chip
              label={he.seasonsCadenceDate}
              active={!byRounds}
              onPress={() => set({ cadenceType: 'date' })}
            />
          </View>

          {byRounds ? (
            <>
              <View style={styles.chipRow}>
                {ROUND_CHOICES.map((n) => (
                  <Chip
                    key={n}
                    label={he.seasonsRoundsUnit(n)}
                    active={value.targetRounds === n}
                    onPress={() => set({ targetRounds: n })}
                  />
                ))}
              </View>
              <Stepper
                label={he.seasonsCustomRounds}
                value={value.targetRounds}
                unit={he.seasonsRoundsUnit(value.targetRounds)}
                min={MIN_SEASON_ROUNDS}
                max={200}
                onChange={(targetRounds: number) => set({ targetRounds })}
              />
            </>
          ) : (
            <>
              <View style={styles.chipRow}>
                {MONTH_CHOICES.map((n) => (
                  <Chip
                    key={n}
                    label={he.seasonsMonthsUnit(n)}
                    active={value.months === n}
                    onPress={() => set({ months: n })}
                  />
                ))}
              </View>
              <Stepper
                label={he.seasonsCustomMonths}
                value={value.months}
                unit={he.seasonsMonthsUnit(value.months)}
                min={1}
                max={24}
                onChange={(months: number) => set({ months })}
              />
            </>
          )}

          {dates ? (
            <View style={styles.dates}>
              <DateRow
                label={he.seasonsEndsOnLabel}
                value={formatCalendarDate(dates.endsOn)}
              />
              <DateRow
                label={he.seasonsNextStartsLabel}
                value={formatCalendarDate(dates.nextStartsOn)}
              />
            </View>
          ) : null}

          {/* What happens at the end, said once. There is no "close the season"
              control here and there must not be — the season has not started. */}
          <Text style={styles.hint}>{he.newClubSeasonsWhatHappens}</Text>
        </>
      ) : null}
    </View>
  );
}

/** Label right, value trailing to its left — the confirmation sheet's Row. */
function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dateRow}>
      <Text style={styles.dateLabel}>{label}</Text>
      <Text style={styles.dateValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dates: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  dateRow: {
    // `row` lays children right-to-left under forceRTL, so the label written
    // first lands on the right and the date trails to its left.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  dateValue: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  // Matches GroupWizardForm's `toggleCard` token for token, so the four
  // toggles on that step read as one set.
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  toggleText: { flexShrink: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: {
    ...typography.label,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    lineHeight: 18,
  },
  // Label first, icon second — `row` lays out right-to-left, so a leading
  // icon lands on the RIGHT of its text. Matches the edit screen's heads.
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  headText: {
    ...typography.label,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

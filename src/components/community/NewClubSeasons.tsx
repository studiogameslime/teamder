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
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InfoTip } from '@/components/InfoTip';
// The SAME chip and stepper the edit screen draws — exported from it rather
// than copied, so the two screens asking one question cannot drift into
// looking like two different settings.
import { Chip, Stepper } from '@/components/community/SeasonsSettings';
import { MIN_SEASON_ROUNDS } from '@/utils/seasonActivation';
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

  return (
    <View style={styles.section}>
      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <View style={styles.titleRow}>
            <Text style={styles.label}>{he.seasonsToggleLabel}</Text>
            {/* The same explanation the edit screen carries. An admin meeting
                this feature for the first time meets it HERE now. */}
            <InfoTip title={he.seasonsToggleLabel} text={he.seasonsToggleInfo} />
          </View>
          <Text style={styles.hint}>{he.newClubSeasonsHint}</Text>
        </View>
        <Switch
          value={value.enabled}
          onValueChange={(enabled) => set({ enabled })}
          accessibilityLabel={he.seasonsToggleLabel}
        />
      </View>

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

          {/* What happens at the end, said once. There is no "close the season"
              control here and there must not be — the season has not started. */}
          <Text style={styles.hint}>{he.newClubSeasonsWhatHappens}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleText: { flex: 1, minWidth: 0 },
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

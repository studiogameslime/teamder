// What switching seasons on will do, spelled out before it happens.
//
// This is the last screen before an irreversible change to a club's whole
// history: everything it has ever played becomes the season being opened, and
// depending on one chip above, that season either carries on or is sealed on
// the spot with its champions handed out permanently. Which season that is
// arrives as a prop — it is 1 only for a club that has never closed one.
//
// Every line is derived from the SAME `ActivationPlan` the settings screen
// validated and the server recomputes before acting. Nothing here is written
// prose about what usually happens — if the plan says 18/24 with six to go,
// that is because those are the numbers that will be written.

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { formatCalendarDate } from '@/utils/seasonDates';
import type { ActivationPlan, Cadence } from '@/utils/seasonActivation';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      {/* Label first → rightmost under forceRTL, value trailing to its left. */}
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function SeasonConfirmSheet({
  visible,
  plan,
  cadence,
  months,
  rounds,
  seasonNo,
  busy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  plan: ActivationPlan;
  cadence: Cadence;
  months: number;
  rounds: number;
  /**
   * The season this activation opens — and NOT 1.
   *
   * Every season line below was hardcoded to "עונה 1" and "עונה 2", while the
   * numbering continues across the feature being switched off and on again. A
   * club that had already played three seasons and switched them back on read
   * "עונה 1 תסתיים ועונה 2 תתחיל" on the last screen before its table was
   * archived and reset — a plan for two seasons it finished months ago.
   */
  seasonNo: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasHistory = plan.playedHistory > 0;
  // The season being sealed or carried on, and the one that follows it. Both
  // read off the same number so they can never name different pairs.
  const no = seasonNo;
  const nextNo = seasonNo + 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{he.seasonsConfirmTitle}</Text>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyInner}
          >
            <Row
              label={he.seasonsConfirmMethod}
              value={
                cadence === 'date'
                  ? he.seasonsConfirmMethodDate
                  : he.seasonsConfirmMethodRounds
              }
            />
            {/* "משך עונה" is a lie when season 1 is being carried: its end is
                the date two rows down, and this number only starts applying at
                season 2. Reported with the row circled — "6 חודשים" printed
                directly above "עונה 1 תסתיים 25.09.2028". */}
            <Row
              label={
                cadence === 'date' && !plan.sealsSeason1 && hasHistory
                  ? he.seasonsConfirmFromSeason2
                  : he.seasonsLengthLabel
              }
              value={
                cadence === 'date'
                  ? he.seasonsMonthsUnit(months)
                  : he.seasonsRoundsUnit(rounds)
              }
            />

            {hasHistory ? (
              <>
                <Row
                  label={he.seasonsConfirmExisting}
                  value={String(plan.playedHistory)}
                />
                <Row
                  label={he.seasonsConfirmHistory}
                  value={he.seasonsConfirmHistoryValueOf(no)}
                />
                <Row
                  label={he.seasonsConfirmChoice}
                  value={
                    plan.sealsSeason1
                      ? he.seasonsConfirmChoiceSealOf(no)
                      : he.seasonsConfirmChoiceContinueOf(no)
                  }
                />
              </>
            ) : null}

            {/* ── rounds ── */}
            {cadence === 'rounds' && !plan.sealsSeason1 ? (
              <>
                <Row
                  label={he.seasonsConfirmSeasonStateLabelOf(no)}
                  value={he.seasonsConfirmSeason1State(
                    plan.startsAtRounds ?? 0,
                    plan.targetRounds ?? rounds,
                  )}
                />
                <Row
                  label={he.seasonsConfirmRemaining}
                  value={he.seasonsConfirmRemainingValue(
                    plan.roundsRemaining ?? 0,
                  )}
                />
                <Text style={styles.note}>
                  {he.seasonsConfirmAfterTargetOf(
                    plan.targetRounds ?? rounds,
                    no,
                    nextNo,
                  )}
                </Text>
              </>
            ) : null}

            {cadence === 'rounds' && plan.sealsSeason1 ? (
              <>
                {hasHistory ? (
                  <Row
                    label={he.seasonNumberLabel(no)}
                    value={he.seasonsConfirmSealedNow(plan.playedHistory)}
                  />
                ) : null}
                <Row
                  label={he.seasonNumberLabel(nextNo)}
                  value={he.seasonsConfirmSeason1State(
                    0,
                    plan.targetRounds ?? rounds,
                  )}
                />
                <Row
                  label={he.seasonsConfirmNextRound}
                  value={he.seasonsConfirmNextRoundValueOf(
                    plan.targetRounds ?? rounds,
                    nextNo,
                  )}
                />
              </>
            ) : null}

            {/* ── dates ── */}
            {cadence === 'date' && plan.startsOn ? (
              <Row
                label={he.seasonsStartsOnLabel}
                value={formatCalendarDate(plan.startsOn)}
              />
            ) : null}
            {cadence === 'date' && plan.endsOn ? (
              <Row
                label={
                  plan.sealsSeason1
                    ? he.seasonsEndsOnLabel
                    : he.seasonsEndsLabel(no)
                }
                value={formatCalendarDate(plan.endsOn)}
              />
            ) : null}
            {cadence === 'date' && plan.nextStartsOn ? (
              <Row
                label={
                  plan.sealsSeason1
                    ? he.seasonsNextStartsLabel
                    : he.seasonsStartsLabel(nextNo)
                }
                value={formatCalendarDate(plan.nextStartsOn)}
              />
            ) : null}
            {cadence === 'date' && !plan.sealsSeason1 && hasHistory ? (
              <Row
                label={he.seasonsConfirmFromSeasonOn(nextNo)}
                value={he.seasonsMonthsUnit(months)}
              />
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Button
              title={he.seasonsConfirmCta}
              fullWidth
              disabled={busy || !plan.ok}
              onPress={onConfirm}
            />
            <Button
              title={he.cancel}
              variant="outline"
              fullWidth
              disabled={busy}
              onPress={onCancel}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...typography.h3, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  body: { flexGrow: 0 },
  bodyInner: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    // `flex: 1` means flexBasis 0, so the label got only what the value left
    // over — and the value, being the bold half, took nearly all of it. On the
    // sheet a club approves before an irreversible change, the Hebrew labels
    // collapsed to about twenty pixels and stacked one character per line.
    // Both halves share, and the label keeps enough to read.
    flexShrink: 1,
    flexGrow: 1,
    flexBasis: 'auto',
    textAlign: RTL_LABEL_ALIGN,
  },
  value: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flexShrink: 0,
    textAlign: RTL_LABEL_ALIGN,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 18,
    paddingTop: spacing.xs,
  },
  actions: { gap: spacing.sm },
});

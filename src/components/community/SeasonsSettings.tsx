// Seasons, in the club's settings, where a setting belongs.
//
// This started as a chain of alert dialogs, which was the quick path and not
// the right one: it asked a question, replaced it with another question, and
// gave the admin nowhere to look at their own choices together. A toggle that
// opens its options — and closes them again — is the shape people already know
// from every other switch on this screen.
//
// The reason it was NOT a plain form field still holds, and it is why there is
// a separate confirm button rather than a save that rides along with the rest
// of the club's settings: none of these are document writes. Switching seasons
// on can seal the club's whole history as season 1, and ending one archives and
// zeroes every stat row in the club. Those belong to the server and deserve
// their own deliberate press.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { SeasonConfirmSheet } from '@/components/community/SeasonConfirmSheet';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import {
  seasonService,
  seasonRefusalText,
  SeasonRefusedError,
} from '@/services/seasonService';
import { gameService } from '@/services/gameService';
import {
  todayIn,
  seasonEndDate,
  nextSeasonStart,
  formatCalendarDate,
  isCalendarDate,
  isValidSeasonMonths,
  MIN_SEASON_MONTHS,
  MAX_SEASON_MONTHS,
  type CalendarDate,
} from '@/utils/seasonDates';
import {
  planActivation,
  isValidSeasonRounds,
  MIN_SEASON_ROUNDS,
  type ActivationPlan,
} from '@/utils/seasonActivation';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GroupSeasons } from '@/types';

type Cadence = 'date' | 'rounds';

/** Deliberately few. A club picking a season length should not be designing one. */
const MONTH_CHOICES = [3, 6, 12] as const;
/** Shortcuts for how long season 1 runs when it is carrying a club's whole
 *  history. Shorter than MONTH_CHOICES on purpose: this season already
 *  holds everything played so far, so its remaining stretch is usually the
 *  short one. Anything else is the custom stepper beside them. */
const SEASON1_MONTH_CHOICES = [1, 2, 3, 6] as const;
const ROUND_CHOICES = [24, 48, 96] as const;
/** The step for the custom pickers. One at a time for months (there are only
 *  24 of them); rounds move in fours, because a club setting 37 is really
 *  setting "about three dozen". Long-press is not a gesture this app uses. */
const ROUND_STEP = 4;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * A count, chosen by tapping rather than typing.
 *
 * The ranges here are small and the value is always a whole number, so a
 * keyboard over a settings sheet would be a heavier gesture than the choice
 * deserves. Bounds are enforced here rather than announced: a button that
 * cannot take you out of range never has to tell you that you went.
 */
function Stepper({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) =>
    Math.max(min, Math.min(typeof max === 'number' ? max : n, n));
  const canDown = value > min;
  const canUp = typeof max !== 'number' || value < max;
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      {/* Minus first in source order → RIGHTMOST under forceRTL, which is
          where the thumb rests and where "less" belongs in a right-to-left
          row. */}
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => canDown && onChange(clamp(value - step))}
          disabled={!canDown}
          style={[styles.stepperBtn, !canDown && styles.stepperBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="-"
        >
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{unit}</Text>
        <Pressable
          onPress={() => canUp && onChange(clamp(value + step))}
          disabled={!canUp}
          style={[styles.stepperBtn, !canUp && styles.stepperBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="+"
        >
          <Text style={styles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** One "label / value" line. Used for the dates under the chips and for every
 *  row of the confirmation, so the two read as the same object. */
function DateLine({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.dateLine}>
      <Text style={styles.dateLineLabel}>{label}</Text>
      <Text style={[styles.dateLineValue, muted && styles.dateLineValueMuted]}>
        {value}
      </Text>
    </View>
  );
}

/** The refusal, in the admin's own numbers. Every message names the figure
 *  that caused it, because "not allowed" is not something anyone can act on. */
function planErrorText(plan: ActivationPlan, target: number): string {
  switch (plan.error) {
    case 'historyExceedsTarget':
      return he.seasonsErrHistoryExceeds(plan.playedHistory, target);
    case 'historyFillsTarget':
      return he.seasonsErrHistoryFills(plan.playedHistory);
    case 'monthsInvalid':
      return he.seasonsErrMonths;
    case 'roundsInvalid':
      return he.seasonsErrRounds;
    case 'season1EndRequired':
      return he.seasonsErrSeason1End;
    case 'season1EndNotFuture':
      return he.seasonsErrSeason1Past;
    default:
      return he.error;
  }
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function SeasonsSettings({
  groupId,
  seasons,
  onChanged,
}: {
  groupId: string;
  seasons?: GroupSeasons;
  onChanged?: () => void;
}) {
  const live = seasons?.enabled === true;
  const [busy, setBusy] = useState(false);
  // What the toggle SHOWS, which is not the same as what the club has: a club
  // with seasons off shows the options the moment the switch flips, and nothing
  // is written until the admin presses the button below them.
  const [open, setOpen] = useState(live);
  // Seeded from the club's REAL target, not from a default.
  //
  // These chips are the only place an admin sees what the season is set to, and
  // they double as the editor. Starting them at 6 months / 24 rounds told a
  // club running a twelve-month season that it was running a six-month one —
  // and then "עדכן את יעד העונה" wrote that fiction back, silently moving the
  // finish line the admin never touched.
  const [cadence, setCadence] = useState<Cadence>(
    seasons?.cadence?.type === 'rounds' ? 'rounds' : 'date',
  );
  // Seeded from the club's target whenever it is VALID, not only when it
  // happens to be one of the chips.
  //
  // These fell back to 6 / 24 for anything else, so a club on a custom length
  // opened the screen showing a preset it had never chosen — and "עדכן את יעד
  // העונה" then wrote that preset back, moving a finish line the admin came
  // only to look at. Reported as settings that do not keep what was set.
  const [months, setMonths] = useState<number>(() =>
    isValidSeasonMonths(seasons?.cadence?.months)
      ? (seasons?.cadence?.months as number)
      : 6,
  );
  const [rounds, setRounds] = useState<number>(() =>
    isValidSeasonRounds(seasons?.cadence?.targetRounds)
      ? (seasons?.cadence?.targetRounds as number)
      : 24,
  );
  /** Only asked on the FIRST enable — after that there is no loose history. */
  const [sealHistory, setSealHistory] = useState(false);
  /** Custom lengths sit beside the presets rather than replacing them. */
  // …and the custom stepper opens already open when the stored value is one.
  // Otherwise a custom target rendered with no chip selected and no stepper,
  // which looks like a screen that failed to load its own setting.
  const [customMonths, setCustomMonths] = useState(
    () =>
      seasons?.cadence?.type === 'date' &&
      isValidSeasonMonths(seasons.cadence.months) &&
      !MONTH_CHOICES.includes(seasons.cadence.months as never),
  );
  const [customRounds, setCustomRounds] = useState(
    () =>
      seasons?.cadence?.type === 'rounds' &&
      isValidSeasonRounds(seasons.cadence.targetRounds) &&
      !ROUND_CHOICES.includes(seasons.cadence.targetRounds as never),
  );
  /** The last day of season 1, when carrying it on under a date cadence.
   *  There is no honest start date to compute for it — the history reaches
   *  back as far as the club does — so the admin names its end instead. */
  const [season1EndsOn, setSeason1EndsOn] = useState<CalendarDate | null>(null);
  /** The same presets-plus-custom shape as the season length above, because it
   *  is the same question asked about a different season — "1, 2, 3 or 6
   *  months" are shortcuts, not the whole range an admin may want. */
  const [season1Custom, setSeason1Custom] = useState(false);
  const [season1Months, setSeason1Months] = useState(3);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Evenings the club has already played. Asked for once, when the options
   *  open, because every validation and every line of the confirmation is
   *  measured against it. */
  const [history, setHistory] = useState<number | null>(null);


  const firstTime = (seasons?.count ?? 0) === 0 && !live;

  useEffect(() => {
    if (!open || !firstTime) return;
    let alive = true;
    void gameService
      .getCommunityStats(groupId)
      .then((st) => {
        if (alive) setHistory(st?.totalFinished ?? 0);
      })
      .catch(() => {
        if (alive) setHistory(0);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupId]);
  /** Does the club's current target correspond to one of the chips below? */
  const offeredTarget =
    seasons?.cadence?.type === 'rounds'
      ? ROUND_CHOICES.includes(seasons.cadence.targetRounds as never)
      : MONTH_CHOICES.includes(seasons?.cadence?.months as never);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      try {
        await action();
        onChanged?.();
      } catch (err) {
        // A refusal is an answer the admin can act on ("finish tonight's game
        // first"), not a failure. Only a real one gets the generic line.
        appAlert(
          he.error,
          err instanceof SeasonRefusedError
            ? seasonRefusalText(err.reason)
            : he.seasonActionFailed,
        );
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  /** Has the admin actually moved the target away from the club's own? */
  const targetChanged = useMemo(() => {
    if (!live) return true;
    const c = seasons?.cadence;
    if (cadence === 'rounds') {
      return c?.type !== 'rounds' || c.targetRounds !== rounds;
    }
    return c?.type !== 'date' || c.months !== months;
  }, [live, seasons?.cadence, cadence, months, rounds]);

  /**
   * What pressing the button will do — recomputed on every keystroke.
   *
   * ONE plan drives the dates under the chips, the red validation line, whether
   * the button is enabled, and every figure in the confirmation. They cannot
   * drift apart, because there is nothing to drift: the sheet an admin approves
   * is this object, and the server recomputes the same one before acting.
   */
  const today = useMemo(() => todayIn(), []);
  const plan = useMemo(
    () =>
      planActivation({
        cadence,
        months,
        targetRounds: rounds,
        choice: sealHistory ? 'sealNow' : 'continue',
        playedHistory: history ?? 0,
        today,
        season1EndsOn: season1EndsOn ?? undefined,
      }),
    [cadence, months, rounds, sealHistory, history, today, season1EndsOn],
  );

  /** The dates shown under the length chips, for a club with no history to
   *  argue about — a plain "this season runs from here to here". */
  const previewDates = useMemo(() => {
    if (cadence !== 'date' || !isValidSeasonMonths(months)) return null;
    const endsOn = seasonEndDate(today, months);
    return { startsOn: today, endsOn, nextStartsOn: nextSeasonStart(endsOn) };
  }, [cadence, months, today]);

  const targetArgs = useMemo(
    () =>
      cadence === 'rounds'
        ? { cadenceType: 'rounds' as const, targetRounds: rounds }
        : { cadenceType: 'date' as const, months },
    [cadence, months, rounds],
  );

  const onToggle = useCallback(
    (next: boolean) => {
      if (next) {
        setOpen(true);
        return;
      }
      if (!live) {
        // Nothing was ever written — just fold the options away.
        setOpen(false);
        return;
      }
      appAlert(he.seasonsDisableTitle, he.seasonsDisableBody, [
        {
          text: he.seasonsDisableConfirm,
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await seasonService.disable(groupId);
              logEvent(AnalyticsEvent.SeasonsDisabled, { groupId });
              setOpen(false);
              toast.success(he.seasonsDisabledToast);
            }),
        },
        { text: he.cancel, style: 'cancel' },
      ]);
    },
    [live, groupId, run],
  );

  const enable = useCallback(() => {
    const go = () =>
      run(async () => {
        await seasonService.enable({
          groupId,
          ...targetArgs,
          historyChoice: sealHistory ? 'sealNow' : 'continue',
          ...(sealHistory ? { closeFirstNow: true } : {}),
          ...(season1EndsOn ? { season1EndsOn } : {}),
        });
        // `sealedHistory` is the question the feature actually turns on: how
        // many clubs were willing to close two years to start clean.
        logEvent(AnalyticsEvent.SeasonsEnabled, {
          groupId,
          cadence,
          target: cadence === 'rounds' ? rounds : months,
          sealedHistory: sealHistory,
        });
        toast.success(he.seasonsEnabledToast);
      });
    go();
  }, [groupId, targetArgs, sealHistory, season1EndsOn, run]);

  const saveTarget = useCallback(() => {
    run(async () => {
      await seasonService.updateTarget({ groupId, ...targetArgs });
      logEvent(AnalyticsEvent.SeasonTargetChanged, {
        groupId,
        cadence,
        target: cadence === 'rounds' ? rounds : months,
      });
      toast.success(he.seasonsTargetSavedToast);
    });
  }, [groupId, targetArgs, run]);

  const reopenLast = useCallback(() => {
    appAlert(he.seasonsReopenConfirmTitle, he.seasonsReopenConfirmBody, [
      {
        text: he.seasonsReopenConfirmCta,
        style: 'destructive',
        onPress: () =>
          run(async () => {
            const res = await seasonService.reopenLast(groupId);
            logEvent(AnalyticsEvent.SeasonReopened, {
              groupId,
              seasonNo: res.reopenedNo,
            });
            toast.success(he.seasonsReopenedToast(res.reopenedNo));
          }),
      },
      { text: he.cancel, style: 'cancel' },
    ]);
  }, [groupId, run]);

  const endNow = useCallback(() => {
    appAlert(he.seasonsEndConfirmTitle, he.seasonsEndConfirmBody, [
      {
        text: he.seasonsEndCta,
        style: 'destructive',
        onPress: () =>
          run(async () => {
            const res = await seasonService.endNow(groupId);
            logEvent(AnalyticsEvent.SeasonEndedEarly, {
              groupId,
              seasonNo: res.closedNo,
            });
            toast.success(he.seasonsEndedToast(res.closedNo));
          }),
      },
      { text: he.cancel, style: 'cancel' },
    ]);
  }, [groupId, run]);

  const currentTargetLine =
    seasons?.cadence?.type === 'rounds' &&
    typeof seasons.cadence.targetRounds === 'number'
      ? he.seasonsTargetRounds(seasons.cadence.targetRounds)
      : isCalendarDate(seasons?.cadence?.endsOn)
        ? he.seasonsTargetDate(
            formatCalendarDate(seasons!.cadence!.endsOn as string),
          )
        : typeof seasons?.cadence?.endsAt === 'number'
        ? he.seasonsTargetDate(formatDate(seasons.cadence.endsAt))
        : '';

  return (
    <View style={styles.section}>
      <Pressable
        style={styles.toggleRow}
        onPress={() => onToggle(!open)}
        accessibilityRole="switch"
        accessibilityState={{ checked: open }}
      >
        <View style={styles.toggleText}>
          <Text style={styles.toggleLabel}>{he.seasonsToggleLabel}</Text>
          <Text style={styles.toggleHint}>{he.seasonsToggleHint}</Text>
        </View>
        <BallSwitch
          value={open}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      </Pressable>

      {!open ? null : (
        <View style={styles.body}>
          {live ? (
            <Text style={styles.running}>
              {he.seasonNumberLabel(seasons?.currentNo ?? 1)}
              {currentTargetLine ? ` · ${currentTargetLine}` : ''}
            </Text>
          ) : (
            // The one paragraph that says plainly what a season does to a club
            // — the table resets, titles are handed out, the season is
            // archived — was written and rendered nowhere. An admin met the
            // feature as a nine-word toggle hint and a list of durations.
            <Text style={styles.fieldHint}>{he.seasonsOffBody}</Text>
          )}

          <Text style={styles.fieldLabel}>{he.seasonsCadenceQuestion}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={he.seasonsCadenceDate}
              active={cadence === 'date'}
              onPress={() => setCadence('date')}
            />
            <Chip
              label={he.seasonsCadenceRounds}
              active={cadence === 'rounds'}
              onPress={() => setCadence('rounds')}
            />
          </View>

          <Text style={styles.fieldLabel}>
            {cadence === 'date' ? he.seasonsHowLong : he.seasonsHowMany}
          </Text>
          {/* A club can hold a target that is not one of the chips — an older
              season, or one set before these choices existed. Say so rather
              than showing an unselected row that looks broken. */}
          {live && !offeredTarget ? (
            <Text style={styles.fieldHint}>{he.seasonsTargetCustom}</Text>
          ) : null}
          <View style={styles.chipRow}>
            {cadence === 'date' ? (
              <>
                {MONTH_CHOICES.map((m) => (
                  <Chip
                    key={m}
                    label={he.seasonsMonthsLabel(m)}
                    active={!customMonths && months === m}
                    onPress={() => {
                      setCustomMonths(false);
                      setMonths(m);
                    }}
                  />
                ))}
                <Chip
                  label={he.seasonsCustom}
                  active={customMonths}
                  onPress={() => setCustomMonths(true)}
                />
              </>
            ) : (
              <>
                {ROUND_CHOICES.map((r) => (
                  <Chip
                    key={r}
                    label={he.seasonsRoundsLabel(r)}
                    active={!customRounds && rounds === r}
                    onPress={() => {
                      setCustomRounds(false);
                      setRounds(r);
                    }}
                  />
                ))}
                <Chip
                  label={he.seasonsCustom}
                  active={customRounds}
                  onPress={() => setCustomRounds(true)}
                />
              </>
            )}
          </View>

          {/* The custom pickers. A stepper rather than a text field: the range
              is small, the value is a count, and a keyboard over a settings
              sheet is a heavier gesture than this deserves. */}
          {cadence === 'date' && customMonths ? (
            <Stepper
              label={he.seasonsCustomMonths}
              value={months}
              unit={he.seasonsMonthsUnit(months)}
              min={MIN_SEASON_MONTHS}
              max={MAX_SEASON_MONTHS}
              onChange={setMonths}
            />
          ) : null}
          {cadence === 'rounds' && customRounds ? (
            <Stepper
              label={he.seasonsCustomRounds}
              value={rounds}
              unit={he.seasonsRoundsUnit(rounds)}
              min={MIN_SEASON_ROUNDS}
              step={ROUND_STEP}
              onChange={setRounds}
            />
          ) : null}

          {/* The dates, live. They answer "what am I actually choosing?" while
              the admin is still choosing, which is the whole point of showing
              them here rather than in the confirmation alone. */}
          {previewDates && !(firstTime && !sealHistory) ? (
            <View style={styles.dateBox}>
              <DateLine
                label={he.seasonsStartsOnLabel}
                value={formatCalendarDate(previewDates.startsOn)}
              />
              <DateLine
                label={he.seasonsEndsOnLabel}
                value={formatCalendarDate(previewDates.endsOn)}
              />
              <DateLine
                label={he.seasonsNextStartsLabel}
                value={formatCalendarDate(previewDates.nextStartsOn)}
                muted
              />
            </View>
          ) : null}

          {firstTime ? (
            <>
              <Text style={styles.fieldLabel}>{he.seasonsCloseFirstTitle}</Text>
              <Text style={styles.fieldHint}>{he.seasonsCloseFirstBody}</Text>
              <View style={styles.chipRow}>
                <Chip
                  label={he.seasonsCloseFirstKeep}
                  active={!sealHistory}
                  onPress={() => setSealHistory(false)}
                />
                <Chip
                  label={he.seasonsCloseFirstSeal}
                  active={sealHistory}
                  onPress={() => setSealHistory(true)}
                />
              </View>

              {/* Carrying season 1 on under a date cadence: it holds the whole
                  history, so there is no start date to compute — only an end
                  the admin names. */}
              {cadence === 'date' && !sealHistory ? (
                <>
                  <Text style={styles.fieldLabel}>{he.seasonsSeason1EndLabel}</Text>
                  <Text style={styles.fieldHint}>{he.seasonsSeason1EndHint}</Text>
                  <View style={styles.chipRow}>
                    {SEASON1_MONTH_CHOICES.map((m) => {
                      const d = seasonEndDate(today, m);
                      return (
                        <Chip
                          key={m}
                          label={formatCalendarDate(d)}
                          active={!season1Custom && season1EndsOn === d}
                          onPress={() => {
                            setSeason1Custom(false);
                            setSeason1Months(m);
                            setSeason1EndsOn(d);
                          }}
                        />
                      );
                    })}
                    <Chip
                      label={he.seasonsCustom}
                      active={season1Custom}
                      onPress={() => {
                        setSeason1Custom(true);
                        setSeason1EndsOn(seasonEndDate(today, season1Months));
                      }}
                    />
                  </View>
                  {season1Custom ? (
                    <Stepper
                      label={he.seasonsCustomMonths}
                      value={season1Months}
                      unit={he.seasonsMonthsUnit(season1Months)}
                      min={MIN_SEASON_MONTHS}
                      max={MAX_SEASON_MONTHS}
                      onChange={(m) => {
                        setSeason1Months(m);
                        // The chips ARE dates, so the stepper has to be one
                        // too — otherwise the admin moves a number and the
                        // date they are actually choosing never changes.
                        setSeason1EndsOn(seasonEndDate(today, m));
                      }}
                    />
                  ) : null}
                </>
              ) : null}

              {/* What the plan says will happen, in the admin's own numbers. */}
              {plan.ok && plan.nextStartsOn ? (
                <View style={styles.dateBox}>
                  {plan.endsOn ? (
                    <DateLine
                      label={he.seasonsConfirmSeason1Ends}
                      value={formatCalendarDate(plan.endsOn)}
                    />
                  ) : null}
                  <DateLine
                    label={he.seasonsConfirmSeason2Starts}
                    value={formatCalendarDate(plan.nextStartsOn)}
                    muted
                  />
                </View>
              ) : null}
            </>
          ) : null}

          {/* The refusal, in red, beside the thing that caused it. */}
          {firstTime && !plan.ok && history !== null ? (
            <Text style={styles.errorLine}>{planErrorText(plan, rounds)}</Text>
          ) : null}

          {/* An inactive button that says nothing reads as broken. This one is
              off on entry by design — the chips already show the club's own
              target — so it says so rather than sitting dead. */}
          {live && !targetChanged ? (
            <Text style={styles.fieldHint}>{he.seasonsTargetUnchanged}</Text>
          ) : null}

          {/* Its own press, not the screen's Save: none of this is a document
              write, and enabling can seal the club's whole history. */}
          <Button
            title={live ? he.seasonsSaveTargetCta : he.seasonsEnableCta}
            variant="outline"
            fullWidth
            // Nothing to save when the chips still show what the club holds.
            // A live "update" button on an unchanged target invites an admin
            // to move a finish line they only came to look at.
            //
            // And never while the plan is refused: the red line above says why,
            // and a button that submits anyway would make it decorative.
            disabled={
              busy ||
              (live && !targetChanged) ||
              (firstTime && (history === null || !plan.ok))
            }
            // Enabling never acts on the press. It opens a sheet that spells
            // out, in this club's own numbers, exactly what is about to happen
            // to its history — and only the button in there does anything.
            onPress={live ? saveTarget : () => setConfirmOpen(true)}
          />

          {/* This block is not saved by the screen's שמור, and it sits among
              six toggles that are. Said out loud, because an admin who flips
              the switch, presses Save and walks away would otherwise believe
              they had turned seasons on. */}
          <Text style={styles.fieldHint}>{he.seasonsNotPartOfSave}</Text>

          {live ? (
            <Button
              title={he.seasonsEndCta}
              variant="danger"
              fullWidth
              disabled={busy}
              onPress={endNow}
            />
          ) : null}
          {/* The way back from "I pressed it a week early". Offered only when
              there is actually a closed season to reopen. */}
          {(seasons?.count ?? 0) > 0 ? (
            <Button
              title={he.seasonsReopenCta}
              variant="outline"
              fullWidth
              disabled={busy}
              onPress={reopenLast}
            />
          ) : null}
        </View>
      )}

      {/* What is about to happen, in this club's own numbers.
          Built from the SAME plan the screen above validated and the server
          recomputes — so the summary a person approves is not a description of
          the action, it IS the action. */}
      <SeasonConfirmSheet
        visible={confirmOpen}
        plan={plan}
        cadence={cadence}
        months={months}
        rounds={rounds}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          enable();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  // Label first in source order: under forceRTL the first child renders
  // rightmost, which puts the text on the right and the switch on the left,
  // matching every other toggle on this screen.
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  body: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  running: {
    ...typography.caption,
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.xs,
  },
  fieldHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stepper: { gap: spacing.xs, paddingVertical: spacing.xs },
  stepperLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperBtnOff: { opacity: 0.35 },
  stepperBtnText: { ...typography.h3, color: colors.text },
  stepperValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    minWidth: 96,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  dateBox: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Label first → rightmost under forceRTL, value trailing to its left.
  dateLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  dateLineLabel: { ...typography.caption, color: colors.textMuted, flex: 1, textAlign: RTL_LABEL_ALIGN },
  dateLineValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dateLineValueMuted: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  errorLine: {
    ...typography.caption,
    color: colors.danger,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 18,
  },
  chip: {
    paddingHorizontal: spacing.md,
    // A settings control has to be a thumb's worth of target.
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextActive: { color: colors.surface, fontWeight: '700' },
});

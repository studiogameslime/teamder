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
  seasonHistoryService,
  type FinishedSeason,
} from '@/services/seasonHistoryService';
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
import { Ionicons } from '@expo/vector-icons';

import { InfoTip } from '@/components/InfoTip';
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
/** The step for the custom pickers. One at a time, for both.
 *
 *  Rounds used to move in fours, on the reasoning that a club setting 37 is
 *  really setting "about three dozen". The trouble is that a step of four from
 *  a chip divisible by four, against a floor of 2, is a lattice and not a
 *  range: 5, 7, 9 and 11 could not be reached at all, 37 could not be reached
 *  from 24, and 6 and 10 could only be reached by walking all the way down to
 *  2 and back up. A picker that cannot reach a number is worse than one that
 *  takes an extra tap to get there, and the long journeys are what the 24 / 48
 *  / 96 chips beside it are for. */
const ROUND_STEP = 1;

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
 *  that caused it, because "not allowed" is not something anyone can act on.
 *
 *  And the season it is really about. Every one of these was written against
 *  "עונה 1", while numbering continues across the feature being switched off
 *  and on — so the line that blocks a re-enable on season 4 told the admin to
 *  pick an end date for season 1, a season the club archived months ago. */
function planErrorText(
  plan: ActivationPlan,
  target: number,
  no: number,
): string {
  switch (plan.error) {
    case 'historyExceedsTarget':
      return he.seasonsErrHistoryExceedsOf(plan.playedHistory, target, no);
    case 'historyFillsTarget':
      return he.seasonsErrHistoryFillsOf(plan.playedHistory, no, no + 1);
    case 'monthsInvalid':
      return he.seasonsErrMonths;
    case 'roundsInvalid':
      return he.seasonsErrRounds;
    case 'season1EndRequired':
      return he.seasonsErrSeasonEndOf(no);
    case 'season1EndNotFuture':
      return he.seasonsErrSeasonPastOf(no);
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
   *  measured against it. `null` means "not answered yet", never "none". */
  const [history, setHistory] = useState<number | null>(null);
  /**
   * The read failed, as opposed to answering zero.
   *
   * A failed or denied read used to be recorded as "0 evenings played", and
   * zero is a CLAIM: it tells the confirmation sheet the club has never played,
   * so every line about its history disappears from the last page the admin
   * approves — while the server goes on to count the real 22 and seal all of
   * them. The two states have to be different things.
   */
  const [historyFailed, setHistoryFailed] = useState(false);
  /** Bumped by the retry button, to ask again. */
  const [historyAttempt, setHistoryAttempt] = useState(0);


  const firstTime = (seasons?.count ?? 0) === 0 && !live;
  /** The season this action is about. Numbering CONTINUES across the feature
   *  being switched off and on, so it is never simply 1 — and every label on
   *  this screen used to say so. */
  const thisSeasonNo = live
    ? (seasons?.currentNo ?? 1)
    : (seasons?.count ?? 0) + 1;

  useEffect(() => {
    if (!open) return;
    setHistoryFailed(false);
    // A club that has closed a season before carries NO loose history: those
    // evenings are sealed inside an archive, and the season about to open
    // starts at zero. Asking the server for the figure would get the same
    // answer it now gives itself — see the playedHistory comment in
    // enableClubSeasons — and a non-null value here is what lets the plan be
    // computed and its refusal explained at all.
    //
    // A LIVE club is the other half of that sentence, and it was getting the
    // same zero. Its running season holds evenings, and the target being
    // edited on this screen is measured against exactly them — by the server,
    // which refuses a target at or under the count. Pinning zero made
    // historyExceedsTarget and historyFillsTarget dead code on the whole
    // target-change path, so a club 22 evenings into a season could pick 12,
    // press the button, and learn the rule only as a refusal. This is the same
    // figure the card shows and the same one the server measures against.
    if (!firstTime) {
      setHistory(live ? Math.max(0, seasons?.playedRounds ?? 0) : 0);
      return;
    }
    let alive = true;
    void gameService
      .getCommunityStats(groupId)
      .then((st) => {
        if (!alive) return;
        const played = st?.totalFinished;
        if (typeof played === 'number' && Number.isFinite(played)) {
          setHistory(Math.max(0, played));
          return;
        }
        setHistory(null);
        setHistoryFailed(true);
      })
      .catch(() => {
        // NOT zero. See historyFailed: zero would tell the sheet this club has
        // no history, one press before the server seals the history it has.
        if (!alive) return;
        setHistory(null);
        setHistoryFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open, groupId, firstTime, live, seasons?.playedRounds, historyAttempt]);
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
        //
        // The season number and the numbers the plan refusals are written
        // about travel with it: the server throws `season-plan:historyFills`
        // and nothing else, and "עונה 1" is wrong for every club that has
        // closed one.
        appAlert(
          he.error,
          err instanceof SeasonRefusedError
            ? seasonRefusalText(err.reason, {
                seasonNo: thisSeasonNo,
                played: err.played ?? history ?? undefined,
                target: rounds,
              })
            : he.seasonActionFailed,
        );
      } finally {
        setBusy(false);
      }
    },
    [onChanged, thisSeasonNo, history, rounds],
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
        // No season 1 to date when the club has already run one — and no
        // control on screen that could pick a date for it.
        hasHistory: !firstTime,
        // A running season has no "לסגור ולהתחיל מאפס" chip to point at, so a
        // target equal to what it has played is the admin saying it ends here
        // — allowed, and announced below rather than refused. On a first
        // activation that chip is right there, so the refusal stays.
        equalTargetCloses: live,
      }),
    [
      cadence,
      months,
      rounds,
      sealHistory,
      history,
      today,
      season1EndsOn,
      firstTime,
      live,
    ],
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
      // Named season + evening count, same as the end-now dialog. Since §9
      // this button closes the season, so it is the last thing an admin reads
      // before nine titles are handed out for good.
      const playedNow = Math.max(0, seasons?.playedRounds ?? 0);
      appAlert(
        he.seasonsDisableTitle,
        he.seasonsDisableBodyOf(thisSeasonNo, playedNow),
        [
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
        ],
      );
    },
    [live, groupId, run, seasons?.playedRounds, thisSeasonNo],
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
    const go = () =>
      run(async () => {
        await seasonService.updateTarget({ groupId, ...targetArgs });
        logEvent(AnalyticsEvent.SeasonTargetChanged, {
          groupId,
          cadence,
          target: cadence === 'rounds' ? rounds : months,
          // Whether this press moved a finish line or crossed it. The server
          // records the same thing as `endsTheSeason`; this is the only place
          // the product can see how often an admin ends a season THIS way
          // rather than through the button that says so.
          endsSeason: plan.closesSeasonNow === true,
        });
        toast.success(he.seasonsTargetSavedToast);
      });
    // A target equal to what the club has already played is not a smaller edit
    // than "סיים עונה עכשיו" — it is the same outcome reached through a number.
    // The table is archived and zeroed and nine titles are handed out for good,
    // so it gets the same question that button asks, with this season's own
    // figures in it.
    if (plan.closesSeasonNow) {
      appAlert(
        he.seasonsTargetClosesTitle,
        he.seasonsTargetClosesBody(thisSeasonNo, plan.playedHistory),
        [
          {
            text: he.seasonsTargetClosesCta,
            style: 'destructive',
            onPress: go,
          },
          { text: he.cancel, style: 'cancel' },
        ],
      );
      return;
    }
    go();
  }, [groupId, targetArgs, run, plan, thisSeasonNo, cadence, rounds, months]);

  // ⚠️ The `reopenLast` handler lived here and is gone with its button (§12).
  //
  // It read the season's own card first so the confirmation could say whether
  // the season would simply close again, then ran the reopen through
  // `seasonService.reopenLast`. All of that was correct; none of it is
  // reachable, because a club admin may no longer reopen a closed season —
  // the callable refuses anyone but the project owner. Dead UI code that still
  // compiles is how a removed feature comes back by accident.
  //
  // `seasonService.reopenLast` is kept as the client-side wrapper for the
  // maintenance hook; nothing in the app calls it.

  const endNow = useCallback(() => {
    // Which season, and how much of it there is.
    //
    // The paragraph on its own reads identically for a season holding nothing
    // and one holding thirty evenings, and names neither. It is the last thing
    // an admin reads before the club's table is archived and zeroed and nine
    // titles are handed out for good — and the server's own comment on
    // endSeasonNow says this client "shows the admin exactly which titles are
    // about to be awarded before they confirm", which it does not. The titles
    // are not computed anywhere this component can reach; the season and its
    // evening count are, so those at least are said out loud.
    const played = Math.max(0, seasons?.playedRounds ?? 0);
    const body = `${he.seasonNumberLabel(thisSeasonNo)} · ${he.seasonsConfirmSealedNow(
      played,
    )}\n\n${he.seasonsEndConfirmBody}`;
    appAlert(he.seasonsEndConfirmTitle, body, [
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
  }, [groupId, run, seasons?.playedRounds, thisSeasonNo]);

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
          <View style={styles.toggleTitleRow}>
            <Text style={styles.toggleLabel}>{he.seasonsToggleLabel}</Text>
            {/* Every other switch on this screen carries one — מועדון פתוח,
                דירוג פנימי, להסתיר דירוג, כרטיסים — and this was the only one
                without, while being by far the hardest thing on it. The owner
                wrote the spec for this feature and still said "I do not
                understand what is going on there". */}
            <InfoTip title={he.seasonsToggleLabel} text={he.seasonsToggleInfo} />
          </View>
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

          <View style={styles.sectionHead}>
            <Text style={styles.sectionHeadText}>{he.seasonsCadenceQuestion}</Text>
            <Ionicons name="flag-outline" size={16} color={colors.primary} />
          </View>
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

          {/* Where the season actually stands, measured against the number in
              the picker directly above — and recomputed with it, so a chip or a
              stepper tap answers itself while the admin is still deciding.
              Everything it needs is already on screen: `history` is the same
              `playedRounds` the season card shows, and `plan.roundsRemaining`
              is what the chosen target leaves.

              Only for a RUNNING season. Before one exists there is no "העונה
              הנוכחית" to count, and the club's loose history becomes either the
              opening season's progress or an archive depending on a chip below
              — a question the confirmation sheet answers properly and a one-line
              hint cannot. */}
          {live && cadence === 'rounds' && history !== null && plan.ok ? (
            <Text
              style={[
                styles.progressHint,
                plan.closesSeasonNow && styles.progressHintClosing,
              ]}
            >
              {!plan.closesSeasonNow
                ? he.seasonsRoundsPlayedLeft(history, plan.roundsRemaining ?? 0)
                : targetChanged
                  ? he.seasonsTargetMeetsPlayed(history)
                  : // Nothing has been touched and the club is already sitting
                    // on its own target: the season is not about to be ended by
                    // a press, it is waiting for the sweep. Saying "שמירה
                    // תסיים את העונה" beside a button that cannot be pressed
                    // would blame the admin for something already in motion —
                    // so this is the card's own sentence about the same state.
                    he.seasonsCardRemaining(0)}
            </Text>
          ) : null}

          {/* The dates, live. They answer "what am I actually choosing?" while
              the admin is still choosing, which is the whole point of showing
              them here rather than in the confirmation alone.
              NOT on a first activation: the plan-based box below knows about
              the history choice and this one does not, and on the seal path
              both used to render together — two identical-looking boxes, the
              second labelling a different season's end with the first's name. */}
          {previewDates && !firstTime ? (
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
              <View style={styles.sectionHead}>
                <Text style={styles.sectionHeadText}>{he.seasonsCloseFirstTitle}</Text>
                <Ionicons name="archive-outline" size={16} color={colors.primary} />
              </View>
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
                  {/* Named, not "עונה 1". This block only renders on a first
                      activation today, but the season it describes is the one
                      the club is opening, and that is the number every other
                      line on this screen already carries. */}
                  <Text style={styles.fieldLabel}>
                    {he.seasonsSeasonEndLabelOf(thisSeasonNo)}
                  </Text>
                  <Text style={styles.fieldHint}>
                    {he.seasonsSeasonEndHintOf(thisSeasonNo)}
                  </Text>
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
                      label={he.seasonsEndsLabel(thisSeasonNo)}
                      value={formatCalendarDate(plan.endsOn)}
                    />
                  ) : null}
                  <DateLine
                    label={he.seasonsStartsLabel(thisSeasonNo + 1)}
                    value={formatCalendarDate(plan.nextStartsOn)}
                    muted
                  />
                </View>
              ) : null}
            </>
          ) : null}

          {/* The refusal, in red, beside the thing that caused it. */}
          {/* The reason, to EVERYONE. It used to be shown only on a club's
              first activation, so a club re-enabling seasons got a refusal
              from the server and a generic "משהו השתבש" — while the sentence
              that explains it was sitting right here, unrendered. */}
          {/* And not before the admin has touched anything: a live club whose
              season is sitting exactly on its target is not making a mistake,
              it is waiting for the sweep. The validation is about the EDIT. */}
          {!plan.ok && history !== null && !(live && !targetChanged) ? (
            <Text style={styles.errorLine}>
              {planErrorText(plan, rounds, thisSeasonNo)}
            </Text>
          ) : null}

          {/* A read that FAILED, said as one. The alternative was to call it
              zero, which reads as "this club has never played" and quietly
              empties the confirmation sheet of every line about the history it
              is about to seal. Nothing below can be pressed until it answers. */}
          {historyFailed ? (
            <>
              <Text style={styles.errorLine}>{he.seasonActionFailed}</Text>
              <Button
                title={he.retry}
                variant="outline"
                fullWidth
                disabled={busy}
                onPress={() => setHistoryAttempt((n) => n + 1)}
              />
            </>
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
              // Same rule for the same reason: a button that cannot succeed
              // must not be pressable, whether or not this is the first time.
              (history === null || !plan.ok)
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
          {/* ⚠️ The reopen button was here and is deliberately gone (§12).

              A closed season is final. It is locked to corrections on the
              server — `assertSeasonOpenForGame` refuses a retro goal, an
              attendance change or a late round commit against an archived
              season — and offering a club admin a button that undoes the
              archive contradicted the lock the rest of the feature enforces.

              The reason it is not merely hidden is that reopening destroys
              things it cannot put back. Guest pair chemistry is minted per
              season and the mint is gone; `chemistry.since` does not return;
              the season-summary pushes sent at close point at an archive that
              will no longer exist. An admin pressing "undo" has no way to know
              any of that.

              `reopenLastSeason` still exists as an OPERATOR maintenance hook —
              a season that closed on bad data has to be repairable — and the
              callable now refuses anyone but the project owner and writes an
              audit row to /seasonReopens. It is reached from
              `firebase functions:shell`, not from this screen.

              The copy it used (seasonsReopenCta, seasonsReopenConfirm*) is
              left in he.ts: the strings are correct, and if the product ever
              wants a supervised reopen back they should not be rewritten from
              memory. */}
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
        seasonNo={thisSeasonNo}
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
  toggleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
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
  // A HEADING, not another caption.
  //
  // The whole body was one flat 8px column of ~20 elements, nearly all at the
  // same 13px caption size — labels, hints, warnings, previews and buttons all
  // carrying identical weight, with nothing for the eye to anchor on. This is
  // the one element that is allowed to be bigger, and it gets real space above
  // it so the things under it read as belonging to it.
  fieldLabel: {
    ...typography.label,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.md,
  },
  sectionHead: {
    // TEXT FIRST, then the icon — the JSX order is what places them, not this
    // style. `row` lays children out right-to-left under RTL, so a leading
    // icon lands on the RIGHT of its label. Both heads that use this style put
    // the label first so the icon sits to its LEFT (owner, 22.09); keep them
    // in step, or one head grows a mirror image of the other.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  sectionHeadText: {
    ...typography.label,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  fieldHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  // The season's own progress, under the picker it is measured against. Reads
  // as an answer rather than a warning — it is the usual state of this screen —
  // and turns amber only on the one target that ends the season.
  progressHint: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    lineHeight: 18,
  },
  progressHintClosing: { color: colors.warning, fontWeight: '700' },
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

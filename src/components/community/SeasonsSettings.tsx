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

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import {
  seasonService,
  seasonRefusalText,
  SeasonRefusedError,
} from '@/services/seasonService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GroupSeasons } from '@/types';

type Cadence = 'date' | 'rounds';

/** Deliberately few. A club picking a season length should not be designing one. */
const MONTH_CHOICES = [3, 6, 12] as const;
const ROUND_CHOICES = [24, 48, 96] as const;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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
  const [months, setMonths] = useState<number>(() =>
    MONTH_CHOICES.includes(seasons?.cadence?.months as never)
      ? (seasons?.cadence?.months as number)
      : 6,
  );
  const [rounds, setRounds] = useState<number>(() =>
    ROUND_CHOICES.includes(seasons?.cadence?.targetRounds as never)
      ? (seasons?.cadence?.targetRounds as number)
      : 24,
  );
  /** Only asked on the FIRST enable — after that there is no loose history. */
  const [sealHistory, setSealHistory] = useState(false);

  const firstTime = (seasons?.count ?? 0) === 0 && !live;
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
          ...(sealHistory ? { closeFirstNow: true } : {}),
        });
        toast.success(he.seasonsEnabledToast);
      });
    // Switching seasons on is ordinary. Switching them on while sealing the
    // club's ENTIRE history as season 1 is not: it archives every number the
    // club has ever recorded, resets the table, and hands out nine permanent
    // titles — and it was one unconfirmed tap away, on a button whose label
    // only says "הפעל עונות". The destructive half gets the same confirmation
    // that ending a season does.
    if (!sealHistory) {
      go();
      return;
    }
    appAlert(he.seasonsSealConfirmTitle, he.seasonsSealConfirmBody, [
      { text: he.seasonsSealConfirmCta, style: 'destructive', onPress: go },
      { text: he.cancel, style: 'cancel' },
    ]);
  }, [groupId, targetArgs, sealHistory, run]);

  const saveTarget = useCallback(() => {
    run(async () => {
      await seasonService.updateTarget({ groupId, ...targetArgs });
      toast.success(he.seasonsTargetSavedToast);
    });
  }, [groupId, targetArgs, run]);

  const endNow = useCallback(() => {
    appAlert(he.seasonsEndConfirmTitle, he.seasonsEndConfirmBody, [
      {
        text: he.seasonsEndCta,
        style: 'destructive',
        onPress: () =>
          run(async () => {
            const res = await seasonService.endNow(groupId);
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
          ) : null}

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
            {cadence === 'date'
              ? MONTH_CHOICES.map((m) => (
                  <Chip
                    key={m}
                    label={he.seasonsMonthsLabel(m)}
                    active={months === m}
                    onPress={() => setMonths(m)}
                  />
                ))
              : ROUND_CHOICES.map((r) => (
                  <Chip
                    key={r}
                    label={he.seasonsRoundsLabel(r)}
                    active={rounds === r}
                    onPress={() => setRounds(r)}
                  />
                ))}
          </View>

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
            </>
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
            disabled={busy || (live && !targetChanged)}
            onPress={live ? saveTarget : enable}
          />

          {live ? (
            <Button
              title={he.seasonsEndCta}
              variant="danger"
              fullWidth
              disabled={busy}
              onPress={endNow}
            />
          ) : null}
        </View>
      )}
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
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextActive: { color: colors.surface, fontWeight: '700' },
});

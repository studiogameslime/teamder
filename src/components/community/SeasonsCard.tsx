// SeasonsCard — the club's season, on the club screen.
//
// Three jobs, and which one it does depends on who is looking:
//   • seasons off, admin      → explain what a season is, offer to switch on
//   • seasons off, member     → nothing at all (an off feature is not news)
//   • seasons on              → where the season stands, and a way into my own
//                               summary; the admin also gets "end it now"
//
// The two destructive actions live behind confirmations with the consequence
// spelled out, because both of them reset the club's table. Neither is a
// settings toggle for that reason — see seasonService.

import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Button } from '@/components/Button';
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

/** Offered when switching seasons on. Deliberately few — a club picking a
 *  cadence should not be designing one. */
const MONTH_CHOICES = [3, 6, 12] as const;
const ROUND_CHOICES = [24, 48, 96] as const;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function SeasonsCard({
  groupId,
  seasons,
  isAdmin,
  onChanged,
}: {
  groupId: string;
  seasons?: GroupSeasons;
  isAdmin: boolean;
  onChanged?: () => void;
}) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const [busy, setBusy] = useState(false);
  const on = seasons?.enabled === true;
  // No progress number here on purpose. The counter the server measures a
  // rounds target against is `clubRecords.eveningsSealed`, which the rules keep
  // server-only, and every other counter in reach means something else — so a
  // progress line would either be blank or quietly disagree with the rule that
  // actually closes the season.

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onChanged?.();
    } catch (err) {
      // A refusal is an answer, not a failure: "finish tonight's game first"
      // is something the admin can act on, and "something went wrong" is not.
      appAlert(
        he.error,
        err instanceof SeasonRefusedError
          ? seasonRefusalText(err.reason)
          : he.seasonActionFailed,
      );
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const openMySummary = useCallback(() => {
    nav.navigate('SeasonSummary', { groupId });
  }, [nav, groupId]);

  const enable = useCallback(() => {
    // Two questions, asked in order, because the second only makes sense once
    // the first is answered: how does a season end, and what happens to
    // everything the club has already played?
    appAlert(he.seasonsEnableTitle, he.seasonsOffBody, [
      ...MONTH_CHOICES.map((m) => ({
        text: he.seasonsMonthsLabel(m),
        onPress: () => askHistory({ cadenceType: 'date' as const, months: m }),
      })),
      ...ROUND_CHOICES.map((r) => ({
        text: he.seasonsRoundsLabel(r),
        onPress: () =>
          askHistory({ cadenceType: 'rounds' as const, targetRounds: r }),
      })),
      { text: he.cancel, style: 'cancel' as const },
    ]);

    function askHistory(cadence: {
      cadenceType: 'date' | 'rounds';
      months?: number;
      targetRounds?: number;
    }) {
      appAlert(he.seasonsCloseFirstTitle, he.seasonsCloseFirstBody, [
        {
          text: he.seasonsCloseFirstKeep,
          onPress: () =>
            run(async () => {
              await seasonService.enable({ groupId, ...cadence });
              toast.success(he.seasonsEnabledToast);
            }),
        },
        {
          text: he.seasonsCloseFirstSeal,
          onPress: () =>
            run(async () => {
              await seasonService.enable({
                groupId,
                ...cadence,
                closeFirstNow: true,
              });
              toast.success(he.seasonsEnabledToast);
            }),
        },
        { text: he.cancel, style: 'cancel' as const },
      ]);
    }
  }, [groupId, run]);

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

  // An off feature is not news to a member — only the person who could switch
  // it on is shown that it exists.
  if (!on && !isAdmin) return null;

  if (!on) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{he.seasonsCardTitle}</Text>
        <Text style={styles.body}>{he.seasonsOffTitle}</Text>
        <Text style={styles.note}>{he.seasonsOffBody}</Text>
        <Button
          title={he.seasonsEnableCta}
          variant="outline"
          fullWidth
          onPress={enable}
          disabled={busy}
        />
      </View>
    );
  }

  const cadence = seasons?.cadence;
  const line =
    cadence?.type === 'rounds' && typeof cadence.targetRounds === 'number'
      ? he.seasonsTargetRounds(cadence.targetRounds)
      : typeof cadence?.endsAt === 'number'
        ? he.seasonsTargetDate(formatDate(cadence.endsAt))
        : '';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {he.seasonsCardTitle} · {he.seasonNumberLabel(seasons?.currentNo ?? 1)}
      </Text>
      {line ? <Text style={styles.note}>{line}</Text> : null}
      <Button
        title={he.seasonsMySummaryCta}
        variant="outline"
        fullWidth
        onPress={openMySummary}
      />
      {isAdmin ? (
        <Button
          title={he.seasonsEndCta}
          variant="danger"
          fullWidth
          onPress={endNow}
          disabled={busy}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.h3, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  body: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});

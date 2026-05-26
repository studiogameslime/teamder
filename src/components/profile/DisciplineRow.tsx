// DisciplineRow — compact trust-meter row on the profile screen.
// Replaces the old yellow/red counter pair: shows a single 0-100
// reliability meter on the leading edge plus a title + caption with
// the breakdown (or "lacking history" message for new users).
//
// Tristate handling matches the player card:
//   • loading → small loader, no values
//   • error   → "אין נתונים זמינים"
//   • ready   → TrustMeter + caption
//
// Filename + export name kept for diff stability with existing call
// sites; conceptually this is the trust row.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TrustMeter } from '@/components/TrustMeter';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { trustService, type TrustSummary } from '@/services/trustService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  userId: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; summary: TrustSummary };

export function DisciplineRow({ userId }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    trustService
      .getSummary(userId)
      .then((summary) => {
        if (alive) setState({ kind: 'ready', summary });
      })
      .catch(() => {
        if (alive) setState({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <View style={styles.card}>
      <View style={styles.meterWrap}>
        {state.kind === 'loading' ? (
          <SoccerBallLoader size={20} />
        ) : state.kind === 'ready' ? (
          <TrustMeter
            score={state.summary.score}
            tier={state.summary.tier}
            size="sm"
          />
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {he.trustMeterTitle}
        </Text>
        {state.kind === 'error' ? (
          <Text style={styles.unavailable} numberOfLines={1}>
            {he.trustMeterUnavailable}
          </Text>
        ) : state.kind === 'ready' ? (
          <Text style={styles.caption} numberOfLines={1}>
            {state.summary.score === null
              ? he.trustMeterCaptionEmpty
              : he.trustMeterCaption(state.summary.breakdown.gamesEvaluated)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  meterWrap: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  unavailable: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: RTL_LABEL_ALIGN,
  },
});

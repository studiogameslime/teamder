// DisciplineRow — compact horizontal display of yellow/red counts
// from the last-10-games snapshot. Replaces the old card-stack-with-
// helper-text block on the profile.
//
// Visual: title on the right, the two counters on the left (RTL flips
// flexDirection so the cards land at the leading edge of the row).
// Tristate handling matches the player card:
//   • loading → small loader, no numbers
//   • error   → "אין נתונים זמינים"
//   • ready   → DisciplineCards + small caption underneath

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DisciplineCards } from '@/components/DisciplineCards';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { disciplineService } from '@/services/disciplineService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  userId: string;
}

type SnapshotState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      yellow: number;
      red: number;
      gamesCounted: number;
    };

export function DisciplineRow({ userId }: Props) {
  const [snapshot, setSnapshot] = useState<SnapshotState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setSnapshot({ kind: 'loading' });
    disciplineService
      .getPlayerDisciplineSnapshot(userId)
      .then((s) => {
        if (alive) {
          setSnapshot({
            kind: 'ready',
            yellow: s.yellowCardsLast10,
            red: s.redCardsLast10,
            gamesCounted: s.gamesCounted,
          });
        }
      })
      .catch(() => {
        if (alive) setSnapshot({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // New layout: prominent red+yellow square indicators on the
  // leading edge (RTL: visually left), title + small caption to the
  // right, chevron on the trailing side. Mirrors the social/info
  // cards on the same screen so the profile reads as one set of
  // matched rows.
  const captionText =
    snapshot.kind === 'ready'
      ? snapshot.gamesCounted >= 10
        ? he.disciplineSnapshotCaptionFull
        : snapshot.gamesCounted === 0
          ? he.disciplineSnapshotEmpty
          : he.disciplineSnapshotCaptionPartial(snapshot.gamesCounted)
      : null;
  return (
    <View style={styles.card}>
      {snapshot.kind === 'loading' ? (
        <View style={styles.loadingWrap}>
          <SoccerBallLoader size={20} />
        </View>
      ) : (
        <View style={styles.indicatorWrap}>
          <View style={[styles.indicator, styles.indicatorRed]}>
            <Text style={styles.indicatorText}>
              {snapshot.kind === 'ready' ? snapshot.red : '—'}
            </Text>
          </View>
          <View style={[styles.indicator, styles.indicatorYellow]}>
            <Text style={styles.indicatorText}>
              {snapshot.kind === 'ready' ? snapshot.yellow : '—'}
            </Text>
          </View>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {he.disciplineSnapshotTitle}
        </Text>
        {snapshot.kind === 'error' ? (
          <Text style={styles.unavailable} numberOfLines={1}>
            {he.disciplineSnapshotUnavailable}
          </Text>
        ) : captionText ? (
          <Text style={styles.caption} numberOfLines={1}>
            {captionText}
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
  // Two prominent square indicators on the leading edge — red over
  // yellow, each showing its current count. Sized like the icon
  // circle on the sibling cards so the row aligns vertically.
  indicatorWrap: {
    flexDirection: 'row',
    gap: 6,
  },
  indicator: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorRed: { backgroundColor: '#EF4444' },
  indicatorYellow: { backgroundColor: '#F59E0B' },
  indicatorText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  loadingWrap: {
    width: 78,
    height: 36,
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
  chevron: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronInner: {
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: colors.textMuted,
    transform: [{ rotate: '-45deg' }],
  },
  // Reserved alias (kept so prior radius/border-radius refs still
  // resolve if used by tests/snapshots).
  _r: { borderRadius: radius.lg },
});

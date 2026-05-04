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

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{he.disciplineSnapshotTitle}</Text>
        {snapshot.kind === 'loading' ? (
          <SoccerBallLoader size={20} />
        ) : snapshot.kind === 'error' ? (
          <Text style={styles.unavailable}>
            {he.disciplineSnapshotUnavailable}
          </Text>
        ) : (
          <DisciplineCards
            yellowCards={snapshot.yellow}
            redCards={snapshot.red}
            size={26}
          />
        )}
      </View>
      {snapshot.kind === 'ready' && snapshot.gamesCounted > 0 ? (
        <Text style={styles.caption}>
          {snapshot.gamesCounted >= 10
            ? he.disciplineSnapshotCaptionFull
            : he.disciplineSnapshotCaptionPartial(snapshot.gamesCounted)}
        </Text>
      ) : snapshot.kind === 'ready' && snapshot.gamesCounted === 0 ? (
        <Text style={styles.caption}>{he.disciplineSnapshotEmpty}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 32,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
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
  },
  // Reserved for future muted bg when there's a recent red.
  _bgWarn: { backgroundColor: '#FEF3C7', borderRadius: radius.lg },
});

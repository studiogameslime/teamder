// "מי ניצחה במשחקון?" — bottom-of-round winner picker. Shows the two teams
// currently on the pitch as tappable cards; choosing one records it as the
// round winner (winner stays, loser rotates out). Opened from the live
// controls' "סיים משחקון" button.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TeamScore } from '@/components/match/TeamScore';
import { buildRoster, makeResolver, type PlayerLite } from '@/components/match/rotationView';
import type { DraftTeamsResult, MatchRotation } from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  draftTeams?: DraftTeamsResult;
  rotation?: MatchRotation;
  playersMap: Record<string, PlayerLite>;
  guests?: { id: string; name: string }[];
  onPick: (teamIdx: number) => void;
  onClose: () => void;
}

export function WinnerPickerModal({
  visible,
  draftTeams,
  rotation,
  playersMap,
  guests,
  onPick,
  onClose,
}: Props) {
  const ready = !!draftTeams && draftTeams.teams.length >= 2 && !!rotation;
  const resolve = makeResolver(playersMap, guests);
  const teams = (draftTeams?.teams ?? []).map((t) => ({ index: t.index, playerIds: t.playerIds }));
  const [aIdx, bIdx] = rotation?.playing ?? [0, 1];
  const winsOf = (i: number) => rotation?.wins?.[String(i)] ?? 0;

  const pick = (idx: number) => {
    onPick(idx);
    onClose();
  };

  return (
    <Modal visible={visible && ready} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{he.winnerPickTitle}</Text>
          <Text style={styles.subtitle}>{he.winnerPickSubtitle}</Text>

          <View style={styles.choices}>
            {ready
              ? ([aIdx, bIdx] as const).map((idx, i) => (
                  <Pressable
                    key={idx}
                    onPress={() => pick(idx)}
                    style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
                  >
                    <TeamScore
                      teamIdx={idx}
                      roster={buildRoster(idx, teams, rotation!, resolve)}
                      wins={winsOf(idx)}
                      align={i === 0 ? 'right' : 'left'}
                      avatarSize={44}
                    />
                  </Pressable>
                ))
              : null}
          </View>

          <Pressable style={styles.cancel} onPress={onClose}>
            <Ionicons name="close" size={18} color="#475569" />
            <Text style={styles.cancelText}>{he.winnerPickCancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.bg,
    borderRadius: 26,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.h2, color: colors.text, fontWeight: '800', textAlign: 'center' },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  choices: { flexDirection: 'row', gap: spacing.sm },
  choice: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  choicePressed: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  cancel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: { color: '#475569', fontSize: 16, fontWeight: '700' },
});

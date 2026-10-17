import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
// "מי ניצחה במשחקון?" — bottom-of-round winner picker. Shows the two teams
// currently on the pitch as selectable cards; tapping one SELECTS it (it does
// not save yet), and an explicit "אישור" button records the round winner.
// Opened from the live controls' "סיים משחקון" button.

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { Ionicons } from '@expo/vector-icons';
import { TeamScore } from '@/components/match/TeamScore';
import { buildRoster, makeResolver, teamName, type PlayerLite } from '@/components/match/rotationView';
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
  discardedPenaltyCount?: number;
}

export function WinnerPickerModal({
  visible,
  draftTeams,
  rotation,
  playersMap,
  guests,
  onPick,
  onClose,
  discardedPenaltyCount = 0,
}: Props) {
  const { height } = useWindowDimensions();
  const surfaceHeight = Math.max(240, Math.min(700, Math.floor(height - 80)));
  const [selected, setSelected] = useState<number | null>(null);

  // Clear the selection whenever the sheet is dismissed/reopened.
  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  const ready = !!draftTeams && draftTeams.teams.length >= 2 && !!rotation;
  const resolve = makeResolver(playersMap, guests);
  const teams = (draftTeams?.teams ?? []).map((t) => ({ index: t.index, playerIds: t.playerIds }));
  const [aIdx, bIdx] = rotation?.playing ?? [0, 1];
  const winsOf = (i: number) => rotation?.wins?.[String(i)] ?? 0;

  const confirm = () => {
    if (selected == null) return;
    onPick(selected);
    onClose();
  };

  return (
    <Modal visible={visible && ready} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { height: surfaceHeight, maxHeight: surfaceHeight }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">{he.winnerPickTitle}</Text>
            <Text style={styles.subtitle}>{he.winnerPickSubtitle}</Text>
            {discardedPenaltyCount > 0 && <Text style={styles.subtitle}>{`אישור המנצחת ימחק את ${discardedPenaltyCount} הבעיטות שנרשמו בפנדלים.`}</Text>}
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} bounces={false}>
          <View style={styles.choices}>
            {ready
              ? ([aIdx, bIdx] as const).map((idx, i) => (
                  <Pressable
                    key={idx}
                    onPress={() => setSelected(idx)}
                    style={[styles.choice, selected === idx && styles.choiceSelected]}
                    accessibilityRole="button"
                    accessibilityLabel={teamName(idx, draftTeams?.teams)}
                    accessibilityState={{ selected: selected === idx }}
                  >
                    {selected === idx ? (
                      <View style={styles.checkBadge}>
                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                      </View>
                    ) : null}
                    <TeamScore
                      teamIdx={idx}
                      teams={draftTeams?.teams}
                      roster={buildRoster(idx, teams, rotation!, resolve)}
                      wins={winsOf(idx)}
                      align={i === 0 ? 'right' : 'left'}
                      avatarSize={44}
                    />
                  </Pressable>
                ))
              : null}
          </View>
          </ScrollView>

          <View style={styles.actions} testID="winner-picker-actions">
            <Pressable style={[styles.btn, styles.cancelBtn]} onPress={onClose} accessibilityRole="button" accessibilityLabel={he.winnerPickCancel}>
              <Text style={styles.cancelText}>{he.winnerPickCancel}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.confirmBtn, selected == null && styles.confirmDisabled]}
              onPress={confirm}
              disabled={selected == null}
              accessibilityRole="button"
              accessibilityLabel={he.winnerPickConfirm}
              accessibilityState={{ disabled: selected == null }}
            >
              <Text style={styles.confirmText}>{he.winnerPickConfirm}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: overlayTheme.backdrop,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: { ...overlaySurfaces.dialog,
    width: '100%',
    maxWidth: 380,
    padding: spacing.lg,
    gap: spacing.sm,
    overflow: 'hidden',
    flexShrink: 1,
  },
  heading: { gap: spacing.sm, flexShrink: 0 },
  scroll: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
  scrollContent: { paddingTop: 12, paddingBottom: 4 },
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
  choiceSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  checkBadge: {
    position: 'absolute',
    // Straddle the card border so the selection mark cannot cover its team name.
    top: -11,
    left: 8,
    zIndex: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexShrink: 0 },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    minHeight: 44,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: { color: '#475569', fontSize: 16, fontWeight: '700' },
  confirmBtn: { backgroundColor: colors.primary },
  confirmDisabled: { opacity: 0.45 },
  confirmText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});

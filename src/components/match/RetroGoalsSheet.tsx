// RetroGoalsSheet — admin-only, post-match "complete a missed goal" manager.
//
// Opened from the finished-game details screen (above the evening-scorers
// table). Lets a community admin credit a goal that was missed during the
// evening to a PLAYER (+ optional assister), and undo any they added. A retro
// goal is a pure stat correction — it credits the scorer's goals + the club
// total (server-side, via the addRetroGoal callable) and NEVER touches any
// mini-game score or winner. See the addRetroGoal callable for the full model.

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SpringSheet } from '@/components/anim/SpringSheet';
import { Button } from '@/components/Button';
import { UserAvatar } from '@/components/UserAvatar';
import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { successHaptic, warningHaptic } from '@/utils/haptics';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { RetroGoal } from '@/types';

export interface RetroRosterMember {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

type Mode = 'list' | 'scorer' | 'assister';

function genRetroId(): string {
  return `retro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RetroGoalsSheet({
  visible,
  gameId,
  roster,
  onClose,
  onChanged,
}: {
  visible: boolean;
  gameId: string;
  /** Registered players of THIS game (guests excluded — they carry no stats). */
  roster: RetroRosterMember[];
  onClose: () => void;
  /** Fired after a successful add/remove so the parent can refresh the table. */
  onChanged: () => void;
}) {
  const [list, setList] = useState<RetroGoal[] | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [pendingScorer, setPendingScorer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOf = useCallback(
    (id: string) => roster.find((r) => r.id === id)?.name ?? he.genericUserName,
    [roster],
  );

  const reload = useCallback(async () => {
    const rows = await gameService.getRetroGoals(gameId);
    setList(rows);
  }, [gameId]);

  useEffect(() => {
    if (visible) {
      setMode('list');
      setPendingScorer(null);
      reload();
    }
  }, [visible, reload]);

  const saveGoal = async (scorerId: string, assisterId: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await gameService.addRetroGoal(gameId, scorerId, assisterId, genRetroId());
      successHaptic();
      toast.success(he.retroAddDone);
      setMode('list');
      setPendingScorer(null);
      await reload();
      onChanged();
    } catch (err) {
      logError('addRetroGoal', err, { gameId, scorerId });
      toast.error(he.retroActionFailed);
    } finally {
      setBusy(false);
    }
  };

  const removeGoal = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await gameService.removeRetroGoal(gameId, id);
      warningHaptic();
      toast.success(he.retroRemoveDone);
      await reload();
      onChanged();
    } catch (err) {
      logError('removeRetroGoal', err, { gameId, retroGoalId: id });
      toast.error(he.retroActionFailed);
    } finally {
      setBusy(false);
    }
  };

  const pickerRoster =
    mode === 'assister' ? roster.filter((r) => r.id !== pendingScorer) : roster;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <SpringSheet visible={visible} onBackdropPress={busy ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grip} />

          {mode === 'list' ? (
            <>
              <Text style={styles.title}>{he.retroTitle}</Text>
              <Text style={styles.note}>{he.retroNote}</Text>

              {list === null ? null : list.length === 0 ? (
                <Text style={styles.empty}>{he.retroEmpty}</Text>
              ) : (
                <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
                  {list.map((g) => (
                    <View key={g.id} style={styles.row}>
                      <Pressable
                        onPress={() => removeGoal(g.id)}
                        hitSlop={8}
                        disabled={busy}
                        style={styles.undoBtn}
                        accessibilityLabel={he.retroRemoveCta}
                      >
                        <Ionicons name="close" size={16} color={colors.danger} />
                      </Pressable>
                      <View style={{ flex: 1 }} />
                      <Text style={styles.rowText} numberOfLines={1}>
                        {g.assisterId
                          ? he.retroScorerWithAssist(nameOf(g.scorerId), nameOf(g.assisterId))
                          : nameOf(g.scorerId)}
                      </Text>
                      <Ionicons name="football" size={16} color={colors.primary} />
                    </View>
                  ))}
                </ScrollView>
              )}

              <Button
                title={he.retroAddCta}
                iconLeft="add"
                size="lg"
                fullWidth
                loading={busy}
                onPress={() => setMode('scorer')}
              />
              <Pressable onPress={onClose} hitSlop={8} style={styles.cancel}>
                <Text style={styles.cancelText}>{he.close}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>
                {mode === 'scorer' ? he.retroPickScorer : he.retroPickAssist}
              </Text>
              <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                {mode === 'assister' ? (
                  <Pressable style={styles.pickRow} onPress={() => saveGoal(pendingScorer as string, null)}>
                    <View style={styles.noneIcon}>
                      <Ionicons name="remove" size={18} color={colors.textMuted} />
                    </View>
                    <Text style={styles.pickName}>{he.retroNoAssist}</Text>
                  </Pressable>
                ) : null}
                {pickerRoster.map((p) => (
                  <Pressable
                    key={p.id}
                    style={styles.pickRow}
                    disabled={busy}
                    onPress={() => {
                      if (mode === 'scorer') {
                        setPendingScorer(p.id);
                        setMode('assister');
                      } else {
                        saveGoal(pendingScorer as string, p.id);
                      }
                    }}
                  >
                    <UserAvatar user={{ id: p.id, name: p.name, avatarId: p.avatarId, photoUrl: p.photoUrl }} size={34} />
                    <Text style={styles.pickName} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable
                onPress={() => {
                  if (mode === 'assister') {
                    setPendingScorer(null);
                    setMode('scorer');
                  } else {
                    setMode('list');
                  }
                }}
                hitSlop={8}
                style={styles.cancel}
              >
                <Text style={styles.cancelText}>{he.back}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    marginTop: 'auto',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.sm },
  title: { ...typography.h3, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  note: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  listScroll: { maxHeight: 220 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowText: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN, fontWeight: '600' },
  undoBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  pickerScroll: { maxHeight: 340 },
  // `row` (NOT row-reverse): under forceRTL the FIRST child (avatar) lands on
  // the RIGHT, the name right-aligned beside it.
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  pickName: { flex: 1, ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN, fontWeight: '600' },
  noneIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  cancel: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  cancelText: { ...typography.body, color: colors.textMuted, fontWeight: '700' },
});

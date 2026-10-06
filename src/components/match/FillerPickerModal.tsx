// FillerPickerModal — "who completes the team?" picker for the advanced
// live match. When a playing team is short, the engine hands us the donor
// pool (players free to come up from the team going off / the bench) plus the
// random recommendation; the admin confirms it or swaps players, but MUST end
// on exactly `requiredCount` selected. There is no cancel — the field has to
// be filled before the round can run.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { selectionHaptic } from '@/utils/haptics';
import { he } from '@/i18n/he';

export interface FillRequestView {
  /** "קבוצה א" etc. — the team being completed. */
  teamLabel: string;
  /** Donor pool, resolved to display names (registered + guests). */
  players: { id: string; name: string; avatarId?: string; photoUrl?: string }[];
  /** The random recommendation, pre-selected when the sheet opens. */
  recommendedIds: string[];
  /** Exactly this many must be selected to confirm. */
  requiredCount: number;
  /**
   * The score of the round that just ended, and who took it.
   *
   * Present only on a ROUND TRANSITION — a mid-evening substitution keeps the
   * clock and has no result to report, so it carries nothing and the line is
   * absent. `winner` is null on a tie.
   */
  savedResult?: { a: number; b: number; winner: string | null };
}

interface Props {
  request: FillRequestView | null;
  onConfirm: (chosenIds: string[]) => void;
  /** Dismiss the picker without filling — aborts the round transition (the
   *  admin can adjust teams manually). Prevents a stuck modal when the donor
   *  pool can't satisfy `requiredCount` (user report). */
  onCancel: () => void;
}

export function FillerPickerModal({ request, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  // Reset to the recommendation each time a new request opens.
  useEffect(() => {
    setSelected(request ? request.recommendedIds.slice(0, request.requiredCount) : []);
  }, [request]);

  const required = request?.requiredCount ?? 0;
  const ready = selected.length === required;

  const toggle = (id: string) => {
    selectionHaptic();
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <Modal
      visible={!!request}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {request ? he.fillPickerTitle(request.teamLabel) : ''}
            </Text>
            <Pressable
              onPress={onCancel}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={he.cancel}
            >
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          {/* What just happened, before what to do next. The board behind
              this sheet has already been zeroed for the coming round — see
              `fillPickerSavedResult` — so without this line the admin is
              looking at 0:0 and being asked to pick a substitute. */}
          {request?.savedResult ? (
            <View style={styles.savedBanner}>
              <Ionicons name="checkmark-circle" size={16} color="#15803D" />
              <Text style={styles.savedText} numberOfLines={2}>
                {request.savedResult.winner
                  ? he.fillPickerSavedResult(
                      request.savedResult.winner,
                      request.savedResult.a,
                      request.savedResult.b,
                    )
                  : he.fillPickerSavedResultTie(
                      request.savedResult.a,
                      request.savedResult.b,
                    )}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.subtitle, ready ? styles.subtitleOk : null]}>
            {he.fillPickerSelectCount(selected.length, required)}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
            {(request?.players ?? []).length === 0 ? (
              <Text style={styles.emptyPool}>{he.fillPickerEmptyPool}</Text>
            ) : null}
            {(request?.players ?? []).map((p) => {
              const on = selected.includes(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => toggle(p.id)}
                  style={[styles.row, on && styles.rowOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                  </View>
                  <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <UserAvatar user={p} size={34} />
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => ready && onConfirm(selected)}
            disabled={!ready}
            style={[styles.confirm, !ready && styles.confirmDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.confirmText}>{he.fillPickerConfirm}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '80%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  // The "result saved" line. Green, quiet, and ABOVE the instruction — it
  // answers a worry, it is not the task.
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: spacing.xs,
  },
  savedText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#15803D',
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitle: { ...typography.body, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  subtitleOk: { color: colors.success, fontWeight: '700' },
  emptyPool: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  list: { alignSelf: 'stretch' },
  listInner: { gap: spacing.xs, paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  name: { ...typography.bodyBold, color: colors.text, flex: 1, textAlign: RTL_LABEL_ALIGN },
  nameOn: { color: colors.primary },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  confirm: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  confirmDisabled: { backgroundColor: colors.border },
  confirmText: { ...typography.bodyBold, color: '#FFFFFF', fontWeight: '800' },
});

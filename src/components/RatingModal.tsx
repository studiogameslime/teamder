// RatingModal — one rater rates one community member 1–5.
//
// Pre-fills with the rater's existing vote (if any) so re-rating
// shows the current selection. Save / clear / cancel actions; tap
// on a star sets it. Tap on the active star clears (also via the
// "נקה" button).

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { ratingsService } from '@/services/ratingsService';
import type { RatingValue } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { toast } from './Toast';

interface Props {
  visible: boolean;
  groupId: string | null;
  raterUserId: string | null;
  ratedUserId: string | null;
  ratedDisplayName: string;
  onClose: () => void;
  /** Called after a successful save / clear so the parent can refresh UI. */
  onChanged?: () => void;
}

export function RatingModal({
  visible,
  groupId,
  raterUserId,
  ratedUserId,
  ratedDisplayName,
  onClose,
  onChanged,
}: Props) {
  const [selected, setSelected] = useState<RatingValue | 0>(0);
  const [busy, setBusy] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  // Load existing vote on open so the stars start pre-selected.
  useEffect(() => {
    if (!visible || !groupId || !raterUserId || !ratedUserId) return;
    if (raterUserId === ratedUserId) return;
    let alive = true;
    ratingsService
      .getMyVote(groupId, raterUserId, ratedUserId)
      .then((vote) => {
        if (!alive) return;
        setSelected((vote?.rating as RatingValue | undefined) ?? 0);
        setHasExisting(!!vote);
      });
    return () => {
      alive = false;
    };
  }, [visible, groupId, raterUserId, ratedUserId]);

  const isSelf = !!raterUserId && raterUserId === ratedUserId;
  const canSave = !busy && selected > 0;

  const save = async () => {
    if (!groupId || !raterUserId || !ratedUserId || selected === 0) return;
    setBusy(true);
    try {
      await ratingsService.ratePlayerInGroup(
        groupId,
        raterUserId,
        ratedUserId,
        selected as RatingValue,
      );
      toast.success(he.ratingSaved);
      onChanged?.();
      onClose();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!groupId || !raterUserId || !ratedUserId) return;
    setBusy(true);
    try {
      await ratingsService.clearMyVote(groupId, raterUserId, ratedUserId);
      setSelected(0);
      setHasExisting(false);
      toast.info(he.ratingCleared);
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.title}>
            {he.ratingTitle.replace('{name}', ratedDisplayName)}
          </Text>

          {isSelf ? (
            <Text style={styles.selfHint}>{he.ratingNoSelf}</Text>
          ) : (
            <>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = n <= selected;
                  return (
                    <Pressable
                      key={n}
                      onPress={() =>
                        setSelected((cur) =>
                          cur === n ? 0 : (n as RatingValue),
                        )
                      }
                      hitSlop={4}
                      style={styles.starHit}
                    >
                      <Ionicons
                        name={filled ? 'star' : 'star-outline'}
                        size={36}
                        color={filled ? colors.warning : colors.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.footer}>
                {hasExisting ? (
                  <Button
                    title={he.dtfClear}
                    variant="outline"
                    size="sm"
                    onPress={clear}
                    disabled={busy}
                  />
                ) : (
                  <View />
                )}
                <View style={styles.footerRight}>
                  <Button
                    title={he.cancel}
                    variant="outline"
                    size="sm"
                    onPress={onClose}
                    disabled={busy}
                  />
                  <Button
                    title={he.save}
                    variant="primary"
                    size="sm"
                    loading={busy}
                    disabled={!canSave}
                    onPress={save}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'right',
  },
  selfHint: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  starHit: {
    padding: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerRight: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

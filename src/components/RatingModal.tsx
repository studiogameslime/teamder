// RatingModal — one rater rates one community member 1–5.
//
// Redesign: centred player avatar + name on top, large star row in the
// middle, optional comment input below, then a single full-width
// "Send rating" PrimaryButton. Cancel via backdrop tap or X (handled by
// the parent's Modal lifecycle).
//
// Pre-fills with the rater's existing vote (if any) so re-rating shows
// the current selection. Tapping the active star clears it (RatingStars
// handles that).

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from './Button';
import { PlayerIdentity } from './PlayerIdentity';
import { RatingStars } from './RatingStars';
import { ratingsService } from '@/services/ratingsService';
import { userService } from '@/services';
import type { RatingValue, User } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { toast } from './Toast';

interface Props {
  visible: boolean;
  groupId: string | null;
  raterUserId: string | null;
  ratedUserId: string | null;
  ratedDisplayName: string;
  /** Optional subtitle line under the name (e.g., "מגן" / "קשר"). */
  ratedRole?: string;
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
  ratedRole,
  onClose,
  onChanged,
}: Props) {
  const [selected, setSelected] = useState<RatingValue | 0>(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [ratedUser, setRatedUser] = useState<User | null>(null);

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

  // Pull the rated user's profile so the avatar/jersey is real.
  useEffect(() => {
    if (!visible || !ratedUserId) return;
    let alive = true;
    userService
      .getUserById(ratedUserId)
      .then((u) => {
        if (alive) setRatedUser(u);
      })
      .catch(() => {
        if (alive) setRatedUser(null);
      });
    return () => {
      alive = false;
    };
  }, [visible, ratedUserId]);

  // Reset volatile state when the modal closes — re-opening should
  // start fresh rather than show stale comment text.
  useEffect(() => {
    if (!visible) {
      setComment('');
    }
  }, [visible]);

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
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          {isSelf ? (
            <>
              <Text style={styles.title}>{he.ratingTitle.replace('{name}', ratedDisplayName)}</Text>
              <Text style={styles.selfHint}>{he.ratingNoSelf}</Text>
            </>
          ) : (
            <>
              {/* Centered avatar + name + role */}
              <View style={styles.identity}>
                <PlayerIdentity
                  user={ratedUser ?? { id: ratedUserId ?? '', name: ratedDisplayName }}
                  size="lg"
                />
                <Text style={styles.name} numberOfLines={1}>
                  {ratedDisplayName}
                </Text>
                {ratedRole ? (
                  <Text style={styles.role} numberOfLines={1}>
                    {ratedRole}
                  </Text>
                ) : null}
              </View>

              {/* Question + stars */}
              <Text style={styles.question}>{he.ratingHowWasTheir}</Text>
              <RatingStars
                value={selected}
                onChange={(n) => setSelected(n as RatingValue | 0)}
                size={42}
              />
              {selected > 0 ? (
                <Text style={styles.selectedLabel}>
                  {ratingLabel(selected)}
                </Text>
              ) : (
                // Reserve the same vertical space whether or not a label
                // is shown, so tapping a star doesn't make the rest of
                // the modal jump up.
                <Text style={styles.selectedLabel}> </Text>
              )}

              {/* Optional free-text comment */}
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder={he.ratingCommentPlaceholder}
                placeholderTextColor={colors.textMuted}
                multiline
                style={styles.comment}
              />

              {/* Send button — full width */}
              <Button
                title={he.ratingSend}
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                disabled={!canSave}
                onPress={save}
              />

              {hasExisting ? (
                <Pressable
                  onPress={clear}
                  disabled={busy}
                  hitSlop={6}
                  style={styles.clearTap}
                >
                  <Text style={styles.clearText}>{he.ratingClear}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ratingLabel(n: number): string {
  if (n <= 1) return he.ratingLabel1;
  if (n === 2) return he.ratingLabel2;
  if (n === 3) return he.ratingLabel3;
  if (n === 4) return he.ratingLabel4;
  return he.ratingLabel5;
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
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  role: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  question: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  selectedLabel: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: 'center',
    minHeight: 22,
  },
  comment: {
    ...typography.body,
    color: colors.text,
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 80,
    textAlign: 'right',
    textAlignVertical: 'top',
  },
  selfHint: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  clearTap: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
  },
  clearText: {
    ...typography.caption,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});

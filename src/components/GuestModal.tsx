// GuestModal — the coach's "add a guest" form. Opens from Game Details
// and from Live Match (admins only). Captures a name (required, ≤20)
// and an optional 1–5 estimated rating.
//
// Edit mode: pass `existing` and the modal pre-fills + switches its
// title to "ערוך אורח". Save dispatches addGuest or updateGuest, both
// of which round-trip through gameService and re-validate server-side.

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { RatingSlider } from './RatingSlider';
import { toast } from './Toast';
import { logError } from '@/services/errorLog';
import { gameService } from '@/services/gameService';
import type { GameGuest } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const MAX_NAME_LEN = 20;

interface Props {
  visible: boolean;
  gameId: string;
  callerId: string | null;
  existing?: GameGuest | null;
  /** Caller is a community admin / game creator. Controls who may rename
   *  an existing guest. The RATING, however, is gated on `addedBy` alone
   *  (only the adder edits it) regardless of admin status. */
  isAdmin?: boolean;
  onClose: () => void;
  /** Fires after a successful save with the saved guest. Lets the
   *  parent splice the change into local state directly — relying on
   *  a fresh `getDoc()` here was racy because Firestore returns the
   *  pre-write snapshot for a brief window after the transaction
   *  commit. Modal awaits the returned promise (if any) before it
   *  closes, so the screen reflects the change by the time the user
   *  sees it again. */
  onChanged?: (
    action: 'added' | 'updated',
    guest: GameGuest,
  ) => void | Promise<void>;
}

export function GuestModal({
  visible,
  gameId,
  callerId,
  existing,
  isAdmin,
  onClose,
  onChanged,
}: Props) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(existing?.name ?? '');
    setRating(existing?.estimatedRating ?? null);
  }, [visible, existing?.id, existing?.name, existing?.estimatedRating]);

  // Permission split (only meaningful in edit mode; on ADD the caller is the
  // adder and may set everything):
  //   • name   — admin / creator (roster management)
  //   • rating — ONLY the adder (`addedBy === caller`)
  const isEdit = !!existing;
  const isAdder = !!existing && !!callerId && existing.addedBy === callerId;
  const canEditName = !isEdit || !!isAdmin;
  const canEditRating = !isEdit || isAdder;

  const trimmed = name.trim();
  const nameValid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LEN;
  const nameChanged = trimmed !== (existing?.name ?? '');
  const ratingChanged = (rating ?? null) !== (existing?.estimatedRating ?? null);
  const canSave =
    !!callerId &&
    !busy &&
    nameValid &&
    (!isEdit ||
      (canEditName && nameChanged) ||
      (canEditRating && ratingChanged));

  const handleSave = async () => {
    if (!canSave || !callerId) return;
    setBusy(true);
    try {
      let saved: GameGuest;
      let action: 'added' | 'updated';
      if (existing) {
        // Apply only the parts this caller is allowed to change, via the
        // matching path: name → updateGuest (admin), rating → setGuestRating
        // (adder-only callable). Build the merged guest locally for the
        // parent's optimistic splice (avoids the post-write read race).
        if (canEditName && nameChanged) {
          await gameService.updateGuest(gameId, callerId, existing.id, {
            name: trimmed,
          });
        }
        if (canEditRating && ratingChanged) {
          await gameService.setGuestRating(
            gameId,
            callerId,
            existing.id,
            rating ?? null,
          );
        }
        const { estimatedRating: _drop, ...rest } = existing;
        const finalRating = canEditRating
          ? rating ?? undefined
          : existing.estimatedRating;
        saved = {
          ...rest,
          name: canEditName ? trimmed : existing.name,
          ...(finalRating !== undefined
            ? { estimatedRating: finalRating }
            : {}),
        };
        action = 'updated';
      } else {
        saved = await gameService.addGuest(gameId, callerId, {
          name: trimmed,
          estimatedRating: rating ?? undefined,
        });
        action = 'added';
      }
      // Success feedback is owned by the realtime banner the parent
      // gets from the useGameEvents listener (`bannerGuestAdded`) —
      // showing a separate toast here would render two notices for
      // the same event. We hand the saved guest to the parent so it
      // can splice it into local state directly; this avoids the
      // post-write Firestore read race that occasionally returned the
      // pre-commit snapshot.
      if (onChanged) await onChanged(action, saved);
      onClose();
    } catch (err) {
      const msg = (err as Error).message ?? '';
      logError(existing ? 'updateGuest' : 'addGuest', err, {
        screen: 'GuestModal',
        gameId,
        callerId,
        guestId: existing?.id,
      });
      if (msg === 'GAME_FULL') toast.error(he.guestErrorGameFull);
      else if (msg === 'GAME_NOT_OPEN') toast.error(he.guestErrorGameNotOpen);
      else if (msg === 'PERMISSION_DENIED') toast.error(he.guestErrorPermission);
      else toast.error(he.guestErrorGeneric);
      if (__DEV__) console.warn('[GuestModal] save failed', err);
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
      {/* KeyboardAvoidingView pushes the card above the on-screen
          keyboard so the guest-name input never falls behind it. iOS
          uses `padding` (the system shrinks the available area from
          the bottom); Android handles keyboard insets via the
          window's softInputMode, so we use `height` as a safe noop
          there — without this wrapper, opening the keyboard on a
          short device hid the input + Save button. */}
      <KeyboardAvoidingView
        style={styles.kavFill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>
            {existing ? he.guestEditTitle : he.guestAddTitle}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>
              {he.guestNameLabel}
              {canEditName ? (
                <Text style={styles.requiredStar}>{' *'}</Text>
              ) : null}
            </Text>
            {canEditName ? (
              <>
                <TextInput
                  value={name}
                  onChangeText={(t) => setName(t.slice(0, MAX_NAME_LEN))}
                  placeholder={he.guestNamePlaceholder}
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_NAME_LEN}
                  style={styles.input}
                />
                <Text style={styles.helper}>
                  {trimmed.length}/{MAX_NAME_LEN}
                </Text>
              </>
            ) : (
              <Text style={[styles.input, styles.readonly]}>{name}</Text>
            )}
          </View>

          {/* Rating: editable only by the adder. Admins see it read-only. */}
          {canEditRating || rating != null ? (
            <View style={styles.field}>
              <Text style={styles.label}>{he.guestRatingLabel}</Text>
              {canEditRating ? (
                <>
                  <RatingSlider
                    value={rating ?? 0}
                    onChange={(n) => setRating(n === 0 ? null : n)}
                  />
                  <Text style={styles.helper}>{he.guestRatingHint}</Text>
                </>
              ) : (
                <>
                  {/* Read-only for the admin: same slider look as create/edit,
                      just non-interactive (no thumb drag, no clear button). */}
                  <RatingSlider value={rating ?? 0} readonly />
                  <Text style={styles.helper}>{he.guestRatingAdderOnly}</Text>
                </>
              )}
            </View>
          ) : null}

          <View style={styles.footer}>
            <Button
              title={he.cancel}
              variant="outline"
              size="sm"
              onPress={onClose}
            />
            <Button
              title={he.save}
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!canSave}
              onPress={handleSave}
            />
          </View>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Transparent fill for the keyboard-avoiding wrapper. The dark dimming
  // lives ONLY on the inner `backdrop` Pressable — applying it here too
  // stacked two 0.45 layers (darker centre, lighter padding border).
  kavFill: {
    flex: 1,
  },
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
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    // TextInput value: physical 'right' (Android TextInput respects
    // physical alignment, unlike <Text> labels which need
    // RTL_LABEL_ALIGN to compensate for the forceRTL flip).
    textAlign: 'right',
  },
  // Read-only rendering of a field this caller can't edit (e.g. an admin
  // viewing a guest's adder-owned rating).
  readonly: {
    color: colors.text,
    opacity: 0.8,
  },
  helper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  requiredStar: {
    color: colors.danger,
    fontWeight: '700',
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  clear: {
    ...typography.caption,
    color: colors.primary,
    marginStart: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

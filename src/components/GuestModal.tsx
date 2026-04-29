// GuestModal — the coach's "add a guest" form. Opens from Game Details
// and from Live Match (admins only). Captures a name (required, ≤20)
// and an optional 1–5 estimated rating.
//
// Edit mode: pass `existing` and the modal pre-fills + switches its
// title to "ערוך אורח". Save dispatches addGuest or updateGuest, both
// of which round-trip through gameService and re-validate server-side.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { toast } from './Toast';
import { gameService } from '@/services/gameService';
import type { GameGuest } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

const MAX_NAME_LEN = 20;

interface Props {
  visible: boolean;
  gameId: string;
  callerId: string | null;
  existing?: GameGuest | null;
  onClose: () => void;
  /** Fires after a successful save so the parent can refresh. */
  onChanged?: () => void;
}

export function GuestModal({
  visible,
  gameId,
  callerId,
  existing,
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

  const trimmed = name.trim();
  const canSave =
    !!callerId && !busy && trimmed.length > 0 && trimmed.length <= MAX_NAME_LEN;

  const handleSave = async () => {
    if (!canSave || !callerId) return;
    setBusy(true);
    try {
      if (existing) {
        await gameService.updateGuest(gameId, callerId, existing.id, {
          name: trimmed,
          estimatedRating: rating ?? null,
        });
        toast.success(he.guestSaved);
      } else {
        await gameService.addGuest(gameId, callerId, {
          name: trimmed,
          estimatedRating: rating ?? undefined,
        });
        toast.success(he.guestAdded);
      }
      onChanged?.();
      onClose();
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg === 'GAME_FULL') toast.error(he.guestErrorGameFull);
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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>
            {existing ? he.guestEditTitle : he.guestAddTitle}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>{he.guestNameLabel}</Text>
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
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{he.guestRatingLabel}</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => {
                const active = rating !== null && n <= rating;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setRating(rating === n ? null : n)}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={active ? 'star' : 'star-outline'}
                      size={28}
                      color={active ? colors.warning : colors.textMuted}
                    />
                  </Pressable>
                );
              })}
              {rating !== null ? (
                <Pressable onPress={() => setRating(null)} hitSlop={6}>
                  <Text style={styles.clear}>{he.dtfClear}</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.helper}>{he.guestRatingHint}</Text>
          </View>

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
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'right',
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: 'right',
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'right',
  },
  helper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
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

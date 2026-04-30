// Reusable destructive-action confirmation dialog.
// Pattern: title + body + irreversible-ack checkbox + cancel/confirm.
// The confirm button stays disabled until the checkbox is ticked, so a
// stray double-tap can't blow away data.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  title: string;
  body: string;
  /** Optional override for the confirm button label. Defaults to "אישור מחיקה". */
  confirmLabel?: string;
  /** Async callback. Modal closes itself on success; errors propagate. */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDestructiveModal({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: Props) {
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset the checkbox each time the modal reopens so the next destructive
  // confirmation starts from a clean slate.
  useEffect(() => {
    if (visible) {
      setAcked(false);
      setBusy(false);
    }
  }, [visible]);

  const handleConfirm = async () => {
    if (!acked || busy) return;
    setBusy(true);
    try {
      await onConfirm();
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
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.iconWrap}>
            <Ionicons
              name="warning-outline"
              size={28}
              color={colors.danger}
            />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>

          <Pressable
            onPress={() => setAcked((v) => !v)}
            style={({ pressed }) => [
              styles.ackRow,
              pressed && { opacity: 0.7 },
            ]}
            disabled={busy}
          >
            <View
              style={[
                styles.checkbox,
                acked && styles.checkboxChecked,
              ]}
            >
              {acked ? (
                <Ionicons name="checkmark" size={16} color="#fff" />
              ) : null}
            </View>
            <Text style={styles.ackText}>{he.confirmDeleteAck}</Text>
          </Pressable>

          <View style={styles.footer}>
            <Button
              title={he.cancel}
              variant="outline"
              size="sm"
              onPress={onClose}
              disabled={busy}
            />
            <Button
              title={confirmLabel ?? he.confirmDeleteSubmit}
              variant="danger"
              size="sm"
              disabled={!acked || busy}
              loading={busy}
              onPress={handleConfirm}
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
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
  },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  checkboxChecked: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  ackText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

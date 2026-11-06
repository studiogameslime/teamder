import { overlaySurfaces } from '@/theme/overlays';
// ConfirmDialog — the app's standard styled popup for confirmations and
// short notices. Replaces native Alert.alert so dialogs match the rest of
// the UI (same card, spring entry, themed buttons) instead of the grey OS
// alert. For destructive actions that need an "I understand" checkbox, use
// ConfirmDestructiveModal instead.
//
//   • Notice  → omit `cancelLabel`: a single confirm button (e.g. "הבנתי").
//   • Confirm → pass `cancelLabel` for a two-button cancel/confirm dialog.

import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

type Tone = 'info' | 'warning' | 'danger';

interface Props {
  visible: boolean;
  title: string;
  body?: string;
  /** Icon + accent colour. Defaults to 'info'. */
  tone?: Tone;
  /** Primary action label. */
  confirmLabel: string;
  /** Primary button colour — 'primary' (default) or 'danger'. */
  confirmVariant?: 'primary' | 'danger';
  /** Runs on confirm. Modal closes itself when it resolves. */
  onConfirm: () => void | Promise<void>;
  /** When set, a secondary cancel button is shown. Omit for a single-
   *  button notice dialog. */
  cancelLabel?: string;
  onClose: () => void;
}

const TONE: Record<Tone, { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }> = {
  info: { icon: 'information-circle-outline', color: colors.primary, bg: 'rgba(37,99,235,0.12)' },
  warning: { icon: 'alert-circle-outline', color: colors.warning, bg: 'rgba(234,179,8,0.14)' },
  danger: { icon: 'warning-outline', color: colors.danger, bg: 'rgba(239,68,68,0.12)' },
};

export function ConfirmDialog({
  visible,
  title,
  body,
  tone = 'info',
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  cancelLabel,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  // Native back and queued presses may arrive before React commits `busy`.
  // One synchronous gate covers confirmation and every dismissal path.
  const confirming = useRef(false);
  useEffect(() => {
    if (visible) setBusy(confirming.current);
  }, [visible]);

  const handleClose = () => {
    if (!confirming.current) onClose();
  };

  const handleConfirm = async () => {
    if (!visible || confirming.current) return;
    confirming.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      confirming.current = false;
      setBusy(false);
    }
  };

  const t = TONE[tone];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <SpringSheet
        visible={visible}
        onBackdropPress={busy ? undefined : handleClose}
        position="center"
        fromOffsetY={60}
        panelStyle={{ paddingHorizontal: spacing.lg, alignSelf: 'stretch' }}
      >
        <ScrollView style={styles.card} contentContainerStyle={styles.cardContent} bounces={false}>
          <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
            <Ionicons name={t.icon} size={28} color={t.color} />
          </View>

          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}

          <View style={styles.footer}>
            {cancelLabel ? (
              <Button
                title={cancelLabel}
                variant="outline"
                size="sm"
                onPress={handleClose}
                disabled={busy}
              />
            ) : null}
            <Button
              title={confirmLabel}
              variant={confirmVariant}
              size="sm"
              loading={busy}
              onPress={handleConfirm}
            />
          </View>
        </ScrollView>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { ...overlaySurfaces.dialog,
    width: '100%',
    maxWidth: 440,
    maxHeight: '92%',
    flexGrow: 0,
  },
  cardContent: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

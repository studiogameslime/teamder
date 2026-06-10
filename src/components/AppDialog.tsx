// Global styled dialog — a drop-in replacement for React Native's
// Alert.alert that renders the app's popup style (SpringSheet card, tone
// icon, themed buttons) instead of the grey OS alert.
//
// Usage (same shape as Alert.alert):
//   import { appAlert } from '@/components/AppDialog';
//   appAlert('כותרת', 'גוף ההודעה');                      // single "הבנתי"
//   appAlert('לעזוב?', 'אי אפשר לבטל', [
//     { text: 'ביטול', style: 'cancel' },
//     { text: 'עזוב', style: 'destructive', onPress: doLeave },
//   ]);
//
// Mount <AppDialogHost /> exactly once at the app root (App.tsx).

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { Button } from '@/components/Button';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

export type AppDialogTone = 'info' | 'warning' | 'danger';

export interface AppAlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AppAlertOptions {
  /** Icon + accent. Defaults to danger when a destructive button exists,
   *  otherwise info. */
  tone?: AppDialogTone;
  /** Called when the user dismisses by tapping the backdrop. */
  onDismiss?: () => void;
  /** Accepted for Alert.alert call-site compatibility; ignored (the
   *  styled dialog is always backdrop-dismissable). */
  cancelable?: boolean;
}

interface DialogRequest {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  tone: AppDialogTone;
  onDismiss?: () => void;
}

interface DialogState {
  current: DialogRequest | null;
  show: (req: DialogRequest) => void;
  close: () => void;
}

const useDialogStore = create<DialogState>((set) => ({
  current: null,
  show: (req) => set({ current: req }),
  close: () => set({ current: null }),
}));

/**
 * Imperative API matching Alert.alert(title, message?, buttons?, options?).
 * Safe to call from anywhere — it routes through the store the mounted
 * AppDialogHost subscribes to.
 */
export function appAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
  options?: AppAlertOptions,
): void {
  const btns =
    buttons && buttons.length > 0
      ? buttons
      : [{ text: he.infoTipGotIt, style: 'default' as const }];
  const tone: AppDialogTone =
    options?.tone ??
    (btns.some((b) => b.style === 'destructive') ? 'danger' : 'info');
  useDialogStore.getState().show({
    title,
    message,
    buttons: btns,
    tone,
    onDismiss: options?.onDismiss,
  });
}

const TONE: Record<
  AppDialogTone,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  info: { icon: 'information-circle-outline', color: colors.primary, bg: 'rgba(37,99,235,0.12)' },
  warning: { icon: 'alert-circle-outline', color: colors.warning, bg: 'rgba(234,179,8,0.14)' },
  danger: { icon: 'warning-outline', color: colors.danger, bg: 'rgba(239,68,68,0.12)' },
};

function buttonVariant(style?: AppAlertButton['style']): 'primary' | 'outline' | 'danger' {
  if (style === 'destructive') return 'danger';
  if (style === 'cancel') return 'outline';
  return 'primary';
}

export function AppDialogHost() {
  const current = useDialogStore((s) => s.current);
  const close = useDialogStore((s) => s.close);

  const handlePress = (b: AppAlertButton) => {
    close();
    // Run after close so the action's own UI (toasts, navigation, busy
    // overlays) isn't layered under the dialog — matches Alert.alert.
    b.onPress?.();
  };

  const handleBackdrop = () => {
    const onDismiss = current?.onDismiss;
    close();
    onDismiss?.();
  };

  const t = current ? TONE[current.tone] : TONE.info;
  // Two buttons sit in a row (cancel + action); one or 3+ stack so long
  // Hebrew labels never clip.
  const stacked = !current || current.buttons.length !== 2;

  return (
    <Modal
      visible={!!current}
      transparent
      animationType="none"
      onRequestClose={handleBackdrop}
    >
      <SpringSheet
        visible={!!current}
        onBackdropPress={handleBackdrop}
        position="center"
        fromOffsetY={60}
        panelStyle={{ paddingHorizontal: spacing.lg, alignSelf: 'stretch' }}
      >
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
            <Ionicons name={t.icon} size={28} color={t.color} />
          </View>

          <Text style={styles.title}>{current?.title}</Text>
          {current?.message ? (
            <Text style={styles.body}>{current.message}</Text>
          ) : null}

          <View style={[styles.footer, stacked && styles.footerStacked]}>
            {(current?.buttons ?? []).map((b, i) => (
              <View key={`${b.text}-${i}`} style={stacked ? styles.fullBtn : undefined}>
                <Button
                  title={b.text}
                  variant={buttonVariant(b.style)}
                  size="sm"
                  fullWidth={stacked}
                  onPress={() => handlePress(b)}
                />
              </View>
            ))}
          </View>
        </Pressable>
      </SpringSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    // Fill the panel width (minus its horizontal padding) instead of
    // shrinking to the text — otherwise a short-title dialog with
    // stacked buttons renders as a tall, narrow sliver. Matches the
    // width of the app's other modals (rating / conflict).
    alignSelf: 'stretch',
    maxWidth: 440,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  title: { ...typography.h3, color: colors.text, fontWeight: '800' },
  body: { ...typography.body, color: colors.textMuted, lineHeight: 22 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  footerStacked: { flexDirection: 'column' },
  fullBtn: { alignSelf: 'stretch' },
});

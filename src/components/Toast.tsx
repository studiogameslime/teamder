// Lightweight global toast. Imperative API + a single host that mounts
// once at the app root. No third-party dep; pure RN Animated.
//
// Usage from anywhere (component, service, store action):
//   import { toast } from '@/components/Toast';
//   toast.success('הבקשה נשלחה');
//   toast.error('משהו השתבש');
//   toast.info('שמור');
//
// Mount <ToastHost /> exactly once at the top of the React tree (App.tsx).

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { colors, radius, spacing, typography } from '@/theme';

type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  /** Bumped on each show() so the host's effect re-runs and re-animates. */
  seq: number;
  visible: boolean;
  message: string;
  type: ToastType;
  /** Auto-dismiss timeout in ms. Default 3000. */
  duration: number;
  show: (input: { message: string; type?: ToastType; duration?: number }) => void;
  hide: () => void;
}

const useToastStore = create<ToastState>((set, get) => ({
  seq: 0,
  visible: false,
  message: '',
  type: 'info',
  duration: 3000,
  show: ({ message, type = 'info', duration = 3000 }) =>
    set({
      seq: get().seq + 1,
      visible: true,
      message,
      type,
      duration,
    }),
  hide: () => set({ visible: false }),
}));

/**
 * Imperative API. Safe to call from any layer (services, stores,
 * component event handlers) — it goes through the store, which the
 * mounted ToastHost subscribes to.
 */
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().show({ message, type: 'success', duration }),
  error: (message: string, duration?: number) =>
    useToastStore.getState().show({ message, type: 'error', duration }),
  info: (message: string, duration?: number) =>
    useToastStore.getState().show({ message, type: 'info', duration }),
  hide: () => useToastStore.getState().hide(),
};

const TOAST_OFFSCREEN_Y = -40;

export function ToastHost() {
  const { seq, visible, message, type, duration, hide } = useToastStore();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(TOAST_OFFSCREEN_Y)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) {
      // Slide back up + fade out.
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: TOAST_OFFSCREEN_Y,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }
    // Slide down + fade in.
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
    const timer = setTimeout(hide, duration);
    return () => clearTimeout(timer);
    // `seq` is included so a back-to-back show() restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seq, duration]);

  const tint =
    type === 'success'
      ? colors.success
      : type === 'error'
        ? colors.danger
        : colors.info;
  const icon: keyof typeof Ionicons.glyphMap =
    type === 'success'
      ? 'checkmark-circle'
      : type === 'error'
        ? 'alert-circle'
        : 'information-circle';

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.host,
        {
          top: insets.top + 8,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable onPress={hide} style={[styles.toast, { borderColor: tint }]}>
        <Ionicons name={icon} size={18} color={tint} />
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 10,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 220,
    maxWidth: 480,
    // Soft shadow so the toast lifts above the screen content.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
});

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

import React, { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

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

const TOAST_OFFSCREEN_Y = -60;

export function ToastHost() {
  const { seq, visible, message, type, duration, hide } = useToastStore();
  // Reanimated shared values — animation runs on the UI thread so a
  // busy JS thread (heavy nav transitions, list renders) can't stutter
  // the toast.
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(TOAST_OFFSCREEN_Y);
  const scale = useSharedValue(0.96);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) {
      // Snap back up + fade out — slightly faster than entry so a
      // queued back-to-back toast appears responsive.
      opacity.value = withTiming(0, { duration: 160 });
      translateY.value = withTiming(TOAST_OFFSCREEN_Y, {
        duration: 180,
        easing: Easing.in(Easing.cubic),
      });
      scale.value = withTiming(0.96, { duration: 160 });
      return;
    }
    // Spring-in: travels past zero slightly and bounces back. The
    // overshoot reads as "arrived emphatically" without feeling toy-
    // like (damping high enough that it settles in <300 ms).
    opacity.value = withTiming(1, { duration: 200 });
    translateY.value = withSpring(0, {
      damping: 14,
      stiffness: 220,
      mass: 0.8,
    });
    scale.value = withSpring(1, {
      damping: 12,
      stiffness: 260,
      mass: 0.6,
    });
    const timer = setTimeout(hide, duration);
    return () => clearTimeout(timer);
    // `seq` is included so a back-to-back show() restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seq, duration]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  // Wide card tinted by status, with a football icon in a soft circle on
  // the trailing (right, RTL) side, a divider, and the message text.
  const palette =
    type === 'success'
      ? { icon: colors.success, iconBg: 'rgba(22,163,74,0.12)', card: '#F1FBF4', border: 'rgba(22,163,74,0.30)' }
      : type === 'error'
        ? { icon: colors.danger, iconBg: 'rgba(239,68,68,0.12)', card: '#FEF3F2', border: 'rgba(239,68,68,0.28)' }
        : { icon: colors.primary, iconBg: 'rgba(37,99,235,0.12)', card: '#EEF4FF', border: 'rgba(37,99,235,0.28)' };

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.host, { top: insets.top + 8 }, animStyle]}
    >
      <Pressable
        onPress={hide}
        style={[styles.toast, { backgroundColor: palette.card, borderColor: palette.border }]}
      >
        <View style={[styles.iconCircle, { backgroundColor: palette.iconBg }]}>
          <Ionicons name="football" size={24} color={palette.icon} />
        </View>
        <View style={styles.divider} />
        <Text style={styles.text} numberOfLines={3}>
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
    // Stretch so the toast spans the width (minus margins) — wider, like
    // the mockup — instead of hugging its content.
    alignItems: 'stretch',
    zIndex: 9999,
    elevation: 10,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xxl,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    // Soft, lifted shadow so the toast floats above content.
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 34,
    backgroundColor: colors.border,
  },
  text: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
});

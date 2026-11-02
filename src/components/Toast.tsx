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
  StyleSheet,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { NoticeCard } from './NoticeCard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { spacing } from '@/theme';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { useUserStore } from '@/store/userStore';
import { observeCaughtError } from '@/utils/errorObservation';
import { isStaleSession } from '@/services/staleSession';

type ToastType = 'success' | 'error' | 'info';
type ToastAction = { label: string; onPress: () => void | Promise<void>; ownerId?: string };

interface ToastState {
  /** Bumped on each show() so the host's effect re-runs and re-animates. */
  seq: number;
  visible: boolean;
  message: string;
  type: ToastType;
  /** Auto-dismiss timeout in ms. Default 3000. */
  duration: number;
  action?: ToastAction;
  busy: boolean;
  show: (input: { message: string; type?: ToastType; duration?: number; action?: ToastAction }) => void;
  hide: () => void;
  act: () => Promise<void>;
}

const useToastStore = create<ToastState>((set, get) => ({
  seq: 0,
  visible: false,
  message: '',
  type: 'info',
  duration: 3000,
  busy: false,
  show: ({ message, type = 'info', duration = 3000, action }) =>
    set({
      seq: get().seq + 1,
      visible: true,
      message,
      type,
      duration,
      action,
      busy: false,
    }),
  hide: () => set({ visible: false, action: undefined, busy: false }),
  act: async () => {
    const current = get();
    if (!current.visible || current.busy || !current.action) return;
    if (current.action.ownerId && current.action.ownerId !== useUserStore.getState().currentUser?.id) { current.hide(); return; }
    set({ busy: true });
    try {
      await current.action.onPress();
      if (get().seq === current.seq) get().hide();
    } catch (error) {
      if (isStaleSession(error)) { if (get().seq === current.seq) get().hide(); return; }
      if (get().seq !== current.seq || current.action.ownerId && current.action.ownerId !== useUserStore.getState().currentUser?.id) return;
      observeCaughtError(error, { source: 'src/components/Toast.tsx', handler: 'act', site: 'Toast:action' });
      set({ busy: false, seq: current.seq + 1, type: 'error', message: 'לא ניתן להשלים כרגע. נסו שוב.' });
    }
  },
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
  action: (message: string, action: ToastAction, duration = 6000) =>
    useToastStore.getState().show({ message, type: 'success', action, duration }),
};

const TOAST_OFFSCREEN_Y = -60;

export function ToastHost() {
  const { seq, visible, message, type, duration, hide, action, busy, act } = useToastStore();
  const ownerId = useUserStore(s => s.currentUser?.id);
  const reduced = useReducedMotion();
  const shown = visible && (!action?.ownerId || action.ownerId === ownerId);
  // Reanimated shared values — animation runs on the UI thread so a
  // busy JS thread (heavy nav transitions, list renders) can't stutter
  // the toast.
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(TOAST_OFFSCREEN_Y);
  const scale = useSharedValue(0.96);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (reduced) { opacity.value = shown ? 1 : 0; translateY.value = 0; scale.value = 1; return; }
    if (!shown) {
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
    // `seq` is included so a back-to-back show() restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, seq, reduced]);
  useEffect(() => {
    if (!shown || busy) return;
    const timer = setTimeout(() => { if (useToastStore.getState().seq === seq) hide(); }, duration); return () => clearTimeout(timer);
  }, [shown, seq, duration, busy, hide]);
  useEffect(() => { if (visible && !shown) hide(); }, [visible, shown, hide]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents={shown ? 'box-none' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      style={[styles.host, { top: insets.top + 8 }, animStyle]}
    >
      <NoticeCard message={message} type={type} onClose={hide} action={action ? { label: action.label, busy, onPress: () => { void act(); } } : undefined} />
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
});

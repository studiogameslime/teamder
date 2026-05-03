// Banner — celebratory in-app notification that slides from the top
// edge and auto-dismisses. Visually distinct from `Toast` (bottom,
// system feedback) so callers can pick the right register: toast for
// errors / acks, banner for "something happened" event signals
// ("הכוחות מוכנים", "גול נרשם").
//
// Imperative API mirrors Toast's so call sites stay terse:
//   import { banner } from '@/components/Banner';
//   banner.show('הכוחות מוכנים');
//
// Mount <BannerHost /> exactly once near the app root (App.tsx).

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

type BannerType = 'success' | 'info';

interface BannerState {
  seq: number;
  visible: boolean;
  /** True from .show() until the exit animation actually finishes.
   *  Drives the render guard so the host doesn't sit on the screen
   *  intercepting touches once it's invisible. */
  mounted: boolean;
  message: string;
  type: BannerType;
  /** Auto-dismiss after N ms. Default 2000. */
  duration: number;
  /** Optional Ionicon glyph; defaults per type. */
  icon?: keyof typeof Ionicons.glyphMap;
  show: (input: {
    message: string;
    type?: BannerType;
    duration?: number;
    icon?: keyof typeof Ionicons.glyphMap;
  }) => void;
  hide: () => void;
  /** Internal — flipped false by the host once the exit animation ends. */
  _setMounted: (m: boolean) => void;
}

const useBannerStore = create<BannerState>((set, get) => ({
  seq: 0,
  visible: false,
  mounted: false,
  message: '',
  type: 'success',
  duration: 2000,
  show: ({ message, type = 'success', duration = 2000, icon }) =>
    set({
      seq: get().seq + 1,
      visible: true,
      mounted: true,
      message,
      type,
      duration,
      icon,
    }),
  hide: () => set({ visible: false }),
  _setMounted: (m) => set({ mounted: m }),
}));

/** Imperative API. Call from anywhere — service, screen, store. */
export const banner = {
  show: (message: string, opts?: Partial<BannerState>) =>
    useBannerStore.getState().show({ message, ...opts }),
  success: (message: string) =>
    useBannerStore.getState().show({ message, type: 'success' }),
  info: (message: string) =>
    useBannerStore.getState().show({ message, type: 'info' }),
};

export function BannerHost() {
  const { seq, visible, mounted, message, type, duration, icon } =
    useBannerStore();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -120,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // Only unmount once the exit actually completed. If a new
        // .show() raced in mid-animation, `visible` is true again and
        // `mounted` was already set true by the show() — don't flip
        // it back to false.
        if (finished && !useBannerStore.getState().visible) {
          useBannerStore.getState()._setMounted(false);
        }
      });
      return;
    }
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 16,
        stiffness: 180,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      useBannerStore.getState().hide();
    }, duration);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
    // `seq` is bumped on each .show() call so a same-message re-show
    // re-animates instead of being a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, visible, duration]);

  if (!mounted) {
    // Skip render entirely when fully hidden so the touch surface
    // doesn't intercept anything.
    return null;
  }

  const iconName: keyof typeof Ionicons.glyphMap =
    icon ?? (type === 'success' ? 'checkmark-circle' : 'information-circle');

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          paddingTop: insets.top + spacing.sm,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Pressable
        onPress={() => useBannerStore.getState().hide()}
        style={[
          styles.card,
          type === 'success' ? styles.cardSuccess : styles.cardInfo,
        ]}
      >
        <Ionicons
          name={iconName}
          size={20}
          color={type === 'success' ? colors.primary : colors.text}
        />
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
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    zIndex: 999,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    ...shadows.card,
  },
  cardSuccess: {
    borderColor: colors.primary,
  },
  cardInfo: {
    borderColor: colors.divider,
  },
  text: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
});

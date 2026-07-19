import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { he } from '@/i18n/he';
import { useReducedMotion } from '@/hooks/animations';
import { ANIM } from './animConfig';

interface Props {
  visible: boolean;
  onComplete?: () => void;
}

const LIME = '#A3E635';

/**
 * Anim 2 — the "you moved into the roster" flourish for a real waitlist→roster
 * promotion. A ring expands + a short banner. Non-interactive overlay; the
 * caller gates it on the genuine transition (usePreviousValue + isWaitlist-
 * Promotion) and dedups by the promotion offer id, so a Firestore snapshot
 * can't replay it. Reduce Motion → a plain fade of the banner.
 */
export function WaitlistPromotionAnimation({ visible, onComplete }: Props) {
  const reduced = useReducedMotion();
  const ring = useSharedValue(0);
  const banner = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    if (reduced) {
      banner.value = withTiming(1, { duration: ANIM.duration.reducedFade });
    } else {
      ring.value = withSequence(
        withTiming(1, { duration: 260, easing: ANIM.easing.out }),
        withTiming(0, { duration: 300 }),
      );
      banner.value = withSequence(
        withTiming(1, { duration: 240, easing: ANIM.easing.out }),
        withDelay(900, withTiming(0, { duration: 260 })),
      );
    }
    const t = setTimeout(() => onComplete?.(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value,
    transform: [{ scale: 0.6 + ring.value * 0.9 }],
  }));
  const bannerStyle = useAnimatedStyle(() => ({
    opacity: banner.value,
    transform: [{ translateY: 10 * (1 - banner.value) }],
  }));

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {!reduced ? <Animated.View style={[styles.ring, ringStyle]} /> : null}
      <Animated.View style={[styles.banner, bannerStyle]}>
        <Text style={styles.bannerText}>{he.promotedToRoster}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    top: '38%',
    alignSelf: 'center',
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: LIME,
  },
  banner: {
    position: 'absolute',
    top: '44%',
    alignSelf: 'center',
    backgroundColor: 'rgba(15,23,42,0.92)',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
  },
  bannerText: { color: LIME, fontSize: 16, fontWeight: '900', textAlign: 'center' },
});

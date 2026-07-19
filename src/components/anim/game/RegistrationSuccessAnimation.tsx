import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { he } from '@/i18n/he';
import { useReducedMotion } from '@/hooks/animations';
import { ANIM } from './animConfig';

export type RegistrationAnimationVariant =
  | 'registered'
  | 'waitlisted'
  | 'pendingApproval';

interface Props {
  visible: boolean;
  variant: RegistrationAnimationVariant;
  /** Only meaningful for `registered` — adds the last-spot celebration. */
  isLastSpot?: boolean;
  onComplete?: () => void;
}

const LIME = '#A3E635';
const { width: SCREEN_W } = Dimensions.get('window');

/**
 * Anim 1 (+3) — the post-registration flourish, rendered as a NON-interactive
 * overlay so it never blocks the screen behind it. Triggered ONLY after the
 * server-confirmed bucket is known (the caller gates this). A confirmed seat
 * rolls a ball up toward the roster counter; taking the final seat adds the
 * closing goal-posts + "last spot" line. Waitlist/pending get a quiet accent —
 * no celebration of a seat that wasn't secured.
 *
 * Reduce Motion → a single short fade of the message, no travel. Best-effort:
 * always calls onComplete so the caller's state can clear even if it no-ops.
 */
export function RegistrationSuccessAnimation({
  visible,
  variant,
  isLastSpot,
  onComplete,
}: Props) {
  const reduced = useReducedMotion();
  const ballX = useSharedValue(0);
  const ballY = useSharedValue(0);
  const ballO = useSharedValue(0);
  const postL = useSharedValue(0);
  const postR = useSharedValue(0);
  const msg = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    const celebrate = variant === 'registered';
    const totalMs = isLastSpot ? ANIM.duration.celebration : 700;

    if (reduced) {
      msg.value = withTiming(1, { duration: ANIM.duration.reducedFade });
    } else if (celebrate) {
      // Ball arcs from lower-centre up toward the roster counter (top area).
      ballO.value = withSequence(
        withTiming(1, { duration: 120 }),
        withDelay(320, withTiming(0, { duration: 160 })),
      );
      ballX.value = withTiming(SCREEN_W * 0.28, { duration: 520, easing: ANIM.easing.out });
      ballY.value = withSequence(
        withTiming(-160, { duration: 300, easing: Easing.out(Easing.quad) }),
        withTiming(-120, { duration: 220, easing: Easing.in(Easing.quad) }),
      );
      if (isLastSpot) {
        postL.value = withDelay(200, withTiming(1, { duration: 460, easing: ANIM.easing.out }));
        postR.value = withDelay(200, withTiming(1, { duration: 460, easing: ANIM.easing.out }));
        msg.value = withDelay(460, withTiming(1, { duration: 320 }));
      }
    } else {
      // waitlist / pending — a quiet single fade, no seat celebration.
      msg.value = withTiming(1, { duration: 260 });
    }

    const t = setTimeout(() => onComplete?.(), totalMs + 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ballStyle = useAnimatedStyle(() => ({
    opacity: ballO.value,
    transform: [{ translateX: ballX.value }, { translateY: ballY.value }],
  }));
  const postLStyle = useAnimatedStyle(() => ({ opacity: postL.value, transform: [{ translateX: -40 * (1 - postL.value) }] }));
  const postRStyle = useAnimatedStyle(() => ({ opacity: postR.value, transform: [{ translateX: 40 * (1 - postR.value) }] }));
  const msgStyle = useAnimatedStyle(() => ({ opacity: msg.value, transform: [{ scale: 0.9 + msg.value * 0.1 }] }));

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {variant === 'registered' && !reduced ? (
        <Animated.View style={[styles.ball, ballStyle]} />
      ) : null}
      {isLastSpot && !reduced ? (
        <>
          <Animated.View style={[styles.postL, postLStyle]} />
          <Animated.View style={[styles.postR, postRStyle]} />
        </>
      ) : null}
      {isLastSpot ? (
        <Animated.View style={[styles.msgWrap, msgStyle]}>
          <Text style={styles.msgText}>{he.lastSpotTaken}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ball: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    // Darker rim so a white ball stays visible over the white roster card,
    // not just over the dark hero. Elevation gives it a shadow on Android.
    borderWidth: 2,
    borderColor: '#0F172A',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  postL: { position: 'absolute', top: '32%', height: 130, width: 4, right: '50%', backgroundColor: LIME, opacity: 0 },
  postR: { position: 'absolute', top: '32%', height: 130, width: 4, left: '50%', backgroundColor: LIME, opacity: 0 },
  msgWrap: {
    position: 'absolute',
    top: '44%',
    alignSelf: 'center',
    backgroundColor: 'rgba(15,23,42,0.9)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  msgText: { color: LIME, fontSize: 15, fontWeight: '900', textAlign: 'center' },
});

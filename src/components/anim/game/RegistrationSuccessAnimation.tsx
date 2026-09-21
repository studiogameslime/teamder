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
const LIME_DIM = 'rgba(163,230,53,0.35)';
const INK = '#0B1220';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Goal mouth, centred on the screen — the badge sits inside it. */
const GOAL_W = Math.min(330, SCREEN_W - 32);
const GOAL_H = 200;
const BAR = 6;

/**
 * The last-spot celebration is a beat of its own, not a toast: the screen dims,
 * a goal is drawn, the ball goes in, and the badge pops inside the mouth. It
 * needs time to be read — 800ms was barely a blink, and the flat pill it used
 * to be landed on top of the stats card and read as a glitch.
 */
const LAST_SPOT = {
  scrimIn: 240,
  goalDelay: 120,
  goalIn: 360,
  badgeDelay: 380,
  /** Pop + settle of the badge. */
  badgePop: 260,
  badgeSettle: 160,
  /** How long the finished frame is held before it fades away. */
  hold: 1250,
  out: 300,
};
/** Every timing below is derived from these two, so nothing drifts out of sync. */
const LAST_SPOT_ENTRANCE =
  LAST_SPOT.badgeDelay + LAST_SPOT.badgePop + LAST_SPOT.badgeSettle; // 800
const LAST_SPOT_EXIT_AT = LAST_SPOT_ENTRANCE + LAST_SPOT.hold; // 2050
const LAST_SPOT_TOTAL = LAST_SPOT_EXIT_AT + LAST_SPOT.out; // 2350
const REDUCED_TOTAL = ANIM.duration.reducedFade + 1200 + 220;

/**
 * Anim 1 (+3) — the post-registration flourish, rendered as a NON-interactive
 * overlay so it never blocks the screen behind it. Triggered ONLY after the
 * server-confirmed bucket is known (the caller gates this). A confirmed seat
 * rolls a ball up toward the roster counter; taking the final seat instead
 * shoots that ball into a drawn goal and pops the "last spot" badge inside it.
 * Waitlist/pending get nothing here — no celebration of a seat that wasn't
 * secured.
 *
 * Reduce Motion → the scrim and the badge fade in once, no travel, no goal.
 * Best-effort: always calls onComplete so the caller's state can clear even if
 * it no-ops.
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
  const scrim = useSharedValue(0);
  const goal = useSharedValue(0);
  const msg = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    // Every run starts from the idle pose. This overlay is mounted for the
    // life of the screen and only `visible` toggles, so the shared values
    // survive between runs — and a second registration on the same screen
    // (cancel → rejoin, which MatchDetails offers) would otherwise start the
    // ball from wherever the previous run parked it. The two paths no longer
    // end in the same place: the last-spot shot finishes ~half a screen up,
    // and the ordinary roll's first keyframe is -160, so an ordinary seat
    // taken after a last-spot one would have seen the ball FALL instead of
    // rise. Reset, then animate.
    ballX.value = 0;
    ballY.value = 0;
    ballO.value = 0;
    scrim.value = 0;
    goal.value = 0;
    msg.value = 0;

    const celebrate = variant === 'registered';
    const totalMs = isLastSpot
      ? reduced
        ? REDUCED_TOTAL
        : LAST_SPOT_TOTAL
      : 700;

    if (reduced) {
      if (isLastSpot) {
        scrim.value = withSequence(
          withTiming(1, { duration: ANIM.duration.reducedFade }),
          withDelay(1200, withTiming(0, { duration: 220 })),
        );
        msg.value = withSequence(
          withTiming(1, { duration: ANIM.duration.reducedFade }),
          withDelay(1200, withTiming(0, { duration: 220 })),
        );
      }
    } else if (celebrate && isLastSpot) {
      // The ball is struck from the CTA area straight into the goal mouth at
      // the centre of the screen, then vanishes as the badge lands on it.
      const rise = -(SCREEN_H * 0.5 - 130 - GOAL_H * 0.1);
      ballO.value = withSequence(
        withTiming(1, { duration: 100 }),
        withDelay(280, withTiming(0, { duration: 140 })),
      );
      ballX.value = withTiming(18, { duration: 420, easing: ANIM.easing.out });
      ballY.value = withSequence(
        withTiming(rise - 60, { duration: 260, easing: Easing.out(Easing.quad) }),
        withTiming(rise, { duration: 180, easing: Easing.in(Easing.quad) }),
      );
      scrim.value = withSequence(
        withTiming(1, { duration: LAST_SPOT.scrimIn, easing: ANIM.easing.out }),
        withDelay(
          LAST_SPOT_EXIT_AT - LAST_SPOT.scrimIn,
          withTiming(0, { duration: LAST_SPOT.out }),
        ),
      );
      goal.value = withSequence(
        withDelay(
          LAST_SPOT.goalDelay,
          withTiming(1, { duration: LAST_SPOT.goalIn, easing: ANIM.easing.out }),
        ),
        withDelay(
          LAST_SPOT_EXIT_AT - LAST_SPOT.goalDelay - LAST_SPOT.goalIn,
          withTiming(0, { duration: LAST_SPOT.out }),
        ),
      );
      // A timed pop, not a spring: withSequence waits for a spring to settle,
      // and the hold + onComplete timeout are computed from these numbers.
      msg.value = withSequence(
        withDelay(
          LAST_SPOT.badgeDelay,
          withTiming(1.12, { duration: LAST_SPOT.badgePop, easing: ANIM.easing.out }),
        ),
        withTiming(1, { duration: LAST_SPOT.badgeSettle, easing: ANIM.easing.inOut }),
        withDelay(LAST_SPOT.hold, withTiming(0, { duration: LAST_SPOT.out })),
      );
    } else if (celebrate) {
      // A normal confirmed seat: the ball rolls up toward the roster counter.
      ballO.value = withSequence(
        withTiming(1, { duration: 120 }),
        withDelay(320, withTiming(0, { duration: 160 })),
      );
      ballX.value = withTiming(SCREEN_W * 0.28, { duration: 520, easing: ANIM.easing.out });
      ballY.value = withSequence(
        withTiming(-160, { duration: 300, easing: Easing.out(Easing.quad) }),
        withTiming(-120, { duration: 220, easing: Easing.in(Easing.quad) }),
      );
    }

    const t = setTimeout(() => onComplete?.(), totalMs + 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ballStyle = useAnimatedStyle(() => ({
    opacity: ballO.value,
    transform: [{ translateX: ballX.value }, { translateY: ballY.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value * 0.55 }));
  const goalStyle = useAnimatedStyle(() => ({
    opacity: goal.value,
    transform: [
      { translateY: -18 * (1 - goal.value) },
      { scale: 0.92 + goal.value * 0.08 },
    ],
  }));
  const msgStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, msg.value * 1.4),
    transform: [
      { scale: 0.86 + msg.value * 0.14 },
      { translateY: 10 * (1 - msg.value) },
    ],
  }));

  // The host stays mounted for the life of the screen and only its CONTENT
  // toggles. Mounting/unmounting an absoluteFill View over a ScrollView leaves a
  // stale native touch region on Fabric, and the screen behind it stops
  // responding until a scroll forces the touch targets to be rebuilt — reported
  // from production as "לפעמים שלוחצים על כפתורים הם לא עובדים בכלל ולאחר שקצת
  // גוללים באותו עמוד אז ניתן אחר כך ללחוץ". The confetti host on MatchDetails
  // was already fixed this way after the same diagnosis; these two overlays,
  // which mount on the same screen right after a registration, kept the old
  // pattern. `pointerEvents="none"` alone does not save it: the stale region is
  // left behind by the unmount, not by the mounted view.
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {visible && isLastSpot ? (
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} />
      ) : null}
      {visible && variant === 'registered' && !reduced ? (
        <Animated.View style={[styles.ball, ballStyle]} />
      ) : null}
      {visible && isLastSpot ? (
        <View style={styles.centerWrap}>
          {!reduced ? (
            <Animated.View style={[styles.goal, goalStyle]}>
              <View style={styles.crossbar} />
              <View style={[styles.post, styles.postStart]} />
              <View style={[styles.post, styles.postEnd]} />
              {/* Net — a few faint lines so the frame reads as a goal. */}
              <View style={[styles.netV, { start: GOAL_W * 0.25 }]} />
              <View style={[styles.netV, { start: GOAL_W * 0.5 }]} />
              <View style={[styles.netV, { start: GOAL_W * 0.75 }]} />
              <View style={[styles.netH, { top: GOAL_H * 0.35 }]} />
              <View style={[styles.netH, { top: GOAL_H * 0.65 }]} />
            </Animated.View>
          ) : null}
          <Animated.View style={[styles.badge, msgStyle]}>
            <View style={styles.emblem}>
              <Text style={styles.emblemText}>⚽</Text>
            </View>
            <Text style={styles.title}>{he.lastSpotTaken}</Text>
            <Text style={styles.subtitle}>{he.lastSpotTakenSub}</Text>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: '#020617' },
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
  // One centred stack instead of a pill pinned at 44% of the screen, which is
  // what used to land half on top of the weather/occupancy card.
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goal: {
    position: 'absolute',
    width: GOAL_W,
    height: GOAL_H,
  },
  crossbar: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    height: BAR,
    borderRadius: BAR / 2,
    backgroundColor: LIME,
  },
  post: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: BAR,
    borderRadius: BAR / 2,
    backgroundColor: LIME,
  },
  postStart: { start: 0 },
  postEnd: { end: 0 },
  netV: {
    position: 'absolute',
    top: BAR,
    bottom: 0,
    width: 1,
    backgroundColor: LIME_DIM,
  },
  netH: {
    position: 'absolute',
    start: BAR,
    end: BAR,
    height: 1,
    backgroundColor: LIME_DIM,
  },
  badge: {
    maxWidth: GOAL_W - 72,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 30,
    paddingBottom: 18,
    borderRadius: 22,
    backgroundColor: INK,
    borderWidth: 1,
    borderColor: 'rgba(163,230,53,0.45)',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  emblem: {
    position: 'absolute',
    top: -22,
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIME,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  emblemText: { fontSize: 22, lineHeight: 26 },
  title: {
    color: LIME,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  subtitle: {
    marginTop: 4,
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});

// ScreenEntrance — the entrance every main card/section shares.
//
// Fade + a short rise, staggered a little between siblings. Deliberately
// small: the goal is a screen that feels settled, not a screen where the user
// notices an animation.
//
// ONE-SHOT, AND IT MEANS IT. AppearItem (which this replaces for screen-level
// use) animates in a mount effect, so it replays whenever React remounts the
// subtree — and these screens refetch on focus and re-key their lists by
// item id, so a routine data refresh made every card slide again. Here the
// played flag lives in a ref that survives re-render, and the animation is
// keyed to the FIRST mount only. A state change that isn't navigation can
// never move a card.
//
// `hero` gives one card per screen a little more presence: it starts slightly
// lower, slightly smaller, and takes slightly longer. That is the whole of the
// hero treatment — no size change, no shadow change, no colour.

import React, { useEffect, useRef } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { motion } from '@/theme/motion';

interface Props {
  children: React.ReactNode;
  /** Position among siblings — drives the stagger. Omit for a lone card. */
  index?: number;
  /** The one card on the screen that carries the screen's purpose. Never set
   *  this on more than one, and never on a card that is also indexed into the
   *  ordinary flow — that is two entrances on one element. */
  hero?: boolean;
  style?: ViewStyle;
}

export function ScreenEntrance({ children, index = 0, hero = false, style }: Props) {
  const reduced = useReducedMotion();
  // Read once. Flipping Reduce Motion mid-screen must not restart anything.
  const reducedAtMount = useRef(reduced);
  const opacity = useSharedValue(0);
  const offset = useSharedValue(
    reducedAtMount.current ? 0 : hero ? motion.entrance.heroOffsetY : motion.entrance.offsetY,
  );
  const scale = useSharedValue(
    !reducedAtMount.current && hero ? motion.entrance.heroScaleFrom : 1,
  );
  const played = useRef(false);

  useEffect(() => {
    if (played.current) return;
    played.current = true;

    if (reducedAtMount.current) {
      // Reduce Motion: a plain short fade, no travel and no scale. The content
      // still arrives softly rather than snapping, which is the part of the
      // effect that isn't motion.
      opacity.value = withTiming(1, { duration: motion.duration.reducedFade });
      return;
    }

    const delay = Math.min(index * motion.entrance.staggerMs, motion.entrance.staggerCapMs);
    const duration = hero ? motion.duration.slow : motion.duration.normal;
    const timing = { duration, easing: motion.easing.out };
    opacity.value = withDelay(delay, withTiming(1, timing));
    offset.value = withDelay(delay, withTiming(0, timing));
    scale.value = withDelay(delay, withTiming(1, timing));
  }, [hero, index, offset, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    // transform only — nothing here can reflow the layout around it.
    transform: [{ translateY: offset.value }, { scale: scale.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

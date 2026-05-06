// StepIndicator — wizard progress bar shared by GameWizardForm and the
// 2-step Create-Group wizard.
//
// Visual model: each step renders as a gray football-outline at a fixed
// flex position. A single primary-green football overlays the bar and
// rolls between step centers when `current` changes — translateX +
// continuous rotation, so it reads as a ball physically rolling.
//
// RTL note: we anchor the overlay with `start: <step-1-offset>` (which
// resolves to the visual right under forceRTL) and translate positive
// toward `end` (visual left under RTL). Both `start` and translateX are
// RTL-aware in RN, so we don't need an `I18nManager.isRTL` branch.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  I18nManager,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';

const ITEM_WIDTH = 76;
const ICON_SIZE = 28;
const ICON_SIZE_CURRENT = 32;
// Used to convert linear travel distance into rotation degrees so the
// ball spins like it's rolling on a surface. 2π·r matches a physical
// roll exactly, but we cap it slightly tighter to make a 2-step move
// feel like ~3 full turns (visually clearer than ~2.5).
const CIRCUMFERENCE = ICON_SIZE_CURRENT * 3;
const ROLL_DURATION_MS = 900;

interface Props {
  /** 1-based current step number. */
  current: number;
  /** Step labels in display order. The component derives count from length. */
  labels: string[];
}

export function StepIndicator({ current, labels }: Props) {
  // Bar width drives the deterministic step-center math below — saves
  // us from per-item onLayout (which on Android+forceRTL can report
  // either logical or physical x depending on RN version).
  const [barWidth, setBarWidth] = useState(0);

  const x = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const rotationValue = useRef(0);
  const lastCurrent = useRef(current);
  const hasPlacedRef = useRef(false);

  // Distance, in px along the writing direction, between two adjacent
  // step centers. With `flexDirection:'row'` and connectors that
  // flex-grow, the items end up evenly distributed across the bar:
  //   start-of-first-item .. start-of-last-item = barInnerWidth - itemWidth
  // Divided by (steps - 1) gives the per-step stride.
  const innerWidth = Math.max(0, barWidth - spacing.lg * 2);
  const stepDistance =
    labels.length > 1
      ? (innerWidth - ITEM_WIDTH) / (labels.length - 1)
      : 0;
  // `transform: translateX` is NOT RTL-aware — positive always moves
  // the element to the physical right. Under forceRTL we want forward
  // motion to go visually LEFT (matching Hebrew reading order from
  // step 1 on the right to step 2 on the left), so we flip the sign.
  const dir = I18nManager.isRTL ? -1 : 1;

  useEffect(() => {
    if (barWidth === 0) return;
    const target = stepDistance * (current - 1) * dir;
    const fromCurrent = lastCurrent.current;
    lastCurrent.current = current;

    // Snap into place on first measure (without an animation), then
    // animate every subsequent step change.
    if (!hasPlacedRef.current) {
      hasPlacedRef.current = true;
      x.setValue(target);
      return;
    }

    // Spin tied to the actual linear distance traveled — one full
    // turn per `circumference` pixels of travel, like a ball rolling
    // on a real surface. Sign multiplied by `dir` so under RTL the
    // ball spins counter-clockwise as it moves visually left.
    const linearDistance = Math.abs(stepDistance * (current - fromCurrent));
    const spin = (linearDistance / CIRCUMFERENCE) * 360 *
      (current > fromCurrent ? 1 : -1) * dir;
    rotationValue.current += spin;

    // Single timing animation for both translation and rotation so they
    // stay perfectly in lockstep — the rolling illusion breaks if the
    // spin and the slide are out of phase. Slow ease-out (~900ms) gives
    // the ball time to "settle" into the new step.
    Animated.parallel([
      Animated.timing(x, {
        toValue: target,
        duration: ROLL_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rotation, {
        toValue: rotationValue.current,
        duration: ROLL_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, stepDistance]);

  const onBarLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== barWidth) setBarWidth(w);
  };

  const rotate = rotation.interpolate({
    inputRange: [-36000, 36000],
    outputRange: ['-36000deg', '36000deg'],
  });

  return (
    <View style={styles.bar} onLayout={onBarLayout}>
      {labels.map((label, i) => (
        <React.Fragment key={i}>
          <View style={styles.item}>
            <View style={styles.staticBallSlot}>
              <Ionicons
                name="football-outline"
                size={ICON_SIZE}
                color={colors.border}
              />
            </View>
            <Text
              style={[
                styles.label,
                i + 1 === current && styles.labelCurrent,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
          {i < labels.length - 1 ? (
            <View style={styles.connector} />
          ) : null}
        </React.Fragment>
      ))}

      {barWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activeBall,
            {
              transform: [{ translateX: x }, { rotate }],
            },
          ]}
        >
          <Ionicons
            name="football"
            size={ICON_SIZE_CURRENT}
            color="#3B82F6"
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 4,
    position: 'relative',
  },
  item: {
    alignItems: 'center',
    gap: 6,
    width: ITEM_WIDTH,
  },
  staticBallSlot: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelCurrent: {
    color: colors.text,
    fontWeight: '800',
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
    marginTop: 17,
    marginHorizontal: 2,
    borderRadius: 1,
  },
  // Overlay ball — anchored at writing-direction `start` (visual right
  // under RTL), centered horizontally over step 1's ball slot. The
  // translateX animation slides it toward `end` (visual left under
  // RTL) so the ball rolls in the natural reading direction.
  activeBall: {
    position: 'absolute',
    // Step-1 horizontal: bar paddingHorizontal + half the item-width
    // gap to the icon-slot center, minus half the ball size to centre.
    start: spacing.lg + (ITEM_WIDTH - ICON_SIZE_CURRENT) / 2,
    // Vertical alignment with the gray static balls.
    top: spacing.md + (36 - ICON_SIZE_CURRENT) / 2,
    width: ICON_SIZE_CURRENT,
    height: ICON_SIZE_CURRENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

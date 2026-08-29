// PenaltyPitch — the penalty area, and only the penalty area.
//
// A whole pitch would be mostly empty grass: a shootout happens inside the box,
// so the box IS the frame. Goal, six-yard box, penalty box, spot and the D —
// nothing else, which leaves the two slots (keeper in the goal, kicker on the
// spot) as the only things asking to be touched.
//
// The markings are drawn, not an image: an asset would have to ship at several
// densities, could not recolour, and would go soft on a tall screen. SVG in a
// viewBox scales to any sheet width for free.
//
// The slots are positioned in PERCENTAGES of the same viewBox the lines use, so
// an avatar sits exactly on the spot and inside the goal mouth at every size.
// Change a line and the slot follows it.

import React from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Path, G } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { colors, radius } from '@/theme';

// ── The geometry, once. Everything below reads from here, so the pitch and the
//    things standing on it can never disagree about where the spot is. ──
const VB = { w: 100, h: 122 };
/** The goal line. Everything is measured from it, as on a real pitch. */
const GOAL_LINE = 20;
/** The goal, drawn ABOVE the line — we are looking at it from the spot. */
const GOAL = { x: 30, y: 4, w: 40, h: GOAL_LINE - 4 };
/** Six-yard box. */
const SIX = { x: 20, y: GOAL_LINE, w: 60, h: 20 };
/** Penalty box. */
const BOX = { x: 6, y: GOAL_LINE, w: 88, h: 66 };
/** The penalty spot. */
const SPOT = { x: 50, y: 66 };
/** The kicker stands ON the spot: the avatar is centred just above it so his
 *  feet land on the mark and the ball sits at them. */
const KICKER = { x: 50, y: 58 };
/** The keeper, on his line in the middle of the mouth. */
const KEEPER = { x: 50, y: GOAL_LINE - 5 };
/** The D. Big enough to actually bulge past the box, which is the whole point
 *  of the marking — the first geometry had a radius smaller than the distance
 *  from the spot to the edge of the box, so the arc existed entirely inside it
 *  and nothing was drawn. */
const ARC_R = 26;

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/** Percent-of-container position for anything standing on the pitch. */
export const PITCH_POS = {
  spot: { left: pct(SPOT.x, VB.w), top: pct(SPOT.y, VB.h) },
  kicker: { left: pct(KICKER.x, VB.w), top: pct(KICKER.y, VB.h) },
  keeper: { left: pct(KEEPER.x, VB.w), top: pct(KEEPER.y, VB.h) },
} as const;

/** The D at the top of the box — the arc of a circle centred on the spot,
 *  clipped to the part that falls OUTSIDE the box. Drawn by hand because an
 *  ellipse would have to be clipped and a path is exact. */
function penaltyArc(): string {
  const y = BOX.y + BOX.h; // the box's lower line
  const dx = Math.sqrt(Math.max(0, ARC_R * ARC_R - (y - SPOT.y) ** 2));
  if (dx < 1) return ''; // radius too small to leave the box — draw nothing
  return `M ${SPOT.x - dx} ${y} A ${ARC_R} ${ARC_R} 0 0 0 ${SPOT.x + dx} ${y}`;
}

interface SlotProps {
  /** Rendered when nobody is chosen yet. */
  placeholder: string;
  /** The chosen person, if any. */
  filled?: React.ReactNode;
  onPress: () => void;
  tint: string;
  style: ViewStyle;
  /** The kicker's name goes ABOVE his head — below it would sit exactly where
   *  the ball rests at his feet. The keeper keeps his underneath, where the
   *  six-yard box is empty. */
  labelAbove?: boolean;
  testID?: string;
}

function Slot({ placeholder, filled, onPress, tint, style, testID, labelAbove }: SlotProps) {
  const label = filled ? null : (
    <Text style={styles.slotLabel} numberOfLines={1}>
      {placeholder}
    </Text>
  );
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        styles.slot,
        labelAbove && { flexDirection: 'column-reverse' as const },
        style,
        pressed && { opacity: 0.75 },
      ]}
    >
      {filled ?? (
        <View style={[styles.empty, { borderColor: tint }]}>
          <Text style={[styles.plus, { color: tint }]}>+</Text>
        </View>
      )}
      {label}
    </Pressable>
  );
}

interface Props {
  /** Slot contents — an avatar + name once chosen. */
  keeperNode?: React.ReactNode;
  kickerNode?: React.ReactNode;
  keeperLabel: string;
  kickerLabel: string;
  onPressKeeper: () => void;
  onPressKicker: () => void;
  keeperTint: string;
  kickerTint: string;
  /** Ball + keeper transforms, driven by the caller so the animation can be
   *  sequenced with recording the kick. */
  ball: { x: SharedValue<number>; y: SharedValue<number>; scale: SharedValue<number> };
  /** A lunge, not a spin: `scale` squashes slightly at full stretch. Rotation
   *  was tried and is invisible on a round avatar — all it did was tilt the
   *  letter inside it, and drag the name plate round with it. */
  keeperDive: { x: SharedValue<number>; y: SharedValue<number>; scale: SharedValue<number> };
}

export function PenaltyPitch({
  keeperNode,
  kickerNode,
  keeperLabel,
  kickerLabel,
  onPressKeeper,
  onPressKicker,
  keeperTint,
  kickerTint,
  ball,
  keeperDive,
}: Props) {
  const ballStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ball.x.value },
      { translateY: ball.y.value },
      { scale: ball.scale.value },
    ],
  }));
  const keeperStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: keeperDive.x.value },
      { translateY: keeperDive.y.value },
      { scale: keeperDive.scale.value },
    ],
  }));

  return (
    <View style={styles.wrap}>
      <Svg viewBox={`0 0 ${VB.w} ${VB.h}`} style={StyleSheet.absoluteFill}>
        {/* Grass, and two mown bands so it reads as a pitch rather than a
            green rectangle. Kept very close in tone — stripes that contrast
            would compete with the white lines. */}
        <Rect x={0} y={0} width={VB.w} height={VB.h} fill="#3F8F4A" />
        <Rect x={0} y={20} width={VB.w} height={24} fill="#3A8544" />
        <Rect x={0} y={68} width={VB.w} height={24} fill="#3A8544" />
        <G stroke="#FFFFFF" strokeWidth={0.9} fill="none" strokeLinecap="square">
          {/* Goal line runs the full width — the box is only part of it. */}
          <Path d={`M 0 ${GOAL_LINE} H ${VB.w}`} />
          <Rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} />
          <Rect x={SIX.x} y={SIX.y} width={SIX.w} height={SIX.h} />
          <Path d={penaltyArc()} />
        </G>
        {/* The goal, seen from the spot: a net behind a heavy frame. Heavier
            than the markings on purpose — it is a structure, not a line
            painted on grass. */}
        <G>
          <Rect
            x={GOAL.x}
            y={GOAL.y}
            width={GOAL.w}
            height={GOAL.h}
            fill="#FFFFFF"
            fillOpacity={0.16}
          />
          <G stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={0.35}>
            {[...Array(9)].map((_, i) => {
              const x = GOAL.x + ((i + 1) * GOAL.w) / 10;
              return <Path key={`v${i}`} d={`M ${x} ${GOAL.y} V ${GOAL.y + GOAL.h}`} />;
            })}
            {[...Array(4)].map((_, i) => {
              const y = GOAL.y + ((i + 1) * GOAL.h) / 5;
              return <Path key={`h${i}`} d={`M ${GOAL.x} ${y} H ${GOAL.x + GOAL.w}`} />;
            })}
          </G>
          {/* Posts and crossbar. The goal line itself closes the bottom. */}
          <Path
            d={`M ${GOAL.x} ${GOAL.y + GOAL.h} V ${GOAL.y} H ${GOAL.x + GOAL.w} V ${GOAL.y + GOAL.h}`}
            stroke="#FFFFFF"
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
          />
        </G>
        <Circle cx={SPOT.x} cy={SPOT.y} r={1.1} fill="#FFFFFF" />
      </Svg>

      {/* ── the two slots ── */}
      {/* The keeper IS the diving element rather than a copy of it: a separate
          animated layer on top would slide away and reveal the static original
          underneath at the very moment everyone is looking at it. The tap
          target travels with the dive, which costs nothing — there is nothing
          to tap once the ball is moving. */}
      <Animated.View style={[styles.animSlot, PITCH_POS.keeper as ViewStyle, keeperStyle]}>
        <Slot
          testID="penalty-keeper-slot"
          placeholder={keeperLabel}
          filled={keeperNode}
          onPress={onPressKeeper}
          tint={keeperTint}
          style={styles.slotInner}
        />
      </Animated.View>
      <Slot
        testID="penalty-kicker-slot"
        placeholder={kickerLabel}
        filled={kickerNode}
        onPress={onPressKicker}
        tint={kickerTint}
        labelAbove
        style={{ ...PITCH_POS.kicker } as ViewStyle}
      />

      <Animated.View
        pointerEvents="none"
        style={[styles.ball, PITCH_POS.spot as ViewStyle, ballStyle]}
      >
        {/* An actual ball: white leather with the panel seams over it. A plain
            white disc read as a marker on the grass, not as something to
            kick. */}
        <View style={styles.ballDot}>
          <Ionicons name="football" size={13} color="#111827" />
        </View>
      </Animated.View>
    </View>
  );
}

const SLOT = 52;

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: VB.w / VB.h,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#3F8F4A',
  },
  // Every element on the pitch is centred on its own point, so the percent
  // position above lands on the FEET of the marking rather than a corner.
  slot: {
    position: 'absolute',
    width: SLOT,
    marginLeft: -SLOT / 2,
    marginTop: -SLOT / 2,
    alignItems: 'center',
    gap: 3,
  },
  empty: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: { fontSize: 22, fontWeight: '900', lineHeight: 26 },
  slotLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    width: SLOT + 34,
    marginLeft: -17,
  },
  // Wrapper that carries the dive transform; the slot inside it is positioned
  // at 0,0 because the wrapper already sits on the keeper's point.
  animSlot: {
    position: 'absolute',
    width: SLOT,
    marginLeft: -SLOT / 2,
    marginTop: -SLOT / 2,
  },
  slotInner: { position: 'relative', marginLeft: 0, marginTop: 0 },
  ball: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    marginTop: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

export const PENALTY_GEOMETRY = { VB, GOAL, BOX, SPOT, KICKER, KEEPER };

// AnimatedWeatherIcon — a small living weather glyph driven by the WMO
// forecast code: the sun's rays rotate, clouds drift, rain/snow fall,
// lightning flashes, fog slides. Replaces the static Ionicon in the match
// stats strip. Falls back to a day/night sun-or-moon when there's no code.

import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import { weatherKind, type WeatherKind } from '@/utils/heroAtmosphere';

interface Props {
  /** WMO weather code. Omit → day/night sun-or-moon fallback. */
  code?: number;
  /** Evening/early-morning kickoff → moon instead of sun for clear/partly. */
  isNight?: boolean;
  size?: number;
  style?: ViewStyle;
}

const SUN = '#F59E0B';
const MOON = '#CBD5E1';
const CLOUD = '#CBD5E1';
const CLOUD_DARK = '#94A3B8';
const RAIN = '#60A5FA';
const SNOW = '#E2E8F0';
const BOLT = '#FBBF24';

export function AnimatedWeatherIcon({ code, isNight, size = 30, style }: Props) {
  const kind = code == null ? (isNight ? 'clearNight' : 'clear') : resolve(code, isNight);
  return (
    <View style={[{ width: size, height: size }, style]}>
      {kind === 'clear' ? <Sun size={size} /> : null}
      {kind === 'clearNight' ? <Moon size={size} /> : null}
      {kind === 'partly' ? <Partly size={size} night={false} /> : null}
      {kind === 'partlyNight' ? <Partly size={size} night /> : null}
      {kind === 'clouds' ? <Clouds size={size} /> : null}
      {kind === 'rain' ? <Precip size={size} snow={false} /> : null}
      {kind === 'snow' ? <Precip size={size} snow /> : null}
      {kind === 'storm' ? <Storm size={size} /> : null}
      {kind === 'fog' ? <Fog size={size} /> : null}
    </View>
  );
}

type Glyph =
  | 'clear'
  | 'clearNight'
  | 'partly'
  | 'partlyNight'
  | 'clouds'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog';

function resolve(code: number, isNight?: boolean): Glyph {
  const k: WeatherKind = weatherKind(code);
  if (k === 'clear') {
    // code 1 reads as "mostly clear" — keep it a clean sun/moon; code 0 too.
    return isNight ? 'clearNight' : 'clear';
  }
  if (k === 'clouds') {
    // 2 = partly cloudy, 3 = overcast.
    if (code === 2) return isNight ? 'partlyNight' : 'partly';
    return 'clouds';
  }
  if (k === 'rain') return 'rain';
  if (k === 'snow') return 'snow';
  if (k === 'storm') return 'storm';
  if (k === 'fog') return 'fog';
  return isNight ? 'clearNight' : 'clear';
}

// ── Sun: rotating rays + gentle pulse ──────────────────────────────────
function Sun({ size }: { size: number }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(
      withTiming(360, { duration: 14000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(spin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rayStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${spin.value}deg` }],
  }));
  const c = size / 2;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, rayStyle]}>
        <Svg width={size} height={size}>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * 2 * Math.PI;
            return (
              <Line
                key={i}
                x1={c + Math.cos(a) * size * 0.3}
                y1={c + Math.sin(a) * size * 0.3}
                x2={c + Math.cos(a) * size * 0.46}
                y2={c + Math.sin(a) * size * 0.46}
                stroke={SUN}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
        </Svg>
      </Animated.View>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={c} cy={c} r={size * 0.2} fill={SUN} />
      </Svg>
    </View>
  );
}

// ── Moon: crescent + a twinkling star ──────────────────────────────────
function Moon({ size }: { size: number }) {
  const twinkle = useSharedValue(0.4);
  useEffect(() => {
    twinkle.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200 }),
        withTiming(0.3, { duration: 1200 }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(twinkle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const starStyle = useAnimatedStyle(() => ({ opacity: twinkle.value }));
  const c = size / 2;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg width={size} height={size}>
        {/* Crescent: a full disc with an offset disc punched out via a
            same-bg overlay — here we just draw a filled crescent path. */}
        <Path d={crescent(c, c, size * 0.27)} fill={MOON} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, starStyle]}>
        <Svg width={size} height={size}>
          <Circle cx={size * 0.74} cy={size * 0.26} r={1.6} fill="#FFFFFF" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// Crescent: an outer semicircle closed by a tighter inner arc that carves
// the "bite", leaving a waxing crescent.
function crescent(cx: number, cy: number, r: number): string {
  const top = `${cx} ${cy - r}`;
  const bot = `${cx} ${cy + r}`;
  return (
    `M ${top} ` +
    `A ${r} ${r} 0 1 0 ${bot} ` + // outer arc (left side)
    `A ${r * 1.15} ${r * 1.15} 0 0 1 ${top} Z` // inner arc carves the bite
  );
}

// ── Drifting cloud (reused) ────────────────────────────────────────────
function CloudShape({ size, color }: { size: number; color: string }) {
  const s = size;
  return (
    <Svg width={s} height={s}>
      <Circle cx={s * 0.36} cy={s * 0.58} r={s * 0.16} fill={color} />
      <Circle cx={s * 0.54} cy={s * 0.5} r={s * 0.2} fill={color} />
      <Circle cx={s * 0.7} cy={s * 0.58} r={s * 0.15} fill={color} />
      <Path
        d={`M ${s * 0.34} ${s * 0.72} H ${s * 0.72} a ${s * 0.07} ${s * 0.07} 0 0 0 0 -${s * 0.14} H ${s * 0.34} a ${s * 0.07} ${s * 0.07} 0 0 0 0 ${s * 0.14} Z`}
        fill={color}
      />
    </Svg>
  );
}

function DriftCloud({ size, color }: { size: number; color: string }) {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(
      withSequence(
        withTiming(size * 0.05, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
        withTiming(-size * 0.05, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <CloudShape size={size} color={color} />
    </Animated.View>
  );
}

function Clouds({ size }: { size: number }) {
  return <DriftCloud size={size} color={CLOUD} />;
}

// ── Sun/Moon peeking behind a cloud ────────────────────────────────────
function Partly({ size, night }: { size: number; night: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: -size * 0.14 }, { translateY: -size * 0.14 }, { scale: 0.7 }] }]}>
        {night ? <Moon size={size} /> : <Sun size={size} />}
      </View>
      <DriftCloud size={size} color={CLOUD} />
    </View>
  );
}

// ── Rain / Snow: cloud + falling drops/flakes ──────────────────────────
function Precip({ size, snow }: { size: number; snow: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { transform: [{ translateY: -size * 0.12 }] }]}>
        <CloudShape size={size} color={CLOUD_DARK} />
      </View>
      {[0, 1, 2].map((i) => (
        <FallingDrop key={i} size={size} index={i} snow={snow} />
      ))}
    </View>
  );
}

function FallingDrop({ size, index, snow }: { size: number; index: number; snow: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(
      index * 280,
      withRepeat(withTiming(1, { duration: 900, easing: Easing.in(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const startY = size * 0.66;
  const endY = size * 0.92;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - y.value,
    transform: [{ translateY: startY + (endY - startY) * y.value }],
  }));
  const left = size * (0.34 + index * 0.16);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size}>
        {snow ? (
          <Circle cx={left} cy={0} r={size * 0.05} fill={SNOW} />
        ) : (
          <Line x1={left} y1={0} x2={left} y2={size * 0.12} stroke={RAIN} strokeWidth={2} strokeLinecap="round" />
        )}
      </Svg>
    </Animated.View>
  );
}

// ── Storm: cloud + flashing bolt ───────────────────────────────────────
function Storm({ size }: { size: number }) {
  const flash = useSharedValue(0);
  useEffect(() => {
    flash.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 120 }),
        withTiming(0.2, { duration: 160 }),
        withTiming(1, { duration: 120 }),
        withDelay(1800, withTiming(0.2, { duration: 200 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(flash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const boltStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const s = size;
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { transform: [{ translateY: -size * 0.12 }] }]}>
        <CloudShape size={size} color={CLOUD_DARK} />
      </View>
      <Animated.View style={[StyleSheet.absoluteFill, boltStyle]}>
        <Svg width={s} height={s}>
          <Polygon
            points={`${s * 0.5},${s * 0.6} ${s * 0.4},${s * 0.82} ${s * 0.5},${s * 0.82} ${s * 0.44},${s * 0.98} ${s * 0.62},${s * 0.74} ${s * 0.52},${s * 0.74}`}
            fill={BOLT}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ── Fog: drifting horizontal bars ──────────────────────────────────────
function Fog({ size }: { size: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      {[0, 1, 2].map((i) => (
        <FogBar key={i} size={size} index={i} />
      ))}
    </View>
  );
}

function FogBar({ size, index }: { size: number; index: number }) {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withDelay(
      index * 300,
      withRepeat(
        withSequence(
          withTiming(size * 0.1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
          withTiming(-size * 0.1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const y = size * (0.36 + index * 0.18);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size}>
        <Line x1={size * 0.2} y1={y} x2={size * 0.8} y2={y} stroke={CLOUD} strokeWidth={2.5} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

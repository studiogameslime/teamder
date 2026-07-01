// RatingSlider — decimal internal-rating input on a 1.0–5.0 scale, one decimal
// (e.g. 4.3). A draggable/tappable track (built on PanResponder so it needs no
// native slider module), a big value read-out, a row of 5 stars that fill to
// match the value, tick labels 1–5, and a "לא דורג" clear that resets to
// unrated (0). The track is laid out LTR (1 left → 5 right) so the position
// math stays simple under the app's RTL.

import React, { useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, typography } from '@/theme';
import { selectionHaptic } from '@/utils/haptics';
import { RATING_MAX, RATING_MIN, formatRating, isRated, snapRating } from '@/utils/rating';
import { he } from '@/i18n/he';

interface Props {
  /** Current value (0 = unrated). */
  value: number;
  onChange?: (next: number) => void;
  readonly?: boolean;
}

const THUMB = 26;
const STAR = 30;
const SPAN = RATING_MAX - RATING_MIN; // 4
const STARS = [1, 2, 3, 4, 5];
// Track runs 0→5, so the tick labels must start at 0 (6 evenly-spaced marks
// align with the track: 0 at the left edge, 5 at the right).
const TICKS = [0, 1, 2, 3, 4, 5];

export function RatingSlider({ value, onChange, readonly = false }: Props) {
  const [trackW, setTrackW] = useState(0);
  const widthRef = useRef(0);
  const rated = isRated(value);

  const emit = (locationX: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const ratio = Math.min(1, Math.max(0, locationX / w));
    onChange?.(snapRating(RATING_MIN + ratio * SPAN));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !readonly,
      onMoveShouldSetPanResponder: () => !readonly,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        selectionHaptic();
        emit(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e: GestureResponderEvent) => emit(e.nativeEvent.locationX),
    }),
  ).current;

  // Filled fraction of the track (0 when unrated).
  const frac = rated ? Math.min(1, Math.max(0, (value - RATING_MIN) / SPAN)) : 0;
  const fillW = trackW * frac;

  // How much of star `s` is filled, 0..1 — fills continuously so every 0.1
  // adds a sliver (e.g. 3.2 → the 4th star is 20% filled from the left).
  const starFill = (s: number): number =>
    rated ? Math.min(1, Math.max(0, value - (s - 1))) : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        {/* LRM marks (U+200E) bracket the LTR numeric run so "3.5 / 5" doesn't
            reorder to "5 / 3.5" inside the RTL screen — same fix the count
            strings in he.ts use. */}
        <Text style={[styles.value, !rated && styles.valueMuted]}>
          {'‎'}
          {formatRating(value)}
          {rated ? <Text style={styles.outOf}> / {RATING_MAX}</Text> : null}
          {'‎'}
        </Text>
        {rated && !readonly ? (
          <Pressable
            onPress={() => {
              selectionHaptic();
              onChange?.(0);
            }}
            hitSlop={8}
            style={styles.clearBtn}
          >
            <Text style={styles.clearTxt}>{he.ratingClear}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Stars — each fills continuously: an outline base with a clipped solid
          star overlaid, revealed left→right in proportion to the value. */}
      <View style={styles.stars}>
        {STARS.map((s) => {
          const f = starFill(s);
          return (
            <View key={s} style={styles.star}>
              <Ionicons name="star-outline" size={STAR} color={colors.border} />
              {f > 0 ? (
                <View style={[styles.starFill, { width: STAR * f }]} pointerEvents="none">
                  <Ionicons name="star" size={STAR} color={colors.primary} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Track (LTR: 1 left → 5 right) */}
      <View
        style={styles.trackArea}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          widthRef.current = w;
          setTrackW(w);
        }}
        {...pan.panHandlers}
      >
        <View style={styles.track} pointerEvents="none">
          {rated ? <View style={[styles.fill, { width: fillW }]} /> : null}
        </View>
        {rated ? (
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: Math.min(trackW - THUMB / 2, Math.max(-THUMB / 2, fillW - THUMB / 2)) }]}
          />
        ) : null}
      </View>

      <View style={styles.ticks}>
        {TICKS.map((t) => (
          <Text key={t} style={styles.tick}>
            {t}
          </Text>
        ))}
      </View>
      {!rated ? <Text style={styles.hint}>{he.ratingDragHint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 8, direction: 'ltr' },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    direction: 'rtl',
  },
  value: { fontSize: 34, fontWeight: '900', color: colors.primary, fontVariant: ['tabular-nums'] },
  valueMuted: { color: colors.textMuted, fontSize: 26 },
  outOf: { fontSize: 18, fontWeight: '700', color: colors.textMuted },
  clearBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  clearTxt: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  star: { width: STAR, height: STAR },
  starFill: { position: 'absolute', top: 0, left: 0, height: STAR, overflow: 'hidden' },
  trackArea: { height: THUMB + 8, justifyContent: 'center' },
  track: { height: 10, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.primary, borderRadius: 999 },
  thumb: {
    position: 'absolute',
    top: 4,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: colors.primary,
    shadowColor: '#0B1220',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  tick: { ...typography.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

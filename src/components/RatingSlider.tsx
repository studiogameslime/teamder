// RatingSlider — decimal internal-rating input on a 0.5–5.0 scale, one decimal
// (e.g. 4.3). A draggable/tappable track (built on PanResponder so it needs no
// native slider module), a big value read-out, tick labels 0–5, and a
// "לא דורג" clear that resets to unrated (0). The track itself is laid out LTR
// (0 left → 5 right) so the position math stays simple under the app's RTL.

import React, { useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
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

export function RatingSlider({ value, onChange, readonly = false }: Props) {
  const [trackW, setTrackW] = useState(0);
  const widthRef = useRef(0);
  const rated = isRated(value);

  const emit = (locationX: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const ratio = Math.min(1, Math.max(0, locationX / w));
    onChange?.(snapRating(ratio * RATING_MAX));
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
  const frac = rated ? Math.min(1, Math.max(0, value / RATING_MAX)) : 0;
  const fillW = trackW * frac;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={[styles.value, !rated && styles.valueMuted]}>
          {formatRating(value)}
          {rated ? <Text style={styles.outOf}> / {RATING_MAX}</Text> : null}
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

      {/* Track (LTR: 0 left → 5 right) */}
      <View
        style={styles.trackArea}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          widthRef.current = w;
          setTrackW(w);
        }}
        {...pan.panHandlers}
      >
        <View style={styles.track}>
          {rated ? <View style={[styles.fill, { width: fillW }]} /> : null}
        </View>
        {rated ? (
          <View
            style={[styles.thumb, { left: Math.min(trackW - THUMB / 2, Math.max(-THUMB / 2, fillW - THUMB / 2)) }]}
          />
        ) : null}
      </View>

      <View style={styles.ticks}>
        {[0, 1, 2, 3, 4, 5].map((t) => (
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

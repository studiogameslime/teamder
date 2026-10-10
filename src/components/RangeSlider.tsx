// A dependency-free horizontal slider (PanResponder + Views) so we don't
// pull in a native module mid-release. LTR track (min on the left, max on
// the right) with a filled blue portion and a white thumb that shows the
// current value inside it — matches the availability "search range" mockup.

import React, { useCallback, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '@/theme';

interface Props {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  /** Text rendered inside the thumb (defaults to the raw value). */
  thumbLabel?: string;
  accent?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}

const THUMB = 44;

export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  thumbLabel,
  accent = colors.primary,
  accessibilityLabel = 'טווח חיפוש',
  disabled = false,
}: Props) {
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const latest = useRef({ min, max, step, onChange, disabled });
  latest.current = { min, max, step, onChange, disabled };

  const clampToStep = useCallback(
    (raw: number) => {
      const stepped = min + Math.round((raw - min) / step) * step;
      return Math.min(max, Math.max(min, stepped));
    },
    [min, max, step],
  );

  const fromX = useCallback(
    (x: number) => {
      const { min, max, step } = latest.current;
      const w = trackWRef.current - THUMB;
      if (w <= 0) return min;
      const ratio = Math.min(1, Math.max(0, x / w));
      const raw = min + ratio * (max - min);
      return Math.min(max, Math.max(min, min + Math.round((raw - min) / step) * step));
    },
    [min, max, clampToStep],
  );

  const responder = useRef(
    PanResponder.create({
      // Claim the touch as soon as it lands on the track — and CAPTURE it
      // before an enclosing ScrollView can. Without this the slider sits
      // dead inside a scroll view (the scroll view swallows the drag), and
      // a plain tap on the track did nothing. The trade-off (a vertical
      // scroll that *starts* on the 44px track moves the value instead of
      // scrolling) is well worth a slider that actually responds; tap +
      // drag both work now.
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onStartShouldSetPanResponderCapture: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponderCapture: () => !latest.current.disabled,
      // Once we own the gesture, don't surrender it to the ScrollView
      // mid-drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        if (latest.current.disabled) return;
        latest.current.onChange(fromX(e.nativeEvent.locationX - THUMB / 2));
      },
      onPanResponderMove: (e, g) => {
        if (latest.current.disabled) return;
        // locationX is relative to the thumb on move; use the track-relative
        // x0 + dx instead for stable tracking across the whole bar.
        latest.current.onChange(fromX(g.moveX - trackOriginRef.current - THUMB / 2));
      },
    }),
  ).current;

  // Absolute screen-x of the track's left edge, captured on layout, so
  // moveX (page coords) maps correctly to a track position.
  const trackOriginRef = useRef(0);
  const trackViewRef = useRef<View>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackW(w);
    trackWRef.current = w;
    trackViewRef.current?.measureInWindow((x) => {
      trackOriginRef.current = x;
    });
  };

  const usable = Math.max(0, trackW - THUMB);
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const thumbLeft = ratio * usable;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      accessibilityValue={{ min, max, now: value, text: thumbLabel ?? String(value) }}
      accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        const action = e.nativeEvent.actionName;
        if (action !== 'increment' && action !== 'decrement') return;
        onChange(clampToStep(valueRef.current + (action === 'increment' ? step : -step)));
      }}
      ref={trackViewRef}
      style={styles.wrap}
      onLayout={onLayout}
      {...responder.panHandlers}
    >
      <View style={styles.trackBg} />
      <View
        style={[
          styles.trackFill,
          { width: thumbLeft + THUMB / 2, backgroundColor: accent },
        ]}
      />
      <View
        style={[
          styles.thumb,
          { left: thumbLeft, borderColor: accent },
        ]}
      >
        <Text
          style={[styles.thumbText, { color: accent }]}
          numberOfLines={1}
        >
          {thumbLabel ?? String(value)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: THUMB,
    justifyContent: 'center',
    // Force LTR so `left`-anchored positions aren't mirrored under the
    // app's RTL layout (min on the left, max on the right).
    direction: 'ltr',
  },
  trackBg: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbText: {
    fontSize: 15,
    fontWeight: '800',
  },
});

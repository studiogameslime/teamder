// CountUp — animated integer that lerps from its previous value to a
// new target over `durationMs` whenever the target changes. Used by
// TrustMeter (0 → score on mount, score-old → score-new on change).
//
// Implementation note: we tick from the JS thread with
// requestAnimationFrame because the consumer wants the rendered TEXT
// to change — Reanimated shared values can drive style props on the
// UI thread, but for plain Text content we'd need a worklet-aware
// reanimated-text helper. requestAnimationFrame at 60 Hz is plenty
// for a 0–100 counter and avoids the dependency.

import React, { useEffect, useRef, useState } from 'react';
import { Text, type TextStyle } from 'react-native';

interface Props {
  to: number;
  durationMs?: number;
  /** Number of decimal places to render. Default 0. */
  decimals?: number;
  /** Optional prefix/suffix. */
  prefix?: string;
  suffix?: string;
  style?: TextStyle | TextStyle[];
  allowFontScaling?: boolean;
}

export function CountUp({
  to,
  durationMs = 700,
  decimals = 0,
  prefix = '',
  suffix = '',
  style,
  allowFontScaling = false,
}: Props) {
  const [value, setValue] = useState(to);
  const fromRef = useRef(to);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === to) return;
    startRef.current = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - startRef.current) / durationMs);
      // easeOutCubic — fast at the start, eases into the target.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      setValue(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      fromRef.current = to;
    };
  }, [to, durationMs]);

  const text = `${prefix}${value.toFixed(decimals)}${suffix}`;
  return (
    <Text style={style} allowFontScaling={allowFontScaling}>
      {text}
    </Text>
  );
}

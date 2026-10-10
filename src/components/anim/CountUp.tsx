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
import { useScrollActivity } from '@/components/ScrollSurface';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

interface Props {
  to: number;
  /** Starting value for the FIRST animation. Defaults to `to` (so the number
   *  renders static until `to` later changes — TrustMeter's behavior). Pass
   *  `from={0}` to play a 0→value count-up on mount. */
  from?: number;
  durationMs?: number;
  /** Number of decimal places to render. Default 0. */
  decimals?: number;
  /** Optional prefix/suffix. */
  prefix?: string;
  suffix?: string;
  style?: TextStyle | TextStyle[];
  allowFontScaling?: boolean;
  maxFontSizeMultiplier?: number;
}

export function CountUp({
  to,
  from,
  durationMs = 700,
  decimals = 0,
  prefix = '',
  suffix = '',
  style,
  allowFontScaling = true,
  maxFontSizeMultiplier = 1.8,
}: Props) {
  const initial = from ?? to;
  const moving = useScrollActivity();
  const reducedMotion = useReducedMotion();
  // Store the displayed text, not an invisible fractional intermediate value.
  const [value, setValue] = useState(initial.toFixed(decimals));
  const fromRef = useRef(initial);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (moving || reducedMotion || durationMs <= 0 || from.toFixed(decimals) === to.toFixed(decimals)) {
      fromRef.current = to;
      setValue(to.toFixed(decimals));
      return;
    }
    if (from === to) return;
    startRef.current = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - startRef.current) / durationMs);
      // easeOutCubic — fast at the start, eases into the target.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      fromRef.current = next;
      setValue(next.toFixed(decimals));
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
    };
  }, [to, durationMs, decimals, moving, reducedMotion]);

  const text = `${prefix}${value}${suffix}`;
  return (
    <Text style={style} allowFontScaling={allowFontScaling} maxFontSizeMultiplier={maxFontSizeMultiplier}>
      {text}
    </Text>
  );
}

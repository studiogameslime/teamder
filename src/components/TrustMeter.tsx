// TrustMeter — single visual representation of a user's reliability.
//
// Replaces the old yellow/red discipline-card pair. Renders as a
// circular progress arc with the numeric score (0-100) in the centre
// and a Hebrew tier label below ("מצוין" / "טוב" / "בסיסי" / "נמוך"
// / "חדש" for users with insufficient history).
//
// Sizes:
//   sm — 44dp (inline next to a name, e.g. inside a player row)
//   md — 80dp (Player Card / Profile section header)
//   lg — 120dp (filler approval screen — admin reviewing a candidate)
//
// All visual logic is here — the score itself comes from
// `trustService.getSummary` (or `computeTrustFromGames` when given
// pre-loaded games). Component is "dumb" so it can be reused under
// different load strategies.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { TrustTier } from '@/services/trustService';
import { CountUp } from '@/components/anim/CountUp';

type Size = 'sm' | 'md' | 'lg';

interface Props {
  /** 0..100, or `null` when the user has insufficient game history. */
  score: number | null;
  tier: TrustTier;
  size?: Size;
  /** Optional caption shown under the tier label (e.g. "12 מחזורים"). */
  caption?: string;
}

const SIZE_MAP: Record<Size, { px: number; stroke: number; fontSize: number }> = {
  sm: { px: 44, stroke: 4, fontSize: 14 },
  md: { px: 80, stroke: 6, fontSize: 22 },
  lg: { px: 120, stroke: 8, fontSize: 32 },
};

function tierLabel(tier: TrustTier): string {
  switch (tier) {
    case 'excellent':
      return he.trustTierExcellent;
    case 'good':
      return he.trustTierGood;
    case 'basic':
      return he.trustTierBasic;
    case 'low':
      return he.trustTierLow;
    case 'new':
    default:
      return he.trustTierNew;
  }
}

function tierColor(tier: TrustTier): string {
  switch (tier) {
    case 'excellent':
      return '#10B981'; // emerald
    case 'good':
      return colors.primary; // blue
    case 'basic':
      return '#F59E0B'; // amber
    case 'low':
      return colors.danger;
    case 'new':
    default:
      return colors.textMuted;
  }
}

export function TrustMeter({ score, tier, size = 'md', caption }: Props) {
  const dim = SIZE_MAP[size];
  const radiusPx = (dim.px - dim.stroke) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  // Animate the arc fill from 0 → final ratio on mount (and on any
  // subsequent score change). We drive a plain `useState` from a
  // 700ms easeOutCubic timer because react-native-svg's <Circle/>
  // doesn't pick up Reanimated shared values — animating
  // `strokeDasharray` via JS is fine here (one node, one prop).
  const target = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf: number | null = null;
    const from = progress;
    const start = Date.now();
    const duration = 700;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const dash = circumference * progress;
  const colour = tierColor(tier);

  return (
    <View style={styles.wrap}>
      <View style={{ width: dim.px, height: dim.px }}>
        <Svg width={dim.px} height={dim.px}>
          {/* Background track */}
          <Circle
            cx={dim.px / 2}
            cy={dim.px / 2}
            r={radiusPx}
            stroke={colors.border}
            strokeWidth={dim.stroke}
            fill="none"
          />
          {/* Progress arc — rotated -90° so 0% starts at top */}
          {score !== null ? (
            <Circle
              cx={dim.px / 2}
              cy={dim.px / 2}
              r={radiusPx}
              stroke={colour}
              strokeWidth={dim.stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              fill="none"
              transform={`rotate(-90 ${dim.px / 2} ${dim.px / 2})`}
            />
          ) : null}
        </Svg>
        <View style={[styles.center, { width: dim.px, height: dim.px }]}>
          {score === null ? (
            <Text style={[styles.newGlyph, { fontSize: dim.fontSize * 0.85 }]}>
              🆕
            </Text>
          ) : (
            <CountUp
              to={score}
              durationMs={700}
              style={[styles.score, { fontSize: dim.fontSize, color: colour }]}
              allowFontScaling={false}
            />
          )}
        </View>
      </View>
      <Text style={[styles.tier, { color: colour }]}>{tierLabel(tier)}</Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontWeight: '800',
    includeFontPadding: false,
  },
  newGlyph: {
    includeFontPadding: false,
  },
  tier: {
    ...typography.caption,
    fontWeight: '700',
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
});


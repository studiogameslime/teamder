// "איך המשחקונים הסתיימו" — one ring, three disjoint slices, the mini-game
// total in the middle.
//
// The three slices are genuinely disjoint, and that is a property of the
// writer, not an assumption made here: `commitRoundStats` increments
// `shootoutRounds` only when a `penalties[]` payload is present, and those
// commits carry a real `winnerSide` (the shootout winner) so they never also
// increment `tiedRounds` (functions/src/index.ts:14330-14337). "הוכרעו במשחק"
// is therefore the remainder, and it is clamped at 0 anyway — a stale
// `totalRounds` must not render a negative arc.
//
// Scoreless rounds are NOT a fourth slice. A 0:0 mini-game is already inside
// one of the three (it ended tied, or penalties decided it), so adding it to
// the ring would sum past 100%. It is a secondary line under the legend.

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { CountUp } from '@/components/anim/CountUp';
import { he } from '@/i18n/he';
import { splitRoundResults } from '@/utils/roundResults';
import { RTL_LABEL_ALIGN, clubAccent, clubShadow, clubSurface, colors, spacing } from '@/theme';

const ACircle = Animated.createAnimatedComponent(Circle);

// 146 → 124. At the old size the ring and its legend shared the row so
// tightly that the legend's own sentences clipped on a narrow phone, and the
// centre label sat against the stroke. Reported with both circled.
const SIZE = 124;
const STROKE = 26;

// The reference palette: a green majority, a neutral grey middle and a red
// tail. Not three brand hues — the ring is read as good / neither / notable,
// and an amber tie slice competed with the green for attention.
const SLICE_TINT = {
  regular: clubAccent.green,
  tie: clubAccent.slate,
  shootout: clubAccent.red,
} as const;

export interface ResultsBreakdownProps {
  /**
   * The mini-games whose OUTCOME was recorded — `countedRounds`, not the
   * club's lifetime `rounds`.
   *
   * The two are different sets and the difference is measurable: on
   * production today a club shows `rounds: 117` with `tiedRounds: 0`,
   * `shootoutRounds: 19`, `scorelessRounds: 20`. Dividing the second group by
   * the first drew a ring claiming 84% of the club's mini-games were decided
   * in normal play and none was ever drawn — a statement about 117 evenings
   * made from data covering a fraction of them.
   *
   * The three slices and the progress bars above describe the same set, so
   * they take the same denominator. When it is 0 the ring is not drawn at
   * all: an unmeasured distribution is not a distribution.
   */
  totalRounds: number;
  tiedRounds: number;
  shootoutRounds: number;
  scorelessRounds: number;
  /**
   * True when the scope predates the counters. `shootoutRounds` and
   * `scorelessRounds` only count from the deploy that added them, so an old
   * club reads 0 for both — which is not the same as "never happened".
   */
  partial?: boolean;
}

interface Slice {
  key: keyof typeof SLICE_TINT;
  label: string;
  value: number;
  tint: string;
}

/** One arc of the ring. Grows from nothing, in place, on its own delay. */
function Arc({
  fraction,
  offset,
  tint,
  delayMs,
}: {
  fraction: number;
  offset: number;
  tint: string;
  delayMs: number;
}) {
  const r = (SIZE - STROKE) / 2;
  const c = SIZE / 2;
  const circumference = 2 * Math.PI * r;
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.value = withDelay(
      delayMs,
      withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
    );
  }, [grow, delayMs, fraction, offset]);

  // No gap. The reference ring is continuous — the three colours are distinct
  // enough to separate the slices, and a hairline between them made a thick
  // ring look nicked.
  const gap = 0;

  const animatedProps = useAnimatedProps(() => {
    const len = Math.max(0, circumference * fraction - gap) * grow.value;
    return {
      strokeDasharray: `${len} ${circumference}`,
      strokeDashoffset: -circumference * offset,
    };
  });

  if (fraction <= 0) return null;

  return (
    <ACircle
      cx={c}
      cy={c}
      r={r}
      stroke={tint}
      strokeWidth={STROKE}
      strokeLinecap="butt"
      fill="none"
      animatedProps={animatedProps}
      transform={`rotate(-90 ${c} ${c})`}
    />
  );
}

export function ResultsBreakdown({
  totalRounds,
  tiedRounds,
  shootoutRounds,
  scorelessRounds,
  partial = false,
}: ResultsBreakdownProps) {
  const { tie, shootout, regular } = splitRoundResults(
    totalRounds,
    tiedRounds,
    shootoutRounds,
  );

  if (totalRounds <= 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="stats-chart" size={18} color={clubAccent.blue} />
          <Text style={styles.title}>{he.clubResultsTitle}</Text>
        </View>
        <Text style={styles.empty}>{he.clubResultsEmpty}</Text>
      </View>
    );
  }

  // A slice worth nothing is not drawn and not listed.
  //
  // "הסתיימו בתיקו · 0%" sat in the legend of a club that resolves every draw
  // with penalties, and the owner asked the obvious question: how are there
  // zero ties? The answer is that there are none to have — `commitRoundStats`
  // increments `tiedRounds` only for a round left level, and a round sent to
  // penalties carries a real winner. The row was reporting the absence of a
  // thing that cannot happen in that club, next to a ring where it drew no arc
  // at all.
  //
  // A club that DOES leave rounds level still sees it. The line appears when
  // the number does.
  const slices: Slice[] = ([
    { key: 'regular' as const, label: he.clubResultsRegular, value: regular, tint: SLICE_TINT.regular },
    { key: 'tie' as const, label: he.clubResultsTie, value: tie, tint: SLICE_TINT.tie },
    {
      key: 'shootout' as const,
      label: he.clubResultsShootout,
      value: shootout,
      tint: SLICE_TINT.shootout,
    },
  ] satisfies Slice[]).filter((s) => s.value > 0);

  // Cumulative offsets, computed once over the same array the legend renders,
  // so a slice's arc and its legend row can never disagree.
  let running = 0;
  const arcs = slices.map((s) => {
    const fraction = s.value / totalRounds;
    const arc = { ...s, fraction, offset: running };
    running += fraction;
    return arc;
  });

  const pctOf = (n: number) => Math.round((n / totalRounds) * 100);
  const scoreless = Math.max(0, Math.min(scorelessRounds, totalRounds));

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="stats-chart" size={18} color={clubAccent.blue} />
        <Text style={styles.title}>{he.clubResultsTitle}</Text>
      </View>

      {/* Legend first → visual RIGHT under forceRTL, with the ring closing the
          row on the left, as in the reference. */}
      <View style={styles.body}>
        <View style={styles.legend}>
          {arcs.map((a) => (
            <View key={a.key} style={styles.legendRow}>
              <Text style={styles.legendLabel} numberOfLines={1}>
                {`${a.label} (${a.value})`}
              </Text>
              <Text style={[styles.legendPct, { color: a.tint }]}>
                {`${pctOf(a.value)}%`}
              </Text>
              <View style={[styles.dot, { backgroundColor: a.tint }]} />
            </View>
          ))}
        </View>
        <View style={styles.ringWrap}>
          <Svg width={SIZE} height={SIZE}>
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={(SIZE - STROKE) / 2}
              stroke={clubSurface.divider}
              strokeWidth={STROKE}
              fill="none"
            />
            {arcs.map((a, i) => (
              <Arc
                key={a.key}
                fraction={a.fraction}
                offset={a.offset}
                tint={a.tint}
                delayMs={i * 140}
              />
            ))}
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <CountUp to={totalRounds} from={0} style={styles.centerNum} />
            <Text style={styles.centerLabel}>{he.clubResultsCenter}</Text>
          </View>
        </View>

      </View>

      {scoreless > 0 && (
        <Text style={styles.insight}>
          {he.clubResultsScoreless(scoreless, pctOf(scoreless))}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    ...clubShadow,
    padding: spacing.lg,
    gap: spacing.md,
  },
  // Title leads on the right, icon closes the row on the left.
  // Icon FIRST → visual right under forceRTL, with the title beside it. The
  // reference anchors both to the right edge; space-between threw the icon to
  // the far left, where it read as an unrelated control.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ringWrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerNum: {
    fontSize: 30,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  centerLabel: {
    fontSize: 12,
    color: clubSurface.subtle,
    textAlign: 'center',
  },
  legend: {
    flex: 1,
    gap: spacing.md,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendLabel: {
    fontSize: 13.5,
    flex: 1,
    color: clubSurface.subtle,
    textAlign: RTL_LABEL_ALIGN,
  },
  legendPct: {
    fontSize: 17,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  insight: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  partial: {
    fontSize: 12,
    color: colors.textMuted,
    opacity: 0.75,
    textAlign: RTL_LABEL_ALIGN,
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});

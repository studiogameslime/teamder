// SeasonPoster — the head of a finished-season card.
//
// A sealed season is a ceremony, and the screen used to report it as a settings
// row: "עונה 1", two grey lines, then nine identical entries in which the
// champion was entry number three.
//
// This is the plate that ceremony happens on: a floodlit night, chalk pitch
// lines running off the edge, the season number engraved enormous behind
// everything, and the club's champion set as the headline they actually are.
//
// Every colour resolves to a token that is already in the app. The gold is the
// SAME gold the championship podium uses — a second gold would make the hall of
// fame look bolted on.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { CountUp } from '@/components/anim/CountUp';
import { ConfettiBurst } from '@/components/anim/ConfettiBurst';
import { LightSweep } from '@/components/anim/LightSweep';
import { seasonTitleIcon, seasonTitleTint } from '@/utils/seasonTitleIcon';
import type { FinishedSeason } from '@/services/seasonHistoryService';
import { radius, spacing, typography } from '@/theme';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { he } from '@/i18n/he';

/** The plate. Night over turf — the two stops the stadium heroes already use.
 *
 *  The third stop used to be #0E4D26 parked at `locations` 1.25, i.e. a quarter
 *  of the way past the end of the gradient, so the green the plate actually
 *  reached was the two-thirds mix below. expo-linear-gradient documents
 *  locations as 0-1 and hands them to CAGradientLayer / Android's
 *  LinearGradient untouched; out-of-range stops are undefined behaviour, and on
 *  a future RN release they clamp and the plate turns a shade of green it was
 *  never designed in. Same pixels, inside the contract. */
const PLATE = ['#0B1226', '#0E1B2E', '#0E3D28'] as const;
const GOLD = '#F4B73E';
const POSTER_H = 214;

interface Props {
  season: FinishedSeason;
  hero: FinishedSeason['winners'][number] | null;
  /** Only the newest real season gets the sweep and the confetti. */
  celebrate?: boolean;
}

/** Two names fit across a 35pt headline. The rest are counted, not printed —
 *  `winners[0]` on a club with no unshared title is routinely every member who
 *  turned up, and a 78-character list at 35pt with `adjustsFontSizeToFit` is a
 *  grey smear that ends mid-name. */
const MAX_HERO_NAMES = 2;

/** Chalk. Six static primitives, drawn to bleed off the leading edge. */
function Chalk() {
  const stroke = 'rgba(255,255,255,0.14)';
  return (
    <Svg
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 390 ${POSTER_H}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <Line x1={0} y1={52} x2={390} y2={52} stroke={stroke} strokeWidth={1.4} />
      <Circle cx={300} cy={52} r={46} stroke={stroke} strokeWidth={1.4} fill="none" />
      <Circle cx={300} cy={52} r={2.5} fill={stroke} />
      <Rect x={-70} y={112} width={150} height={104} stroke={stroke} strokeWidth={1.4} fill="none" />
      <Rect x={-70} y={140} width={72} height={48} stroke={stroke} strokeWidth={1.4} fill="none" />
      <Path d="M80 148 a30 30 0 0 1 0 32" stroke={stroke} strokeWidth={1.4} fill="none" />
    </Svg>
  );
}

export function SeasonPoster({ season, hero, celebrate = false }: Props) {
  const tint = hero ? seasonTitleTint(hero.key) : '#1E40AF';
  const value = hero ? he.seasonHeroValue(hero.key, hero.value) : null;
  // A share only means something for a counting title measured against the
  // club's own goals — "100% מכל שערי המועדון" for a clean-sheet king is
  // nonsense, and so is a share of zero.
  const share =
    hero && hero.key === 'topScorer' && season.totals.goals > 0
      ? Math.round((hero.value / season.totals.goals) * 100)
      : null;
  const heroNames = hero ? hero.names.slice(0, MAX_HERO_NAMES) : [];
  const heroShared = hero ? hero.names.length - heroNames.length : 0;

  return (
    <View style={styles.poster}>
      <LinearGradient
        colors={PLATE}
        locations={[0, 0.46, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Chalk />
      {/* The one place the title's tint lives on the plate. On a wash, not as
          text: amber on night is 2.9:1 and the hero's name must be legible. */}
      <View style={[styles.glow, { backgroundColor: tint + '66' }]} />

      {/* Engraved, behind everything, on the trailing edge so it never sits
          under the Hebrew that is set from the right. */}
      <Text
        style={styles.ghostNo}
        allowFontScaling={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {String(season.no)}
      </Text>
      {hero ? (
        <Ionicons
          name={seasonTitleIcon(hero.key)}
          size={84}
          color="#FFFFFF"
          style={styles.ghostIcon}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      {celebrate ? (
        <>
          <ConfettiBurst
            count={18}
            spread={150}
            colors={[GOLD, tint, '#FFFFFF', '#93B4FF']}
            style={styles.fill}
          />
          <LightSweep active style={styles.fill}>
            <View style={StyleSheet.absoluteFill} />
          </LightSweep>
        </>
      ) : null}

      <View style={styles.body}>
        {hero && value ? (
          <>
            <View style={[styles.pill, { backgroundColor: tint + '4D', borderColor: tint + '80' }]}>
              <Ionicons name={seasonTitleIcon(hero.key)} size={13} color="#FFFFFF" />
              {/* The plate is a fixed 214pt, so every text on it is capped
                  rather than left to grow off the bottom of the poster at the
                  OS "largest" setting. */}
              <Text
                style={styles.pillText}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {he.seasonTitleNames[hero.key]}
              </Text>
            </View>
            <Text
              style={styles.heroName}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
            >
              {heroNames.join(' · ')}
            </Text>
            {heroShared > 0 ? (
              <Text
                style={styles.heroShared}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {he.seasonTitleSharedWith(heroShared)}
              </Text>
            ) : null}
            <View style={styles.valueRow}>
              <Text style={styles.heroValue} allowFontScaling={false}>
                {value.big}
              </Text>
              <Text
                style={styles.heroUnit}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {share !== null
                  ? `${value.unit} · ${he.seasonHeroShare(share)}`
                  : value.unit}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.heroName} numberOfLines={2}>
            {he.seasonNumberLabel(season.no)}
          </Text>
        )}
      </View>

      {/* Counting up is for the season being celebrated. Every poster used to
          run three requestAnimationFrame counters on mount, so a club with
          twelve sealed seasons started thirty-six JS-thread timers in the same
          frame as the list itself. */}
      <View style={styles.strip}>
        <Stat
          n={season.completedRounds}
          label={he.seasonStatRoundsShort}
          animate={celebrate}
        />
        {/* Mini-games exist only in advanced mode. Printing "0 משחקונים" on
            every season of every timer-only club is a column of zeros that
            reports nothing. */}
        {season.totals.rounds > 0 ? (
          <Stat
            n={season.totals.rounds}
            label={he.seasonStatMiniShort}
            animate={celebrate}
          />
        ) : null}
        <Stat
          n={season.players}
          label={he.seasonStatPlayersShort}
          animate={celebrate}
        />
      </View>
    </View>
  );
}

function Stat({
  n,
  label,
  animate,
}: {
  n: number;
  label: string;
  animate: boolean;
}) {
  return (
    <View style={styles.statBox} accessible accessibilityLabel={`${n} ${label}`}>
      {/* `from` omitted renders the number static — no rAF at all. */}
      <CountUp
        to={n}
        from={animate ? 0 : undefined}
        durationMs={800}
        style={styles.statNum}
      />
      <Text
        style={styles.statLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  poster: {
    // A floor, not a fixed height. The plate is set from the bottom up, so a
    // shared-title line (or a font-scale bump) on a fixed 214 pushed the title
    // pill out through `overflow: 'hidden'` at the top and the poster lost the
    // one element that names the title.
    minHeight: POSTER_H,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  glow: {
    position: 'absolute',
    top: -96,
    end: -74,
    width: 250,
    height: 250,
    borderRadius: 999,
  },
  ghostNo: {
    // Upper half of the trailing edge. It was pinned to the bottom, where the
    // stat strip sits on top of it and an engraved numeral became a smudge.
    position: 'absolute',
    top: -38,
    end: -6,
    fontSize: 168,
    lineHeight: 176,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.075)',
    fontVariant: ['tabular-nums'],
  },
  ghostIcon: { position: 'absolute', bottom: 62, end: 104, opacity: 0.12 },
  body: { zIndex: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    height: 25,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillText: { ...typography.caption, fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  heroShared: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.74)',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
  },
  heroName: {
    fontSize: 35,
    lineHeight: 40,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.sm,
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 2 },
  heroValue: {
    fontSize: 45,
    lineHeight: 48,
    fontWeight: '900',
    color: GOLD,
    fontVariant: ['tabular-nums'],
  },
  heroUnit: {
    ...typography.caption,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.74)',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  strip: { zIndex: 2, flexDirection: 'row', gap: 7, marginTop: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.md,
    paddingVertical: 7,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.62)',
  },
});

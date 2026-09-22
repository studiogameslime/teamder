// SeasonMedal — one title, as an object rather than a row.
//
// Nine titles used to be nine 30pt discs in nine identical rows, which meant
// the hall of fame could only be read line by line and every title looked
// exactly as hard-won as every other one.
//
// The medal has two axes and they are deliberately separate:
//   the RING says how strong  (the tier — bronze → platinum)
//   the CORE says which title (the tint the rest of the app already uses)
// So a מלך ההתמדה who made 19 of 19 evenings reads differently from a
// מלך הבישולים who took it on five assists, without either of them changing
// colour and breaking the vocabulary shared with the profile shelf, the season
// summary and the share card.
//
// A title NOT awarded is drawn too, as an empty engraved socket. Nine fixed
// places in a fixed order means you can scan the same spot down a column of
// seasons and see who held what over the years — and seeing the gap is what
// makes somebody want to fill it.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Path } from 'react-native-svg';

import { seasonTitleIcon, seasonTitleTint } from '@/utils/seasonTitleIcon';
import { TIER_METAL, type MedalTier } from '@/utils/seasonMedalTier';
import type { SeasonTitleKey } from '@/utils/seasonAwards';
import { colors, typography } from '@/theme';

/** Notch count. Twelve reads as milled metal; more turns to mush at 54pt. */
const NOTCHES = 12;

interface Props {
  titleKey: SeasonTitleKey;
  tier: MedalTier;
  /** Seasons in a row the same holder has taken it. 1 (or less) draws nothing. */
  streak?: number;
  /** Draw the empty socket instead — this title was not awarded. */
  empty?: boolean;
  /** Disc diameter. The ribbon and badge scale off it. */
  size?: number;
}

// The medal says everything it says in colour and metal, which is exactly
// nothing to a screen reader: TalkBack met a disc, an icon font and a bare
// "×2" and read out the icon's name. The slot around it renders the title, the
// holders, the value and the tier as real text and owns the whole label, so
// the medal is hidden from the accessibility tree rather than read twice.
const DECORATIVE = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

function Notches({ size }: { size: number }) {
  const r = size / 2;
  const inner = r - 9;
  const outer = r - 3;
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      {Array.from({ length: NOTCHES }, (_, i) => {
        const a = (i / NOTCHES) * Math.PI * 2;
        const sin = Math.sin(a);
        const cos = Math.cos(a);
        return (
          <Line
            key={i}
            x1={r + sin * inner}
            y1={r - cos * inner}
            x2={r + sin * outer}
            y2={r - cos * outer}
            stroke="rgba(0,0,0,0.22)"
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
}

export function SeasonMedal({
  titleKey,
  tier,
  streak = 1,
  empty = false,
  size = 54,
}: Props) {
  const tint = seasonTitleTint(titleKey);
  const icon = seasonTitleIcon(titleKey);
  const metal = TIER_METAL[tier];
  const ribbonH = Math.round(size * 0.44);
  const ribbonW = Math.round(size * 0.55);

  if (empty) {
    return (
      <View
        {...DECORATIVE}
        style={[styles.root, { width: size, height: size + ribbonH * 0.5 }]}
      >
        <View
          style={[
            styles.socket,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Ionicons name={icon} size={size * 0.38} color="#C7CCD6" />
        </View>
      </View>
    );
  }

  return (
    <View
      {...DECORATIVE}
      style={[styles.root, { width: size, height: size + ribbonH * 0.5 }]}
    >
      {/* The ribbon, in the TITLE's colour — it is the one part of the medal
          that is allowed to name the title from across the shelf. */}
      <Svg
        width={ribbonW}
        height={ribbonH}
        style={[styles.ribbon, { marginStart: -ribbonW / 2 }]}
      >
        <Path
          d={`M0 0 H${ribbonW / 2} V${ribbonH} L${ribbonW / 4} ${ribbonH * 0.72} L0 ${ribbonH} Z`}
          fill={tint}
        />
        <Path
          d={`M${ribbonW / 2} 0 H${ribbonW} V${ribbonH} L${(ribbonW * 3) / 4} ${ribbonH * 0.72} L${ribbonW / 2} ${ribbonH} Z`}
          fill={tint}
          opacity={0.78}
        />
      </Svg>

      <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]}>
        {/* Ring: the TIER. Three stops on a diagonal read as turned metal
            without a conic gradient, which React Native does not have. */}
        <LinearGradient
          colors={[metal[0], metal[1], metal[2], metal[0]]}
          locations={[0, 0.4, 0.68, 1]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
        <Notches size={size} />

        {/* Core: the TITLE. */}
        <LinearGradient
          colors={[tint, shade(tint, 0.45)]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[
            styles.core,
            { borderRadius: (size - 16) / 2, margin: 8 },
          ]}
        >
          <Ionicons name={icon} size={size * 0.39} color="#FFFFFF" />
        </LinearGradient>

        {/* One highlight arc across the top-left, so the disc reads as convex
            rather than as a flat sticker. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.40)', 'rgba(255,255,255,0)']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.75, y: 0.62 }}
          pointerEvents="none"
          style={[
            styles.core,
            { borderRadius: (size - 16) / 2, margin: 8 },
          ]}
        />
      </View>

      {streak > 1 ? (
        <View style={styles.streak}>
          {/* 9pt that refused to scale at all. The pill sizes itself off the
              text, so the badge can follow the OS font setting some way before
              it eats the disc — capped rather than frozen. */}
          <Text style={styles.streakText} maxFontSizeMultiplier={1.3}>
            {`×${streak}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Darken a #rrggbb toward black. Cheap, and the tints are all opaque hex. */
function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const k = 1 - amount;
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'flex-end' },
  ribbon: { position: 'absolute', top: 0, start: '50%' },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  core: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socket: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F3F7',
    borderWidth: 1,
    borderColor: '#E3E7EE',
  },
  streak: {
    position: 'absolute',
    top: -2,
    end: -4,
    backgroundColor: colors.text,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  streakText: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    color: '#FFFFFF',
  },
});

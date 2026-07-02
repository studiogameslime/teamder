// CardCountBadges — tiny referee-card chips showing how many ACTIVE yellow /
// red cards a player currently holds. Rendered next to a player's name on the
// community roster and the in-game roster (admins-only). A card shows only when
// its count > 0.
//
// The card shape itself (`RefereeCard`) is reused by the player timeline so a
// card event there looks identical to the roster badge — a small rounded
// rectangle in the card colour (with an optional count inside).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { typography } from '@/theme';
import { he } from '@/i18n/he';
import type { CardCounts } from '@/services/communityEventsService';

export const CARD_YELLOW = '#F59E0B';
export const CARD_RED = '#DC2626';

/** A single football-referee card: a rounded rectangle in the card colour with
 *  an optional count inside. Shared by the roster badge + the timeline icon so
 *  they look identical. */
/** Foreground ink (count text + slash) that stays legible on the card colour:
 *  white on the dark red card, near-black on the light amber yellow card. */
export function inkFor(color: string): string {
  return color === CARD_YELLOW ? '#1F2937' : '#FFFFFF';
}

export function RefereeCard({
  color,
  count,
  w = 15,
  h = 20,
  fontSize = 11,
  radius = 4,
  struck = false,
  a11y,
}: {
  color: string;
  count?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  radius?: number;
  /** Draw a diagonal slash across the card (expired/revoked) — keeps the full
   *  card colour instead of dimming it. */
  struck?: boolean;
  a11y?: string;
}) {
  // Corner-to-corner diagonal: a thin bar of the card's diagonal length,
  // centred and rotated to the card's own diagonal angle.
  const diag = Math.sqrt(w * w + h * h);
  const angle = (Math.atan2(h, w) * 180) / Math.PI;
  const ink = inkFor(color);
  return (
    <View
      style={[styles.card, { backgroundColor: color, width: w, height: h, borderRadius: radius }]}
      accessibilityLabel={a11y}
    >
      {count != null ? (
        <Text style={[styles.count, { fontSize, color: ink }]}>{count}</Text>
      ) : null}
      {struck ? (
        <View
          pointerEvents="none"
          style={[
            styles.slash,
            {
              backgroundColor: ink,
              width: diag,
              top: h / 2 - 1,
              left: w / 2 - diag / 2,
              transform: [{ rotate: `-${angle}deg` }],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export function CardCountBadges({
  counts,
  size = 'sm',
}: {
  counts?: CardCounts | null;
  /** 'sm' for dense roster rows, 'md' for roomier lists. */
  size?: 'sm' | 'md';
}) {
  const yellow = counts?.yellow ?? 0;
  const red = counts?.red ?? 0;
  if (yellow <= 0 && red <= 0) return null;
  const dim = size === 'md' ? { w: 17, h: 23, f: 12 } : { w: 15, h: 20, f: 11 };
  return (
    <View style={styles.wrap}>
      {yellow > 0 ? (
        <RefereeCard color={CARD_YELLOW} count={yellow} w={dim.w} h={dim.h} fontSize={dim.f} a11y={he.cardCountYellowA11y(yellow)} />
      ) : null}
      {red > 0 ? (
        <RefereeCard color={CARD_RED} count={red} w={dim.w} h={dim.h} fontSize={dim.f} a11y={he.cardCountRedA11y(red)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    // A faint dark edge so a light (yellow) card stays legible on white.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  count: {
    ...typography.caption,
    color: '#fff',
    fontWeight: '800',
    lineHeight: undefined,
  },
  slash: {
    position: 'absolute',
    height: 2.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
});

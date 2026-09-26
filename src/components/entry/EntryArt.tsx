// EntryArt — the artwork on the choice cards, and the shape it is shown in.
//
// ─── Where it came from ─────────────────────────────────────────────────
//
// The owner's asset sheet. Nothing here is generated, substituted or re-drawn
// in CSS: the files ARE the artwork, and the only processing is a crop, a
// Lanczos resize and PNG optimisation. See `src/assets/images/entry/`.
//
// The launch artwork is not here — it belongs to the unified launch screen,
// which owns its own wordmark and slogan. See `SplashHero.tsx`.
//
// ─── The crops are per-asset, not one rule ──────────────────────────────
//
// The slot is 0.91 (taller than wide) on a typical phone, and the sheet's
// panels run from 0.96 to 1.49. Feeding those to a single centre `cover` threw
// the subject away: the four friends and the phone/map both ended up outside
// the frame and the cards showed blurred background instead.
//
// So each asset is exported from the sheet through a window chosen around ITS
// OWN focal point, at the slot's aspect ratio:
//
//   create-club    the Teamder shirt centred, a face either side
//   find-game      the player's head AND the phone/map, both inside
//   one-time-game  ball and calendar centred
//   invite-game    ball and boot
//   invite-club    the handshake dead centre
//
// This is what "designed for the card" means here, and it is why there is no
// runtime object-position: the framing is baked in, so `cover` on a different
// screen shape only ever trims background.

import React from 'react';
import {
  Image,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const CREATE_CLUB: ImageSourcePropType = require('../../assets/images/entry/onboarding-create-club.png');
const FIND_GAME: ImageSourcePropType = require('../../assets/images/entry/onboarding-find-game.png');
const ONE_TIME: ImageSourcePropType = require('../../assets/images/entry/onboarding-one-time-game.png');
const INVITE_GAME: ImageSourcePropType = require('../../assets/images/entry/onboarding-invite-game.png');
const INVITE_CLUB: ImageSourcePropType = require('../../assets/images/entry/onboarding-invite-club.png');

/** Every illustration a choice card can carry. */
export type CardArtKind =
  | 'create_club'
  | 'find_game'
  | 'one_off_game'
  | 'invite_game'
  | 'invite_club'
  | 'invite_referral';

const ART: Record<CardArtKind, ImageSourcePropType> = {
  create_club: CREATE_CLUB,
  find_game: FIND_GAME,
  one_off_game: ONE_TIME,
  invite_game: INVITE_GAME,
  invite_club: INVITE_CLUB,
  // A general referral is an invitation to a PERSON, and the handshake is the
  // approved visual for that. Deliberately not the inviter's avatar: an avatar
  // is often a built-in glyph rather than a photograph, so it carries no more
  // meaning than the name already does — and the name is right above it.
  invite_referral: INVITE_CLUB,
};

/**
 * The art's share of a choice card.
 *
 * 0.39, down from 0.44. At 44% the pictures were carrying the card rather than
 * belonging to it, and the near-square slot forced a harder crop on every
 * asset. At 39% the copy gets room to breathe and each crop gives back a
 * margin of background around its subject.
 *
 * Resolved to a NUMBER in JS rather than handed to Yoga as `'39%'`: a
 * percentage width left the image inside scaling from its own intrinsic pixels
 * instead of the slot's box, and the artwork rendered about five times too
 * large. A definite width and a definite height are what it resolves against.
 */
export const CARD_ART_SHARE = 0.39;
/** Horizontal screen padding the cards sit inside. */
export const CARD_GUTTER = 16;

/**
 * Height of every choice card, and of the slot inside it.
 *
 * DEFINITE, not `stretch`. An `Image` sized `height: '100%'` inside a parent
 * with no resolved height falls back to the bitmap's intrinsic size, and the
 * cards grew to ~350pt each. A number also delivers the "all cards the same
 * height" the design asks for, and it fits the invitation's extra tag row
 * without a second measurement.
 */
export const CARD_HEIGHT = 162;

/** The art slot's width on this screen. */
export function cardArtWidth(screenWidth: number): number {
  return Math.round((screenWidth - CARD_GUTTER * 2) * CARD_ART_SHARE);
}

/**
 * The picture on a choice card: a fixed-width slot the row lays out, with a
 * short fade into the copy beside it.
 *
 * A NORMAL flex child, deliberately. Positioning it absolutely at `left: 0`
 * put it on the opposite edge under `I18nManager.forceRTL`, which swaps `left`
 * and `right` — on top of the text, which was itself padded on the wrong side.
 * Letting the row's child ORDER place it needs no left/right literal and
 * cannot flip.
 */
export function CardArt({ kind }: { kind: CardArtKind }) {
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.slot, { width: cardArtWidth(width) }]}>
      <Image source={ART[kind]} style={styles.slotImage} resizeMode="cover" />
      {/* The fade between the photograph and the copy.
          SHORT — it ends at 46% of the slot, so the picture stays a defined
          region with a soft edge rather than bleeding halfway across the card.
          The five-stop version reached the full width and made the artwork
          look like it was dissolving into the text.
          LinearGradient's `x` is NOT flipped by forceRTL — only layout is — so
          x:0 is this slot's visual LEFT, which is the side the copy is on. */}
      <LinearGradient
        colors={['#FFFFFF', 'rgba(255,255,255,0.62)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.46, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { height: CARD_HEIGHT, overflow: 'hidden' },
  slotImage: { width: '100%', height: '100%' },
});

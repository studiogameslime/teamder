// SplashHero — the unified launch screen's artwork, and where UI may sit on it.
//
// ─── The artwork carries its own type ───────────────────────────────────
//
// The wordmark and "המשחק הבא שלך מתחיל כאן" are painted INTO the asset. They
// are not re-created as Text, not overlaid, and not masked out. The only
// things this app draws on top are the progress bar and, for a new person, the
// "מתחילים" button.
//
// ─── Where the UI sits ──────────────────────────────────────────────────
//
// Both of them — the progress bar and the button — occupy the SAME slot above
// the bottom safe area, and only one is on screen at a time. That is what
// makes the button read as taking the bar's place when loading ends, and it
// means neither needs a coordinate measured against the artwork.
//
// An earlier version placed the bar under the slogan, which required resolving
// a fraction of the ARTWORK to a screen y (`cover` crops a different axis on a
// 0.56 phone than on a 0.45 one). That machinery is gone with the position.
//
// ─── No stretching, ever ────────────────────────────────────────────────
//
// The previous hero was padded by duplicating its bottom row to make a short
// composition reach further up. This asset is authored at 0.4615, close to a
// phone, and is used exactly as delivered: same aspect, same pixels. Where a
// viewport needs it, `cover` trims a few percent from the edges — which here
// are sky at the top and plain grass at the bottom, never the wordmark, the
// slogan, the player or the ball.

import { type ImageSourcePropType } from 'react-native';

export const SPLASH_IMAGE: ImageSourcePropType = require('../../assets/images/entry/onboarding-splash.png');

/** Native pixels of the asset. Stated, not read back from Metro's registry. */
export const SPLASH_W = 852;
export const SPLASH_H = 1846;

/**
 * The ball's lowest point, as a fraction of the artwork's height. Everything
 * below it is plain pitch — which is why the button can sit at the bottom of
 * the screen without covering anything that matters.
 */
export const SPLASH_BALL_BOTTOM = 0.80;

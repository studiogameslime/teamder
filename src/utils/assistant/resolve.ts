// Teamder Assistant — priority resolver + stable copy rotation.
//
// Two jobs:
//
//   • Pick ONE message. Several rules can match at once (it's game day AND
//     you're two goals off a milestone AND your club hasn't booked next week).
//     Showing all three turns the card into a notification feed, so the lowest
//     priority number wins and everything else is dropped. Rule order breaks
//     ties, which makes the outcome fully deterministic — and testable.
//
//   • Draw fresh copy on every SCREEN LOAD without flicker. Each scenario
//     ships several phrasings, and the draw is keyed on a nonce minted once
//     per home-screen mount: a new line each time you open the app, identical
//     for as long as you're looking at it.

import type {
  AssistantContext,
  AssistantMessage,
  AssistantRule,
} from './types';

/** Small deterministic string hash (FNV-1a). Stable across JS engines. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick one entry, drawn fresh on each SCREEN LOAD.
 *
 * The `nonce` is generated once per mount of the home screen and lives on the
 * context, which gives the two properties that matter:
 *
 *   • a new draw every time the player opens the screen, so the coach feels
 *     alive rather than like a card that changed once at midnight;
 *   • completely STABLE while that screen is on screen — re-renders, scrolling
 *     and state updates all reuse the same nonce, so the words never reshuffle
 *     under the player's eyes mid-read.
 *
 * (It used to key off the day index, which held steady for 24h — safe, but it
 * meant opening the app ten times showed the identical sentence ten times.)
 */
export function pickVariant<T>(variants: readonly T[], seed: string, nonce: number): T {
  if (variants.length === 0) {
    throw new Error('pickVariant: empty variants');
  }
  if (variants.length === 1) return variants[0];
  return variants[hash(`${seed}#${nonce}`) % variants.length];
}

/** A fresh draw seed. Called once per home-screen mount. */
export function newAssistantNonce(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * Run the rules and return the single winning message, or null when nothing
 * has anything worth saying (the caller then renders no card at all — an
 * assistant with nothing to say should be silent, not filled with padding).
 *
 * Rules are expected to be cheap and pure; a throwing rule is skipped rather
 * than allowed to take the home screen down with it.
 */
export function resolveAssistantMessage(
  ctx: AssistantContext,
  rules: readonly AssistantRule[],
): AssistantMessage | null {
  let best: AssistantMessage | null = null;
  for (const rule of rules) {
    let msg: AssistantMessage | null = null;
    try {
      msg = rule(ctx);
    } catch {
      // A broken rule must never blank the home screen.
      msg = null;
    }
    // Strictly-less keeps rule ORDER as the tie-break: the first rule
    // registered at a given priority wins.
    if (msg && (best === null || msg.priority < best.priority)) {
      best = msg;
    }
  }
  return best;
}

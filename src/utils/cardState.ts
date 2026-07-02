// Card lifecycle for the per-community player timeline.
//
// A card (yellow/red) is one of:
//   • 'revoked' — an admin cancelled it (kept on the timeline, marked "בוטל").
//   • 'expired' — the club set a validity in days and it has elapsed (kept for
//                 history, no longer "relevant" / no longer blocks).
//   • 'active'  — still in effect (an active RED card blocks registration).
// Validity `null`/`undefined` = no expiry → a card is active until revoked.
//
// The server (functions/src) mirrors this tiny rule inline — keep them in sync.

import type { CommunityPlayerEvent } from '@/types';

export const DAY_MS = 24 * 60 * 60 * 1000;

export type CardState = 'active' | 'expired' | 'revoked';

/** When the card stops being active (ms), or null when it never expires. */
export function activeUntil(
  at: number,
  validityDays: number | null | undefined,
): number | null {
  return typeof validityDays === 'number' && validityDays > 0
    ? at + validityDays * DAY_MS
    : null;
}

/**
 * The moment a card stops counting. Prefers the expiry SNAPSHOTTED on the event
 * at issue time (`expiresAt`) so later club-config edits don't rewrite history;
 * falls back to the live group-validity computation for legacy cards that
 * pre-date the snapshot. `null` either way = no expiry.
 */
export function effectiveExpiry(
  ev: Pick<CommunityPlayerEvent, 'at' | 'expiresAt'>,
  validityDays: number | null | undefined,
): number | null {
  if (ev.expiresAt !== undefined) return ev.expiresAt;
  return activeUntil(ev.at, validityDays);
}

export function cardState(
  ev: Pick<CommunityPlayerEvent, 'at' | 'revoked' | 'expiresAt'>,
  validityDays: number | null | undefined,
  now: number,
): CardState {
  if (ev.revoked) return 'revoked';
  const exp = effectiveExpiry(ev, validityDays);
  if (exp !== null && now > exp) return 'expired';
  return 'active';
}

/** True when the event is a red card that is currently in effect. */
export function isActiveRedCard(
  ev: Pick<CommunityPlayerEvent, 'type' | 'at' | 'revoked' | 'expiresAt'>,
  redValidityDays: number | null | undefined,
  now: number,
): boolean {
  return ev.type === 'red' && cardState(ev, redValidityDays, now) === 'active';
}

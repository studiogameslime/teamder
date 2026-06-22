// joinFairness — the pure, deterministic core of FAIR game registration.
//
// Problem: when registration opens, the whole community gets the push at once
// and many people tap within milliseconds. The old model appended joiners in
// the order their write REACHED the server (network luck + transaction-retry
// jitter) — so a faster connection could steal the spot from someone who
// tapped first.
//
// Fix: every tap carries `tappedAt = serverNow()` (a server-synced clock
// captured at the tap instant, BEFORE the network hop), so we know the true
// tap order independent of latency. A short settle window collects the opening
// burst, then this function assigns spots strictly by tap time. Slow network no
// longer costs you the spot.
//
// This module is intentionally pure (no Firestore, no clock) so it can be
// exhaustively unit-tested AND mirrored 1:1 by the server reconciler.

export interface JoinReq {
  uid: string;
  /** Server-synced clock at the tap instant (the fair ordering key). */
  tappedAt: number;
  /** Server-receipt time (serverTimestamp), ms. Tiebreaker + anti-backdate. */
  requestedAt: number;
}

export interface RosterState {
  players: string[];
  waitlist: string[];
  pending: string[];
  /** Guests occupy real capacity. */
  guestsCount: number;
  maxPlayers: number;
  /** Approval-gated game → every new joiner goes to `pending`, no auto-seat. */
  requiresApproval: boolean;
  /** A pending waitlist-promotion offer reserves one seat. */
  pendingOfferReservation?: boolean;
}

export type JoinBucket = 'players' | 'waitlist' | 'pending';

export interface AssignResult {
  players: string[];
  waitlist: string[];
  pending: string[];
  assignments: Array<{ uid: string; bucket: JoinBucket }>;
}

// A tap timestamp may not be earlier than the server actually saw the request
// minus this grace window. Bounds clock-backdating (a hacked client setting
// tappedAt=0 to always win) to at most GRACE before its real arrival.
export const TAP_BACKDATE_GRACE_MS = 15_000;

/** Effective (clamped) ordering key for a request. */
export function effectiveTap(r: JoinReq): number {
  // Guard against a missing/zero tappedAt (old client / bad write): fall back
  // to the server-receipt time so the request still orders sensibly.
  const tap = Number.isFinite(r.tappedAt) && r.tappedAt > 0 ? r.tappedAt : r.requestedAt;
  return Math.max(tap, r.requestedAt - TAP_BACKDATE_GRACE_MS);
}

/** Deterministic fair order: by clamped tap time, then server receipt, then uid. */
export function orderJoinRequests(reqs: JoinReq[]): JoinReq[] {
  return [...reqs].sort((a, b) => {
    const ka = effectiveTap(a);
    const kb = effectiveTap(b);
    if (ka !== kb) return ka - kb;
    if (a.requestedAt !== b.requestedAt) return a.requestedAt - b.requestedAt;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
}

/**
 * Assign a batch of join requests onto the current roster, strictly in
 * tap-time order. Pure + idempotent: a uid already on the roster keeps its
 * bucket (re-running with the same input is a no-op). Existing players keep
 * their seats; new joiners fill remaining capacity in fair order, then spill
 * to the waitlist.
 */
export function assignJoins(state: RosterState, reqs: JoinReq[]): AssignResult {
  const players = [...state.players];
  const waitlist = [...state.waitlist];
  const pending = [...state.pending];
  const inAny = new Set([...players, ...waitlist, ...pending]);
  let occupancy =
    players.length + state.guestsCount + (state.pendingOfferReservation ? 1 : 0);

  const assignments: Array<{ uid: string; bucket: JoinBucket }> = [];
  for (const r of orderJoinRequests(reqs)) {
    if (inAny.has(r.uid)) {
      const bucket: JoinBucket = players.includes(r.uid)
        ? 'players'
        : waitlist.includes(r.uid)
          ? 'waitlist'
          : 'pending';
      assignments.push({ uid: r.uid, bucket });
      continue;
    }
    let bucket: JoinBucket;
    if (state.requiresApproval) {
      pending.push(r.uid);
      bucket = 'pending';
    } else if (occupancy < state.maxPlayers) {
      players.push(r.uid);
      occupancy += 1;
      bucket = 'players';
    } else {
      waitlist.push(r.uid);
      bucket = 'waitlist';
    }
    inAny.add(r.uid);
    assignments.push({ uid: r.uid, bucket });
  }
  return { players, waitlist, pending, assignments };
}

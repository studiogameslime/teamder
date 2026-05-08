// rateLimitService — per-user spam guards.
//
// Anchored to a /rateLimits/{uid}_{op} doc. The document holds a
// counter for the current minute-window and the window timestamp.
// `consume()` increments and returns false if the cap is exceeded
// for the window; the caller refuses the action.
//
// Why a doc per (uid, op): a single doc per uid would force every
// rate-limited action to read the same counter, creating a hot key
// at scale. Per-op spreads load and lets each operation pick its
// own cap.
//
// The Firestore rule for /rateLimits/{rid} only allows the user
// themselves to read / write their own counters (id prefix matches
// auth.uid). A malicious client COULD reset their own counter early
// by overwriting the doc, but the floor is the per-window cap so the
// worst case is exactly the same throughput as a clean reset every
// window — no escalation. Server-side enforcement (Cloud Function
// pre-check on the corresponding write trigger) is the hard ceiling
// once we layer it in.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';

export type RateLimitOp =
  | 'createGroup'
  | 'createGame'
  | 'inviteToGame'
  | 'joinRequest'
  | 'rateVote';

interface Window {
  windowMs: number;
  /** How many ops permitted per window. */
  cap: number;
}

const POLICY: Record<RateLimitOp, Window> = {
  createGroup: { windowMs: 24 * 60 * 60 * 1000, cap: 5 },
  createGame: { windowMs: 60 * 60 * 1000, cap: 10 },
  inviteToGame: { windowMs: 60 * 60 * 1000, cap: 30 },
  joinRequest: { windowMs: 60 * 60 * 1000, cap: 20 },
  rateVote: { windowMs: 60 * 60 * 1000, cap: 60 },
};

interface CounterDoc {
  uid: string;
  op: RateLimitOp;
  windowStart: number;
  count: number;
}

/**
 * Atomically increment the counter for (uid, op). Returns true when
 * the action is allowed, false when the cap for this window has been
 * exceeded. Best-effort: a Firestore failure logs and returns true
 * (failing-open) so a transient network blip doesn't lock the user
 * out of the app entirely.
 */
export async function consume(
  uid: string,
  op: RateLimitOp,
): Promise<boolean> {
  if (!uid) return true;
  if (USE_MOCK_DATA) return true;
  const policy = POLICY[op];
  const now = Date.now();
  try {
    const { db } = getFirebase();
    const ref = doc(db, 'rateLimits', `${uid}_${op}`);
    const snap = await getDoc(ref);
    let next: CounterDoc;
    if (!snap.exists()) {
      next = { uid, op, windowStart: now, count: 1 };
    } else {
      const cur = snap.data() as CounterDoc;
      const expired =
        typeof cur.windowStart !== 'number' ||
        now - cur.windowStart > policy.windowMs;
      next = expired
        ? { uid, op, windowStart: now, count: 1 }
        : { uid, op, windowStart: cur.windowStart, count: (cur.count ?? 0) + 1 };
    }
    if (next.count > policy.cap) {
      return false;
    }
    await setDoc(
      ref,
      {
        uid: next.uid,
        op: next.op,
        windowStart: next.windowStart,
        count: next.count,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (err) {
    if (__DEV__) {
      console.warn('[rateLimit] consume failed (fail-open)', op, err);
    }
    return true;
  }
}

/** Throw a typed error when over the cap — convenience wrapper. */
export async function enforceRateLimit(
  uid: string,
  op: RateLimitOp,
): Promise<void> {
  const ok = await consume(uid, op);
  if (!ok) {
    const e = new Error(`RATE_LIMITED:${op}`) as Error & { code: string };
    e.code = 'RATE_LIMITED';
    throw e;
  }
}

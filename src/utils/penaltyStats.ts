// Pure, unit-tested penalty-shootout stat logic — the CANONICAL reference for
// how penalty stats are computed. `aggregatePenalties` is MIRRORED verbatim in
// the `commitRoundStats` cloud function (functions/src/index.ts §1c); if you
// change the algorithm here, change it there too (they can't share code — the
// cloud function is a separate build).
//
// Stat model (all optional on UserStats; absent = never took/faced a penalty):
//   kicker:  penTaken = penScored + penMissed
//   keeper:  penFaced = penSaved  + penConceded
// A SHOOTOUT kick is never a mini-game goal — these fields are independent of
// goals/score.

import type { LiveMatchState } from '@/types';

export interface PenaltyKick {
  kickerId?: string | null;
  keeperId?: string | null;
  scored?: boolean;
}

export interface KickerPen {
  taken: number;
  scored: number;
  missed: number;
}
export interface KeeperPen {
  faced: number;
  saved: number;
  conceded: number;
}

/** Max penalties credited per round — op-count safety (the round-end Firestore
 *  batch already runs near the 500-op ceiling). Matches the server cap. Real
 *  shootouts are far smaller, so this never truncates a genuine round. */
export const PENALTY_ROUND_CAP = 16;

/** Build the commit payload from a live shootout: one entry per kick, in order. */
export function buildShootoutPenaltyPayload(
  shootout: LiveMatchState['shootout'] | undefined | null,
): PenaltyKick[] {
  // `|| null` (not `??`) so an empty-string id — which readLiveMatch can
  // produce for a malformed kick — normalizes to null and is skipped server-side.
  return (shootout?.kicks ?? []).map((k) => ({
    kickerId: k.kickerId || null,
    keeperId: k.keeperId || null,
    scored: !!k.scored,
  }));
}

/**
 * Aggregate a round's penalty kicks into per-kicker + per-keeper deltas.
 * Both kicker and keeper are gated through `isReal` + `isOnField` (guests and
 * off-field ids carry no stats — same rule as goals/assists). Capped at
 * PENALTY_ROUND_CAP kicks. Deduped per player (each accumulates once).
 * ⚠️ MIRRORED in commitRoundStats §1c — keep in sync.
 */
export function aggregatePenalties(
  penalties: PenaltyKick[] | undefined | null,
  opts: { isOnField: (id: string) => boolean; isReal: (id: string) => boolean },
): { byKicker: Record<string, KickerPen>; byKeeper: Record<string, KeeperPen> } {
  const { isOnField, isReal } = opts;
  const pens = (penalties ?? []).slice(0, PENALTY_ROUND_CAP);
  const byKicker: Record<string, KickerPen> = {};
  const byKeeper: Record<string, KeeperPen> = {};
  for (const p of pens) {
    const scored = !!p.scored;
    const k = p.kickerId;
    if (k && isReal(k) && isOnField(k)) {
      const s = (byKicker[k] ??= { taken: 0, scored: 0, missed: 0 });
      s.taken += 1;
      if (scored) s.scored += 1;
      else s.missed += 1;
    }
    const gk = p.keeperId;
    if (gk && isReal(gk) && isOnField(gk)) {
      const s = (byKeeper[gk] ??= { faced: 0, saved: 0, conceded: 0 });
      s.faced += 1;
      if (scored) s.conceded += 1;
      else s.saved += 1;
    }
  }
  return { byKicker, byKeeper };
}

// ── Community leaderboards ────────────────────────────────────────────────
// Derived CLIENT-side from the community's per-player rollup
// (communityPlayerStats/{groupId}__{uid}), same as the other community cards.

export interface PenaltyStatsLike {
  userId: string;
  penScored?: number;
  penTaken?: number;
  penSaved?: number;
  penFaced?: number;
}

export interface PenaltyLeader {
  userId: string;
  /** The headline count — penalties SCORED (king) or SAVED (keeper king). */
  count: number;
  /** Attempts behind the count — penTaken (king) or penFaced (keeper king). */
  attempts: number;
  /** Success rate 0..100, rounded — the REAL percentage, shown in the UI. */
  pct: number;
  /** Wilson lower-bound score (0..1) used for RANKING only (not displayed). */
  score: number;
}

/** Round a ratio to a whole-number percentage (0 attempts → 0). */
export function pctOf(made: number, attempts: number): number {
  return attempts > 0 ? Math.round((made / attempts) * 100) : 0;
}

/**
 * Wilson score lower bound of a binomial proportion (z=1.96, 95% CI). Rewards
 * BOTH a high success rate AND a large sample: 8/10 (0.49) outranks 1/1 (0.21),
 * so a one-shot 100% no longer beats a proven high-volume scorer. Used ONLY to
 * pick the leader — the card still shows the real success %. 0 attempts → 0.
 */
export function wilsonLowerBound(pos: number, n: number, z = 1.96): number {
  if (n <= 0 || pos <= 0) return 0;
  const phat = pos / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom);
}

// Rank by Wilson score desc (volume + rate), then headline count desc, then
// attempts desc, then userId asc (stable + deterministic across devices).
function pickLeader(
  players: PenaltyStatsLike[],
  countOf: (p: PenaltyStatsLike) => number,
  attemptsOf: (p: PenaltyStatsLike) => number,
): PenaltyLeader | null {
  let best: PenaltyLeader | null = null;
  for (const p of players) {
    const count = countOf(p) || 0;
    if (count <= 0) continue; // nobody with 0 scored/saved can be king
    const attempts = attemptsOf(p) || 0;
    const cand: PenaltyLeader = {
      userId: p.userId,
      count,
      attempts,
      pct: pctOf(count, attempts),
      score: wilsonLowerBound(count, attempts),
    };
    if (
      !best ||
      cand.score > best.score ||
      (cand.score === best.score && cand.count > best.count) ||
      (cand.score === best.score && cand.count === best.count && cand.attempts > best.attempts) ||
      (cand.score === best.score &&
        cand.count === best.count &&
        cand.attempts === best.attempts &&
        cand.userId < best.userId)
    ) {
      best = cand;
    }
  }
  return best;
}

/** מלך הפנדלים — most penalties SCORED in the community. null if none scored. */
export function penaltyKing(players: PenaltyStatsLike[]): PenaltyLeader | null {
  return pickLeader(
    players,
    (p) => p.penScored ?? 0,
    (p) => p.penTaken ?? 0,
  );
}

/** מלך שוערי הפנדלים — most penalties SAVED in the community. null if none saved. */
export function penaltyKeeperKing(players: PenaltyStatsLike[]): PenaltyLeader | null {
  return pickLeader(
    players,
    (p) => p.penSaved ?? 0,
    (p) => p.penFaced ?? 0,
  );
}

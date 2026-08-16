// Draft Teams (חלוקת כוחות) — pure logic for the captain-draft flow.
//
// A manager picks 2–4 captains; each captain is the first member of their
// team. The remaining registered players are then drafted in turns. Two
// orderings are supported:
//   • regular: א,ב,ג, א,ב,ג, …            (same order every round)
//   • snake:   א,ב,ג, ג,ב,א, א,ב,ג, …     (reverse every other round)
//
// Everything here is pure + dynamic in the number of teams — no UI assumes
// a fixed count.

import type { DraftTeamsResult, GameFormat, UserId } from '@/types';
import {
  balanceCore,
  buildPairRepeatWeights,
  NEUTRAL_RATING,
  normalizeRating,
  type BalanceBand,
  type BalanceStrategy,
  type PastSplit,
} from './teamBalanceCore';

// Re-exported so callers (and tests) keep importing the rating helpers from
// the same place they always have.
export { NEUTRAL_RATING, normalizeRating };
export type { PastSplit, BalanceStrategy, BalanceBand };


export type DraftMethod = 'snake' | 'regular';

/**
 * Players per team for a given format. Mirrors the server `perTeamSize`
 * (functions/src/index.ts) so the client auto-balance lands on the same
 * roster sizes. Default 5 for 5v5 / unknown.
 */
export function playersPerTeam(format?: GameFormat): number {
  if (format === '4v4') return 4;
  if (format === '6v6') return 6;
  if (format === '7v7') return 7;
  return 5;
}

/** Hebrew team letters; team index 0 → 'א'. Dynamic for 2–4 teams. */
export const TEAM_LETTERS = ['א', 'ב', 'ג', 'ד'] as const;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;

export function teamLetter(i: number): string {
  return TEAM_LETTERS[i] ?? String(i + 1);
}

// Teams are identified by COLOR (clearer than "קבוצה א/ב"), fixed per index.
const TEAM_COLOR_NAMES = ['אדומה', 'כחולה', 'ירוקה', 'צהובה'];
export function teamName(i: number): string {
  const c = TEAM_COLOR_NAMES[i];
  return c ? `קבוצה ${c}` : `קבוצה ${teamLetter(i)}`;
}

/**
 * The sequence of team indices that pick, in order, for `picks` total
 * picks. `picks` is normally (totalPlayers − numCaptains): captains are
 * already seated, so only the remaining players get drafted.
 */
export function buildPickOrder(
  numTeams: number,
  picks: number,
  method: DraftMethod,
): number[] {
  const order: number[] = [];
  if (numTeams <= 0 || picks <= 0) return order;
  let round = 0;
  while (order.length < picks) {
    const forward = method === 'regular' || round % 2 === 0;
    for (let t = 0; t < numTeams && order.length < picks; t++) {
      order.push(forward ? t : numTeams - 1 - t);
    }
    round++;
  }
  return order;
}

/**
 * A short, representative path for the setup-screen preview — two full
 * rounds so the snake reversal is visible (e.g. א,ב,ג,ג,ב,א).
 */
export function previewPath(numTeams: number, method: DraftMethod): number[] {
  return buildPickOrder(numTeams, numTeams * 2, method);
}

/**
 * Rebuild the global pick sequence (uids in the order they were drafted)
 * from a SAVED draft result, so re-opening a finished draft can resume on
 * the summary and still be edited. Each team's `playerIds[0]` is the
 * captain; the rest are members in their pick order. Interleaving them by
 * the deterministic order reproduces the original `picks` array.
 */
export function reconstructPicks(draft: DraftTeamsResult): string[] {
  const teams = draft.teams.slice().sort((a, b) => a.index - b.index);
  const queues = teams.map((t) => t.playerIds.slice(1)); // members only
  const total = queues.reduce((s, q) => s + q.length, 0);
  const order = buildPickOrder(draft.numTeams, total, draft.method);
  const cursor = new Array(draft.numTeams).fill(0);
  const picks: string[] = [];
  for (const team of order) {
    const q = queues[team];
    if (q && cursor[team] < q.length) {
      picks.push(q[cursor[team]]);
      cursor[team] += 1;
    }
  }
  return picks;
}

// ─── Auto-balance ─────────────────────────────────────────────────────────
// The algorithm itself lives in `teamBalanceCore` — a dependency-free module
// that `functions/src/teamBalanceCore.ts` is generated from, so the phone and
// the scheduled Cloud Function can never drift. This file only adapts it to
// the draft shape the app stores (captain first in `playerIds`).

export interface BalanceTeamsInput {
  /** Roster ids: real uids + prefixed `guest:<id>`. */
  playerIds: string[];
  /** Roster id → rating. A missing entry = unrated (scored NEUTRAL_RATING). */
  ratings: Record<string, number>;
  /** 2–4. */
  numTeams: number;
  /** Game format, for the nominal per-team size. */
  format?: GameFormat;
  createdBy: UserId;
  /**
   * Recent game-nights of this club, newest-first order not required. Drives
   * the "don't put the same people together again" half of the split. Absent
   * (a club with no stored splits, or a caller that couldn't load them) → the
   * split is decided on rating alone, exactly as before.
   */
  history?: PastSplit[];
  /** Selection model; see teamBalanceCore. Defaults to the shipped one. */
  strategy?: BalanceStrategy;
  /** Injectable RNG for deterministic tests. */
  rng?: () => number;
}

export interface BalanceTeamsOutput {
  result: DraftTeamsResult;
  /** How many roster ids had no rating (scored as the neutral middle). */
  unratedCount: number;
  /** Per-team average rating, team index order — the number the UI shows. */
  teamAverages: number[];
  /** Strongest team average − weakest. */
  gap: number;
  /** Repeat weight this split carries against the recent game-nights. */
  repeat: number;
  /** True when the roster made GAP_MAX unreachable and the fallback ran. */
  fallback: boolean;
  /** Tolerance band the gap fell into (A/B/C/over). */
  band: BalanceBand;
}

/**
 * Split the roster into `numTeams` teams: fair enough on rating, and inside the
 * fair options mixed up as much as possible relative to the last game-nights.
 *
 * `perTeam` is sized so NOBODY is benched
 * (`max(playersPerTeam(format), ceil(roster / numTeams))`), which keeps the
 * persist-then-resume round-trip through `reconstructPicks` exact.
 */
export function balanceTeams(input: BalanceTeamsInput): BalanceTeamsOutput {
  const { ratings, format, createdBy } = input;
  const unique = [...new Set(input.playerIds)];
  const numTeams = Math.max(1, Math.min(input.numTeams, unique.length));
  const perTeam = Math.max(
    playersPerTeam(format),
    Math.ceil(unique.length / Math.max(1, numTeams)),
  );

  const core = balanceCore({
    playerIds: unique,
    ratings,
    numTeams,
    perTeam,
    // `?.length`, not just presence: 'random' mode and a club with no stored
    // splits both pass an empty array, and an empty weight map is NOT the same
    // as no history — it would still switch the search into variety mode.
    pairWeights: input.history?.length
      ? buildPairRepeatWeights(input.history)
      : undefined,
    strategy: input.strategy,
    rng: input.rng,
  });

  const ratingOf = (id: string) =>
    typeof ratings[id] === 'number' && ratings[id] > 0
      ? normalizeRating(ratings[id])
      : NEUTRAL_RATING;

  const draftTeams = core.teams.map((ids, index) => {
    // Captain = the highest-rated member (ties → first after the stable sort).
    const ordered = ids.slice().sort((a, b) => ratingOf(b) - ratingOf(a));
    return { index, captainId: ordered[0], playerIds: ordered };
  });

  const result: DraftTeamsResult = {
    method: 'snake',
    numTeams: draftTeams.length,
    createdAt: Date.now(),
    createdBy,
    teams: draftTeams,
  };
  return {
    result,
    unratedCount: core.unratedCount,
    teamAverages: core.teams.map((ids) => {
      const avg = ids.reduce((s, id) => s + ratingOf(id), 0) / (ids.length || 1);
      return Math.round(avg * 10) / 10;
    }),
    gap: core.gap,
    repeat: core.repeat,
    fallback: core.fallback,
    band: core.band,
  };
}

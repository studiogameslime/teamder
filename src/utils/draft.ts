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

/** Neutral rating for an unrated player — the middle of the 1.0–5.0 scale. */
export const NEUTRAL_RATING = 3;

/**
 * Coerce any stored rating onto the live 1.0–5.0 scale. Ratings created before
 * the 1–10 → 1–5 migration still live in `adminRatings` / guest
 * `estimatedRating` as 6–10 values; read raw they make an old "8" dwarf a
 * neutral 3 and skew the split (B06/B07). Anything over the 1–5 max is treated
 * as the old scale and halved, then clamped into [1,5]. Mirrors the server
 * `normalizeRating` so client and scheduled splits agree. Idempotent on 1–5.
 */
export function normalizeRating(v: number): number {
  const r = v > 5 ? v / 2 : v;
  return Math.min(5, Math.max(1, r));
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

/** In-place Fisher–Yates shuffle. */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export interface BalanceTeamsInput {
  /** Roster ids: real uids + prefixed `guest:<id>`. */
  playerIds: string[];
  /** Roster id → 1..10 rating. A missing entry = unrated (scored NEUTRAL_RATING). */
  ratings: Record<string, number>;
  /** 2–4. */
  numTeams: number;
  /** Game format, for the nominal per-team size. */
  format?: GameFormat;
  createdBy: UserId;
}

export interface BalanceTeamsOutput {
  result: DraftTeamsResult;
  /** How many roster ids had no rating (scored as the neutral middle). */
  unratedCount: number;
}

/**
 * rating_greedy_v1 — split the roster into `numTeams` balanced teams by
 * rating, returning a ready-to-save `DraftTeamsResult`. Client port of the
 * server `balanceTeamsV1` (functions/src/index.ts), with two differences:
 *  • It returns draft-shaped teams (captain = highest-rated member,
 *    `playerIds[0]` = captain) instead of a flat zone map.
 *  • `perTeam` is sized so NOBODY is benched
 *    (`max(playersPerTeam(format), ceil(roster/numTeams))`), which keeps the
 *    persist-then-resume round-trip through `reconstructPicks` exact.
 *
 * Unrated players (and guests without `estimatedRating`) are scored at the
 * neutral middle, so they spread evenly. JS sort is stable, so the pre-sort
 * shuffle survives within any tied-rating bucket → reruns differ.
 */
export function balanceTeams(input: BalanceTeamsInput): BalanceTeamsOutput {
  const { ratings, format, createdBy } = input;
  // Dedupe the roster FIRST: a duplicate id (e.g. a player who slipped into
  // `players` twice, or overlaps a guest) would otherwise be placed twice and
  // land on two teams — the "why am I in my team twice?" bug (user report).
  const playerIds = [...new Set(input.playerIds)];
  // Never ask for more teams than there are players to fill them — an empty
  // team would carry an undefined captain and get dropped by the converter,
  // silently shrinking the count (B29). Mirrors the server clamp.
  const numTeams = Math.max(1, Math.min(input.numTeams, playerIds.length));
  let unratedCount = 0;
  const scored = playerIds.map((id) => {
    const known = ratings[id];
    if (typeof known === 'number' && known > 0) {
      return { id, rating: normalizeRating(known) };
    }
    unratedCount += 1;
    return { id, rating: NEUTRAL_RATING };
  });

  shuffleInPlace(scored);
  scored.sort((a, b) => b.rating - a.rating);

  // Size teams so everyone is placed (no bench) — the manual draft has no
  // bench either, and a bench would break the reconstructPicks round-trip.
  const perTeam = Math.max(
    playersPerTeam(format),
    Math.ceil(scored.length / Math.max(1, numTeams)),
  );

  const teams: { ids: string[]; total: number }[] = Array.from(
    { length: numTeams },
    () => ({ ids: [], total: 0 }),
  );

  for (const p of scored) {
    const open = teams.filter((t) => t.ids.length < perTeam);
    const pool = open.length > 0 ? open : teams; // safety: never drop a player
    pool.sort((a, b) => {
      if (a.total !== b.total) return a.total - b.total;
      if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length;
      return Math.random() - 0.5;
    });
    pool[0].ids.push(p.id);
    pool[0].total += p.rating;
  }

  const ratingOf = (id: string) =>
    typeof ratings[id] === 'number' && ratings[id] > 0
      ? normalizeRating(ratings[id])
      : NEUTRAL_RATING;

  const draftTeams = teams.map((t, index) => {
    // Captain = the highest-rated member (ties → first after the stable sort).
    const ordered = t.ids
      .slice()
      .sort((a, b) => ratingOf(b) - ratingOf(a));
    return {
      index,
      captainId: ordered[0],
      playerIds: ordered,
    };
  });

  const result: DraftTeamsResult = {
    method: 'snake',
    numTeams,
    createdAt: Date.now(),
    createdBy,
    teams: draftTeams,
  };
  return { result, unratedCount };
}

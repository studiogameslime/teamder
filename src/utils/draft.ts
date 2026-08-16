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
  // Floor at 0 (not 1): the live scale is 0–5 and sub-1 ratings are real —
  // flooring to 1 would collapse a genuinely weakest 0.4 into a 1.0 and defeat
  // the sub-1 rating feature at balance time.
  return Math.min(5, Math.max(0, r));
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
  /** Per-team average rating, team index order — the number the UI shows. */
  teamAverages: number[];
}

/**
 * The strongest and weakest ends of the roster, TIE-INCLUSIVE: everyone at or
 * above the Nth-highest rating, and everyone at or below the Nth-lowest. Taking
 * literally N ids instead would let a tie at the cut-off slip through — with
 * three players rated 4.0 and a top-3 of {4.5, 4.3, 4.0}, only one of the three
 * counts and stacking the other two stays invisible.
 */
function extremeSets(
  scored: ScoredPlayer[],
  numTeams: number,
): { top: Set<string>; bottom: Set<string> } {
  const sorted = scored.map((p) => p.rating).sort((a, b) => b - a);
  const topCut = sorted[Math.min(numTeams, sorted.length) - 1];
  const bottomCut = sorted[Math.max(0, sorted.length - numTeams)];
  const top = new Set<string>();
  const bottom = new Set<string>();
  for (const p of scored) {
    if (p.rating >= topCut) top.add(p.id);
    // On a short roster the two ends would overlap; the top end wins so a
    // player is never counted as both.
    else if (p.rating <= bottomCut) bottom.add(p.id);
  }
  return { top, bottom };
}

/**
 * How badly a split stacks the extremes: the sum of SQUARED counts of top (and
 * bottom) players per team, which is smallest when they are spread one per
 * team. Equal averages alone allow "the three best players on one team, carried
 * by the guest rated 1" — fair on paper, lopsided on the pitch. This is the
 * rule the admins apply by hand: one of the strongest and one of the weakest to
 * each team, then balance the rest.
 *
 * Squared and not `max(0, n − 1)`: with 5 strong players over 3 teams the
 * linear form scores 3/1/1 and 2/2/1 identically (both 2), so it would let the
 * pile-up through; squared prefers 2/2/1 (9) over 3/1/1 (11).
 */
function stackPenalty(
  teams: BuildTeam[],
  top: Set<string>,
  bottom: Set<string>,
): number {
  let penalty = 0;
  for (const t of teams) {
    let nTop = 0;
    let nBottom = 0;
    for (const id of t.ids) {
      if (top.has(id)) nTop += 1;
      else if (bottom.has(id)) nBottom += 1;
    }
    penalty += nTop * nTop + nBottom * nBottom;
  }
  return penalty;
}

/** A player with the rating the balance actually scores them at. */
interface ScoredPlayer {
  id: string;
  rating: number;
}

/** A team under construction: its members and their rating sum. */
interface BuildTeam {
  ids: string[];
  total: number;
  /** Fixed target size — the balance works towards AVERAGES, so it must know
   *  how many players each team will end up with. */
  size: number;
}

/**
 * How much average gap counts as "still equally fair" — the knob that decides
 * how much a rerun varies. Measured over 200 presses of the real 15-player
 * roster: 0.02 → 12 distinct splits, 0.05 → 36, 0.08 → 78, 0.10 → 125, with the
 * worst surviving gap tracking the value itself. 0.05 is the last value whose
 * gap (0.04) still rounds to a single shared number on screen — past it the
 * teams start showing 3.3 against 3.4, which is the very thing the split is
 * supposed to avoid.
 */
const SPREAD_EPSILON = 0.05;
/** Weight of one stack-penalty point against one rating point of average gap.
 *  Small on purpose: a genuinely fairer split still wins, but between splits
 *  that are equally fair the less top-heavy one is taken. */
const STACK_WEIGHT = 0.02;
/** How many independent splits to generate before picking one. */
const CANDIDATES = 32;
/** Sideways swaps applied to the chosen split, for variety at equal fairness. */
const WANDER_STEPS = 6;
/** Cap on improvement passes — the loop exits on its own long before this. */
const MAX_REFINE_PASSES = 60;

/**
 * Team sizes, as even as possible, capped at `capacity` each. Players beyond
 * `numTeams * capacity` are not placed (the caller benches them).
 * The remainder is handed to a RANDOM subset of teams, so "קבוצה א is always
 * the one with the extra player" stops being a fixed pattern.
 */
function splitSizes(
  count: number,
  numTeams: number,
  capacity: number,
): number[] {
  const placed = Math.min(count, numTeams * capacity);
  const base = Math.floor(placed / numTeams);
  const extra = placed % numTeams;
  const order = Array.from({ length: numTeams }, (_, i) => i);
  shuffleInPlace(order);
  const sizes = new Array<number>(numTeams).fill(base);
  for (let i = 0; i < extra; i++) sizes[order[i]] += 1;
  return sizes;
}

/** Average rating of a team; an empty team scores neutral so it never wins
 *  or loses the spread comparison on emptiness alone. */
function averageOf(t: BuildTeam): number {
  return t.ids.length > 0 ? t.total / t.ids.length : NEUTRAL_RATING;
}

/** The fairness objective: the gap between the strongest and weakest team
 *  AVERAGE. Zero = perfectly balanced. */
function spreadOf(teams: BuildTeam[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const t of teams) {
    const a = averageOf(t);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  return max - min;
}

/**
 * One greedy pass: strongest player first, into whichever team is furthest
 * BELOW its share. `total / size` (not `total`) is the yardstick — that is
 * what makes the split chase equal averages instead of equal sums, so a team
 * that carries an extra player is allowed a bigger sum.
 */
function greedyBuild(
  scored: ScoredPlayer[],
  sizes: number[],
): { teams: BuildTeam[]; bench: ScoredPlayer[] } {
  const teams: BuildTeam[] = sizes.map((size) => ({ ids: [], total: 0, size }));
  const players = scored.slice();
  shuffleInPlace(players); // varies the order inside every tied-rating bucket
  players.sort((a, b) => b.rating - a.rating); // stable → the shuffle survives

  const bench: ScoredPlayer[] = [];
  for (const p of players) {
    const open = teams.filter((t) => t.ids.length < t.size);
    if (open.length === 0) {
      bench.push(p);
      continue;
    }
    open.sort((a, b) => {
      const da = a.total / Math.max(1, a.size);
      const db = b.total / Math.max(1, b.size);
      if (Math.abs(da - db) > 1e-9) return da - db;
      if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length;
      return Math.random() - 0.5;
    });
    open[0].ids.push(p.id);
    open[0].total += p.rating;
  }
  // Whatever didn't fit is the caller's bench, weakest last (the players are
  // walked strongest-first, so overflow is the tail of the roster).
  return { teams, bench };
}

/**
 * What the balance optimises: the average gap, plus a small charge for piling
 * the strongest (or weakest) players onto one team. Both in one number so the
 * refinement can't fix one by wrecking the other — chasing the gap alone is
 * exactly what produced "the three best players together, carried by the guest
 * rated 1".
 */
function costOf(
  teams: BuildTeam[],
  top: Set<string>,
  bottom: Set<string>,
): number {
  return spreadOf(teams) + STACK_WEIGHT * stackPenalty(teams, top, bottom);
}

/** Swap two players between teams, keeping the running totals in step. */
function applySwap(
  ti: BuildTeam,
  a: number,
  tj: BuildTeam,
  b: number,
  rating: (id: string) => number,
): void {
  const ida = ti.ids[a];
  const idb = tj.ids[b];
  ti.ids[a] = idb;
  tj.ids[b] = ida;
  ti.total += rating(idb) - rating(ida);
  tj.total += rating(ida) - rating(idb);
}

/**
 * Steepest-descent refinement: repeatedly apply the single cross-team swap that
 * improves the cost the most, until nothing improves. Team sizes are preserved,
 * so this can only make the split better — it is the step the old one-pass
 * greedy was missing, and the reason a 0.4 gap used to survive every rerun.
 */
function refineSwaps(
  teams: BuildTeam[],
  rating: (id: string) => number,
  top: Set<string>,
  bottom: Set<string>,
): void {
  for (let pass = 0; pass < MAX_REFINE_PASSES; pass++) {
    // ALL the best swaps, not the first one found: a roster usually offers
    // several swaps that improve the split by exactly the same amount, and
    // taking the earliest in scan order every time is what made the descent
    // land on the same handful of splits no matter where it started.
    let bestGain = 0;
    let best: { i: number; j: number; a: number; b: number }[] = [];
    const current = costOf(teams, top, bottom);
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const ti = teams[i];
        const tj = teams[j];
        for (let a = 0; a < ti.ids.length; a++) {
          for (let b = 0; b < tj.ids.length; b++) {
            // Try it for real and undo — the cost depends on WHO sits where
            // (the stacking half), not just on the totals.
            applySwap(ti, a, tj, b, rating);
            const gain = current - costOf(teams, top, bottom);
            applySwap(ti, a, tj, b, rating);
            if (gain <= 1e-9) continue;
            if (gain > bestGain + 1e-9) {
              bestGain = gain;
              best = [{ i, j, a, b }];
            } else if (gain >= bestGain - 1e-9) {
              best.push({ i, j, a, b });
            }
          }
        }
      }
    }
    if (best.length === 0) return;
    const pick = best[Math.floor(Math.random() * best.length)];
    applySwap(teams[pick.i], pick.a, teams[pick.j], pick.b, rating);
  }
}

/**
 * Random walk INSIDE the fair region: repeatedly apply a random swap that keeps
 * the stacking minimal and the average gap within `maxSpread`. The refinement
 * converges on a handful of optimal splits — on the real 15-player roster only
 * about a dozen exist — so without this step a rerun keeps re-drawing the same
 * few line-ups, and one grouping can end up fixed. Every step here is
 * sideways, never downhill: the split that comes out is exactly as fair as the
 * one that went in, just composed differently.
 */
function wander(
  teams: BuildTeam[],
  rating: (id: string) => number,
  top: Set<string>,
  bottom: Set<string>,
  maxSpread: number,
  steps: number,
): void {
  for (let s = 0; s < steps; s++) {
    const basePenalty = stackPenalty(teams, top, bottom);
    const moves: { i: number; j: number; a: number; b: number }[] = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const ti = teams[i];
        const tj = teams[j];
        for (let a = 0; a < ti.ids.length; a++) {
          for (let b = 0; b < tj.ids.length; b++) {
            applySwap(ti, a, tj, b, rating);
            const ok =
              spreadOf(teams) <= maxSpread + 1e-9 &&
              stackPenalty(teams, top, bottom) <= basePenalty;
            applySwap(ti, a, tj, b, rating);
            if (ok) moves.push({ i, j, a, b });
          }
        }
      }
    }
    if (moves.length === 0) return;
    const m = moves[Math.floor(Math.random() * moves.length)];
    applySwap(teams[m.i], m.a, teams[m.j], m.b, rating);
  }
}

/**
 * rating_balanced_v2 — split the roster into `numTeams` teams with matching
 * AVERAGE ratings, returning a ready-to-save `DraftTeamsResult`. Mirrors the
 * server `balanceTeamsV1` (functions/src/index.ts); the client differs only in
 * shape (draft teams with a captain, `playerIds[0]`) and in sizing `perTeam`
 * so NOBODY is benched — which keeps the persist-then-resume round-trip
 * through `reconstructPicks` exact.
 *
 * Three properties the previous rating_greedy_v1 lacked:
 *  • It balances the AVERAGE, not the sum. Equal sums across teams of
 *    different sizes meant the bigger team was permanently weaker.
 *  • A swap-refinement pass closes whatever gap the greedy pass leaves.
 *  • It generates `CANDIDATES` independent splits and picks at random among
 *    all of them that are within `SPREAD_EPSILON` of the fairest, so pressing
 *    the button again really does produce different teams. The old shuffle
 *    only reordered tied ratings, so every rerun landed on the same totals.
 *
 * Unrated players (and guests without `estimatedRating`) are scored at the
 * neutral middle, so they spread evenly.
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
  const scored: ScoredPlayer[] = playerIds.map((id) => {
    const known = ratings[id];
    if (typeof known === 'number' && known > 0) {
      return { id, rating: normalizeRating(known) };
    }
    unratedCount += 1;
    return { id, rating: NEUTRAL_RATING };
  });

  const ratingOf = (id: string) =>
    typeof ratings[id] === 'number' && ratings[id] > 0
      ? normalizeRating(ratings[id])
      : NEUTRAL_RATING;

  // Size teams so everyone is placed (no bench) — the manual draft has no
  // bench either, and a bench would break the reconstructPicks round-trip.
  const perTeam = Math.max(
    playersPerTeam(format),
    Math.ceil(scored.length / Math.max(1, numTeams)),
  );

  // Generate several good splits, then pick one at random among the best.
  const { top, bottom } = extremeSets(scored, numTeams);
  const pool = [];
  for (let k = 0; k < CANDIDATES; k++) {
    const { teams: built } = greedyBuild(
      scored,
      splitSizes(scored.length, numTeams, perTeam),
    );
    refineSwaps(built, ratingOf, top, bottom);
    pool.push({
      teams: built,
      spread: spreadOf(built),
      penalty: stackPenalty(built, top, bottom),
    });
  }
  // Selection is LEXICOGRAPHIC, not a weighted sum: no team may hold more of
  // the strongest (or weakest) players than it has to — that is a hard rule,
  // and letting `SPREAD_EPSILON` trade it away for a hundredth of a rating
  // point put the whole top of the roster back on one team. Only once the
  // stacking is minimal does the tolerance open the field up for variety.
  const minPenalty = Math.min(...pool.map((c) => c.penalty));
  const unstacked = pool.filter((c) => c.penalty === minPenalty);
  const bestSpread = Math.min(...unstacked.map((c) => c.spread));
  const best = unstacked.filter((c) => c.spread <= bestSpread + SPREAD_EPSILON);
  const chosen = best[Math.floor(Math.random() * best.length)] ?? pool[0];
  const teams = chosen.teams;
  wander(teams, ratingOf, top, bottom, bestSpread + SPREAD_EPSILON, WANDER_STEPS);

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
  return {
    result,
    unratedCount,
    teamAverages: teams.map((t) => Math.round(averageOf(t) * 10) / 10),
  };
}

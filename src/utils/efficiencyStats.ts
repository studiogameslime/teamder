// Per-game efficiency, next to the cumulative table rather than instead of it.
//
// The cumulative table answers "who has done the most here", which after two
// years answers "who has been here longest". This one answers "who is good
// right now", and the two are different questions — a player with 12 games and
// 9 goals is having a better season than one with 300 games and 180, and the
// standing table cannot say so.
//
// THE DENOMINATOR IS THE WHOLE PROBLEM.
//
// `cleanSheets` and `assists` count the times something HAPPENED. They do not
// count the mini-games in which the metric was being recorded at all — clean
// sheets began 17.08 and assists 21.06, while clubs have existed since 28.04.
// Dividing either by `rounds` silently folds in mini-games nobody was
// measuring, and produces a number that is wrong and looks right.
//
// Measured in production: clean sheets are recorded for 78% of the big club's
// player-rounds. Dividing by `rounds` puts the top players at 42/47/44%, and
// the correct denominator puts them at 54/58/51% — a tenth of the scale,
// missing, for every long-standing member.
//
// So the server now keeps `csRounds` and `asRounds` — "the metric was being
// measured for this round" — and every rate here divides by the right one.
// When a denominator is missing (an old row the backfill never reached), the
// answer is `null` and the cell shows a dash. A dash is honest; a zero is a
// claim that the player kept no clean sheets, which is a different statement.

import type { ChampionshipRow } from './championship';

export interface EfficiencyRow {
  uid: string;
  /** Wins as a share of mini-games played. 0–100, or null when none played. */
  winPct: number | null;
  goalsPerGame: number | null;
  assistsPerGame: number | null;
  /** Goals + assists per mini-game — the headline, and the default sort. */
  gaPerGame: number | null;
  cleanSheetPct: number | null;
  /** Evenings (מחזורים) attended as a share of the evenings the club held in
   *  the scope on screen. 0–100, or null when there is nothing to divide by.
   *  The ONLY rate here counted in evenings rather than mini-games. */
  attendancePct: number | null;
  /** Mini-games played. The sample the rest of the row rests on. */
  rounds: number;
  /** True when this player's history predates one of the metrics, so at least
   *  one rate is computed over a shorter window than `rounds`. */
  partial: boolean;
}

/** A rate, or null when there is nothing to divide by. */
function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Which denominator a metric may honestly use.
 *
 * Falls back to `rounds` only when the coverage counter is absent entirely —
 * a row written before the counters existed and not yet backfilled. That is
 * the pre-existing behaviour, no worse than before, and the backfill removes
 * it. A counter of 0 with rounds > 0 is NOT missing: it means the metric was
 * never measured for this player, and the rate is genuinely unknowable.
 */
function coverage(counter: number | undefined, rounds: number): number {
  return typeof counter === 'number' ? counter : rounds;
}

/**
 * Attendance — the one rate on this row measured in EVENINGS, not mini-games.
 *
 * `games` is evenings the player turned up for; `clubEvenings` is how many the
 * club held in the scope the table is showing (the running season, one sealed
 * season, or all time). Mixing the two scopes is the whole risk here: a
 * season-scoped numerator over a lifetime denominator reads as a player who
 * shows up a third of the time, so the caller must hand over the evening count
 * that belongs to the rows it is passing, or none at all.
 *
 * Null, in both of the cases where the number would be a claim rather than a
 * measurement:
 *   • No denominator — the caller has no evening count for this scope. Nothing
 *     to divide by, and the column hides itself rather than print a dash per
 *     row.
 *   • The player attended none of them. A zero cannot tell "was in the club
 *     all season and never came" from "joined last week", and this table
 *     lists every member from the day they join — including the whole roster
 *     on the morning a new season starts, when the club has held no evenings
 *     yet and every `games` is 0.
 *
 * Capped at 100. A player cannot attend more evenings than the club held, so
 * anything above it is drift between the attendance scan and the evening
 * count, and "117%" reads as a broken table rather than as a caveat.
 */
export function attendanceShare(
  games: number | undefined,
  clubEvenings: number | undefined,
): number | null {
  const attended = typeof games === 'number' && games > 0 ? games : 0;
  const held =
    typeof clubEvenings === 'number' && clubEvenings > 0 ? clubEvenings : 0;
  if (attended <= 0 || held <= 0) return null;
  return Math.min(100, (attended / held) * 100);
}

export function toEfficiencyRow(
  row: ChampionshipRow,
  /** Evenings the club held in the scope these rows belong to. Omit and the
   *  attendance rate is null — see `attendanceShare`. */
  clubEvenings?: number,
): EfficiencyRow {
  const rounds = row.rounds ?? 0;
  const csRounds = coverage(row.csRounds, rounds);
  const asRounds = coverage(row.asRounds, rounds);

  // Goals have been recorded since the first evening, so they divide by the
  // full sample. Assists have not, which also makes `asRounds` the honest
  // denominator for goals+assists: it is the window in which BOTH were being
  // recorded, and inflating it with goal-only rounds would overstate the
  // combined rate for exactly the longest-standing players.
  return {
    uid: row.uid,
    winPct: rate(row.wins ?? 0, rounds) === null ? null : (row.wins / rounds) * 100,
    goalsPerGame: rate(row.goals ?? 0, rounds),
    assistsPerGame: rate(row.assists ?? 0, asRounds),
    gaPerGame: rate((row.goals ?? 0) + (row.assists ?? 0), asRounds),
    cleanSheetPct:
      rate(row.cleanSheets ?? 0, csRounds) === null
        ? null
        : (row.cleanSheets / csRounds) * 100,
    attendancePct: attendanceShare(row.games, clubEvenings),
    rounds,
    partial: rounds > 0 && (csRounds < rounds || asRounds < rounds),
  };
}

/** Whole numbers. 55%, not 54.8% — a decimal here implies a precision the
 *  sample does not have. */
export function formatPct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}%`;
}

/** Two decimals. 0.24 carries real information at these volumes; 0.2 does not. */
export function formatPerGame(v: number | null): string {
  return v === null ? '—' : v.toFixed(2);
}

export type EfficiencySortKey =
  | 'winPct'
  | 'goalsPerGame'
  | 'assistsPerGame'
  | 'gaPerGame'
  | 'cleanSheetPct'
  | 'attendancePct'
  | 'rounds';

/**
 * Sort by a column, descending, with nulls last.
 *
 * A player with no data has not "scored zero" — they are unrankable on that
 * column, and pushing them below everyone who does have a number is the only
 * placement that does not assert something false about them.
 *
 * Ties fall through to more mini-games, so the deeper sample wins. Without it,
 * a player with one appearance and one goal would sit above a regular on the
 * same rate, which is the complaint that started this table.
 */
export function sortEfficiency(
  rows: readonly EfficiencyRow[],
  key: EfficiencySortKey,
): EfficiencyRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return b.rounds - a.rounds;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (bv !== av) return bv - av;
    return b.rounds - a.rounds;
  });
}

/**
 * The share of the club's mini-games a player must have played to be RANKED.
 *
 * A rate over a handful of mini-games is not a measurement, it is a
 * coincidence: one lucky night puts a visitor who came once above people who
 * have turned up for two years. The cumulative table is a record of what
 * everyone did and lists everyone; the efficiency table is a ranking, and a
 * ranking without an entry requirement ranks noise.
 *
 * A tenth is the owner's number and it is a good one. A club playing ~6
 * mini-games a night asks for roughly two evenings out of twenty — it clears
 * the one-off visitor without touching anybody who actually turns up.
 */
export const MIN_RANKED_SHARE = 0.1;

/** Mini-games needed to be ranked, given what the club has played. 0 disables
 *  the bar entirely (a club with no recorded mini-games rates everyone). */
export function minRoundsForRanking(clubRounds: number | undefined): number {
  return typeof clubRounds === 'number' && clubRounds > 0
    ? Math.ceil(clubRounds * MIN_RANKED_SHARE)
    : 0;
}

/**
 * The players the efficiency table may rank.
 *
 * Never returns empty. A young club can have nobody past the bar — everyone's
 * sample is small while the club's is — and a blank tab reads as broken rather
 * than as strict.
 */
export function eligibleForRanking<T extends { rounds?: number }>(
  players: T[],
  clubRounds: number | undefined,
): T[] {
  const min = minRoundsForRanking(clubRounds);
  if (min <= 0) return players;
  const eligible = players.filter((p) => (p.rounds ?? 0) >= min);
  return eligible.length > 0 ? eligible : players;
}

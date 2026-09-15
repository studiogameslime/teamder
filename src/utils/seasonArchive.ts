// The sealed record of one finished season, in the shape the club reads it.
//
// Pure on purpose: this is the reader for `seasonSummary/{groupId}__{seasonId}`
// and the thing most likely to drift away from the writer, so it has to be
// testable without a Firestore or a React Native runtime around it.

import type { ChampionshipRow } from '@/utils/championship';

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * ONE closed season's numbers, in the exact shape the club stats screen
 * already renders the RUNNING season in.
 *
 * Read from the archive and never recomputed: a past season is a record, and a
 * record that changes because the code did is not a record.
 *
 * Every column is there because the reset list was the point — a season owns
 * these counters, so closing one had to save all of them or it would be
 * destroying rather than archiving. The upshot is that a past season is exactly
 * as complete as the live one for anything derived from player and pair rows:
 * the top scorer, the leaders, the donuts, the duo, the full table.
 *
 * What it does NOT carry is the other half of that screen — organisation rate,
 * average attendance, the longest streak — which is scanned from the club's
 * finished games rather than kept in a counter. The screen hides those for a
 * past season instead of showing today's value under last season's heading.
 *
 * Names come frozen with the rows, so the caller passes them through rather
 * than resolving from /users: a season still reads after somebody deletes
 * their account, or leaves the club.
 */
export interface FinishedSeasonTable {
  totalGoals: number;
  totalRounds: number;
  tiedRounds: number;
  shootoutRounds: number;
  scorelessRounds: number;
  guestGoals: number;
  ownGoals: number;
  players: ChampionshipRow[];
  /** The pair with the most assists between them, as the live screen shows it. */
  duo: { uidA: string; uidB: string; assists: number } | null;
  /** uid → the display name sealed at closing time. */
  names: Record<string, string>;
}

/**
 * The archive document, in the shape the club stats screen renders.
 *
 * Exported and pure so the mapping can be tested against a byte-for-byte copy
 * of what closeSeason writes — the same reason every other reader in this app
 * has a persistence test. A field added to the archive and not named here
 * simply does not exist on the client, silently.
 */
export function parseSeasonTable(
  d: Record<string, unknown>,
): FinishedSeasonTable {
  const rows = (d.players ?? {}) as Record<string, Record<string, unknown>>;
  const totals = (d.totals ?? {}) as Record<string, unknown>;
  const players: ChampionshipRow[] = [];
  const names: Record<string, string> = {};
  for (const [uid, x] of Object.entries(rows)) {
    if (typeof x !== 'object' || x === null) continue;
    const n = str(x.displayName);
    if (n) names[uid] = n;
    players.push({
      uid,
      goals: num(x.goals),
      assists: num(x.assists),
      rounds: num(x.rounds),
      wins: num(x.wins),
      ties: num(x.ties),
      losses: num(x.losses),
      games: num(x.games),
      penTaken: num(x.penTaken),
      penScored: num(x.penScored),
      penFaced: num(x.penFaced),
      penSaved: num(x.penSaved),
      ownGoals: num(x.ownGoals),
      cleanSheets: num(x.cleanSheets),
      // Absent stays absent. These two say how many mini-games a metric could
      // be measured over, and they arrived later than the metrics they divide;
      // a 0 here claims "measured across zero rounds", which is exactly what
      // the reader's fallback exists to distinguish from a real zero.
      ...(typeof x.csRounds === 'number' ? { csRounds: x.csRounds } : {}),
      ...(typeof x.asRounds === 'number' ? { asRounds: x.asRounds } : {}),
    });
  }
  return {
    totalGoals: num(totals.goals),
    totalRounds: num(totals.rounds),
    tiedRounds: num(totals.tiedRounds),
    shootoutRounds: num(totals.shootoutRounds),
    scorelessRounds: num(totals.scorelessRounds),
    guestGoals: num(totals.guestGoals),
    ownGoals: num(totals.ownGoals),
    players,
    duo: topDuo(d.pairs, names),
    names,
  };
}

/**
 * The season's deadliest duo, from the archived pairs.
 *
 * Same rule as the live screen: most assists between the two, either
 * direction. Guests are already excluded from the archive, but a pair whose
 * other half is not in the sealed player map is skipped anyway — the screen
 * needs a name for both halves and has no /users lookup that would find one.
 */
function topDuo(
  raw: unknown,
  names: Record<string, string>,
): { uidA: string; uidB: string; assists: number } | null {
  // The archive stores pairs as a MAP keyed "<lo>__<hi>", not an array.
  //
  // This read `Array.isArray(raw)` and bailed, so every closed season's
  // deadliest duo came back null — silently, because a season with no duo is a
  // legitimate outcome and looks identical. Accepting both shapes costs one
  // line and makes the reader independent of how the writer happens to spell
  // a collection.
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw as Record<string, unknown>)
      : [];
  let best: { uidA: string; uidB: string; assists: number } | null = null;
  for (const p of rows) {
    if (typeof p !== 'object' || p === null) continue;
    const x = p as Record<string, unknown>;
    const a = str(x.a);
    const b = str(x.b);
    if (!a || !b || !names[a] || !names[b]) continue;
    const assists = num(x.assistsAToB) + num(x.assistsBToA);
    if (assists > (best?.assists ?? 0)) best = { uidA: a, uidB: b, assists };
  }
  return best;
}

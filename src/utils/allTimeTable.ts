// The club's ALL-TIME table, across every season it has ever played.
//
// Closing a season ZEROES the live counters — goals, assists, rounds, wins,
// evenings, clean sheets, penalties, every one of them — after copying them
// into an archive. That is the whole point of a season, and it means the live
// rows answer exactly one question: "this season". After the first close,
// nothing in the app could answer "how many goals have I scored for this club,
// ever" — which is what "למה אין טבלה של כל הזמנים?" was asking.
//
// All-time is therefore live + every archive, summed per player. Nothing
// recomputes and nothing is re-read from games: the archives ARE the record of
// the seasons they sealed, so this is addition over numbers that were already
// agreed.

import type { ChampionshipRow } from '@/utils/championship';

export interface ClubTotals {
  totalGoals: number;
  totalRounds: number;
  tiedRounds: number;
  shootoutRounds: number;
  scorelessRounds: number;
  countedRounds: number;
  guestGoals: number;
  ownGoals: number;
}

export interface TableSlice extends ClubTotals {
  players: ChampionshipRow[];
  /** uid → name, for players who have left and exist only in an archive. */
  names?: Record<string, string>;
}

const n = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Columns that are plain counts and simply add up across seasons. */
const SUMMED = [
  'goals',
  'assists',
  'rounds',
  'wins',
  'ties',
  'losses',
  'games',
  'penTaken',
  'penScored',
  'penFaced',
  'penSaved',
  'ownGoals',
  'cleanSheets',
] as const;

/**
 * Coverage denominators are summed ONLY where both sides have one.
 *
 * `csRounds` / `asRounds` say how many mini-games a metric could be measured
 * over, and they arrived later than the metrics they divide. Absent means
 * "never measured", which is a different statement from zero — so adding a
 * present one to an absent one would invent coverage that never existed and
 * quietly deflate the rate. If any slice is missing it, the total is missing
 * it too, and the reader falls back as it always has.
 */
function mergeCoverage(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (typeof a !== 'number' || typeof b !== 'number') return undefined;
  return a + b;
}

/**
 * Add every slice together into one table.
 *
 * Order does not matter and the operation is associative, so a club with one
 * archive and a club with nine reach their answer the same way.
 */
export function mergeAllTime(slices: readonly TableSlice[]): TableSlice {
  const byUid = new Map<string, ChampionshipRow>();
  const names: Record<string, string> = {};
  const totals: ClubTotals = {
    totalGoals: 0,
    totalRounds: 0,
    tiedRounds: 0,
    shootoutRounds: 0,
    scorelessRounds: 0,
    countedRounds: 0,
    guestGoals: 0,
    ownGoals: 0,
  };

  for (const s of slices) {
    if (!s) continue;
    totals.totalGoals += n(s.totalGoals);
    totals.totalRounds += n(s.totalRounds);
    totals.tiedRounds += n(s.tiedRounds);
    totals.shootoutRounds += n(s.shootoutRounds);
    totals.scorelessRounds += n(s.scorelessRounds);
    // Summed like the rest: all-time's denominator is the sum of the samples
    // each season was measured over, not the sum of rounds played.
    totals.countedRounds += n(s.countedRounds);
    totals.guestGoals += n(s.guestGoals);
    totals.ownGoals += n(s.ownGoals);
    for (const [uid, name] of Object.entries(s.names ?? {})) {
      // First name wins: the LIVE slice is passed first, so a player still in
      // the club keeps their current name over a two-year-old frozen copy.
      if (name && !names[uid]) names[uid] = name;
    }
    for (const row of s.players ?? []) {
      const prev = byUid.get(row.uid);
      if (!prev) {
        byUid.set(row.uid, { ...row });
        continue;
      }
      const next: ChampionshipRow = { ...prev };
      for (const f of SUMMED) next[f] = n(prev[f]) + n(row[f]);
      const cs = mergeCoverage(prev.csRounds, row.csRounds);
      const as = mergeCoverage(prev.asRounds, row.asRounds);
      if (typeof cs === 'number') next.csRounds = cs;
      else delete next.csRounds;
      if (typeof as === 'number') next.asRounds = as;
      else delete next.asRounds;
      byUid.set(row.uid, next);
    }
  }

  return { ...totals, players: [...byUid.values()], names };
}

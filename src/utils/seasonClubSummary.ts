import type { SeasonPairRow } from './seasonPersonal';
import { EMPTY_PAIR, pairKey, type PairTotals } from './clubChemistry';

export interface SeasonClubNumbers {
  games: number | null;
  players: number;
  goals: number | null;
  assists: number | null;
  ownGoals: number | null;
  penScored: number | null;
  penTaken: number | null;
  penSaved: number | null;
  averageAttendance: number | null;
  goalsPerGame: number | null;
  topScorerShare: number | null;
}

const number = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** Club mini-games are counted ONCE in totals, never summed over players. */
export function buildSeasonClubNumbers(
  totals: Record<string, unknown>,
  players: Record<string, unknown>[],
  completedRounds: number,
): SeasonClubNumbers {
  const sum = (field: string): number | null => {
    const values = players.map(p => number(p[field]));
    // Older archives did not keep every counter. Absence is not a zero.
    return values.length && values.some(v => v !== null)
      ? values.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  };
  const games = number(totals.rounds);
  const goals = number(totals.goals);
  const attendance = sum('games');
  const topScorer = Math.max(0, ...players.map(p => number(p.goals) ?? 0));
  return {
    games, goals,
    players: players.filter(p => (number(p.games) ?? 0) > 0 || (number(p.rounds) ?? 0) > 0).length,
    assists: number(totals.assists) ?? sum('assists'),
    ownGoals: number(totals.ownGoals),
    penScored: sum('penScored'), penTaken: sum('penTaken'), penSaved: sum('penSaved'),
    averageAttendance: completedRounds > 0 && attendance !== null ? attendance / completedRounds : null,
    goalsPerGame: games && goals !== null ? goals / games : null,
    topScorerShare: goals && topScorer <= goals ? topScorer / goals : null,
  };
}

/** Canonical key AND directional counters must agree, including old rows. */
export function seasonChemistryPairs(rows: SeasonPairRow[]): Record<string, PairTotals> {
  return Object.fromEntries(rows.map(({ a, b, ...p }) => [pairKey(a, b), a < b ? { ...EMPTY_PAIR, ...p } : {
    ...EMPTY_PAIR, ...p, winsA: p.winsB ?? 0, winsB: p.winsA ?? 0,
    assistsAToB: p.assistsBToA ?? 0, assistsBToA: p.assistsAToB ?? 0,
  }]));
}

export function distinctSeasonWinners(holders: string[]): string[] {
  return [...new Set(holders.flatMap(id => id.split('__')).filter(Boolean))];
}

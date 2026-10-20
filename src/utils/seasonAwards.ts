// Who wins what when a season closes.
//
// This is the file the arguments will be about, so every rule in it comes
// from the spec rather than from taste, and every one is tested.
//
// Three ideas carry the whole thing:
//
//   1. ELIGIBILITY IS A GATE, NOT A RANKING. A player must have turned up for
//      at least half the season's finished rounds. Below that they are not
//      compared for MVP or win percentage — cumulative titles have no attendance gate.
//
//   2. "NOT AWARDED" IS A RESULT. If nobody is eligible, or the leader's
//      number is zero, the title simply
//      is not given. An empty crown is better than a silly one, and the
//      season document stores `null` so a past season stays auditable.
//
//   3. TIES ARE SHARED. Every player on the top number wins. No coin toss, no
//      alphabetical order, no id comparison — the club would notice, and it
//      would be indefensible.
//
// A player who has LEFT the club can still win: the title was earned on the
// pitch, and it belongs to them. Membership is not a condition anywhere here.

/** One player's season line. Only the fields a title can be decided on. */
export interface SeasonPlayerLine {
  uid: string;
  /**
   * EVENINGS this player turned up to — the eligibility numerator, and the
   * loyalty title.
   *
   * It has to be evenings, because the season's own length is measured in
   * evenings: `completedRounds` is the sealed-evening count. The gate used to
   * compare `rounds` (MINI-GAMES) against half of that, which is not a
   * comparison at all — a club plays roughly six mini-games an evening, so a
   * one-night visitor cleared a gate meant to demand half a season. That
   * mistake would have been sealed into every archive, permanently.
   */
  games: number;
  /** Mini-games played. Not an attendance measure — see `games`. */
  rounds: number;
  goals: number;
  assists: number;
  wins: number;
  cleanSheets: number;
  /** Mean of the round scores they actually received this season. */
  mvpAvg: number;
  /** Number of genuine round ratings, when known. */
  ratedRounds?: number;
  penTaken: number;
  penScored: number;
  penFaced: number;
  penSaved: number;
}

/** A pair's season line, for the deadly duo. */
export interface SeasonPairLine {
  a: string;
  b: string;
  /** The existing club pair metric. */
  score: number;
  /** Rounds the two were on the same side. */
  together: number;
}

export type SeasonTitleKey =
  | 'topScorer'
  | 'topAssister'
  | 'mvp'
  | 'topWinner'
  | 'mostLoyal'
  | 'cleanSheetKing'
  | 'penaltyKing'
  | 'penaltyKeeper'
  | 'deadlyDuo';

/** A decided title. `winners` holds every player on the top number. */
export interface SeasonAward {
  winners: string[];
  value: number;
  /** Absent on legacy count awards. Percent values are in 0–100. */
  valueUnit?: 'percent';
}

export type SeasonAwards = Record<SeasonTitleKey, SeasonAward | null>;

export const SEASON_TITLE_KEYS: readonly SeasonTitleKey[] = [
  'mvp',
  'topScorer',
  'topAssister',
  'topWinner',
  'mostLoyal',
  'cleanSheetKing',
  'penaltyKing',
  'penaltyKeeper',
  'deadlyDuo',
];

/**
 * Half the season's finished rounds, rounded up.
 *
 * Measured against the club: 13 rounds → 7, and 13 of 29 players clear it.
 * That club's attendance is bimodal — a core on 9–12 and then a drop to 5 —
 * so half lands in the gap rather than through anybody's middle.
 */
export function eligibilityThreshold(completedRounds: number): number {
  return Math.ceil(Math.max(0, completedRounds) / 2);
}

/**
 * Did this player turn up enough to be considered for שחקן העונה?
 *
 * Applied to MVP and win percentage. Cumulative titles remain ungated.
 *
 * Evenings against evenings. Both sides of this comparison must be the same
 * unit or the gate means nothing — see the note on `games`.
 */
export function isEligible(
  line: Pick<SeasonPlayerLine, 'games'>,
  completedRounds: number,
): boolean {
  return line.games >= eligibilityThreshold(completedRounds);
}

/**
 * How many attempts a penalty title used to demand before it would be awarded.
 *
 * ⚠️ NO LONGER APPLIED. The penalty titles are counts now, not rates — מלך
 * הפנדלים is "most penalties scored this season" and מלך שוערי הפנדלים is
 * "most penalties saved" — and a count needs no minimum-sample guard, because
 * the thing that made a rate meaningless off one kick (100% from a single
 * attempt) cannot happen to a count. One save leads the season only if nobody
 * saved two.
 *
 * Kept and exported because the mirror test and the historical-archive
 * comparison both need to state what the old rule WAS: every archive written
 * before 20.09.2026 decided these two titles by rate under this gate, so a
 * reader comparing an old archive to a fresh computation needs the old rule to
 * explain the difference.
 *
 *   10 rounds → 2    24 → 3    35 → 4    50+ → 5
 */
export function minPenaltyAttempts(completedRounds: number): number {
  return Math.min(5, Math.max(2, Math.ceil(Math.max(0, completedRounds) / 10)));
}

/** Everyone holding the maximum, or null when the max is not worth a title. */
function leaders<T>(
  rows: readonly T[],
  value: (row: T) => number,
  id: (row: T) => string,
  /** The value must EXCEED this to count. Zero goals is not a goalscoring title. */
  floor = 0,
): SeasonAward | null {
  let best = -Infinity;
  for (const r of rows) {
    const v = value(r);
    if (v > best) best = v;
  }
  if (!Number.isFinite(best) || best <= floor) return null;
  const winners = rows.filter((r) => value(r) === best).map(id);
  return winners.length ? { winners, value: best } : null;
}

/** Percent of all played mini-games, including draws in the denominator.
 * Attendance is checked separately in completed evenings. A displayed tie is shared.
 */
export function computeTopWinner(
  players: readonly Pick<SeasonPlayerLine, 'uid' | 'games' | 'rounds' | 'wins'>[],
  completedRounds: number,
): SeasonAward | null {
  if (!Number.isFinite(completedRounds) || completedRounds <= 0) return null;
  const eligible = players.filter(p => !!p.uid && !p.uid.startsWith('guest:') &&
    Number.isFinite(p.games) && isEligible(p, completedRounds) &&
    Number.isFinite(p.rounds) && p.rounds > 0 && Number.isFinite(p.wins) && p.wins > 0 && p.wins <= p.rounds);
  const award = leaders(eligible, p => Math.round((p.wins / p.rounds + Number.EPSILON) * 10000) / 100, p => p.uid, -1);
  return award ? { ...award, valueUnit: 'percent' } : null;
}

/**
 * Decide every title for a closed season.
 *
 * `completedRounds` is the season's finished-round count — the denominator for
 * the MVP and win-percentage gates. The caller supplies the full season count, never maximum attendance.
 */
export function computeSeasonAwards(
  players: readonly SeasonPlayerLine[],
  pairs: readonly SeasonPairLine[],
  completedRounds: number,
): SeasonAwards {
  // A season with no finished evenings awards nothing.
  //
  // Not a formality. `eligibilityThreshold(0)` is 0, so every gate opens: a
  // club whose evenings were never sealed — one that played only unfinished
  // games, or one closed the week it was created — would crown nine champions
  // on a single goal, permanently, and the archive would carry it forever.
  // "Not awarded" is already a result everywhere else here; it is the right
  // result here too.
  if (completedRounds <= 0) {
    return SEASON_TITLE_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: null }),
      {} as SeasonAwards,
    );
  }
  // Rate and rating titles require half the season; counts use the full roster.
  const realPlayers = players.filter(p => !!p.uid && !p.uid.startsWith('guest:'));
  const eligibleForMvp = realPlayers.filter((p) => isEligible(p, completedRounds) &&
    (p.ratedRounds == null || p.ratedRounds > 0) && Number.isFinite(p.mvpAvg) && p.mvpAvg >= 6);

  return {
    topScorer: leaders(realPlayers, (p) => p.goals, (p) => p.uid),
    topAssister: leaders(realPlayers, (p) => p.assists, (p) => p.uid),
    mvp: leaders(eligibleForMvp, (p) => Math.round((p.mvpAvg + Number.EPSILON) * 100) / 100, (p) => p.uid),
    topWinner: computeTopWinner(realPlayers, completedRounds),
    // Loyalty is turning up, so it counts EVENINGS. On mini-games it would
    // reward whoever happened to play in the longest rotations instead.
    mostLoyal: leaders(realPlayers, (p) => p.games, (p) => p.uid),
    cleanSheetKing: leaders(realPlayers, (p) => p.cleanSheets, (p) => p.uid),
    // COUNTS, not rates, and no minimum-attempts gate on either.
    //
    // The rate form crowned a player who took one kick and scored it at 100%
    // over a player who took eleven and scored nine, which is why the old code
    // needed `minPenaltyAttempts` to be defensible at all. A count needs no
    // such prop: most scored is most scored. The gate is gone with the rate it
    // existed to protect.
    penaltyKing: leaders(realPlayers, (p) => p.penScored, (p) => p.uid),
    penaltyKeeper: leaders(realPlayers, (p) => p.penSaved, (p) => p.uid),
    deadlyDuo: leaders(pairs.filter(p => !p.a.startsWith('guest:') && !p.b.startsWith('guest:')), (p) => p.score, (p) => `${p.a}__${p.b}`),
  };
}

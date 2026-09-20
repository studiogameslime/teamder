// Who wins what when a season closes.
//
// This is the file the arguments will be about, so every rule in it comes
// from the spec rather than from taste, and every one is tested.
//
// Three ideas carry the whole thing:
//
//   1. ELIGIBILITY IS A GATE, NOT A RANKING. A player must have turned up for
//      at least half the season's finished rounds. Below that they are not
//      compared at all — they cannot win a title on two lucky evenings, and
//      they are not "beaten" either.
//
//   2. "NOT AWARDED" IS A RESULT. If nobody is eligible, or the leader's
//      number is zero, or no keeper faced enough penalties, the title simply
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
}

export type SeasonAwards = Record<SeasonTitleKey, SeasonAward | null>;

export const SEASON_TITLE_KEYS: readonly SeasonTitleKey[] = [
  'topScorer',
  'topAssister',
  'mvp',
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
 * ⚠️ This gate belongs to the MVP title and to nothing else. It used to be
 * applied to all nine, which meant a player who turned up to a third of the
 * season could not win מלך השערים however many he scored — and the product
 * decision (20.09.2026) is that only the MVP has an attendance condition:
 * every other title goes to whoever leads it, however few evenings he played.
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

/**
 * Assists a pair must have exchanged before "deadly duo" means anything.
 *
 * Mirrors CHEMISTRY_MIN.deadlyDuo in src/utils/clubChemistry.ts — the club's
 * chemistry card shows a הצמד הקטלני under that name all year, and a season
 * title that crowned a different pair would simply look wrong.
 */
const MIN_DUO_ASSISTS = 3;

/** The bottom of the evening-score scale. A season in which nobody rose above
 *  it has no player of the season — see the note at the `mvp` call. */
const MVP_SCALE_FLOOR = 6;

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
  // Compared on the exact value; only the DISPLAY is ever rounded, so two
  // averages of 8.3746 and 8.3751 are two different numbers here.
  const winners = rows.filter((r) => value(r) === best).map(id);
  return winners.length ? { winners, value: best } : null;
}

/**
 * Decide every title for a closed season.
 *
 * `completedRounds` is the season's finished-round count — the denominator for
 * both gates. It comes from the sealed-evening counter, never from a query
 * over games: deleting a game does not decrement anything, so a live count
 * drifts below the rounds that were actually credited.
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
  // ⚠️ The attendance gate applies to ONE title. Everything else is decided
  // over the whole roster — `players`, not `eligible`.
  //
  // Eight of the nine titles used to be filtered through this list as well,
  // and the effect was the opposite of a fairness rule: a player who came to
  // four evenings of a fourteen-evening season and scored more than anybody
  // simply did not appear in the reckoning for מלך השערים. The product rule
  // (20.09.2026) is that leading a count wins the count. Turning up is the
  // condition for שחקן העונה alone, because that title is an AVERAGE and an
  // average over one good night is not a season.
  const eligibleForMvp = players.filter((p) => isEligible(p, completedRounds));

  return {
    topScorer: leaders(players, (p) => p.goals, (p) => p.uid),
    topAssister: leaders(players, (p) => p.assists, (p) => p.uid),
    // Average, not sum: the spec's call. The half-season gate is what stops
    // it rewarding someone who only shows up on the easy nights.
    //
    // Floored at the SCALE's own bottom, not at zero.
    //
    // The evening score is clamped to [6, 10], and 6.0 is also what it returns
    // for a player who took the field for no mini-games — which is every
    // player of every club that runs the plain timer, because mini-games only
    // exist in advanced mode. With a floor of 0 the sentinel cleared it, so
    // the title that is supposed to name the season was awarded to the entire
    // eligible roster at the value that means "nothing was recorded".
    //
    // On the one club that has ever closed a season, all seven members hold
    // שחקן העונה at exactly 6.0, and seven title documents sit on seven
    // profiles. Nobody beat anybody.
    mvp: leaders(eligibleForMvp, (p) => p.mvpAvg, (p) => p.uid, MVP_SCALE_FLOOR),
    topWinner: leaders(players, (p) => p.wins, (p) => p.uid),
    // Loyalty is turning up, so it counts EVENINGS. On mini-games it would
    // reward whoever happened to play in the longest rotations instead.
    mostLoyal: leaders(players, (p) => p.games, (p) => p.uid),
    cleanSheetKing: leaders(players, (p) => p.cleanSheets, (p) => p.uid),
    // COUNTS, not rates, and no minimum-attempts gate on either.
    //
    // The rate form crowned a player who took one kick and scored it at 100%
    // over a player who took eleven and scored nine, which is why the old code
    // needed `minPenaltyAttempts` to be defensible at all. A count needs no
    // such prop: most scored is most scored. The gate is gone with the rate it
    // existed to protect.
    penaltyKing: leaders(players, (p) => p.penScored, (p) => p.uid),
    penaltyKeeper: leaders(players, (p) => p.penSaved, (p) => p.uid),
    // A floor, like every other title has. With the default of 0 a single
    // assist between two regulars took the crown, which is not a partnership —
    // and the club's chemistry card uses the same threshold for the same name.
    // The floor STAYS (a product decision, 20.09.2026): the club's chemistry
    // card carries a הצמד הקטלני under the same name and the same threshold
    // all year, and a season title naming a different pair would read as a
    // mistake. But the attendance gate is gone here too — a pair that played
    // six evenings between them and combined for more goals than anybody wins
    // it, which is what the title says it measures.
    deadlyDuo: leaders(
      pairs,
      (p) => p.score,
      (p) => `${p.a}__${p.b}`,
      MIN_DUO_ASSISTS - 1,
    ),
  };
}

// One player's season, told back to them.
//
// Everything here is SEASON-scoped, and that is the whole point. The club's
// live stat rows ARE the season: closing one archives them and zeroes them
// (see functions/src/seasonRollover.ts), so "this season" is simply what those
// documents hold right now, and a closed season is its frozen archive. No new
// counter had to be collected for any of this.
//
// The people-facts — who I played beside most, who I faced most, who I beat
// most — come out of `communityPairStats`, which the round rollup has been
// filling all along: `sameTeam`, `against`, `winsA`/`winsB` and the two
// directional assist counters. That collection is zeroed by the same rollover,
// so it is season-scoped for free.
//
// The one thing worth being careful about is DIRECTION. A pair document is
// stored once, under a sorted key, with the two players as `a` and `b`. Which
// of them I am decides whether `winsA` means my wins or theirs, and reading it
// the wrong way round turns my best victim into my tormentor. Every read here
// goes through `orient()`.

/** A player's club row — `communityPlayerStats`, or one entry of a season archive. */
export interface SeasonPlayerRow {
  userId: string;
  displayName?: string;
  goals?: number;
  assists?: number;
  rounds?: number;
  wins?: number;
  losses?: number;
  ties?: number;
  games?: number;
  cleanSheets?: number;
  ownGoals?: number;
  penTaken?: number;
  penScored?: number;
  penSaved?: number;
  penFaced?: number;
  /** Coverage denominators — how many rounds the counter above could be measured over. */
  csRounds?: number;
  asRounds?: number;
}

/** A pair document — `communityPairStats`. Stored once per unordered pair. */
export interface SeasonPairRow {
  a: string;
  b: string;
  sameTeam?: number;
  against?: number;
  winsTogether?: number;
  lossesTogether?: number;
  cleanSheetsTogether?: number;
  /** Head to head: times a's side beat b's side, and the reverse. */
  winsA?: number;
  winsB?: number;
  assistsAToB?: number;
  assistsBToA?: number;
}

/** Another player, and why they earned their place in the summary. */
export interface SeasonPeer {
  userId: string;
  /** The number that won them the spot — mini-games together, or faced, or beaten. */
  count: number;
  /**
   * Head to head, from MY side: mini-games I won against them, and they
   * against me. NOT the same as `winsTogether` — one is us on opposite sides,
   * the other is us on the same side, and mixing them up produces a sentence
   * that is true about the wrong relationship.
   */
  myWins: number;
  theirWins: number;
  /** Same side: mini-games we won together, and clean sheets we kept together. */
  winsTogether: number;
  cleanSheetsTogether: number;
}

export interface PersonalSeasonRank {
  /** 1-based position in the club, or null when the player has no rounds. */
  goals: number | null;
  assists: number | null;
  wins: number | null;
  /** How many players the position is out of — those who actually played. */
  of: number;
}

export interface PersonalSeason {
  /** False when the player has not played a single mini-game this season. */
  hasData: boolean;
  goals: number;
  assists: number;
  /** Goals + assists — the number people actually quote at each other. */
  contributions: number;
  rounds: number;
  /**
   * EVENINGS I turned up to. Not the same as `rounds` (mini-games), and worth
   * its own tile: it is the number every season title is judged on — the gate
   * is half the season's evenings — so a player looking at why they did or did
   * not win one should be able to see it.
   */
  evenings: number;
  wins: number;
  losses: number;
  ties: number;
  /** Null rather than 0 when nothing was played — an unknown rate is not a zero one. */
  winPct: number | null;
  cleanSheets: number;
  cleanSheetPct: number | null;
  ownGoals: number;
  penTaken: number;
  penScored: number;
  penFaced: number;
  penSaved: number;
  goalsPerRound: number | null;
  assistsPerRound: number | null;
  ranks: PersonalSeasonRank;
  /** Most mini-games on my side. */
  partner: SeasonPeer | null;
  /** Most mini-games on the other side. */
  nemesis: SeasonPeer | null;
  /** I beat them more than anyone. */
  victim: SeasonPeer | null;
  /** They beat me more than anyone. */
  tormentor: SeasonPeer | null;
  /** I set up their goals more than anyone's. */
  assistedMost: SeasonPeer | null;
  /** They set up mine more than anyone's. */
  assistedBy: SeasonPeer | null;
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Guests are per-game identities with no cross-game existence — a "best
 *  teammate" who is a different person each week is not a fact about anyone. */
const isReal = (id: string): boolean => !!id && !id.startsWith('guest:');

/** A rate whose denominator is zero is unknown, not zero. */
function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface Oriented {
  other: string;
  sameTeam: number;
  against: number;
  myWins: number;
  theirWins: number;
  winsTogether: number;
  lossesTogether: number;
  cleanSheetsTogether: number;
  iAssistedThem: number;
  theyAssistedMe: number;
}

/**
 * Read a pair row from ONE player's side.
 *
 * `a`/`b` come from a sorted key, so which slot I occupy is an accident of my
 * user id. Everything asymmetric — the head-to-head wins, the two assist
 * directions — has to be flipped when I am `b`, and forgetting is not a
 * visible bug: the summary still renders, it just names the wrong person as
 * the one I beat all season.
 */
function orient(row: SeasonPairRow, me: string): Oriented | null {
  const meIsA = row.a === me;
  const meIsB = row.b === me;
  if (!meIsA && !meIsB) return null;
  const other = meIsA ? row.b : row.a;
  // A row pairing someone with themselves is malformed; it would otherwise
  // make every player their own best teammate.
  if (!isReal(other) || other === me) return null;
  return {
    other,
    sameTeam: num(row.sameTeam),
    against: num(row.against),
    myWins: meIsA ? num(row.winsA) : num(row.winsB),
    theirWins: meIsA ? num(row.winsB) : num(row.winsA),
    winsTogether: num(row.winsTogether),
    lossesTogether: num(row.lossesTogether),
    cleanSheetsTogether: num(row.cleanSheetsTogether),
    iAssistedThem: meIsA ? num(row.assistsAToB) : num(row.assistsBToA),
    theyAssistedMe: meIsA ? num(row.assistsBToA) : num(row.assistsAToB),
  };
}

/**
 * Best row by `pick`, zero excluded.
 *
 * Ties break on the tiebreaker and then on user id, so the same season always
 * produces the same answer. Without that last step the winner would depend on
 * Firestore's document order, and the summary would name a different "biggest
 * rival" on a refresh — which reads as a bug even though both are true.
 */
function best(
  rows: Oriented[],
  pick: (o: Oriented) => number,
  tiebreak: (o: Oriented) => number,
): SeasonPeer | null {
  let winner: Oriented | null = null;
  let winnerCount = 0;
  for (const o of rows) {
    const count = pick(o);
    if (count <= 0) continue;
    if (
      !winner ||
      count > winnerCount ||
      (count === winnerCount &&
        (tiebreak(o) > tiebreak(winner) ||
          (tiebreak(o) === tiebreak(winner) && o.other < winner.other)))
    ) {
      winner = o;
      winnerCount = count;
    }
  }
  if (!winner) return null;
  return {
    userId: winner.other,
    count: winnerCount,
    myWins: winner.myWins,
    theirWins: winner.theirWins,
    winsTogether: winner.winsTogether,
    cleanSheetsTogether: winner.cleanSheetsTogether,
  };
}

/**
 * Where I stand in the club on one counter.
 *
 * THE TABLE'S POSITION, not a count of who is ahead.
 *
 * These two are not the same thing, and the difference was visible: the club
 * table is a positional list that breaks every tie (wins → goals → assists →
 * uid, and tapping a column re-sorts stably on it), while this used to count
 * "how many are strictly ahead, +1" and let ties SHARE a position. So a player
 * the table listed third was told they were second — reported as "המיקום שלי
 * ... לא נכון", and correctly.
 *
 * Mirrors the table's comparator exactly so the two can never disagree: the
 * chosen metric first, then the table's own tie-breakers.
 */
function rankOf(
  rows: readonly SeasonPlayerRow[],
  me: string,
  pick: (r: SeasonPlayerRow) => number,
): { rank: number | null; of: number } {
  const played = rows.filter((r) => num(r.rounds) > 0 && isReal(r.userId));
  const order = [...played].sort(
    (a, b) =>
      pick(b) - pick(a) ||
      num(b.wins) - num(a.wins) ||
      num(b.goals) - num(a.goals) ||
      num(b.assists) - num(a.assists) ||
      a.userId.localeCompare(b.userId),
  );
  const i = order.findIndex((r) => r.userId === me);
  // A player with no row at all is not ranked — they did not play.
  return { rank: i < 0 ? null : i + 1, of: order.length };
}

export interface PersonalSeasonInput {
  me: string;
  /** Every club row for the season — used for both my numbers and my rank. */
  players: readonly SeasonPlayerRow[];
  /** Pair rows. Rows not involving me are ignored, so the caller may pass all. */
  pairs: readonly SeasonPairRow[];
}

export function buildPersonalSeason({
  me,
  players,
  pairs,
}: PersonalSeasonInput): PersonalSeason {
  const mine = players.find((r) => r.userId === me);
  const rounds = num(mine?.rounds);
  const goals = num(mine?.goals);
  const assists = num(mine?.assists);
  const wins = num(mine?.wins);
  const losses = num(mine?.losses);
  const ties = num(mine?.ties);
  const cleanSheets = num(mine?.cleanSheets);

  const oriented: Oriented[] = [];
  for (const row of pairs) {
    const o = orient(row, me);
    if (o) oriented.push(o);
  }

  // Every mini-game, ties included — because that is what "% ניצחון" already
  // means everywhere else in this app.
  //
  // Decided-only (wins / (wins + losses)) is the better statistic and it was
  // the first thing written here. But the club's efficiency table has shipped
  // for months computing wins / rounds under the same Hebrew name, on a screen
  // one tap away, and two surfaces showing different numbers under one label
  // is worse than the weaker formula. Nothing is hidden by it: wins, losses
  // and ties are each their own tile right beside this one.
  const decided = rounds;
  // The clean-sheet denominator is its own counter: the metric started being
  // collected later than `rounds`, so dividing by rounds understates every
  // veteran. Same correction the club efficiency table carries.
  const csRounds = typeof mine?.csRounds === 'number' ? mine.csRounds : rounds;

  const g = rankOf(players, me, (r) => num(r.goals));
  const a = rankOf(players, me, (r) => num(r.assists));
  const w = rankOf(players, me, (r) => num(r.wins));

  return {
    hasData: rounds > 0,
    goals,
    assists,
    contributions: goals + assists,
    rounds,
    evenings: num(mine?.games),
    wins,
    losses,
    ties,
    winPct: rate(wins, decided),
    cleanSheets,
    cleanSheetPct: rate(cleanSheets, csRounds),
    ownGoals: num(mine?.ownGoals),
    penTaken: num(mine?.penTaken),
    penScored: num(mine?.penScored),
    penFaced: num(mine?.penFaced),
    penSaved: num(mine?.penSaved),
    goalsPerRound: rate(goals, rounds),
    assistsPerRound: rate(assists, rounds),
    ranks: { goals: g.rank, assists: a.rank, wins: w.rank, of: g.of },
    // The teammate I shared a side with most. Tie broken on how often we WON
    // together — of two people I played 10 mini-games beside, the one I kept
    // winning with is the better story and the more useful fact.
    partner: best(oriented, (o) => o.sameTeam, (o) => o.winsTogether),
    // The opponent I faced most, tie broken towards the one who beat me more:
    // "biggest rival" should lean to the harder rivalry, not the friendlier.
    nemesis: best(oriented, (o) => o.against, (o) => o.theirWins),
    victim: best(oriented, (o) => o.myWins, (o) => o.against),
    tormentor: best(oriented, (o) => o.theirWins, (o) => o.against),
    assistedMost: best(oriented, (o) => o.iAssistedThem, (o) => o.sameTeam),
    assistedBy: best(oriented, (o) => o.theyAssistedMe, (o) => o.sameTeam),
  };
}

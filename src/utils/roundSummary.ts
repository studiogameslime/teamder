// Round summary core — the club's story of one evening.
//
// Pure and import-free ON PURPOSE: it runs on the phone (tests, preview) and
// inside the Cloud Function that seals the summary, and the two must produce
// byte-identical output. Same convention as teamBalanceCore — one source, a
// generated backend twin, and a parity test that fails on drift.
//
// Everything here is a decision about what is TRUE, never about wording. The
// output is structured data; the screen decides how to phrase it. That split is
// deliberate: a record is a fact with a previous value, and only the UI layer
// should be choosing between "שבר" and "השווה".
//
// WHAT THIS DELIBERATELY WILL NOT DO
//   • Invent a tie-break. Every leader field is an array.
//   • Claim an all-time record. The club existed before the app, assists and
//     clean sheets started being collected later, and some evenings have no
//     per-mini-game history at all — so records are scoped to a basis window
//     the caller states, and suppressed entirely when that window is too thin.
//   • Recompute itself later. The caller seals the output once; a goal added
//     by an admin next week must not rewrite last week's story.

// ─── The shape of an evening ──────────────────────────────────────────────

/** One player's line for THIS evening (from gamePlayerStats). */
export interface PlayerEvening {
  userId: string;
  isGuest?: boolean;
  goals: number;
  assists: number;
  wins: number;
  cleanSheets: number;
  /** mini-games the player took the field for. */
  rounds: number;
}

/** One goal inside a mini-game (from roundHistory.goals[]). */
export interface RoundGoal {
  scorerId: string | null;
  assisterId: string | null;
  ownGoal: boolean;
  team: 'A' | 'B';
}

/** One mini-game (from roundHistory). */
export interface RoundRec {
  /** Bib-colour index of each side; -1 when unknown (pre-colour games). */
  teamAIndex: number;
  teamBIndex: number;
  winnerSide: 'A' | 'B' | 'tie';
  goals: RoundGoal[];
  /** True when the mini-game was decided by a shootout. */
  shootout: boolean;
}

/** A player's cumulative career IN THIS CLUB, AFTER tonight
 *  (from communityPlayerStats). */
export interface PlayerCareer {
  userId: string;
  goals: number;
  assists: number;
  /** mini-games played, lifetime. */
  rounds: number;
  wins: number;
  cleanSheets: number;
  /** evenings attended, lifetime. */
  games: number;
}

/** Club-wide cumulative counters AFTER tonight (from communityStats + derived). */
export interface ClubTotals {
  goals: number;
  assists: number;
  /** mini-games, lifetime. */
  rounds: number;
  cleanSheets: number;
  shootoutRounds: number;
  /** evenings played, lifetime. */
  evenings: number;
}

/** The best single evening any club member has produced, BEFORE tonight. */
export interface RecordHolder {
  value: number;
  userIds: string[];
}

export interface ClubRecordBaseline {
  goals?: RecordHolder;
  assists?: RecordHolder;
  involvement?: RecordHolder;
  cleanSheets?: RecordHolder;
  wins?: RecordHolder;
  /** first-ever codes already announced, so each fires exactly once ever. */
  firstEverSeen?: string[];
}

/** One player's best single evening BEFORE tonight. Absent = no baseline, and
 *  a personal record is NOT claimed (a first-ever evening is not a record). */
export interface PersonalBest {
  goals?: number;
  assists?: number;
  involvement?: number;
  cleanSheets?: number;
  wins?: number;
}

/** Tonight's club-table position for one player (from eveningStandings). */
export interface StandingRec {
  userId: string;
  score: number;
  rank: number | null;
  rankTotal: number | null;
  /** + = climbed N places tonight. */
  rankDelta: number | null;
}

/**
 * How far back the comparison can honestly reach.
 *
 * `eveningsCompared` is the number of PAST evenings that carry the data being
 * compared. Below MIN_RECORD_BASIS the whole records section is dropped — a
 * "club record" drawn from two evenings is not a record, it is a coincidence.
 */
export interface HistoryBasis {
  /** ms-epoch of the earliest evening in the comparison window; null = unknown. */
  since: number | null;
  eveningsCompared: number;
}

export interface RoundSummaryInput {
  gameId: string;
  groupId: string;
  at: number;
  players: PlayerEvening[];
  rounds: RoundRec[];
  career: PlayerCareer[];
  club: ClubTotals;
  records: ClubRecordBaseline | null;
  personalBests: Record<string, PersonalBest>;
  standings: StandingRec[];
  basis: HistoryBasis;
  /** Injected so a sealed summary is reproducible in tests. */
  now: number;
}

// ─── The shape of a summary ───────────────────────────────────────────────

export type RecordMetric =
  | 'goals'
  | 'assists'
  | 'involvement'
  | 'cleanSheets'
  | 'wins';

export type MilestoneMetric =
  | 'goals'
  | 'assists'
  | 'rounds'
  | 'evenings'
  | 'wins'
  | 'cleanSheets'
  | 'shootouts';

export type FirstEverCode =
  | 'two_players_4_goals'
  | 'player_3_goals_3_assists'
  | 'all_teams_level'
  | 'three_shootouts'
  | 'multiple_personal_records'
  | 'every_team_won';

export type SummaryEvent =
  | { type: 'club_record'; metric: RecordMetric; userIds: string[]; value: number; previousValue: number; tied: boolean }
  | { type: 'personal_record'; metric: RecordMetric; userIds: string[]; value: number; previousValue: number; tied: boolean }
  | { type: 'club_milestone'; metric: MilestoneMetric; threshold: number; total: number }
  | { type: 'player_milestone'; metric: MilestoneMetric; userIds: string[]; threshold: number; total: number }
  | { type: 'rank_first_place'; userIds: string[] }
  | { type: 'rank_jump'; userIds: string[]; from: number; to: number }
  | { type: 'rank_top_entry'; userIds: string[]; rank: number; tier: number }
  | { type: 'rank_tight_top'; entries: { userId: string; score: number }[] }
  | { type: 'first_ever'; code: FirstEverCode; value?: number };

/** A leaderboard line. `userIds` is always an array — ties are the norm. */
export interface Leader {
  userIds: string[];
  value: number;
}

export interface TeamLine {
  colourIndex: number;
  wins: number;
  losses: number;
  played: number;
}

export interface PairHighlight {
  /** The two players, sorted, so the pair has one identity regardless of direction. */
  userIds: [string, string];
  /** Goals created between them, both directions summed. */
  goals: number;
  /** Per-direction breakdown: assister → scorer. */
  breakdown: { assisterId: string; scorerId: string; goals: number }[];
}

export interface RoundSummary {
  version: number;
  generatedAt: number;
  gameId: string;
  groupId: string;
  at: number;
  stats: {
    rounds: number;
    goals: number;
    assists: number;
    shootouts: number;
    /** Mini-games that ended level. 0 in a three-team club, where the loser
     *  rotates out and every mini-game has a winner — the summary hides the
     *  figure at 0 rather than printing it. */
    ties: number;
  };
  leaders: {
    topScorers: Leader | null;
    topAssisters: Leader | null;
    topCleanSheets: Leader | null;
    topGoalInvolvement: Leader | null;
    topWinners: Leader | null;
  };
  teamHighlights: { best: TeamLine[]; worst: TeamLine[] };
  pairHighlight: PairHighlight | null;
  events: SummaryEvent[];
  basis: HistoryBasis;
  /** What in this summary can be trusted, so the screen never implies more. */
  coverage: { hasRoundHistory: boolean; hasAssists: boolean };
  /**
   * Produced by replaying an evening that finished before this feature existed.
   *
   * Worth carrying because such an evening is not merely older — parts of it
   * were never recorded. The screen says so rather than presenting a
   * reconstruction as if it had been watched live.
   */
  backfilled?: boolean;
}

// ─── Tuning ───────────────────────────────────────────────────────────────

export const SUMMARY_VERSION = 1;

/** Below this many comparable past evenings, no record is claimed. */
export const MIN_RECORD_BASIS = 5;

/** A club table smaller than this makes every movement meaningless. */
export const MIN_TABLE_SIZE = 6;

/** Places climbed to count as "the jump of the evening" — or 15% of the table,
 *  whichever is larger, so a 40-player club needs a real climb. */
export const MIN_RANK_JUMP = 3;

/** Score gap at the top that reads as a genuine race. */
export const TIGHT_TOP_GAP = 2;

/** How many of the top places a tight race may span. */
export const TIGHT_TOP_SIZE = 3;

/** Dynamic events shown. The fixed sections (numbers, stars, teams) are not
 *  part of this budget. */
export const MAX_EVENTS = 6;
export const MAX_EVENTS_PER_TYPE = 2;
export const MAX_EVENTS_PER_PLAYER = 2;

/** Personal milestones. Thresholds are the club's own scale, not football's. */
export const PLAYER_MILESTONES: Record<string, number[]> = {
  goals: [10, 25, 50, 100, 250, 500],
  assists: [10, 25, 50, 100, 250],
  rounds: [50, 100, 250, 500, 1000],
  evenings: [10, 25, 50, 100, 250],
  wins: [50, 100, 250, 500],
  cleanSheets: [10, 25, 50, 100, 250],
};

/**
 * Club milestones.
 *
 * The lower tiers are the point. Measured against production, the biggest club
 * in the app sits at 136 goals and 81 mini-games after four months — so a
 * ladder that starts at "the 1,000th goal" would never fire for anyone, and the
 * section would be dead code dressed as a feature.
 */
export const CLUB_MILESTONES: Record<string, number[]> = {
  goals: [100, 250, 500, 1000, 2500],
  assists: [100, 250, 500, 1000],
  rounds: [100, 250, 500, 1000],
  evenings: [10, 25, 50, 100, 250],
  cleanSheets: [100, 250, 500, 1000],
  shootouts: [10, 25, 50, 100],
};

/** §10's order, as numbers. Higher wins a contested slot. */
const PRIORITY: Record<SummaryEvent['type'], number> = {
  club_record: 100,
  club_milestone: 90,
  rank_first_place: 80,
  personal_record: 70,
  player_milestone: 60,
  first_ever: 50,
  rank_jump: 40,
  rank_top_entry: 35,
  rank_tight_top: 30,
};

// ─── Small helpers ────────────────────────────────────────────────────────

const n = (v: number | undefined | null): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Everyone tied at the maximum. Returns null when the max is 0 — an evening
 *  with no assists does not crown a king of assists. */
function leaderOf(
  players: PlayerEvening[],
  value: (p: PlayerEvening) => number,
): Leader | null {
  let best = 0;
  for (const p of players) best = Math.max(best, n(value(p)));
  if (best <= 0) return null;
  const userIds = players
    .filter((p) => n(value(p)) === best)
    .map((p) => p.userId)
    .sort();
  return { userIds, value: best };
}

const involvementOf = (p: PlayerEvening): number => n(p.goals) + n(p.assists);

/** Thresholds crossed by going from `before` to `after`. */
function crossed(before: number, after: number, steps: number[]): number[] {
  return steps.filter((t) => before < t && after >= t);
}

// ─── The four numbers ─────────────────────────────────────────────────────

/**
 * Goals and assists come from the PLAYER rows, not from the mini-game history.
 *
 * Both sources exist and they normally agree — verified on a real evening: 20
 * goals and 17 assists from either. They stop agreeing the moment an admin
 * completes a goal that was missed on the night, because `addRetroGoal` updates
 * the player rows and never touches the mini-game history. The player rows are
 * the ones a correction reaches, so they are the ones that count.
 *
 * Mini-games are counted from the HISTORY, one document each. Summing the
 * players' `rounds` would multiply every mini-game by the ten people who played
 * it.
 */
function statsOf(input: RoundSummaryInput): RoundSummary['stats'] {
  let goals = 0;
  let assists = 0;
  for (const p of input.players) {
    goals += n(p.goals);
    assists += n(p.assists);
  }
  // Own goals are on the scoreboard but on nobody's tally, so they are added
  // from the history — the only place they are recorded as goals at all.
  for (const r of input.rounds) {
    for (const g of r.goals) if (g.ownGoal) goals += 1;
  }
  return {
    rounds: input.rounds.length,
    goals,
    assists,
    shootouts: input.rounds.filter((r) => r.shootout).length,
    ties: input.rounds.filter((r) => r.winnerSide === 'tie').length,
  };
}

// ─── Teams ────────────────────────────────────────────────────────────────

/**
 * Wins and losses per BIB COLOUR, not per group of people.
 *
 * The colour is the only stable identity a team has across an evening: rosters
 * change constantly — a short side borrows a player, someone goes home, the
 * fill engine moves people between rounds. "The blue team won 6" is true.
 * "Those five players won 6 together" is not, and the data cannot support it.
 * A mini-game whose colours were not recorded (index < 0) is skipped rather
 * than lumped into a fake team.
 */
function teamsOf(rounds: RoundRec[]): RoundSummary['teamHighlights'] {
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  const played = new Map<number, number>();
  const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const r of rounds) {
    const a = r.teamAIndex;
    const b = r.teamBIndex;
    // `< 0` alone let a MISSING index through: `undefined < 0` is false, so a
    // round whose colours were never recorded was counted under the key
    // `undefined` — every such round piling onto one phantom team that had
    // played twice as many games as existed. Require an actual number.
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (a < 0 || b < 0) continue;
    bump(played, a);
    bump(played, b);
    if (r.winnerSide === 'A') {
      bump(wins, a);
      bump(losses, b);
    } else if (r.winnerSide === 'B') {
      bump(wins, b);
      bump(losses, a);
    }
    // A tie counts as neither, for both sides.
  }

  const lines: TeamLine[] = Array.from(played.keys())
    .sort((x, y) => x - y)
    .map((colourIndex) => ({
      colourIndex,
      wins: wins.get(colourIndex) ?? 0,
      losses: losses.get(colourIndex) ?? 0,
      played: played.get(colourIndex) ?? 0,
    }));

  if (lines.length === 0) return { best: [], worst: [] };
  const maxW = Math.max(...lines.map((l) => l.wins));
  const maxL = Math.max(...lines.map((l) => l.losses));
  return {
    best: maxW > 0 ? lines.filter((l) => l.wins === maxW) : [],
    worst: maxL > 0 ? lines.filter((l) => l.losses === maxL) : [],
  };
}

// ─── The pair of the evening ──────────────────────────────────────────────

/**
 * The strongest DIRECT attacking link: assists actually played from one named
 * player to another, summed across both directions.
 *
 * Not "who won together" — two players on a winning side share a result, not a
 * connection, and calling that chemistry would be reading a pattern into noise.
 * Own goals have no scorer and are excluded. Guests are eligible: they were on
 * the pitch and the pass was real.
 */
function pairOf(rounds: RoundRec[]): PairHighlight | null {
  const direct = new Map<string, number>(); // "assister>scorer" → goals
  for (const r of rounds) {
    for (const g of r.goals) {
      if (g.ownGoal) continue;
      if (!g.assisterId || !g.scorerId) continue;
      if (g.assisterId === g.scorerId) continue;
      const k = `${g.assisterId}>${g.scorerId}`;
      direct.set(k, (direct.get(k) ?? 0) + 1);
    }
  }
  if (direct.size === 0) return null;

  const byPair = new Map<string, number>();
  for (const [k, v] of direct) {
    const [a, s] = k.split('>');
    const key = [a, s].sort().join('|');
    byPair.set(key, (byPair.get(key) ?? 0) + v);
  }
  let bestKey = '';
  let bestVal = 0;
  for (const [k, v] of Array.from(byPair.entries()).sort((x, y) =>
    x[0].localeCompare(y[0]),
  )) {
    if (v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  // One goal between two players is a pass, not a partnership.
  if (bestVal < 2) return null;

  const [u1, u2] = bestKey.split('|');
  const breakdown = [
    { assisterId: u1, scorerId: u2, goals: direct.get(`${u1}>${u2}`) ?? 0 },
    { assisterId: u2, scorerId: u1, goals: direct.get(`${u2}>${u1}`) ?? 0 },
  ].filter((b) => b.goals > 0);
  return { userIds: [u1, u2], goals: bestVal, breakdown };
}

// ─── Records ──────────────────────────────────────────────────────────────

const RECORD_METRICS: RecordMetric[] = [
  'goals',
  'assists',
  'involvement',
  'cleanSheets',
  'wins',
];

function metricValue(p: PlayerEvening, m: RecordMetric): number {
  if (m === 'involvement') return involvementOf(p);
  return n(p[m]);
}

/**
 * Club and personal records for tonight.
 *
 * The `tied` flag is the whole point of returning structured data: equalling a
 * record and beating it are different events, and only the caller knows the
 * previous value well enough to say which happened. A record is claimed only
 * when there is a real baseline — no baseline means this is the first measured
 * evening, and being the best of one is not an achievement.
 */
function recordsOf(input: RoundSummaryInput): SummaryEvent[] {
  if (input.basis.eveningsCompared < MIN_RECORD_BASIS) return [];
  const out: SummaryEvent[] = [];
  const eligible = input.players.filter((p) => !p.isGuest);

  for (const metric of RECORD_METRICS) {
    const best = leaderOf(eligible, (p) => metricValue(p, metric));
    if (!best) continue;

    // ── club ──
    const baseline = input.records ? input.records[metric] : undefined;
    if (baseline && n(baseline.value) > 0) {
      if (best.value > baseline.value) {
        out.push({ type: 'club_record', metric, userIds: best.userIds, value: best.value, previousValue: baseline.value, tied: false });
      } else if (best.value === baseline.value) {
        // Someone who already held it has not equalled anything.
        const fresh = best.userIds.filter((u) => !(baseline.userIds ?? []).includes(u));
        if (fresh.length > 0) {
          out.push({ type: 'club_record', metric, userIds: fresh, value: best.value, previousValue: baseline.value, tied: true });
        }
      }
    }

    // ── personal ──
    const broke: string[] = [];
    const equalled: string[] = [];
    let prevOfBroke = 0;
    let prevOfEqualled = 0;
    for (const p of eligible) {
      const v = metricValue(p, metric);
      if (v <= 0) continue;
      const pb = input.personalBests[p.userId];
      const prev = pb ? pb[metric] : undefined;
      if (typeof prev !== 'number') continue; // no baseline → not a record
      if (v > prev) {
        broke.push(p.userId);
        prevOfBroke = Math.max(prevOfBroke, prev);
      } else if (v === prev && prev > 0) {
        equalled.push(p.userId);
        prevOfEqualled = Math.max(prevOfEqualled, prev);
      }
    }
    // Only the strongest personal story per metric — one line, not a roll-call.
    if (broke.length > 0) {
      const top = leaderOf(
        eligible.filter((p) => broke.includes(p.userId)),
        (p) => metricValue(p, metric),
      );
      if (top) {
        out.push({ type: 'personal_record', metric, userIds: top.userIds, value: top.value, previousValue: prevOfBroke, tied: false });
      }
    } else if (equalled.length > 0) {
      const top = leaderOf(
        eligible.filter((p) => equalled.includes(p.userId)),
        (p) => metricValue(p, metric),
      );
      if (top) {
        out.push({ type: 'personal_record', metric, userIds: top.userIds, value: top.value, previousValue: prevOfEqualled, tied: true });
      }
    }
  }
  return out;
}

/** How many DISTINCT players set a new personal best tonight — the input to the
 *  "several records in one evening" first-ever. */
function personalRecordBreakers(input: RoundSummaryInput): number {
  const who = new Set<string>();
  for (const p of input.players) {
    if (p.isGuest) continue;
    const pb = input.personalBests[p.userId];
    if (!pb) continue;
    for (const m of RECORD_METRICS) {
      const prev = pb[m];
      if (typeof prev !== 'number') continue;
      if (metricValue(p, m) > prev) {
        who.add(p.userId);
        break;
      }
    }
  }
  return who.size;
}

// ─── Milestones ───────────────────────────────────────────────────────────

/**
 * Crossing a cumulative total tonight.
 *
 * Derived by subtracting tonight's contribution from the career total rather
 * than by reading a "before" snapshot: the career row is written by the same
 * transaction that credits the evening, so by the time anything can read it the
 * before-value no longer exists anywhere.
 */
function playerMilestonesOf(input: RoundSummaryInput): SummaryEvent[] {
  const tonight = new Map<string, PlayerEvening>();
  for (const p of input.players) tonight.set(p.userId, p);
  const out: SummaryEvent[] = [];
  // Grouped so five players reaching 10 goals is one line, not five.
  const hits = new Map<string, { metric: MilestoneMetric; threshold: number; total: number; userIds: string[] }>();

  for (const c of input.career) {
    const t = tonight.get(c.userId);
    if (!t || t.isGuest) continue;
    const pairs: [MilestoneMetric, number, number][] = [
      ['goals', n(c.goals), n(t.goals)],
      ['assists', n(c.assists), n(t.assists)],
      ['rounds', n(c.rounds), n(t.rounds)],
      ['wins', n(c.wins), n(t.wins)],
      ['cleanSheets', n(c.cleanSheets), n(t.cleanSheets)],
      // One evening attended, so the career count moves by exactly one.
      ['evenings', n(c.games), 1],
    ];
    for (const [metric, after, delta] of pairs) {
      if (delta <= 0) continue;
      const steps = PLAYER_MILESTONES[metric];
      if (!steps) continue;
      for (const threshold of crossed(after - delta, after, steps)) {
        const key = `${metric}:${threshold}`;
        const cur = hits.get(key);
        if (cur) cur.userIds.push(c.userId);
        else hits.set(key, { metric, threshold, total: after, userIds: [c.userId] });
      }
    }
  }
  for (const h of Array.from(hits.values()).sort((a, b) => b.threshold - a.threshold)) {
    out.push({ type: 'player_milestone', metric: h.metric, userIds: h.userIds.slice().sort(), threshold: h.threshold, total: h.total });
  }
  return out;
}

function clubMilestonesOf(input: RoundSummaryInput): SummaryEvent[] {
  const s = statsOf(input);
  const tonightCleanSheets = input.players.reduce((a, p) => a + n(p.cleanSheets), 0);
  const pairs: [MilestoneMetric, number, number][] = [
    ['goals', n(input.club.goals), s.goals],
    ['assists', n(input.club.assists), s.assists],
    ['rounds', n(input.club.rounds), s.rounds],
    ['cleanSheets', n(input.club.cleanSheets), tonightCleanSheets],
    ['shootouts', n(input.club.shootoutRounds), s.shootouts],
    ['evenings', n(input.club.evenings), 1],
  ];
  const out: SummaryEvent[] = [];
  for (const [metric, after, delta] of pairs) {
    if (delta <= 0) continue;
    const steps = CLUB_MILESTONES[metric];
    if (!steps) continue;
    for (const threshold of crossed(after - delta, after, steps)) {
      out.push({ type: 'club_milestone', metric, threshold, total: after });
    }
  }
  return out.sort((a, b) => (b as { threshold: number }).threshold - (a as { threshold: number }).threshold);
}

// ─── Table movement ───────────────────────────────────────────────────────

/**
 * Only movement worth telling someone about.
 *
 * Deliberately no "biggest drop": a table position is public, and singling
 * somebody out for falling turns a summary people look forward to into one they
 * brace for. A change at the top is reported as a change at the top — who
 * arrived, never who was displaced.
 */
function rankEventsOf(input: RoundSummaryInput): SummaryEvent[] {
  const rows = input.standings.filter((s) => typeof s.rank === 'number' && s.rank > 0);
  if (rows.length === 0) return [];
  const total = Math.max(...rows.map((s) => n(s.rankTotal)));
  if (total < MIN_TABLE_SIZE) return [];
  const out: SummaryEvent[] = [];

  // New at the top — a climb INTO first place, not merely holding it.
  const firsts = rows.filter((s) => s.rank === 1 && n(s.rankDelta) > 0);
  if (firsts.length > 0) {
    out.push({ type: 'rank_first_place', userIds: firsts.map((s) => s.userId).sort() });
  }

  const jumpBar = Math.max(MIN_RANK_JUMP, Math.round(total * 0.15));
  const jumpers = rows
    .filter((s) => n(s.rankDelta) >= jumpBar)
    .sort((a, b) => n(b.rankDelta) - n(a.rankDelta));
  if (jumpers.length > 0) {
    const top = jumpers[0];
    const to = n(top.rank);
    const tied = jumpers.filter((s) => n(s.rankDelta) === n(top.rankDelta));
    out.push({ type: 'rank_jump', userIds: tied.map((s) => s.userId).sort(), from: to + n(top.rankDelta), to });
  }

  // Into the top 3 / top 5 for the first time tonight. Guarded on the delta so
  // a player who was already there does not "enter" every week.
  for (const tier of [3, 5]) {
    if (total < tier * 2) continue;
    const entered = rows.filter(
      (s) => n(s.rank) <= tier && n(s.rankDelta) > 0 && n(s.rank) + n(s.rankDelta) > tier,
    );
    if (entered.length > 0) {
      const best = Math.min(...entered.map((s) => n(s.rank)));
      out.push({
        type: 'rank_top_entry',
        userIds: entered.filter((s) => n(s.rank) === best).map((s) => s.userId).sort(),
        rank: best,
        tier,
      });
      break; // top-3 already implies top-5; say it once.
    }
  }

  // A genuine race: the leaders within a couple of points of each other.
  const top = rows.slice().sort((a, b) => n(a.rank) - n(b.rank)).slice(0, TIGHT_TOP_SIZE);
  if (top.length >= 2) {
    const spread = n(top[0].score) - n(top[top.length - 1].score);
    if (spread > 0 && spread <= TIGHT_TOP_GAP) {
      out.push({
        type: 'rank_tight_top',
        entries: top.map((s) => ({ userId: s.userId, score: n(s.score) })),
      });
    }
  }
  return out;
}

// ─── First ever ───────────────────────────────────────────────────────────

/**
 * A closed list, checked against a ledger of codes already announced.
 *
 * Closed on purpose. Anything that scans for "a combination of numbers never
 * seen before" will find one every single week — the space of combinations is
 * enormous and the history is short — and a summary that cries "first ever"
 * every week has taught its readers to ignore the words.
 */
function firstEverOf(input: RoundSummaryInput): SummaryEvent[] {
  if (input.basis.eveningsCompared < MIN_RECORD_BASIS) return [];
  const seen = new Set(input.records?.firstEverSeen ?? []);
  const s = statsOf(input);
  const real = input.players.filter((p) => !p.isGuest);
  const out: SummaryEvent[] = [];
  const add = (code: FirstEverCode, value?: number) => {
    if (!seen.has(code)) out.push({ type: 'first_ever', code, value });
  };

  if (real.filter((p) => n(p.goals) >= 4).length >= 2) add('two_players_4_goals');
  if (real.some((p) => n(p.goals) >= 3 && n(p.assists) >= 3)) add('player_3_goals_3_assists');
  if (s.shootouts >= 3) add('three_shootouts', s.shootouts);
  if (personalRecordBreakers(input) >= 3) add('multiple_personal_records', personalRecordBreakers(input));

  const teams = teamsOf(input.rounds);
  const lines = teams.best.concat(teams.worst);
  if (lines.length > 0) {
    const all = new Map<number, TeamLine>();
    for (const t of lines) all.set(t.colourIndex, t);
    // Recount from scratch — best/worst are filtered views.
    const wins = new Map<number, number>();
    for (const r of input.rounds) {
      if (r.teamAIndex < 0 || r.teamBIndex < 0) continue;
      if (r.winnerSide === 'A') wins.set(r.teamAIndex, (wins.get(r.teamAIndex) ?? 0) + 1);
      else if (r.winnerSide === 'B') wins.set(r.teamBIndex, (wins.get(r.teamBIndex) ?? 0) + 1);
      else {
        if (!wins.has(r.teamAIndex)) wins.set(r.teamAIndex, 0);
        if (!wins.has(r.teamBIndex)) wins.set(r.teamBIndex, 0);
      }
    }
    const counts = Array.from(wins.values());
    if (counts.length >= 3 && counts.every((c) => c === counts[0])) add('all_teams_level', counts[0]);
    if (counts.length >= 3 && counts.every((c) => c >= 1)) add('every_team_won');
  }
  return out;
}

// ─── Selection ────────────────────────────────────────────────────────────

function playersOf(e: SummaryEvent): string[] {
  if ('userIds' in e) return e.userIds;
  if (e.type === 'rank_tight_top') return e.entries.map((x) => x.userId);
  return [];
}

function magnitudeOf(e: SummaryEvent): number {
  switch (e.type) {
    case 'club_record':
    case 'personal_record':
      return e.value - e.previousValue;
    case 'club_milestone':
    case 'player_milestone':
      return e.threshold;
    case 'rank_jump':
      return e.from - e.to;
    default:
      return 0;
  }
}

/**
 * Drop the smaller retelling of something already said.
 *
 * A six-goal evening is simultaneously the scoring title, a personal best and a
 * club record. All three are true and printing all three is a summary that
 * repeats itself: the club record subsumes the personal one for the same player
 * and metric, and the scoring title already has its own place among the stars.
 */
function dedupe(events: SummaryEvent[]): SummaryEvent[] {
  const clubRecordKeys = new Set<string>();
  for (const e of events) {
    if (e.type === 'club_record') {
      for (const u of e.userIds) clubRecordKeys.add(`${u}:${e.metric}`);
    }
  }
  return events.filter((e) => {
    if (e.type !== 'personal_record') return true;
    return !e.userIds.every((u) => clubRecordKeys.has(`${u}:${e.metric}`));
  });
}

/** Rank by §10's order, then by how far it exceeded what came before, and cap
 *  so no single player or single kind of event fills the summary. */
export function selectEvents(
  events: SummaryEvent[],
  max = MAX_EVENTS,
): SummaryEvent[] {
  const ranked = dedupe(events)
    .slice()
    .sort((a, b) => {
      const p = PRIORITY[b.type] - PRIORITY[a.type];
      if (p !== 0) return p;
      return magnitudeOf(b) - magnitudeOf(a);
    });

  const out: SummaryEvent[] = [];
  const perType = new Map<string, number>();
  const perPlayer = new Map<string, number>();
  for (const e of ranked) {
    if (out.length >= max) break;
    const t = perType.get(e.type) ?? 0;
    if (t >= MAX_EVENTS_PER_TYPE) continue;
    const who = playersOf(e);
    if (who.some((u) => (perPlayer.get(u) ?? 0) >= MAX_EVENTS_PER_PLAYER)) continue;
    out.push(e);
    perType.set(e.type, t + 1);
    for (const u of who) perPlayer.set(u, (perPlayer.get(u) ?? 0) + 1);
  }
  return out;
}

// ─── The whole thing ──────────────────────────────────────────────────────

export function buildRoundSummary(input: RoundSummaryInput): RoundSummary {
  const stats = statsOf(input);
  const eligible = input.players.filter((p) => !p.isGuest);
  const events = selectEvents([
    ...recordsOf(input),
    ...clubMilestonesOf(input),
    ...playerMilestonesOf(input),
    ...rankEventsOf(input),
    ...firstEverOf(input),
  ]);

  return {
    version: SUMMARY_VERSION,
    generatedAt: input.now,
    gameId: input.gameId,
    groupId: input.groupId,
    at: input.at,
    stats,
    leaders: {
      // Guests are excluded from the titles: a title is a thing you hold in the
      // club, and a guest has no account to hold it in. They still count in the
      // evening's totals — they were on the pitch and the goals were real.
      topScorers: leaderOf(eligible, (p) => n(p.goals)),
      topAssisters: leaderOf(eligible, (p) => n(p.assists)),
      topCleanSheets: leaderOf(eligible, (p) => n(p.cleanSheets)),
      topGoalInvolvement: leaderOf(eligible, involvementOf),
      topWinners: leaderOf(eligible, (p) => n(p.wins)),
    },
    teamHighlights: teamsOf(input.rounds),
    pairHighlight: pairOf(input.rounds),
    events,
    basis: input.basis,
    coverage: {
      hasRoundHistory: input.rounds.length > 0,
      hasAssists: stats.assists > 0,
    },
  };
}

/** The club record baseline AFTER tonight — written only once the summary is
 *  sealed, so the comparison above can never race the value it compares to. */
export function nextRecordBaseline(
  previous: ClubRecordBaseline | null,
  summary: RoundSummary,
  players: PlayerEvening[],
): ClubRecordBaseline {
  const out: ClubRecordBaseline = { ...(previous ?? {}) };
  const eligible = players.filter((p) => !p.isGuest);
  for (const metric of RECORD_METRICS) {
    const best = leaderOf(eligible, (p) => metricValue(p, metric));
    if (!best) continue;
    const prev = out[metric];
    if (!prev || best.value > prev.value) {
      out[metric] = { value: best.value, userIds: best.userIds };
    } else if (best.value === prev.value) {
      out[metric] = {
        value: prev.value,
        userIds: Array.from(new Set([...(prev.userIds ?? []), ...best.userIds])).sort(),
      };
    }
  }
  const seen = new Set(out.firstEverSeen ?? []);
  for (const e of summary.events) if (e.type === 'first_ever') seen.add(e.code);
  out.firstEverSeen = Array.from(seen).sort();
  return out;
}

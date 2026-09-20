// The club the seasons feature actually runs on.
//
// Every fixture in this repo was built by hand from whatever the test needed,
// and every one of them describes a club that does not exist: advanced mode
// on, mini-games in every row, a season that began when the club did, and a
// stamp on every game. The one club that has ever run a season looks nothing
// like that, and that gap is where the shipped bugs lived — each of them was
// invisible to a suite whose fixtures had no unstamped evening, no timer-only
// row, and no disagreement between the counters.
//
// So this is the real shape, measured against production on 18.09.2026 and
// used as the input to the reconciliation test:
//
//   • 22 evenings that happened. NINETEEN of them carry no `seasonId` at all —
//     they were played before the feature shipped and the stamp is only
//     written when a game goes active. Three carry 's1'.
//   • One evening the sweep closed with nothing on it: 'unverified'. It counts
//     for nobody until an admin says so, and it is the difference between the
//     scan and a naive `status === 'finished'` count.
//   • One cancelled evening, which is what the organisation rate divides by.
//   • `clubRecords.eveningsSealed` is 10 — the counter only began on
//     26.08.2026, so it has seen ten of the club's twenty-two nights — while
//     `seasons.roundsAtStart` is 7 and the card says 22. Subtracting one from
//     the other gives 3, and 3 is the number two different shipped code paths
//     archived for a season everybody had watched reach 22.
//   • TIMER-ONLY player rows: `games` counts evenings attended and `rounds` is
//     absent entirely. Mini-games exist only in advanced mode, so this is the
//     common club, not an edge case — 23 of the 87 real stat rows have
//     `games > 0` and no `rounds` at all.
//
// Names are the app's mock-side first names, deliberately: the club's own name
// is a real one and does not belong in this repo (see mockUsesNoRealNames).

import type { PlayableEvening } from '@/utils/eveningPlayed';
import type { SeasonScope } from '@/utils/seasonScope';

export const SEASON_1: SeasonScope = { currentId: 's1', currentNo: 1 };
/** The season that opened on the close and has not held an evening yet. */
export const SEASON_2: SeasonScope = { currentId: 's2', currentNo: 2 };

export interface ClubEvening extends PlayableEvening {
  id: string;
  startsAt: number;
  seasonId?: string;
  players: string[];
  arrivals: Record<string, string>;
}

export const PLAYERS = [
  'matan',
  'helen',
  'nofar',
  'lioz',
  'linoy',
  'eliran',
  'shir',
] as const;

export const PLAYER_NAMES: Record<string, string> = {
  matan: 'מתן',
  helen: 'הלן',
  nofar: 'Nofar',
  lioz: 'Lioz',
  linoy: 'Linoy',
  eliran: 'Eliran',
  shir: 'שיר',
};

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** Thursday 20:00, the club's weekly slot. Counts backwards from the close. */
const LAST_NIGHT = 1_789_500_000_000;

const attendance = (uids: readonly string[]): Record<string, string> =>
  Object.fromEntries(uids.map((u) => [u, 'arrived']));

/** A night that left evidence: the clock ran. The only evidence a timer-only
 *  evening can produce — that live screen is a clock and nothing else. */
const played = (
  i: number,
  over: Partial<ClubEvening> = {},
): ClubEvening => ({
  id: `g${i}`,
  startsAt: LAST_NIGHT - i * WEEK,
  status: 'finished',
  // No `endedBy` on the nineteen oldest: they were closed by a build that
  // predates the field, which is what makes them 'happened' by the legacy rule
  // rather than by evidence.
  liveMatch: { timerEvents: [{ type: 'start', at: 1 }] },
  players: [...PLAYERS],
  arrivals: attendance(PLAYERS),
  ...over,
});

/**
 * The club's terminal games, newest first — the same order and the same 200-doc
 * window both the client scan and the server counters read.
 */
export const EVENINGS: ClubEvening[] = [
  // ── The three stamped nights of season 1 ──────────────────────────────────
  played(0, { seasonId: 's1', endedBy: 'admin' }),
  played(1, { seasonId: 's1', endedBy: 'admin' }),
  played(2, { seasonId: 's1', endedBy: 'auto' }),

  // ── The evening nobody can vouch for ──────────────────────────────────────
  //
  // Closed by the sweep with no timer, no goal and no rotation. It is
  // 'unverified', it is stamped into season 1, and it must be counted by
  // NOTHING — not by the card, not by the archive, not by the organisation
  // rate. A naive count of `status === 'finished'` makes the season 23.
  {
    id: 'g-unverified',
    startsAt: LAST_NIGHT - 3 * WEEK,
    status: 'finished',
    endedBy: 'auto',
    seasonId: 's1',
    players: [...PLAYERS],
    arrivals: attendance(PLAYERS),
  },

  // ── The night that was called off ─────────────────────────────────────────
  {
    id: 'g-cancelled',
    startsAt: LAST_NIGHT - 4 * WEEK,
    status: 'cancelled',
    seasonId: 's1',
    players: [...PLAYERS],
    arrivals: {},
  },

  // ── Nineteen nights from before the stamp existed ─────────────────────────
  ...Array.from({ length: 19 }, (_, k) => played(5 + k)),
];

/** The 22 that happened, as the two counters see them. */
export const EVENINGS_THAT_HAPPENED = 22;

/**
 * What the club document and the counters hold for season 1, exactly as
 * production does.
 */
export const CLUB_SEASON_1 = {
  seasonId: 's1',
  seasonNo: 1,
  /** The number on the card and on the stats screen. */
  playedRounds: 22,
  /** Where season 1 was told to start counting. */
  roundsAtStart: 7,
  /** `clubRecords.eveningsSealed`: all-time, and only born on 26.08.2026. */
  eveningsSealed: 10,
  /** What `eveningsSealed - roundsAtStart` answers. Never the right number for
   *  this club, and twice shipped as one. */
  counterSubtraction: 3,
};

/**
 * `communityPlayerStats` for the seven members, timer-only.
 *
 * `games` is evenings attended; `rounds` is absent, not zero — the row has
 * never seen a mini-game because the club has never opened advanced mode. Any
 * rule that asks "did this player take part" by reading `rounds` answers "no"
 * for the entire club, which is how a closed season came to report 0 שחקנים.
 */
export const PLAYER_ROWS: Record<
  string,
  { userId: string; games: number; goals: number; assists?: number; wins?: number }
> = {
  matan: { userId: 'matan', games: 22, goals: 10, assists: 5, wins: 9 },
  helen: { userId: 'helen', games: 19, goals: 8, assists: 3, wins: 8 },
  nofar: { userId: 'nofar', games: 18, goals: 6, assists: 2, wins: 7 },
  lioz: { userId: 'lioz', games: 17, goals: 4, assists: 1, wins: 6 },
  linoy: { userId: 'linoy', games: 17, goals: 2, assists: 1, wins: 6 },
  eliran: { userId: 'eliran', games: 15, goals: 1, wins: 5 },
  shir: { userId: 'shir', games: 14, goals: 0, wins: 4 },
};

/**
 * The same seven rows as the CLOSE archived them.
 *
 * Every one is short by exactly three: the club played three evenings with no
 * timer and no rotation (06.07, 16.07, 04.08), and nothing credited a `games`
 * increment for them. So the archive's best attendance is 19 while the season
 * it belongs to is 22 — which is why the awards denominator and the season's
 * length are two separate numbers on the card, and why substituting either for
 * the other moves a real title. Under the pre-20.09.2026 rules that was
 * מלך הפנדלים (minPenaltyAttempts(19) is 2, (22) is 3); the penalty titles
 * are counts now, and the denominator instead decides who is eligible for
 * שחקן העונה (ceil(19/2) = 10 against ceil(22/2) = 11).
 */
export const ARCHIVED_PLAYER_ROWS: Record<string, { games: number }> = {
  matan: { games: 19 },
  helen: { games: 16 },
  nofar: { games: 15 },
  lioz: { games: 14 },
  linoy: { games: 14 },
  eliran: { games: 12 },
  shir: { games: 11 },
};

/**
 * The card the close actually wrote for this season, read off
 * `seasonCards/HhzIwmjMl1i5HSOGHt3p__s1` in production on 2026-09-18.
 *
 * Copied, not invented. An earlier version of this fixture declared
 * `totals.rounds: 0` with a comment insisting it "is 0 and always will be" —
 * and this club runs ADVANCED mode and has 37 archived mini-games. A fixture
 * that exists to stop the מחזור/משחקון confusion must not contain it; the
 * timer-only shape is a real and common one, and it is TIMER_ONLY_CARD below,
 * which is a different club.
 *
 * `completedRounds` is EVENINGS (22) and `totals.rounds` is MINI-GAMES (37).
 * They are different units and the gap between them is the point.
 */
/**
 * The most evenings any ONE player attended — the denominator the eligibility
 * gate is measured in. It is NOT on the card and never was: it lived there for
 * half a day and the write was removed, because it is by construction identical
 * to כתר ההתמדה's own winning value and anything dividing by it gets 1.0.
 * It stays here because the gate still uses it server-side.
 */
export const AWARDS_DENOMINATOR = 19;

export const SEALED_CARD = {
  seasonId: 's1',
  no: 1,
  completedRounds: 22,
  totals: { rounds: 37, goals: 27, assists: 13 },
  players: 7,
};

/**
 * The other real shape, and the common one: a club that runs the plain live
 * timer, so it records evenings and no mini-games at all. Measured in
 * production — 23 of 87 `communityPlayerStats` rows have `games > 0` and no
 * `rounds` field whatsoever.
 *
 * Anything that decides a season is empty by looking at mini-games erases the
 * entire hall of fame of every club of this kind.
 */
export const TIMER_ONLY_CARD = {
  seasonId: 's1',
  no: 1,
  completedRounds: 20,
  totals: { rounds: 0, goals: 0, assists: 0 },
  players: 14,
};

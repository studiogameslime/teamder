// How strong a title was, as distinct from which title it is.
//
// The medal has two axes and they say different things: the RING is the tier
// (how strong), the CORE is the title (which one). Without that separation nine
// titles are nine equal discs, and a מלך ההתמדה who made 19 evenings out of 19
// looks exactly like a מלך הבישולים who won it on five assists.
//
// Thresholds are per title because the units are not comparable — 40 goals and
// 19 evenings and a 6.5 average are three different scales. They are tuned for
// an amateur club playing weekly, not for a league: the point of בָּרוֹנְזָה here
// is "took the title", not "was mediocre".

import type { SeasonTitleKey } from '@/utils/seasonAwards';

export type MedalTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/** The ring, as a three-stop metal. */
export const TIER_METAL: Record<MedalTier, readonly [string, string, string]> = {
  // Same three metals the club achievements already use, so a badge means the
  // same thing on both shelves.
  bronze: ['#E9A46A', '#CD7F32', '#8A5320'],
  silver: ['#E4E9F0', '#9AA4B2', '#666E7C'],
  gold: ['#FFE9A8', '#F4B73E', '#A9741A'],
  platinum: ['#FFFFFF', '#DCE4F0', '#8C9BB5'],
};

export const TIER_NAME: Record<MedalTier, string> = {
  bronze: 'ארד',
  silver: 'כסף',
  gold: 'זהב',
  platinum: 'פלטינה',
};

/** silver / gold / platinum cut-offs. Below the first is bronze. */
type Steps = readonly [number, number, number];

/**
 * Which scale a title is graded on.
 *
 * A TOTAL Record, deliberately: a tenth title added to SEASON_TITLE_KEYS is a
 * compile error here. It used to be a `Partial<Record<…>>` of counting steps
 * with a `steps ? … : 'bronze'` fallthrough, so a title with no entry would
 * wear the weakest metal for ever and TypeScript had nothing to say about it —
 * the one failure in this file that is silent in production and invisible in
 * review.
 */
type Scale =
  /** A raw count, on its own per-title scale. */
  | { kind: 'count'; steps: Steps }
  /** Already 0-1. */
  | { kind: 'rate' }
  /** Graded against the season's own length, not against a fixed number. */
  | { kind: 'attendance' }
  /** An average evening score. */
  | { kind: 'eveningScore' };

const SCALE: Record<SeasonTitleKey, Scale> = {
  topScorer: { kind: 'count', steps: [8, 16, 28] },
  topAssister: { kind: 'count', steps: [6, 12, 22] },
  topWinner: { kind: 'count', steps: [10, 20, 34] },
  cleanSheetKing: { kind: 'count', steps: [5, 11, 20] },
  deadlyDuo: { kind: 'count', steps: [5, 11, 20] },
  penaltyKing: { kind: 'rate' },
  penaltyKeeper: { kind: 'rate' },
  mostLoyal: { kind: 'attendance' },
  mvp: { kind: 'eveningScore' },
};

/** The two rate titles: already 0-1, and only meaningful with volume. */
const RATE_STEPS: Steps = [0.7, 0.85, 1];

/**
 * מלך העונה is an average evening score, and eveningScore ends on
 * `Math.max(6, Math.min(10, score))` — so the only values that can ever reach
 * here are 6 to 10, not 1 to 10.
 *
 * The cut-offs were written as [6.5, 7.5, 8.5] against an assumed 1-10 scale.
 * Read against the real [6, 10] they are not unreasonable — but they were not
 * CHOSEN for it, and the first attempt to correct that moved them to [7, 8, 9],
 * which widened bronze from [6, 6.5) to [6, 7) and made the title HARDER to
 * lift off the floor. The club's own evening-standings leader sits at 6.93.
 *
 * So: quarters of the range the number can actually hold. 6.0 is the floor and
 * means "nothing was recorded" — it must stay bronze — and 8.8 and up is the
 * top of what a real season produces.
 */
const MVP_STEPS: Steps = [6.6, 7.6, 8.8];

/** Attendance is a share of the season, so its steps are shares too. */
const ATTENDANCE_STEPS: Steps = [0.6, 0.8, 1];

function step(value: number, [s, g, p]: Steps): MedalTier {
  if (value >= p) return 'platinum';
  if (value >= g) return 'gold';
  if (value >= s) return 'silver';
  return 'bronze';
}

/**
 * @param completedRounds the season's own length — מלך ההתמדה is the one title
 *        whose scale IS the season, so 19 of 19 must outrank 19 of 40.
 */
export function medalTier(
  key: SeasonTitleKey,
  value: number,
  completedRounds: number,
): MedalTier {
  const scale = SCALE[key];
  switch (scale.kind) {
    case 'count':
      return step(value, scale.steps);
    case 'rate':
      return step(value, RATE_STEPS);
    case 'eveningScore':
      return step(value, MVP_STEPS);
    case 'attendance':
      // Perfect attendance is the one thing in this app that is unarguably
      // perfect, and platinum exists to say so. With no length to divide by
      // there is no share to grade, only the fact of the title.
      if (completedRounds <= 0) return 'bronze';
      return step(value / completedRounds, ATTENDANCE_STEPS);
  }
}

/**
 * How many seasons in a row the same holder has taken the same title.
 *
 * Free: the screen already holds every season in one array, so this is a walk
 * over what is in memory — no read, no server field.
 *
 * Compared BY NAME, because a name is all a sealed season carries: a
 * SeasonWinner is {key, names, value} and no user id survives the archive. A
 * player who edits their display name therefore ends the streak they are in
 * the middle of, silently, and nothing here can tell that apart from a new
 * holder. Freezing the holders' user ids beside their names when the season
 * card is written is the only real fix; until the archive carries them this is
 * a name match, and it says so.
 *
 * @param seasons newest first, the order `seasonHistoryService.list` returns.
 */
export function titleStreak(
  seasons: readonly {
    no: number;
    winners: readonly { key: string; names: readonly string[] }[];
  }[],
  index: number,
  key: string,
): number {
  const holders = (i: number): string | null => {
    const w = seasons[i]?.winners.find((x) => x.key === key);
    if (!w || w.names.length === 0) return null;
    // A shared title continues a streak only for the identical set.
    //
    // Joined on U+0000, written as an escape rather than as the raw control
    // byte that used to sit in this string: a name cannot contain it, while on
    // a space ['א', 'ב ג'] and ['א ב', 'ג'] both flatten to 'א ב ג' — two
    // different pairs of people reading as the same holders, which is how a
    // streak badge reaches a set that never held anything twice. Trimmed as
    // well, because the archive freezes whatever the name field held.
    return [...w.names]
      .map((n) => n.trim())
      .sort()
      .join('\u0000');
  };
  const mine = holders(index);
  if (mine === null) return 0;
  let n = 1;
  // Walk towards OLDER seasons (higher index), and only while the season
  // numbers are consecutive — a gap means the club turned seasons off, and a
  // streak across a gap is not a streak.
  for (let i = index + 1; i < seasons.length; i += 1) {
    if (seasons[i].no !== seasons[i - 1].no - 1) break;
    if (holders(i) !== mine) break;
    n += 1;
  }
  return n;
}

// How much of a season a RATING was really built from.
//
// שחקן העונה is a MEAN of evening scores, and a mean is only as honest as the
// nights it covers. `eveningScoreCount` counts the evenings a player was
// actually rated — since 20.09.2026 it excludes the "no mini-game tonight"
// sentinel — and it can sit well below the season's length. On the one club
// that has closed a season it is nine of twenty-two, because the accumulator
// feeding it shipped two days before the season ended. "ציון 7.7" reads as a
// whole-season figure and is not one.
//
// Recorded on the title rather than as the season-level `partialData` flag.
// That flag says the SEASON is partial, and a season whose goals, assists,
// wins and attendance were collected in full is not — only its rating is
// short, so only its rating carries the note.
//
// Read in two places, from two different documents: the hall of fame reads
// `seasonCards.winners[]` and the personal summary reads `seasonSummary.awards`.
// One reader for both, because two copies of a defensive parser are two sets
// of things it defends against.

export interface SeasonCoverage {
  /** Evenings the rating actually exists for. */
  rated: number;
  /** Evenings in the season. */
  of: number;
}

/**
 * A complete, positive coverage pair, or undefined.
 *
 * ⚠️ Deliberately strict, because a HALF-written coverage is worse than none:
 * the sentence it produces reads as fact. One number without the other, a
 * denominator of zero, a numerator above it, a string where a number belongs —
 * all dropped, and the title renders exactly as it did before this field
 * existed.
 *
 * Absent means "no claim either way", never "zero of zero". Every season
 * closed before 20.09.2026 has winners with no such field and must keep
 * rendering as it does now.
 */
export function readSeasonCoverage(raw: unknown): SeasonCoverage | undefined {
  const c = (raw as { coverage?: unknown } | null | undefined)?.coverage as
    | { rated?: unknown; of?: unknown }
    | null
    | undefined;
  if (!c || typeof c !== 'object') return undefined;
  const rated = typeof c.rated === 'number' && Number.isFinite(c.rated) ? c.rated : 0;
  const of = typeof c.of === 'number' && Number.isFinite(c.of) ? c.of : 0;
  if (of <= 0 || rated <= 0 || rated > of) return undefined;
  return { rated, of };
}

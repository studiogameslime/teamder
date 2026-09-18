// A season that opens without its offset is due the moment it opens.
//
// `completedRoundsOf(groupId, roundsAtStart)` subtracts the club's ALL-TIME
// sealed-evening count from where this season started. The counter never
// resets, so a season block written without `roundsAtStart` is measured
// against the club's whole history:
//
//   A two-year-old club with 40 sealed evenings switches seasons on, seals its
//   history as season 1, and gives season 2 a target of 24 rounds. Season 2
//   opens with no offset, so `completedRoundsOf` answers 40 — already past 24.
//   The hourly sweep finds it due and closes it, empty, within the hour: an
//   archive of zeros, nine null titles, and the club's season counter one
//   ahead of anything anybody played.
//
// `playedRounds` is the same fact on the client side: the card renders
// `he.seasonsProgressRounds(seasons.playedRounds ?? 0, target)`, so a block
// without it shows "0 מתוך 24" for a season the server thinks is over.
//
// Five places open a new season: runSeasonRollovers, endSeasonNow,
// reopenLastSeason, and enableClubSeasons twice — once for "seal my history as
// season 1 and start season 2", once for "carry season 1 on". They are five
// inline object literals with nothing tying them together, which is exactly how
// one of them came to be missing both fields — so the shape is pinned here
// rather than trusted.
import { objectLiterals } from '../fixtures/serverSource';

/** A block that names a season id AND a start time is opening one. A block
 *  that only edits the cadence, or only flips `enabled`, is not. */
const opensASeason = (body: string) =>
  /currentId:/.test(body) && /startedAt:/.test(body);

describe('every place that opens a season', () => {
  // Over the whole backend, not over index.ts alone: this guard exists because
  // a writer can be forgotten, and a writer moved into another file is the
  // easiest kind to forget. Brace-matched, so indentation is not part of the
  // rule.
  const blocks = objectLiterals(/seasons:\s*\{/).filter((b) =>
    opensASeason(b.body),
  );

  it('there are five of them, and this test knows about all five', () => {
    // A sixth writer is a sixth chance to forget; it should arrive with a line
    // in this test rather than silently. Named, so a failure says which file
    // grew one.
    expect(blocks.map((b) => b.where)).toHaveLength(5);
  });

  // `...seasonSeed(n)` supplies BOTH fields and is the preferred way to write
  // them — it is the one place that guarantees the offset and the progress are
  // derived from the same instant, which is what stops a season reading
  // "0 מתוך 24" while the sweep closes it at 17. Naming them individually is
  // still accepted for the paths that genuinely need their own values.
  const seeds = (body: string, field: RegExp) =>
    field.test(body) || /\.\.\.seasonSeed\(/.test(body);

  it.each(blocks.map((b) => [b.where, b.body] as const))(
    'stamps roundsAtStart (%s)',
    (_where, body) => {
      expect(seeds(body, /roundsAtStart:/)).toBe(true);
    },
  );

  it.each(blocks.map((b) => [b.where, b.body] as const))(
    'stamps playedRounds (%s)',
    (_where, body) => {
      expect(seeds(body, /playedRounds:/)).toBe(true);
    },
  );
});

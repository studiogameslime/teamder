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
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..', 'functions', 'src', 'index.ts');
const src = fs.readFileSync(SRC, 'utf8');

/** Every `seasons: { … }` object literal in the file, brace-matched. */
function seasonBlocks(text: string): { at: number; body: string }[] {
  const out: { at: number; body: string }[] = [];
  const marker = /seasons:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(text))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({ at: text.slice(0, m.index).split('\n').length, body: text.slice(open, i + 1) });
  }
  return out;
}

/** A block that names a season id AND a start time is opening one. A block
 *  that only edits the cadence, or only flips `enabled`, is not. */
const opensASeason = (body: string) =>
  /currentId:/.test(body) && /startedAt:/.test(body);

describe('every place that opens a season', () => {
  const blocks = seasonBlocks(src).filter((b) => opensASeason(b.body));

  it('there are five of them, and this test knows about all five', () => {
    // A sixth writer is a sixth chance to forget; it should arrive with a line
    // in this test rather than silently.
    expect(blocks.length).toBe(5);
  });

  it.each(blocks.map((b) => [b.at, b.body] as const))(
    'stamps roundsAtStart (functions/src/index.ts:%i)',
    (_line, body) => {
      expect(body).toMatch(/roundsAtStart:/);
    },
  );

  it.each(blocks.map((b) => [b.at, b.body] as const))(
    'stamps playedRounds (functions/src/index.ts:%i)',
    (_line, body) => {
      expect(body).toMatch(/playedRounds:/);
    },
  );
});

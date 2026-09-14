// The reset list is a safety boundary, not an implementation detail.
//
// A season rollover zeroes club-scoped counters on `communityPlayerStats` and
// `communityStats`. Those same two documents also carry things that are NOT
// the club's competition and must survive untouched:
//
//   bestEvening        a PERSONAL high-water mark, stored on a club document.
//                      Wiping it does not just blank a number — the round
//                      summary suppresses "personal record" while no baseline
//                      exists and then re-announces months-old numbers as
//                      brand-new records.
//   lastEveningScore   the previous score, used for the evening's delta.
//   kingGoalsSum       the running benchmark the evening score is measured
//   kingGoalsCount     against. Reset it and the new season's first top
//   kingAssistsSum     scorer is a perfect 10 by construction, lifting every
//   kingAssistsCount   score by roughly a quarter of the 6–10 scale, silently.
//   chemistrySince     the pair window's start. Only ever advanced when absent
//                      or earlier, so it must be RE-STAMPED rather than left.
//
// The failure mode is that someone adds a field to the reset list, or a
// blanket overwrite replaces the named one, and nothing complains. So the list
// is pinned here.

import { __seasonFields } from '../../functions/src/seasonRollover';

const PLAYER = [...__seasonFields.player];
const CLUB = [...__seasonFields.club];

/** Personal or cross-season state that happens to live on the same documents. */
const MUST_SURVIVE = [
  'bestEvening',
  'lastEveningScore',
  'kingGoalsSum',
  'kingGoalsCount',
  'kingAssistsSum',
  'kingAssistsCount',
  'chemistrySince',
  // The per-row stamp that makes the wind-back idempotent. Resetting it would
  // let a retry subtract the archived season a second time.
  'seasonWoundBack',
  // Identity, not competition.
  'groupId',
  'userId',
  'displayName',
];

describe('the reset list is exactly the competition', () => {
  it('zeroes the player counters a season owns', () => {
    expect(PLAYER.sort()).toEqual([
      'asRounds', 'assists', 'cleanSheets', 'csRounds', 'eveningScoreCount',
      'eveningScoreSum', 'games', 'goals', 'losses', 'ownGoals', 'penConceded',
      'penFaced', 'penMissed', 'penSaved', 'penScored', 'penTaken', 'rounds',
      'ties', 'wins',
    ]);
  });

  it('zeroes the club counters a season owns', () => {
    expect(CLUB.sort()).toEqual([
      'goals', 'guestGoals', 'ownGoals', 'rounds', 'scorelessRounds',
      'shootoutRounds', 'tiedRounds',
    ]);
  });

  it('never touches personal or cross-season state', () => {
    for (const field of MUST_SURVIVE) {
      expect(PLAYER).not.toContain(field);
      expect(CLUB).not.toContain(field);
    }
  });

  it('resets each coverage denominator alongside its numerator', () => {
    // csRounds without cleanSheets would divide a new season's handful of
    // clean sheets by a whole career, and vice versa.
    expect(PLAYER.includes('cleanSheets')).toBe(PLAYER.includes('csRounds'));
    expect(PLAYER.includes('assists')).toBe(PLAYER.includes('asRounds'));
  });

  it('resets the evening-score mean as a PAIR', () => {
    // The MVP title is the highest average evening score this season. Keeping
    // the sum but resetting the count — or the reverse — yields a number that
    // is not an average of anything.
    expect(PLAYER.includes('eveningScoreSum')).toBe(
      PLAYER.includes('eveningScoreCount'),
    );
    // And `lastEveningScore` is NOT part of it: it is next evening's delta
    // baseline, and zeroing it would announce the first evening of a season as
    // an enormous improvement over nothing.
    expect(PLAYER).not.toContain('lastEveningScore');
  });

  it('resets every penalty counter together', () => {
    const pen = PLAYER.filter((f) => f.startsWith('pen'));
    expect(pen.sort()).toEqual([
      'penConceded', 'penFaced', 'penMissed', 'penSaved', 'penScored',
      'penTaken',
    ]);
  });

  it('resets the outcome trio together, or rounds stops adding up', () => {
    for (const f of ['wins', 'losses', 'ties', 'rounds']) {
      expect(PLAYER).toContain(f);
    }
  });
});

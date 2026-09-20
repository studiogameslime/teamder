/**
 * The season-title rules exist twice and must stay identical.
 *
 * Cloud Functions cannot import from the app source, so `functions/src/
 * seasonAwards.ts` is a copy of `src/utils/seasonAwards.ts`. A copy that
 * drifts is worse than no copy: the server would seal a season's titles by one
 * set of rules while the app explained them by another, and the disagreement
 * would only ever be visible to the club.
 *
 * The text check says the copy is a copy; the run below says the copy WORKS.
 * Only one of those is evidence — two byte-identical copies of a wrong rule
 * pass a diff, and this file never executed the server copy at all, which is
 * the half that actually decides who gets a title. The pattern is
 * balanceParity.test.ts's: load both modules and run them over one table.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ARCHIVED_PLAYER_ROWS, PLAYER_ROWS, SEALED_CARD } from '../fixtures/realClub';

const ROOT = path.join(__dirname, '..', '..');
const MARKER = '// ---- everything below this line is a copy of the client file ----';

describe('the two copies of the title rules', () => {
  const client = fs.readFileSync(path.join(ROOT, 'src/utils/seasonAwards.ts'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'functions/src/seasonAwards.ts'), 'utf8');

  it('the server copy declares itself a copy', () => {
    expect(server).toContain(MARKER);
  });

  it('and is byte-identical to the client file below the marker', () => {
    const copied = server.slice(server.indexOf(MARKER) + MARKER.length).replace(/^\n+/, '');
    expect(copied).toBe(client);
  });
});

describe('and both copies decide the same season', () => {
  const load = async () => [
    await import('@/utils/seasonAwards'),
    await import('../../functions/src/seasonAwards'),
  ];

  /** The real club's seven members, in the units the close hands over: the
   *  ARCHIVED `games` (short by three — see the fixture), no mini-games at all,
   *  and an evening score everybody shares on the scale floor. */
  const lines = Object.entries(PLAYER_ROWS).map(([uid, r]) => ({
    uid,
    games: ARCHIVED_PLAYER_ROWS[uid].games,
    rounds: 0,
    goals: r.goals,
    assists: r.assists ?? 0,
    wins: r.wins ?? 0,
    cleanSheets: 0,
    mvpAvg: 6,
    penTaken: uid === 'helen' ? 2 : 0,
    penScored: uid === 'helen' ? 2 : 0,
    penFaced: 0,
    penSaved: 0,
  }));
  const pairs = [
    { a: 'matan', b: 'helen', score: 7, together: 14 },
    { a: 'nofar', b: 'lioz', score: 2, together: 3 },
  ];

  it('over the season that actually closed', async () => {
    const [app, server] = await load();
    expect(server.computeSeasonAwards(lines, pairs, SEALED_CARD.completedRounds)).toEqual(
      app.computeSeasonAwards(lines, pairs, SEALED_CARD.completedRounds),
    );
  });

  it('and over the denominators either side of the title it moved', async () => {
    // 19 versus 22 is not a rounding difference. It used to move a title via
    // minPenaltyAttempts (2 against 19, 3 against 22); that gate no longer
    // applies to anything, and the difference now lands on the MVP gate. The
    // original note follows, kept because the archives were written under it:
    // minPenaltyAttempts(19) is 2
    // and (22) is 3, which is the whole of how מלך הפנדלים went to a player
    // with two kicks. Both copies have to move the title together or the app
    // explains a title the server did not award.
    const [app, server] = await load();
    for (const denominator of [0, 1, 2, 13, 19, 20, 22, 40]) {
      expect(server.computeSeasonAwards(lines, pairs, denominator)).toEqual(
        app.computeSeasonAwards(lines, pairs, denominator),
      );
      expect(server.eligibilityThreshold(denominator)).toBe(
        app.eligibilityThreshold(denominator),
      );
      expect(server.minPenaltyAttempts(denominator)).toBe(
        app.minPenaltyAttempts(denominator),
      );
    }
  });

  it('and agree on who is even eligible, row by row', async () => {
    const [app, server] = await load();
    for (const line of lines) {
      for (const denominator of [0, 19, 22, 40]) {
        expect(server.isEligible(line, denominator)).toBe(
          app.isEligible(line, denominator),
        );
      }
    }
    expect([...server.SEASON_TITLE_KEYS]).toEqual([...app.SEASON_TITLE_KEYS]);
  });

  it('and on a season nobody played, which awards nothing', async () => {
    const [app, server] = await load();
    expect(server.computeSeasonAwards([], [], 22)).toEqual(
      app.computeSeasonAwards([], [], 22),
    );
  });
});

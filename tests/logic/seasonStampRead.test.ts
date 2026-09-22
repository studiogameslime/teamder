// The season stamp has to survive the READ, or every club past season 1
// counts zero evenings.
//
// Reported on שכחת שושי: "מחזורים 0" beside "משחקונים 12" and 17 goals, on
// the running season. The two numbers come from different places — the
// mini-games and goals from server-maintained counters, the evenings from a
// client-side scan over the club's games — and only the scan needs the stamp.
//
//   the server stamps `seasonId` on every game;
//   the game READER in src/firebase/firestore.ts rebuilt the object field by
//   field and never named it, so `game.seasonId` was undefined on every
//   client;
//   `inSeason` reads an absent stamp as "season 1", because that is what an
//   absent stamp means on a game written before seasons shipped;
//   so on season 2 it returned false for EVERY game, and the scan counted none.
//
// The same class of bug as the 1.0.85 draft mode and as the archived `pairs`
// found this morning. This test exists so the third one is the last.

import fixture from '../fixtures/shoshiSeason2Games.json';
import { inSeason } from '@/utils/seasonScope';
import { eveningPlayState, type PlayableEvening } from '@/utils/eveningPlayed';

const SEASON = fixture.season;
const games = fixture.games as Array<Record<string, unknown>>;

/** The scan's own two filters, in its order. */
const countEvenings = (rows: Array<Record<string, unknown>>) =>
  rows.filter(
    (g) =>
      inSeason(g as { seasonId?: string }, SEASON) &&
      g.status !== 'cancelled' &&
      eveningPlayState(g as unknown as PlayableEvening) === 'happened',
  ).length;

describe('the evening scan on a club in its second season', () => {
  it('production really does stamp these games', () => {
    const stamped = games.filter((g) => typeof g.seasonId === 'string' && g.seasonId);
    expect(stamped).toHaveLength(games.length);
  });

  it('counts the evenings of the running season', () => {
    // Five of the six are s2. The sixth is stamped s3 — a season that was
    // opened and reopened back — and must NOT be counted under s2.
    expect(countEvenings(games)).toBe(5);
  });

  it('and every one of those five is "happened", not merely finished', () => {
    const s2 = games.filter((g) => g.seasonId === SEASON.currentId);
    expect(s2).toHaveLength(5);
    for (const g of s2) {
      expect(eveningPlayState(g as unknown as PlayableEvening)).toBe('happened');
    }
  });

  it('⚠️ THE BUG: strip the stamp on read and the count collapses to zero', () => {
    // Exactly what the old reader produced — the field simply not there.
    const unread = games.map(({ seasonId: _dropped, ...rest }) => rest);
    expect(countEvenings(unread)).toBe(0);
    // And the failure is total, not partial: this is why the tile read 0 and
    // not "a few missing".
    expect(countEvenings(unread)).toBeLessThan(countEvenings(games));
  });

  it('an UNSTAMPED game still counts for a club in its first season', () => {
    // The absent stamp means "written before seasons existed", and that is a
    // season-1 evening. Removing the fallback would break every such club.
    const unread = games.map(({ seasonId: _d, ...rest }) => rest);
    const asSeasonOne = unread.filter(
      (g) =>
        inSeason(g as { seasonId?: string }, { currentId: 's1', currentNo: 1 }) &&
        eveningPlayState(g as unknown as PlayableEvening) === 'happened',
    );
    expect(asSeasonOne.length).toBeGreaterThan(0);
  });
});

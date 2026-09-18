// Which evenings belong to the season on screen.
//
// A club whose season 2 had not yet had a single evening read "22 מחזורים", a
// 100% organisation rate and a 22-night streak — beside goals and mini-games
// the close had correctly zeroed. The scan behind those three had no season
// filter at all, so one screen showed two different scopes (owner report,
// reproduced against production: 22 finished games, seasons.playedRounds 0).
//
// THE REAL RULE, imported. It used to be re-declared here — nine lines of
// "extracted exactly as gameService applies it" — which meant this file tested
// its own copy: deleting the filter from the scan would have left every
// assertion below green while the stats screen went straight back to showing a
// club's lifetime under a season heading. The rule now lives in
// `src/utils/seasonScope.ts` precisely so a test can reach it, because
// gameService itself cannot be loaded under jest (it pulls react-native in
// through the auth layer).
import { inSeason } from '@/utils/seasonScope';
import { EVENINGS, SEASON_1, SEASON_2 } from '../fixtures/realClub';

const S2 = SEASON_2;
const S1 = SEASON_1;

describe('inSeason', () => {
  it('counts nothing from an earlier season', () => {
    expect(inSeason({ seasonId: 's1' }, S2)).toBe(false);
  });

  it('counts this season', () => {
    expect(inSeason({ seasonId: 's2' }, S2)).toBe(true);
  });

  // The stamp is only written on games that went active or finished AFTER the
  // feature shipped. Everything older was played in the club's first season.
  it('treats an unstamped game as season 1', () => {
    expect(inSeason({}, S1)).toBe(true);
    expect(inSeason({}, S2)).toBe(false);
  });

  it('counts everything when the club runs no seasons', () => {
    expect(inSeason({}, undefined)).toBe(true);
    expect(inSeason({ seasonId: 's1' }, undefined)).toBe(true);
  });

  it('is not fooled by a stamp that is not a string', () => {
    // The field comes off a raw Firestore document. A null — which is what a
    // deserialiser writing `seasonId: null` produces — is an ABSENT stamp, not
    // a stamp that matches nothing: those evenings are season 1's.
    expect(inSeason({ seasonId: null } as never, S1)).toBe(true);
    expect(inSeason({ seasonId: null } as never, S2)).toBe(false);
  });

  // The exact shape of the club that was reported: 19 nights from before the
  // feature, 3 stamped into season 1, and a season 2 that has not started.
  it('reproduces the reported club — season 2 is empty', () => {
    const games = [
      ...Array.from({ length: 19 }, () => ({})),
      ...Array.from({ length: 3 }, () => ({ seasonId: 's1' })),
    ];
    expect(games.filter((g) => inSeason(g, S2)).length).toBe(0);
    // All 22 belong to season 1 — the 19 that predate the stamp and the 3 that
    // carry it. The season CARD recorded 19, which is the second half of this
    // report: endClubSeason re-derived the figure instead of recording
    // `seasons.playedRounds`, the number the club had been watching.
    expect(games.filter((g) => inSeason(g, S1)).length).toBe(22);
  });

  it('and does the same over the real club’s own documents', () => {
    // The same claim, made against the fixture built from production rather
    // than from two array literals: 24 terminal documents, 22 of them evenings
    // that happened, every one of them season 1's.
    expect(EVENINGS.filter((g) => inSeason(g, S1)).length).toBe(24);
    expect(EVENINGS.filter((g) => inSeason(g, S2)).length).toBe(0);
    // 24, not 22: the cancelled night and the unverified one are both IN the
    // season — one is what the organisation rate divides by, the other is
    // waiting on an admin. Whether an evening HAPPENED is a separate question,
    // asked of a separate module, and seasonCounterReconciliation pins the two
    // together. This rule answers only "whose season is it".
  });
});

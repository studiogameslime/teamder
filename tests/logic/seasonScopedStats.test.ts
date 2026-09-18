// Which evenings belong to the season on screen.
//
// A club whose season 2 had not yet had a single evening read "22 מחזורים", a
// 100% organisation rate and a 22-night streak — beside goals and mini-games
// the close had correctly zeroed. The scan behind those three had no season
// filter at all, so one screen showed two different scopes (owner report,
// reproduced against production: 22 finished games, seasons.playedRounds 0).

/** The rule, extracted exactly as gameService applies it. */
function inSeason(
  game: { seasonId?: string },
  season?: { currentId: string; currentNo: number },
): boolean {
  if (!season) return true;
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === season.currentId : season.currentNo === 1;
}

const S2 = { currentId: 's2', currentNo: 2 };
const S1 = { currentId: 's1', currentNo: 1 };

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
});

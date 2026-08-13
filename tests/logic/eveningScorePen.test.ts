// The penalty axis in the evening score.
//
// The server used to drop it — "not available here" — while the client added
// it on the card. Invisible until the card started showing the STORED score,
// at which point a keeper who saved a shootout penalty saw it recorded in his
// stats and missing from the score that ranked him. These lock the axis in.

import { eveningScore, PENALTY_POINTS } from '@/utils/eveningScore';

const base = {
  goals: 3,
  assists: 1,
  wins: 5,
  gamesPlayed: 8,
  goalsFor10: 4,
  assistsFor10: 2,
};
const NO_PEN = { scored: 0, saved: 0, missed: 0, conceded: 0 };

describe('a shootout save moves the score', () => {
  it('never lowers the score', () => {
    const without = eveningScore({ ...base, pen: NO_PEN });
    const withSave = eveningScore({ ...base, pen: { ...NO_PEN, saved: 1 } });
    expect(withSave).toBeGreaterThanOrEqual(without);
  });

  it('⚠️ ONE save is worth less than the displayed decimal', () => {
    // The axis is 5% of the score, and a single save moves it by ~0.035 — it
    // rounds away at one decimal. So "the penalty now counts" is true and
    // "you will see the number change" usually is NOT. Pinned here so nobody
    // reads a fix as broken, and so anyone raising the 5% weight sees which
    // test to revisit.
    const without = eveningScore({ ...base, pen: NO_PEN });
    const withSave = eveningScore({ ...base, pen: { ...NO_PEN, saved: 1 } });
    expect(withSave - without).toBeLessThan(0.1);
  });

  it('moves visibly when the rest of the evening was quiet', () => {
    // The axis is 5%, so whether it shows at one decimal depends on where the
    // other 95% already sits. On a quiet evening — few wins, no goals — the
    // shootout is the loudest thing that happened and it does move the number.
    const quiet = { goals: 0, assists: 0, wins: 2, gamesPlayed: 8 };
    const without = eveningScore({ ...quiet, pen: NO_PEN });
    const busy = eveningScore({ ...quiet, pen: { ...NO_PEN, saved: 3 } });
    expect(busy).toBeGreaterThan(without);
  });

  it('penalises misses', () => {
    const missed = eveningScore({ ...base, pen: { ...NO_PEN, missed: 3 } });
    const clean = eveningScore({ ...base, pen: NO_PEN });
    expect(missed).toBeLessThan(clean);
  });

  it('treats conceding as the norm — a small dent, not a punishment', () => {
    const conceded = eveningScore({ ...base, pen: { ...NO_PEN, conceded: 3 } });
    const missed = eveningScore({ ...base, pen: { ...NO_PEN, missed: 3 } });
    expect(conceded).toBeGreaterThan(missed);
    expect(PENALTY_POINTS.conceded).toBeGreaterThan(PENALTY_POINTS.missed);
  });

  it('leaves everyone who took no part in a shootout untouched', () => {
    // The whole point of two weight sets: a player with no shootout is scored
    // on 50/30/20 and is never diluted by a category he had no access to.
    expect(eveningScore({ ...base, pen: NO_PEN })).toBe(
      eveningScore({ ...base, pen: { scored: 0, saved: 0, missed: 0, conceded: 0 } }),
    );
  });

  it('keeps the score inside its band', () => {
    const best = eveningScore({
      goals: 99, assists: 99, wins: 8, gamesPlayed: 8,
      pen: { scored: 9, saved: 9, missed: 0, conceded: 0 },
    });
    expect(best).toBeLessThanOrEqual(10);
    const worst = eveningScore({
      goals: 0, assists: 0, wins: 0, gamesPlayed: 8,
      pen: { scored: 0, saved: 0, missed: 9, conceded: 9 },
    });
    expect(worst).toBeGreaterThanOrEqual(6);
  });
});

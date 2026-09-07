import { eveningScore, type EveningScoreInput } from '@/utils/eveningScore';
import {
  pickEveningTitle,
  pickEveningInsights,
  type NarrativeStats,
} from '@/utils/eveningNarrative';

const noPen = { scored: 0, saved: 0, missed: 0, conceded: 0 };
const score = (p: Partial<EveningScoreInput>): number =>
  eveningScore({
    goals: 0,
    assists: 0,
    wins: 0,
    gamesPlayed: 7,
    pen: noPen,
    ...p,
  });

describe('eveningScore (weighted model)', () => {
  // Since WIN_PRIOR_GAMES, a win RATE is shrunk toward a draw so a tiny sample
  // can't read as a perfect record. The consequence at both ends of the range:
  // showing up and losing everything sits just ABOVE the 6.0 no-show floor, and
  // sweeping the evening no longer reaches a literal 10 on the wins axis.
  it('a tough evening (lost all, no goals) sits just above the no-show floor', () => {
    expect(score({ wins: 0, goals: 0, assists: 0 })).toBe(6.2);
    // …and still beats not turning up at all.
    expect(score({ wins: 0, goals: 0, assists: 0 })).toBeGreaterThan(
      score({ gamesPlayed: 0 }),
    );
  });

  it('never exceeds 10 (won all + prolific)', () => {
    expect(score({ wins: 7, goals: 20, assists: 20 })).toBeLessThanOrEqual(10);
    expect(score({ wins: 7, goals: 20, assists: 20 })).toBe(9.8);
  });

  it('a zero-game evening does not divide by zero', () => {
    expect(score({ gamesPlayed: 0 })).toBe(6);
  });

  it('is one decimal place', () => {
    const s = score({ wins: 3, goals: 1, assists: 1 });
    expect(Math.round(s * 10) / 10).toBe(s);
  });

  it('wins dominate (50%): all-wins no-goals carries the score on its own', () => {
    const runner = score({ wins: 7, goals: 0, assists: 0 });
    // 0.5 weight × a shrunk win rate (7+1)/(7+2) = 0.889 → 8.89 → weighted
    // 4.44 → 6 + 4.44/10*4 = 7.8. Was exactly 8.0 on the raw rate.
    expect(runner).toBe(7.8);
    // Wins remain the single heaviest axis, but note what shrinkage costs it:
    // over only 7 mini-games the rate tops out at 8.89, not 10, so its
    // EFFECTIVE weight here is 0.44 rather than 0.5 — and a goals+assists
    // perfect evening (5.0 weighted) now edges out an all-wins one (4.44).
    // The gap closes as the sample grows: over 20 mini-games the rate reaches
    // 9.55, which is the whole point — a perfect record has to be earned over
    // more than a handful of games.
    const over20 = eveningScore({
      goals: 0, assists: 0, wins: 20, gamesPlayed: 20, pen: noPen,
    });
    expect(over20).toBeGreaterThan(runner);
  });

  it('more goals ⇒ higher, all else equal', () => {
    expect(score({ wins: 3, goals: 4 })).toBeGreaterThan(score({ wins: 3, goals: 0 }));
  });

  it('goals reach the cap at the community benchmark target', () => {
    const atTarget = score({ goals: 4, goalsFor10: 4 }); // 4 = target → goalsScore 10
    const over = score({ goals: 9, goalsFor10: 4 }); // capped, same goals axis
    expect(over).toBe(atTarget);
  });

  it('a lower king benchmark makes the same goals worth more', () => {
    const easyLeague = score({ wins: 3, goals: 3, goalsFor10: 3 }); // 3/3 → 10
    const toughLeague = score({ wins: 3, goals: 3, goalsFor10: 6 }); // 3/6 → 5
    expect(easyLeague).toBeGreaterThan(toughLeague);
  });

  it('drops the penalty category when there was no shootout (no punishment)', () => {
    const withoutPenCat = score({ wins: 4, goals: 2 });
    // Same player who ALSO saved a penalty scores at least as high.
    const withSave = score({ wins: 4, goals: 2, pen: { ...noPen, saved: 1 } });
    expect(withSave).toBeGreaterThanOrEqual(withoutPenCat);
  });

  it('a missed penalty lowers the score vs no shootout', () => {
    const base = score({ wins: 4, goals: 2 });
    const missed = score({ wins: 4, goals: 2, pen: { ...noPen, missed: 2 } });
    expect(missed).toBeLessThan(base);
  });
});

const nstats = (p: Partial<NarrativeStats>): NarrativeStats => ({
  goals: 0,
  assists: 0,
  wins: 0,
  losses: 0,
  gamesPlayed: 7,
  totalRounds: 7,
  heldPitch: 0,
  scoringStreak: 0,
  bestMiniGame: null,
  pen: noPen,
  ...p,
});

describe('eveningNarrative', () => {
  it('titles a scorer, a playmaker, and a non-scorer differently', () => {
    const scorer = pickEveningTitle(nstats({ goals: 3 }), 'g:u').title;
    const maker = pickEveningTitle(nstats({ assists: 3 }), 'g:u').title;
    const grinder = pickEveningTitle(nstats({ gamesPlayed: 6 }), 'g:u').title;
    expect(scorer).not.toBe(maker);
    expect(grinder).toBeTruthy();
  });

  it('is deterministic for the same seed, varied across seeds', () => {
    const s = nstats({ goals: 3 });
    expect(pickEveningTitle(s, 'a').title).toBe(pickEveningTitle(s, 'a').title);
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f'].map(
      (x) => pickEveningTitle(s, x).title,
    );
    expect(new Set(seeds).size).toBeGreaterThan(1); // not always identical
  });

  it('always returns at least one insight for a player who took the field', () => {
    expect(pickEveningInsights(nstats({ gamesPlayed: 4 }), 'g:u').length).toBeGreaterThan(0);
  });

  it('surfaces a perfect-night line when every game was won', () => {
    const ins = pickEveningInsights(nstats({ gamesPlayed: 4, wins: 4 }), 'g:u');
    expect(ins.some((i) => i.text.includes('מושלם'))).toBe(true);
  });

  it('credits a keeper who saved penalties', () => {
    const ins = pickEveningInsights(
      nstats({ gamesPlayed: 4, pen: { ...noPen, saved: 2 } }),
      'g:u',
    );
    expect(ins.some((i) => i.text.includes('עצרת'))).toBe(true);
  });

  it('caps at the requested number of insights', () => {
    const loaded = nstats({
      gamesPlayed: 6, wins: 6, goals: 4, assists: 4, heldPitch: 4, scoringStreak: 3,
    });
    expect(pickEveningInsights(loaded, 'g:u', 3).length).toBeLessThanOrEqual(3);
  });
});

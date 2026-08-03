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
    contributionPct: null,
    pen: noPen,
    ...p,
  });

describe('eveningScore (weighted model)', () => {
  it('floors at 6 for a tough evening (lost all, no goals)', () => {
    expect(score({ wins: 0, goals: 0, assists: 0 })).toBe(6);
  });

  it('never exceeds 10 (won all + prolific)', () => {
    expect(
      score({ wins: 7, goals: 20, assists: 20, contributionPct: 100 }),
    ).toBe(10);
  });

  it('a zero-game evening does not divide by zero', () => {
    expect(score({ gamesPlayed: 0 })).toBe(6);
  });

  it('is one decimal place', () => {
    const s = score({ wins: 3, goals: 1, assists: 1 });
    expect(Math.round(s * 10) / 10).toBe(s);
  });

  it('wins dominate (50%): all-wins no-goals still scores well', () => {
    const runner = score({ wins: 7, goals: 0, assists: 0 });
    expect(runner).toBeGreaterThan(8); // ~0.5 weight * 10 → strong
    expect(runner).toBeLessThanOrEqual(10);
  });

  it('more goals ⇒ higher, all else equal', () => {
    expect(score({ wins: 3, goals: 4 })).toBeGreaterThan(score({ wins: 3, goals: 0 }));
  });

  it('goals reach the cap around 2/game', () => {
    const two = score({ gamesPlayed: 4, goals: 8 }); // 2/game → goalsScore 10
    const four = score({ gamesPlayed: 4, goals: 16 }); // capped, same goals axis
    expect(four).toBe(two);
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
  contribution: null,
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

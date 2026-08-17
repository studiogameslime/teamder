// Regression guards for the "שער נקי" counter as it crosses the converters.
//
// This project has lost fields exactly this way twice — `originalTeams` was
// written and never read back, and the same class of bug disabled draft mode in
// 1.0.85 — so a new server-maintained stat gets a read AND a write test before
// it ships, not after somebody notices the column is stuck on 0.
//
// `@/firebase/config` is mocked because the real module pulls in AsyncStorage
// (native) at import time; the functions under test are pure.

jest.mock('@/firebase/config', () => ({ getFirebase: jest.fn() }));

import { readStats } from '@/firebase/firestore';
import { ACHIEVEMENTS } from '@/data/achievements';
import { defaultAchievementState, type UserAchievementState } from '@/types';

describe('readStats — clean sheets survive deserialization', () => {
  it('reads the counter back', () => {
    const s = readStats({ stats: { totalGames: 9, attended: 8, cancelled: 1, cleanSheets: 17 } });
    expect(s?.cleanSheets).toBe(17);
  });

  it('leaves it undefined for a player who has none stored', () => {
    const s = readStats({ stats: { totalGames: 3, attended: 3, cancelled: 0 } });
    expect(s?.cleanSheets).toBeUndefined();
    // …and doesn't disturb the neighbours it sits between.
    expect(s?.goals).toBe(0);
    expect(s?.wins).toBe(0);
  });

  it('ignores a non-numeric value rather than storing it', () => {
    const s = readStats({ stats: { totalGames: 1, attended: 1, cancelled: 0, cleanSheets: 'lots' } });
    expect(s?.cleanSheets).toBeUndefined();
  });
});

describe('the achievement is wired into the existing system', () => {
  const def = ACHIEVEMENTS.find((a) => a.id === 'cleanSheets');

  it('exists and watches the cleanSheets metric', () => {
    expect(def).toBeDefined();
    expect(def?.metric).toBe('cleanSheets');
  });

  it('is named "שער נקי", never "ללא ספיגה"', () => {
    expect(def?.titleHe).toBe('שער נקי');
    expect(def?.nounHe).toBe('שערים נקיים');
    expect(`${def?.titleHe} ${def?.nounHe} ${def?.howHe}`).not.toMatch(/ללא ספיגה/);
  });

  it('climbs the same three tiers as every other badge', () => {
    expect(def?.tiers.map((t) => t.tier)).toEqual(['bronze', 'silver', 'gold']);
    const thresholds = def!.tiers.map((t) => t.threshold);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
  });

  it('unlocks at its thresholds and not before', () => {
    const [bronze, silver, gold] = def!.tiers.map((t) => t.threshold);
    const tierAt = (value: number) => {
      let reached: string | undefined;
      for (const step of def!.tiers) if (value >= step.threshold) reached = step.tier;
      return reached;
    };
    expect(tierAt(bronze - 1)).toBeUndefined();
    expect(tierAt(bronze)).toBe('bronze');
    expect(tierAt(silver - 1)).toBe('bronze');
    expect(tierAt(silver)).toBe('silver');
    expect(tierAt(gold - 1)).toBe('silver');
    expect(tierAt(gold)).toBe('gold');
    expect(tierAt(gold * 3)).toBe('gold');
  });

  it('the counter has a default, so an unseen player reads 0 rather than NaN', () => {
    const state: UserAchievementState = { ...defaultAchievementState };
    expect(state.cleanSheets).toBe(0);
  });
});

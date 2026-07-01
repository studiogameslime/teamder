// Decimal rating scale (0.5–5.0) + team colour naming.

// rotationView → '@/theme' imports react-native (only `Appearance`, unused).
// Stub it so the colour helpers can be imported under jest/node.
jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });

import {
  RATING_MIN,
  RATING_MAX,
  RATING_NEUTRAL,
  formatRating,
  isRated,
  snapRating,
} from '@/utils/rating';

describe('rating scale', () => {
  it('formats one decimal; unrated → em dash', () => {
    expect(formatRating(4.3)).toBe('4.3');
    expect(formatRating(5)).toBe('5.0');
    expect(formatRating(0.5)).toBe('0.5');
    expect(formatRating(0)).toBe('—');
    expect(formatRating(undefined)).toBe('—');
    expect(formatRating(null)).toBe('—');
  });

  it('isRated treats 0/undefined as unrated', () => {
    expect(isRated(0)).toBe(false);
    expect(isRated(undefined)).toBe(false);
    expect(isRated(0.5)).toBe(true);
    expect(isRated(3.2)).toBe(true);
  });

  it('snaps to the 0.1 grid and clamps to [0, 5]', () => {
    expect(snapRating(4.27)).toBe(4.3);
    expect(snapRating(4.24)).toBe(4.2);
    expect(snapRating(7)).toBe(RATING_MAX); // 5
    expect(snapRating(0.1)).toBe(0.1); // a valid low rating now (min is 0)
    expect(snapRating(-3)).toBe(RATING_MIN); // 0
  });

  it('neutral middle is the centre of 1–5', () => {
    expect(RATING_NEUTRAL).toBe(3);
  });
});

describe('team colour naming', () => {
  // rotationView pulls in '@/theme' (a plain palette object) — safe in node.
  const { teamName, teamColor, TEAM_PALETTE, teamPaletteEntry } =
    require('@/components/match/rotationView');

  it('a chosen colour names the team in plural + tints it', () => {
    const teams = [{ index: 0, colorKey: 'red' }, { index: 1, colorKey: 'black' }];
    expect(teamName(0, teams)).toBe('האדומים');
    expect(teamName(1, teams)).toBe('השחורים');
    expect(teamColor(0, teams)).toBe('#EF4444');
  });

  it('falls back to the default name/colour when no colour chosen', () => {
    expect(teamName(0)).toBe('קבוצה אדומה');
    expect(teamName(0, [{ index: 0 }])).toBe('קבוצה אדומה');
    // a real colour is returned for the default index too
    expect(typeof teamColor(0)).toBe('string');
  });

  it('palette has a plural for every colour', () => {
    for (const c of TEAM_PALETTE) {
      expect(c.plural.startsWith('ה')).toBe(true);
      expect(teamPaletteEntry(c.key)).toEqual(c);
    }
  });
});

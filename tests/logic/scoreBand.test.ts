// The evening score decides the card's colour AND whether the headline is
// allowed to praise. Both shipped wrong first: a 6.9 was crowned
// "רצת בלי לעצור" on the same gold tint a 9.4 gets.

import { pickEveningTitle, scoreBand } from '@/utils/eveningNarrative';
import type { NarrativeStats } from '@/utils/eveningNarrative';

const stats = (over: Partial<NarrativeStats> = {}): NarrativeStats => ({
  goals: 0,
  assists: 0,
  wins: 2,
  losses: 4,
  gamesPlayed: 6,
  totalRounds: 11,
  heldPitch: 0,
  scoringStreak: 0,
  bestMiniGame: null,
  pen: { scored: 0, saved: 0, missed: 0, conceded: 0 },
  ...over,
});

describe('the colour band', () => {
  it('splits exactly where the owner asked', () => {
    expect(scoreBand(6.0)).toBe('low');
    expect(scoreBand(6.9)).toBe('low');
    expect(scoreBand(7.0)).toBe('mid');
    expect(scoreBand(7.9)).toBe('mid');
    expect(scoreBand(8.0)).toBe('good');
    expect(scoreBand(8.9)).toBe('good');
    expect(scoreBand(9.0)).toBe('great');
    expect(scoreBand(10)).toBe('great');
  });

  it('treats a very poor evening like the rest of the low band', () => {
    expect(scoreBand(3.1)).toBe('low');
    expect(scoreBand(0)).toBe('low');
  });
});

describe('the headline knows what the score was', () => {
  it('does not praise a middling evening', () => {
    // The exact case reported: six mini-games played, 6.9 score. The stats
    // rule fired "רצת בלי לעצור" without ever looking at the result.
    const { title } = pickEveningTitle(stats({ gamesPlayed: 6 }), 'g:me', 6.9);
    expect(title).not.toBe('רצת בלי לעצור');
    expect(['ערב פושר', 'היה אפשר יותר', 'לא הלך הערב']).toContain(title);
  });

  it('still celebrates when the score earns it', () => {
    const { title } = pickEveningTitle(stats({ goals: 3 }), 'g:me', 9.1);
    expect(['ערב שלא שוכחים', 'הכל נכנס לך הערב', 'היית בכל מקום']).toContain(title);
  });

  it('is neutral, not negative, in the middle band', () => {
    const { title } = pickEveningTitle(stats(), 'g:me', 7.4);
    expect(['ערב סולידי', 'עשית את שלך', 'נוכחות טובה']).toContain(title);
  });

  it('softens rather than mocks at the very bottom', () => {
    const { title } = pickEveningTitle(stats(), 'g:me', 3.2);
    expect(['ערב קשה', 'יש ימים כאלה', 'בשבוע הבא מתקנים']).toContain(title);
  });

  it('keeps the old behaviour when no score is supplied', () => {
    // Callers that never pass a score (and the mock) must not change.
    const { title } = pickEveningTitle(stats({ gamesPlayed: 6 }), 'g:me');
    expect(['רצת בלי לעצור', 'נתת הכל הערב', 'לא ויתרת רגע']).toContain(title);
  });
});

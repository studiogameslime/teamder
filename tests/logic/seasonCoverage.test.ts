import { readSeasonCoverage } from '@/utils/seasonCoverage';
import { he } from '@/i18n/he';

// Coverage on a title, and the backward compatibility that matters more.
//
// `coverage` says how much of a season a RATING was really built from. Every
// season closed before 20.09.2026 has winners with no such field, and those
// must keep rendering exactly as they do now — the note is an addition, never
// a requirement.
//
// The reader is deliberately strict, because a half-written coverage is worse
// than none: the sentence it produces reads as fact.

describe('a title WITH coverage', () => {
  it('carries the pair through', () => {
    expect(readSeasonCoverage({ key: 'mvp', value: 7.656, coverage: { rated: 9, of: 22 } }))
      .toEqual({ rated: 9, of: 22 });
  });

  it('including a rating that covers a single evening', () => {
    expect(readSeasonCoverage({ coverage: { rated: 1, of: 22 } })).toEqual({ rated: 1, of: 22 });
  });
});

describe('a title WITHOUT coverage — every season closed before today', () => {
  it('claims nothing, rather than claiming zero', () => {
    expect(readSeasonCoverage({ key: 'topScorer', value: 10 })).toBeUndefined();
    expect(readSeasonCoverage({})).toBeUndefined();
    expect(readSeasonCoverage(null)).toBeUndefined();
    expect(readSeasonCoverage(undefined)).toBeUndefined();
  });
});

describe('a HALF-WRITTEN coverage is dropped, not printed', () => {
  it.each([
    ['only a numerator', { rated: 9 }],
    ['only a denominator', { of: 22 }],
    ['a zero denominator', { rated: 9, of: 0 }],
    ['a zero numerator', { rated: 0, of: 22 }],
    ['a negative', { rated: -1, of: 22 }],
    // The one that would print a lie rather than nothing.
    ['more rated evenings than the season is long', { rated: 30, of: 22 }],
    ['strings instead of numbers', { rated: '9', of: '22' }],
    ['NaN', { rated: NaN, of: 22 }],
    ['not an object at all', 'nine of twenty-two'],
  ])('%s', (_label, coverage) => {
    expect(readSeasonCoverage({ coverage })).toBeUndefined();
  });

  it('and a rating that covers the WHOLE season says nothing either', () => {
    // Not a defect — there is simply no caveat to give. The note exists to
    // warn that the average is short of the season; when it is not, printing
    // "based on 22 of 22" is noise that makes every other season look suspect
    // by omission. closeSeason declines to record it in that case.
    expect(readSeasonCoverage({ coverage: { rated: 22, of: 22 } })).toEqual({ rated: 22, of: 22 });
  });
});

describe('the sentence it produces', () => {
  it('names the numerator and denominator the right way round', () => {
    const t = he.seasonTitleCoverage(9, 22);
    expect(t).toBe('מבוסס על 9 מתוך 22 ערבי העונה שבהם נאספו דירוגים');
    // The trap that would make it a lie: 22 of 9.
    expect(t.indexOf('9')).toBeLessThan(t.indexOf('22'));
  });

  it('never says the rating IS the season average', () => {
    // The whole point. It says which nights were measured, not how long the
    // season was — a reader must not come away thinking 7.66 is the mean of
    // twenty-two evenings.
    const t = he.seasonTitleCoverage(9, 22);
    expect(t).toContain('שבהם נאספו דירוגים');
    expect(t).not.toMatch(/ממוצע/);
  });

  it('and reads correctly for the real Shoshi numbers', () => {
    expect(he.seasonTitleCoverage(9, 22)).toContain('9 מתוך 22');
  });
});

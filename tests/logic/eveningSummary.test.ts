import { eveningScore, pickTitle } from '@/utils/eveningScore';

describe('eveningScore', () => {
  it('never drops below 6 (a tough evening is not a "failure")', () => {
    // Lost every round, no goals — still floors at 6.0.
    expect(eveningScore(0, 0, 0, 7)).toBe(6);
  });

  it('never exceeds 10', () => {
    // Won everything + a hat-trick of goals and assists.
    expect(eveningScore(10, 10, 7, 7)).toBe(10);
  });

  it('is one decimal place', () => {
    const s = eveningScore(1, 1, 3, 7);
    expect(Number.isFinite(s)).toBe(true);
    expect(Math.round(s * 10) / 10).toBe(s);
  });

  it('rewards winning even with zero goals (fair to non-scorers)', () => {
    // A runner/defender who won most rounds but never scored still clears
    // the 6.0 floor meaningfully.
    const runner = eveningScore(0, 0, 6, 7); // ~7.7
    expect(runner).toBeGreaterThan(7);
    expect(runner).toBeLessThanOrEqual(10);
  });

  it('rewards scoring — more goals ⇒ higher score, all else equal', () => {
    expect(eveningScore(3, 0, 3, 7)).toBeGreaterThan(eveningScore(0, 0, 3, 7));
  });

  it('handles a zero-round evening without dividing by zero', () => {
    expect(eveningScore(0, 0, 0, 0)).toBe(6);
  });
});

describe('pickTitle', () => {
  it('crowns a scorer "ערב של חלוץ"', () => {
    expect(pickTitle(3, 0, 0.5, 7).title).toBe('ערב של חלוץ');
  });
  it('crowns a playmaker "מפעל הבישולים"', () => {
    expect(pickTitle(0, 3, 0.5, 7).title).toBe('מפעל הבישולים');
  });
  it('gives a non-scorer who played a lot a fair title (not empty)', () => {
    const t = pickTitle(0, 0, 0.2, 7);
    expect(t.title).toBe('עבד קשה');
    expect(t.emoji).toBeTruthy();
  });
});

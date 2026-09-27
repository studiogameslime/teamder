// A season may not be CLOSED under the floor — through any of its doors.
//
// The rule already held at two of them: `endSeasonNow` refuses to seal a
// season that has played fewer than MIN_SEASON_ROUNDS evenings, and the target
// picker refuses to set one that would end sooner. The third door was open.
//
// Switching seasons ON offers "לסגור ולהתחיל חדשה", and on a club with nothing
// behind it that sealed an empty season 1: an archive holding zero evenings,
// nine `null` titles decided over an empty table, `count: 1`, and a club that
// permanently reports a closed season it never played. An archive is written
// once and never recomputed, so there is no fixing it afterwards.
//
// Reported by the owner: "אני יוצר מועדון ללא עונות, אין עדיין בכלל מחזורים
// ששוחקו… זה יוצר מצב שאני סוגר עונה עם 0 מחזורים."

import { planActivation, MIN_SEASON_ROUNDS } from '@/utils/seasonActivation';

const base = {
  cadence: 'date' as const,
  months: 6,
  today: '2026-09-27' as const,
};

describe('sealing on enable', () => {
  it('is refused with nothing played — the reported case', () => {
    const plan = planActivation({ ...base, choice: 'sealNow', playedHistory: 0 });
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('sealTooFewRounds');
  });

  it('is refused one evening short of the floor', () => {
    const plan = planActivation({
      ...base,
      choice: 'sealNow',
      playedHistory: MIN_SEASON_ROUNDS - 1,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('sealTooFewRounds');
  });

  it('is allowed exactly AT the floor', () => {
    const plan = planActivation({
      ...base,
      choice: 'sealNow',
      playedHistory: MIN_SEASON_ROUNDS,
    });
    expect(plan.ok).toBe(true);
    expect(plan.sealsSeason1).toBe(true);
  });

  it('applies under a rounds cadence too, not only dates', () => {
    const plan = planActivation({
      cadence: 'rounds',
      targetRounds: 10,
      choice: 'sealNow',
      playedHistory: 0,
      today: '2026-09-27',
    });
    expect(plan.error).toBe('sealTooFewRounds');
  });

  it('refuses the SEAL before complaining about the cadence', () => {
    // The admin is being told about the choice they just made, not about a
    // month count they have not reached yet.
    const plan = planActivation({
      cadence: 'date',
      months: 0 as unknown as number,
      choice: 'sealNow',
      playedHistory: 0,
      today: '2026-09-27',
    });
    expect(plan.error).toBe('sealTooFewRounds');
  });
});

describe('carrying the history on', () => {
  it('is still allowed with nothing played — that is the whole point of it', () => {
    // This is the way forward the refusal above points at: start counting from
    // today instead of archiving an empty record. Breaking it would leave a
    // brand-new club unable to switch seasons on at all.
    const plan = planActivation({
      ...base,
      choice: 'continue',
      playedHistory: 0,
      season1EndsOn: '2027-03-27',
    });
    expect(plan.ok).toBe(true);
    expect(plan.sealsSeason1).toBe(false);
  });
});

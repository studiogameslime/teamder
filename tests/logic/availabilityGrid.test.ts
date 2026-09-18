import { readAvailabilityForTest } from '@/firebase/firestore';

/**
 * The per-day grid is the whole point of the availability screen — "Tuesday
 * evenings and Friday mornings" — and the server prefers it over the coarse
 * `preferredDays × preferredTimes` cross-product, which would also say Friday
 * evenings.
 *
 * It was written nowhere and read nowhere. The screen collected it, derived the
 * coarse values from it, saved those, and on reopening rebuilt the grid from
 * them — so the distinction the user drew was lost on every save, and the
 * server's grid branch could not fire for anybody.
 */
describe('the availability grid survives a round trip', () => {
  it('reads the days and buckets that were stored', () => {
    const a = readAvailabilityForTest({
      availability: {
        preferredDays: [2, 5],
        availabilitySlots: { '2': ['evening'], '5': ['morning'] },
      },
    });
    expect(a?.availabilitySlots).toEqual({ 2: ['evening'], 5: ['morning'] });
  });

  it('drops a day outside the week and an empty one', () => {
    const a = readAvailabilityForTest({
      availability: {
        preferredDays: [1],
        availabilitySlots: { '1': ['evening'], '9': ['evening'], '3': [] },
      },
    });
    expect(a?.availabilitySlots).toEqual({ 1: ['evening'] });
  });

  it('is undefined — not an empty object — when nothing was ticked', () => {
    // The server branches on the grid being PRESENT and non-empty; an empty
    // object here would read as "a grid with nothing in it" and exclude the
    // user from every match rather than falling back to the coarse rule.
    expect(
      readAvailabilityForTest({
        availability: { preferredDays: [1], availabilitySlots: {} },
      })?.availabilitySlots,
    ).toBeUndefined();
    expect(
      readAvailabilityForTest({ availability: { preferredDays: [1] } })
        ?.availabilitySlots,
    ).toBeUndefined();
  });

  it('survives a malformed grid without throwing', () => {
    expect(
      readAvailabilityForTest({
        availability: { preferredDays: [1], availabilitySlots: 'nope' },
      })?.availabilitySlots,
    ).toBeUndefined();
  });
});

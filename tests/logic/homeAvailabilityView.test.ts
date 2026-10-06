/**
 * The home availability panel, as a decision.
 *
 * Two things are pinned here, and they are the two the merged card exists
 * for. First, the ORDER: days are ranked by headcount to choose which three
 * to show, and then drawn in date order — so the recommended day keeps its
 * place in the week instead of sliding to whichever end "best" would put it.
 * The tests walk the recommendation through the right, middle and left slot
 * to prove the position comes from the date and nothing else.
 *
 * Second, the refusal to invent: a week in which nobody is free has a busiest
 * day on paper, and naming it would be a claim that someone is coming.
 */
import { buildAvailabilityView, type EveningDay } from '@/utils/homeAvailabilityView';

const DAY = 24 * 60 * 60 * 1000;
const MON = new Date('2026-10-05T18:00:00+03:00').getTime();

/** Days as the feed hands them over: nearest first. */
const feed = (...counts: number[]): EveningDay[] =>
  counts.map((count, i) => ({
    dateMs: MON + i * DAY,
    count,
    letter: ['ב', 'ג', 'ד', 'ה', 'ו', 'ש', 'א'][i] ?? '',
  }));

/** What the row reads, right to left — first card is the visual RIGHT. */
const order = (days: { letter: string }[]) => days.map((d) => d.letter);

describe('which days are shown, and where', () => {
  it('draws the three in DATE order, not in rank order', () => {
    // Wednesday is busiest, Monday is nearest. Ranked: ד, ב, ג.
    // Drawn: ב, ג, ד — the week, as a week.
    const v = buildAvailabilityView(feed(59, 55, 62));
    expect(order(v.days)).toEqual(['ב', 'ג', 'ד']);
    expect(v.recommended?.letter).toBe('ד');
  });

  it('the recommendation sits on the LEFT when it is the latest day', () => {
    const v = buildAvailabilityView(feed(59, 55, 62));
    expect(order(v.days)).toEqual(['ב', 'ג', 'ד']);
    expect(v.days[2].best).toBe(true);
  });

  it('…in the MIDDLE when it is the middle day', () => {
    const v = buildAvailabilityView(feed(59, 62, 55));
    expect(order(v.days)).toEqual(['ב', 'ג', 'ד']);
    expect(v.days[1].best).toBe(true);
    expect(v.recommended?.letter).toBe('ג');
  });

  it('…and on the RIGHT when it is the nearest day', () => {
    // The case that would break if "best" were allowed to reorder: the
    // busiest day is already first, and must simply stay there.
    const v = buildAvailabilityView(feed(62, 59, 55));
    expect(order(v.days)).toEqual(['ב', 'ג', 'ד']);
    expect(v.days[0].best).toBe(true);
  });

  it('marks exactly ONE day as the recommendation', () => {
    // The duplication this card replaced was one fact told twice. Two stars
    // would be the same bug in a smaller space.
    const v = buildAvailabilityView(feed(62, 62, 62));
    expect(v.days.filter((d) => d.best)).toHaveLength(1);
  });

  it('a tie on headcount is broken by the ranking, not by the date', () => {
    // Three equal days: `sort` keeps the feed's order, so the nearest wins
    // the recommendation — and it is the NEAREST that gets the badge, not
    // simply the first card drawn.
    const v = buildAvailabilityView(feed(40, 40, 40));
    expect(v.recommended?.dateMs).toBe(MON);
    expect(v.days[0].best).toBe(true);
  });
});

describe('how many days there are', () => {
  it('one day with availability → one card', () => {
    const v = buildAvailabilityView(feed(12));
    expect(v.days).toHaveLength(1);
    expect(v.days[0].best).toBe(true);
    expect(v.maxCount).toBe(12);
  });

  it('two days → two cards, still in date order', () => {
    const v = buildAvailabilityView(feed(9, 20));
    expect(order(v.days)).toEqual(['ב', 'ג']);
    expect(v.days[1].best).toBe(true);
  });

  it('more than three → the three busiest, drawn in date order', () => {
    // Counts: ב=10 ג=70 ד=20 ה=80 ו=60. Top three are ה, ג, ו.
    const v = buildAvailabilityView(feed(10, 70, 20, 80, 60));
    expect(order(v.days)).toEqual(['ג', 'ה', 'ו']);
    expect(v.recommended?.letter).toBe('ה');
    expect(v.days[1].best).toBe(true);
  });

  it('looks only at the nearest five days', () => {
    // A packed evening a week out must not outrank a good one this week:
    // the sixth day is dropped before ranking even starts.
    const v = buildAvailabilityView(feed(10, 11, 12, 13, 14, 999));
    expect(v.recommended?.count).toBe(14);
    expect(v.days.some((d) => d.count === 999)).toBe(false);
  });
});

describe('what it refuses to claim', () => {
  it('nobody free all week → no recommendation and no cards', () => {
    const v = buildAvailabilityView(feed(0, 0, 0));
    expect(v.recommended).toBeNull();
    expect(v.days).toEqual([]);
    expect(v.maxCount).toBe(0);
  });

  it('no days at all → the same', () => {
    const v = buildAvailabilityView([]);
    expect(v.recommended).toBeNull();
    expect(v.days).toEqual([]);
  });

  it('a zero day riding along with real ones is still drawn', () => {
    // It is information: "Tuesday, nobody". What it must not be is the
    // recommendation.
    const v = buildAvailabilityView(feed(30, 0, 10));
    expect(order(v.days)).toEqual(['ב', 'ג', 'ד']);
    expect(v.days[1].count).toBe(0);
    expect(v.days[1].best).toBe(false);
    expect(v.recommended?.letter).toBe('ב');
  });

  it('the recommendation is always one of the cards on screen', () => {
    // The panel names a day and then draws the week; if the named day were
    // not among the cards the reader would be hunting for it.
    const v = buildAvailabilityView(feed(10, 70, 20, 80, 60));
    expect(v.days.map((d) => d.dateMs)).toContain(v.recommended!.dateMs);
  });
});

describe('the bar denominator', () => {
  it('is the busiest of the days actually drawn', () => {
    const v = buildAvailabilityView(feed(59, 55, 62));
    expect(v.maxCount).toBe(62);
  });

  it('never leaves the input array it was handed reordered', () => {
    // The screen reuses `eveningDays` elsewhere; a sort in place would
    // quietly change what those callers see.
    const input = feed(59, 55, 62);
    const before = input.map((d) => d.dateMs);
    buildAvailabilityView(input);
    expect(input.map((d) => d.dateMs)).toEqual(before);
  });
});

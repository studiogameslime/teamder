/**
 * The layer that turns facts into sentences.
 *
 * Two things it must never do: claim a record was broken when it was equalled,
 * and print a raw user id at somebody. Both are cases where a line that is
 * merely ugly becomes a line that is wrong.
 */
import { summaryLines } from '@/utils/roundSummaryLines';
import type { SummaryEvent } from '@/utils/roundSummary';

const NAMES: Record<string, string> = { a: 'מתן', b: 'חיים', c: 'אלירן' };
const nameOf = (u: string) => NAMES[u] ?? null;

it('distinguishes beating a record from equalling it', () => {
  const beat: SummaryEvent = { type: 'club_record', metric: 'goals', userIds: ['a'], value: 6, previousValue: 5, tied: false };
  const tied: SummaryEvent = { type: 'club_record', metric: 'goals', userIds: ['a'], value: 5, previousValue: 5, tied: true };
  expect(summaryLines([beat], nameOf)[0].text).toContain('שיא מועדון חדש');
  expect(summaryLines([tied], nameOf)[0].text).toContain('השוואת שיא מועדון');
  expect(summaryLines([tied], nameOf)[0].text).not.toContain('חדש');
});

it('names every joint holder rather than picking one', () => {
  const e: SummaryEvent = { type: 'club_record', metric: 'goals', userIds: ['a', 'b'], value: 5, previousValue: 4, tied: false };
  const text = summaryLines([e], nameOf)[0].text;
  expect(text).toContain('מתן');
  expect(text).toContain('חיים');
});

it('drops a line it cannot name rather than printing an id', () => {
  const e: SummaryEvent = { type: 'player_milestone', metric: 'goals', userIds: ['unknown'], threshold: 100, total: 101 };
  expect(summaryLines([e], nameOf)).toHaveLength(0);
});

it('keeps the order the core ranked them in', () => {
  const events: SummaryEvent[] = [
    { type: 'club_record', metric: 'goals', userIds: ['a'], value: 6, previousValue: 5, tied: false },
    { type: 'rank_first_place', userIds: ['b'] },
  ];
  const out = summaryLines(events, nameOf);
  expect(out[0].text).toContain('שיא מועדון');
  expect(out[1].text).toContain('מקום ראשון');
});

it('needs two named players before it calls the top a race', () => {
  const e: SummaryEvent = {
    type: 'rank_tight_top',
    entries: [{ userId: 'a', score: 82 }, { userId: 'ghost', score: 81 }],
  };
  expect(summaryLines([e], nameOf)).toHaveLength(0);
});

it('writes every line without guessing anyone’s gender', () => {
  const events: SummaryEvent[] = [
    { type: 'club_record', metric: 'goals', userIds: ['a'], value: 6, previousValue: 5, tied: false },
    { type: 'personal_record', metric: 'assists', userIds: ['b'], value: 4, previousValue: 2, tied: false },
    { type: 'player_milestone', metric: 'goals', userIds: ['c'], threshold: 100, total: 101 },
    { type: 'rank_jump', userIds: ['a'], from: 9, to: 5 },
    { type: 'rank_first_place', userIds: ['b'] },
  ];
  // Hebrew verbs carry gender; these lines are nominal, so they carry none.
  // Matched as whole words — "למעלה" ends in the letters of "עלה" without
  // being it, and a substring test would fail a line that is perfectly fine.
  const GENDERED = /(^|[\s·—])(הגיע|כבש|טיפס|שבר|עלה|ניצח)([\s·—,.]|$)/;
  for (const l of summaryLines(events, nameOf)) {
    expect(l.text).not.toMatch(GENDERED);
  }
});

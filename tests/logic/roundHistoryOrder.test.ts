/**
 * "משחק 1, משחק 2, משחק 3" — and never the other way round.
 *
 * The list is numbered by position, so reversing it renumbers every card.
 * That is tolerable on a finished evening nobody is watching; it is not
 * tolerable on the list opened from the live screen, where a round ends
 * while someone is reading it. These tests pin the order, and the two
 * behaviours that decide which games are on the list at all.
 */
import { sortRounds, compareRounds } from '@/utils/roundHistoryOrder';

const r = (at: number, roundId: string) => ({ at, roundId });

describe('the order mini-games are shown in', () => {
  it('is the order they were played in — oldest first', () => {
    const out = sortRounds([r(300, '3'), r(100, '1'), r(200, '2')]);
    expect(out.map((x) => x.roundId)).toEqual(['1', '2', '3']);
  });

  it('a round that ends now goes to the BOTTOM, not the top', () => {
    // The whole point: a fifth mini-game committed while the screen is open
    // must not push 1–4 down and renumber them.
    const existing = [r(100, '1'), r(200, '2'), r(300, '3'), r(400, '4')];
    const out = sortRounds([...existing, r(500, '5')]);
    expect(out.map((x) => x.roundId)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('falls back to the round number when commit times tie', () => {
    // Two rounds committed in the same millisecond — the id is the only
    // other thing carrying the order.
    const out = sortRounds([r(100, '2'), r(100, '1')]);
    expect(out.map((x) => x.roundId)).toEqual(['1', '2']);
  });

  it('orders legacy documents with no timestamp by their number', () => {
    const out = sortRounds([r(0, '3'), r(0, '1'), r(0, '2')]);
    expect(out.map((x) => x.roundId)).toEqual(['1', '2', '3']);
  });

  it('leaves a non-numeric id where it is rather than flinging it to an end', () => {
    // NaN comparisons are the classic way a sort silently scrambles a list.
    expect(compareRounds(r(0, 'abc'), r(0, '2'))).toBe(0);
    expect(compareRounds(r(0, '2'), r(0, 'abc'))).toBe(0);
  });

  it('does not mutate what it was given', () => {
    const input = [r(300, '3'), r(100, '1')];
    const copy = [...input];
    sortRounds(input);
    expect(input).toEqual(copy);
  });

  it('is stable for an already-ordered list', () => {
    const input = [r(100, '1'), r(200, '2'), r(300, '3')];
    expect(sortRounds(input).map((x) => x.roundId)).toEqual(['1', '2', '3']);
  });
});

describe('which mini-games reach the list at all', () => {
  // These are not filters in the UI — they are a property of the SOURCE.
  // `roundHistory` is written by `commitRoundStats` and by nothing else, so
  // a document exists only once the admin has ended that mini-game. The
  // running round and any future one are simply not in the collection, and
  // the screen does no filtering of its own. These cases document that
  // contract so a future filter is not added on top of it by mistake.
  it('an empty collection means nothing has been committed yet', () => {
    expect(sortRounds([])).toEqual([]);
  });

  it('a single committed round is the whole list', () => {
    expect(sortRounds([r(100, '1')]).map((x) => x.roundId)).toEqual(['1']);
  });
});

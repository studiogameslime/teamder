import { winsPlaceIsFactual } from '@/utils/assistant/winsPlace';

/**
 * "אתה השחקן עם הכי הרבה ניצחונות במועדון 🏆" is a definite claim about one
 * person. The rule that renders it sees only a place, so every fact-check has
 * to happen where the numbers are — which is why this is tested here and not
 * through the rule.
 *
 * The hole it closes: `byWins` sorts `b.wins - a.wins || a.uid.localeCompare(b.uid)`,
 * so in a club where nobody has ever recorded a win the podium is the alphabet.
 * Seven of the twelve clubs in production with any stat rows are in exactly
 * that state — `wins` is written only by the mini-game commit path, and the
 * common club runs the plain live timer.
 */
const rows = (...wins: number[]) => wins.map((w) => ({ wins: w }));

describe('winsPlaceIsFactual', () => {
  it('says nothing in a club where nobody has ever won', () => {
    const table = rows(0, 0, 0, 0, 0);
    expect(winsPlaceIsFactual(table, 0, 0)).toBe(false);
    expect(winsPlaceIsFactual(table, 0, 2)).toBe(false);
  });

  it('and nothing to a player who has not won, however high the leader is', () => {
    expect(winsPlaceIsFactual(rows(14, 9, 0), 0, 2)).toBe(false);
  });

  it('nor when the whole table is below the threshold the crown uses', () => {
    // A club two evenings old has a leader on 2. "The player with the most
    // wins" is true and meaningless.
    expect(winsPlaceIsFactual(rows(2, 1, 1), 2, 0)).toBe(false);
  });

  it('refuses a place shared with anybody, at any rank', () => {
    // Two players on 11: neither is "the one with the most wins", and neither
    // is third either — the copy is a claim about one person.
    expect(winsPlaceIsFactual(rows(11, 11, 4), 11, 0)).toBe(false);
    expect(winsPlaceIsFactual(rows(14, 6, 6), 6, 1)).toBe(false);
  });

  it('and states it when it is genuinely true', () => {
    expect(winsPlaceIsFactual(rows(14, 9, 4), 14, 0)).toBe(true);
    expect(winsPlaceIsFactual(rows(14, 9, 4), 4, 2)).toBe(true);
  });

  it('a player outside the table is not ranked at all', () => {
    expect(winsPlaceIsFactual(rows(14, 9, 4), 0, -1)).toBe(false);
  });
});

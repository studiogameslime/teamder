/**
 * A cadence must not carry the other kind's leftovers.
 *
 * The seasons block is written with merge:true, and a merge into a nested map
 * merges field BY FIELD — so omitting a field leaves whatever the previous
 * cadence put there. Seen in production: an admin on a rounds season tried a
 * date cadence, switched back, and the stored cadence kept `months: 3` and a
 * stale `endsAt` from the experiment.
 *
 * Nothing reads them today, because every reader branches on `type` first.
 * That is precisely why this needs a guard rather than a shrug: the day
 * something reads `endsAt` without checking `type`, a rounds season quietly
 * closes on a date nobody chose.
 *
 * A source-level test, because the failure is a Firestore merge and there is no
 * way to unit-test one from here — but there IS a way to stop the two writers
 * from drifting apart again.
 *
 * It used to find those writers with `/(?:cadence|next) = \{[\s\S]*?\n {4,6}\};/`
 * over index.ts alone: a literal indented one level deeper, written on one
 * line, or living in any other backend file was not found at all — and a guard
 * that finds nothing asserts nothing while reporting four green tests. Braces
 * are matched now, and the scan is the whole backend.
 */
import { objectLiterals } from '../fixtures/serverSource';

/**
 * Every `cadence = { … }` / `next = { … }` literal the backend builds.
 *
 * Narrowed to the ones that are actually a cadence — a literal naming any of
 * the three finish-line fields. `next` is also the name the recurring-game
 * clone gives its copy of a game, and that one is not a cadence. Deliberately
 * NOT narrowed by `type:`, because a cadence literal that forgot to say which
 * kind it is has to end up in this list to be caught.
 */
const cadenceLiterals = objectLiterals(
  /(?:cadence|next)\s*(?::[^=\n]*)?=\s*\{/,
).filter((c) => /(targetRounds|endsOn|months):/.test(c.body));

describe('every cadence written to Firestore', () => {
  it('there are four of them — two per writer, and this test knows about all four', () => {
    // A fifth writer is a fifth chance to forget. Named, so the failure says
    // WHICH file grew one rather than only that the count moved.
    expect(cadenceLiterals.map((c) => c.where)).toHaveLength(4);
  });

  it('a rounds cadence explicitly clears the date fields', () => {
    const rounds = cadenceLiterals.filter((c) => /type: 'rounds'/.test(c.body));
    expect(rounds.length).toBe(2);
    for (const c of rounds) {
      expect(`${c.where} ${c.body}`).toMatch(/months: null/);
      expect(`${c.where} ${c.body}`).toMatch(/endsAt: null/);
      expect(`${c.where} ${c.body}`).toMatch(/endsOn: null/);
    }
  });

  it('a date cadence explicitly clears the rounds field', () => {
    const dated = cadenceLiterals.filter((c) => /type: 'date'/.test(c.body));
    expect(dated.length).toBe(2);
    for (const c of dated) {
      expect(`${c.where} ${c.body}`).toMatch(/targetRounds: null/);
    }
  });

  it('a date cadence carries a calendar end, not only an epoch', () => {
    // The epoch stays for backward compatibility; the calendar date is what
    // makes the rollover land on the club's midnight rather than on UTC's.
    for (const c of cadenceLiterals.filter((x) => /type: 'date'/.test(x.body))) {
      expect(`${c.where} ${c.body}`).toMatch(/endsOn:/);
    }
  });

  it('and every one of them says which kind it is', () => {
    // A cadence with no `type` is read as neither by `seasonFinishLine`, which
    // means a season that can never close.
    for (const c of cadenceLiterals) {
      expect(`${c.where} ${c.body}`).toMatch(/type: '(rounds|date)'/);
    }
  });
});

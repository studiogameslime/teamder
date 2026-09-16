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
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'functions/src/index.ts'),
  'utf8',
);

/** Both callables that write a cadence, by the shape they build it with. */
const cadenceLiterals = SRC.match(/(?:cadence|next) = \{[\s\S]*?\n {4,6}\};/g) ?? [];

describe('every cadence written to Firestore', () => {
  it('there are four of them — two per writer, and this test knows about all four', () => {
    // A fifth writer is a fifth chance to forget.
    expect(cadenceLiterals.length).toBe(4);
  });

  it('a rounds cadence explicitly clears the date fields', () => {
    const rounds = cadenceLiterals.filter((c) => /type: 'rounds'/.test(c));
    expect(rounds.length).toBe(2);
    for (const c of rounds) {
      expect(c).toMatch(/months: null/);
      expect(c).toMatch(/endsAt: null/);
      expect(c).toMatch(/endsOn: null/);
    }
  });

  it('a date cadence explicitly clears the rounds field', () => {
    const dated = cadenceLiterals.filter((c) => /type: 'date'/.test(c));
    expect(dated.length).toBe(2);
    for (const c of dated) {
      expect(c).toMatch(/targetRounds: null/);
    }
  });

  it('a date cadence carries a calendar end, not only an epoch', () => {
    // The epoch stays for backward compatibility; the calendar date is what
    // makes the rollover land on the club's midnight rather than on UTC's.
    for (const c of cadenceLiterals.filter((x) => /type: 'date'/.test(x))) {
      expect(c).toMatch(/endsOn:/);
    }
  });
});

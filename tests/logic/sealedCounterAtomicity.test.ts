/**
 * The evening counter must be an INCREMENT, not a read-plus-one.
 *
 * `clubRecords.eveningsSealed` is what a season's progress is measured against
 * and what the title-eligibility threshold divides. It was written as
 * `eveningsSealed + 1` from a value read at the top of sealRoundSummary — a
 * read-modify-write with nothing guarding it.
 *
 * Reproduced against the deployed backend on the QA club: three evenings
 * sealed within a minute of each other left three round summaries and a
 * counter of two. One evening simply vanished from the club's history, and a
 * rounds-based season would have run one evening long for ever after.
 *
 * A source-level guard, in the spirit of tests/hooksAfterEarlyReturn.ts: there
 * is no way to unit-test a Firestore race from here, but there IS a way to
 * make sure nobody rewrites the fix as an absolute assignment again.
 *
 * Over the WHOLE backend, not over index.ts alone. The rule is "nothing
 * anywhere writes these two counters as an absolute value", and the version
 * that shipped read one file — so the same write in seasonRollover.ts, or in a
 * file created tomorrow, passed it in silence. Both counters are already
 * mentioned by name in four other server files.
 */
import { codeLines, serverFiles } from '../fixtures/serverSource';

/** Both counters, and what a caller must never do to them. */
const COUNTERS = ['eveningsSealed', 'playedRounds'] as const;

describe('the two evening counters', () => {
  it.each(COUNTERS)('%s is never written as an absolute value', (field) => {
    // `<field>: <anything> + 1` is the shape that lost an evening. Comments
    // are excluded, or the note explaining the fix would trip its own guard.
    const absolute = new RegExp(
      `${field}:\\s*(?!admin\\.firestore\\.FieldValue\\.increment)[^,\\n]*\\+\\s*1`,
    );
    const offenders = codeLines()
      .filter((l) => absolute.test(l.line))
      .map((l) => `${l.where} — ${l.line.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('and neither is derived from the other', () => {
    // `seasons.playedRounds` is the number the club actually SEES ("2 מתוך 3
    // מחזורים"). Computing it from the same stale read reintroduces the bug on
    // the visible half.
    const offenders = codeLines()
      .filter((l) => /playedRounds:\s*eveningsSealed/.test(l.line))
      .map((l) => l.where);
    expect(offenders).toEqual([]);
  });

  it('the seal increments both atomically', () => {
    const src = serverFiles()
      .map((f) => f.text)
      .join('\n');
    for (const field of COUNTERS) {
      expect(src).toMatch(
        new RegExp(`${field}:\\s*admin\\.firestore\\.FieldValue\\.increment\\(1\\)`),
      );
    }
  });

  it('and the guard is reading the file the seal is actually in', () => {
    // The failure this whole file guards against is a write that moved. So the
    // scan proves it can see the seal before it certifies anything: a guard
    // that reads the wrong file reports a clean run for ever.
    const seen = serverFiles().filter((f) =>
      /eveningsSealed:\s*admin\.firestore\.FieldValue\.increment/.test(f.text),
    );
    expect(seen.length).toBeGreaterThan(0);
  });
});

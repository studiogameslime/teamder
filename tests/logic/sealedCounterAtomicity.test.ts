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
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'functions/src/index.ts'),
  'utf8',
);

describe('sealRoundSummary counters', () => {
  it('never writes eveningsSealed as an absolute value', () => {
    // `eveningsSealed: <anything> + 1` is the shape that lost an evening.
    const absolute =
      /eveningsSealed:\s*(?!admin\.firestore\.FieldValue\.increment)[^,\n]*\+\s*1/;
    expect(SRC).not.toMatch(absolute);
  });

  it('increments it atomically instead', () => {
    expect(SRC).toMatch(
      /eveningsSealed:\s*admin\.firestore\.FieldValue\.increment\(1\)/,
    );
  });

  it('increments the season mirror the same way', () => {
    // `seasons.playedRounds` is the number the club actually SEES ("2 מתוך 3
    // מחזורים"). Computing it from the same stale read reintroduces the bug on
    // the visible half.
    expect(SRC).toMatch(
      /playedRounds:\s*admin\.firestore\.FieldValue\.increment\(1\)/,
    );
    const absolute = /playedRounds:\s*eveningsSealed\s*\+\s*1/;
    expect(SRC).not.toMatch(absolute);
  });
});

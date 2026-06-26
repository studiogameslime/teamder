// wentHomeRestore — locks the invariant behind the "bring a player back after
// their spot was filled" fix (B01): a team's effective on-field roster must
// never exceed perTeam. The bug was that restoring a player who had gone home
// re-added them to their team WITHOUT undoing the loan that had covered their
// spot, leaving the team permanently over-full (6 in a 5-a-side), which then
// corrupted every round's win/pair stats.
//
// restorePlayer itself is I/O-bound (gameService); here we exercise the pure
// rotation-engine math it now relies on — a temporary fill is a loan into the
// home team, and the restore drops one such covering loan.

import { applyChosenFill, rosterOf, type RotationTeam } from '@/services/rotationEngine';
import type { RotationLoan } from '@/types';

const PER = 5;

function startingTeams(): RotationTeam[] {
  return [
    { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4', 'a5'] }, // X = a1 will leave
    { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4', 'b5'] },
    { index: 2, playerIds: ['c1', 'c2'] }, // bench / donor pool
  ];
}

describe('went-home → temporary fill → restore (B01)', () => {
  it('leaves the home team OVER-FULL when the covering loan is not undone (the bug)', () => {
    // a1 goes home → removed from team 0 (now 4).
    let teams = startingTeams().map((t) => ({
      ...t,
      playerIds: t.playerIds.filter((p) => p !== 'a1'),
    }));
    // Borrow c1 from the bench to complete team 0 → a temporary loan.
    const filled = applyChosenFill(teams, [], 0, ['c1'], 'temporary');
    teams = filled.teams;
    const loans: RotationLoan[] = filled.loans;
    expect(rosterOf(0, teams, loans)).toHaveLength(PER); // 4 home + c1 = 5

    // Restore a1 WITHOUT touching the loan (old restorePlayer behaviour).
    const naive = teams.map((t) =>
      t.index === 0 ? { ...t, playerIds: [...t.playerIds, 'a1'] } : t,
    );
    expect(rosterOf(0, naive, loans)).toHaveLength(PER + 1); // 6 — corrupt
  });

  it('returns the team to exactly perTeam when the restore drops the covering loan (the fix)', () => {
    let teams = startingTeams().map((t) => ({
      ...t,
      playerIds: t.playerIds.filter((p) => p !== 'a1'),
    }));
    const filled = applyChosenFill(teams, [], 0, ['c1'], 'temporary');
    teams = filled.teams;
    let loans: RotationLoan[] = filled.loans;

    // restorePlayer: re-add a1 AND drop one loan that filled team 0.
    teams = teams.map((t) =>
      t.index === 0 ? { ...t, playerIds: [...t.playerIds, 'a1'] } : t,
    );
    const coverIdx = loans.findIndex((l) => l.filledTeam === 0);
    expect(coverIdx).toBeGreaterThanOrEqual(0);
    loans = loans.filter((_, i) => i !== coverIdx);

    // a1 back, c1 returned to the bench → exactly 5, never 6.
    expect(rosterOf(0, teams, loans)).toHaveLength(PER);
    expect(rosterOf(0, teams, loans).sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    // c1 is no longer loaned in anywhere.
    expect(loans.some((l) => l.playerId === 'c1')).toBe(false);
  });
});

// Guards that penalty stats flow from the communityPlayerStats rollup docs
// THROUGH rankChampionshipRows — the choke point that used to strip everything
// except goals/assists/rounds/wins/losses/games. If they're dropped here, the
// community penalty kings + the compare card silently read 0.

import { rankChampionshipRows } from '@/utils/championship';
import { penaltyKing, penaltyKeeperKing } from '@/utils/penaltyStats';

describe('rankChampionshipRows — penalty fields survive the mapper', () => {
  it('carries penTaken/penScored/penFaced/penSaved from the raw docs', () => {
    const rows = rankChampionshipRows(
      [
        { userId: 'a', goals: 5, penTaken: 4, penScored: 3, penFaced: 6, penSaved: 2 },
        { userId: 'b', goals: 1, penTaken: 2, penScored: 1, penFaced: 1, penSaved: 0 },
      ],
      'points',
      true,
    );
    const a = rows.find((r) => r.uid === 'a')!;
    expect(a.penTaken).toBe(4);
    expect(a.penScored).toBe(3);
    expect(a.penFaced).toBe(6);
    expect(a.penSaved).toBe(2);
  });

  it('defaults missing penalty fields to 0 (a member with no shootouts)', () => {
    const rows = rankChampionshipRows([{ userId: 'a', goals: 2 }], 'points', true);
    expect(rows[0].penTaken).toBe(0);
    expect(rows[0].penScored).toBe(0);
    expect(rows[0].penFaced).toBe(0);
    expect(rows[0].penSaved).toBe(0);
  });

  it('feeds the community penalty kings correctly (end-to-end derivation)', () => {
    const rows = rankChampionshipRows(
      [
        { userId: 'striker', goals: 10, penScored: 6, penTaken: 8, penSaved: 0, penFaced: 0 },
        { userId: 'keeper', goals: 1, penScored: 1, penTaken: 2, penSaved: 5, penFaced: 9 },
        { userId: 'nobody', goals: 3 },
      ],
      'points',
      true,
    );
    // The screen maps rows → {userId: uid, ...} before calling the derivations.
    const kickers = rows.map((r) => ({ userId: r.uid, penScored: r.penScored, penTaken: r.penTaken }));
    const keepers = rows.map((r) => ({ userId: r.uid, penSaved: r.penSaved, penFaced: r.penFaced }));
    expect(penaltyKing(kickers)?.userId).toBe('striker');
    expect(penaltyKeeperKing(keepers)?.userId).toBe('keeper');
  });
});

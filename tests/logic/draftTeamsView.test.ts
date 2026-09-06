import { resolveSplitTeams, isSplitStale } from '@/utils/draftTeamsView';

const T = (index: number, ids: string[], captainId = ids[0]) => ({
  index,
  captainId,
  playerIds: ids,
});

describe('resolveSplitTeams', () => {
  it('prefers the frozen originalTeams over the live teams array', () => {
    const split = resolveSplitTeams({
      teams: [T(0, ['a', 'b']), T(1, ['c'])],
      originalTeams: [T(0, ['a', 'b']), T(1, ['c', 'd'])],
    });
    expect(split.flatMap((t) => t.playerIds).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to rotation.baseTeams, taking playerIds[0] as captain', () => {
    const split = resolveSplitTeams({ teams: [] }, { baseTeams: [{ index: 0, playerIds: ['x', 'y'] }] });
    expect(split).toEqual([{ index: 0, captainId: 'x', playerIds: ['x', 'y'] }]);
  });

  it('falls back to teams on a legacy game with neither', () => {
    expect(resolveSplitTeams({ teams: [T(0, ['a'])] })).toEqual([
      { index: 0, captainId: 'a', playerIds: ['a'] },
    ]);
  });

  it('sorts by team index', () => {
    const split = resolveSplitTeams({ originalTeams: [T(2, ['c']), T(0, ['a']), T(1, ['b'])] });
    expect(split.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it('returns an empty split when there is no draft at all', () => {
    expect(resolveSplitTeams(null)).toEqual([]);
    expect(resolveSplitTeams(undefined)).toEqual([]);
  });
});

describe('isSplitStale', () => {
  // The reported regression, with the real shape of game 87n2y26N2nsHdMILkKzg:
  // 15 registered, split 5/5/5, two players went home so the LIVE teams array
  // dropped to 4/5/4. Judged against the live array they look like late joiners.
  const original = [T(0, ['p1', 'p2', 'p3', 'p4', 'p5']), T(1, ['p6', 'p7', 'p8', 'p9', 'p10']), T(2, ['p11', 'p12', 'p13', 'p14', 'p15'])];
  const players = Array.from({ length: 15 }, (_, i) => `p${i + 1}`);

  it('does NOT warn when players only went home', () => {
    const live = [T(0, ['p1', 'p2', 'p3', 'p4']), T(1, ['p6', 'p7', 'p8', 'p9', 'p10']), T(2, ['p11', 'p12', 'p13', 'p14'])];
    const split = resolveSplitTeams({ teams: live, originalTeams: original });
    expect(isSplitStale(split, players, true)).toBe(false);
  });

  it('still warns about a genuine late joiner — in neither array', () => {
    const split = resolveSplitTeams({ teams: original, originalTeams: original });
    expect(isSplitStale(split, [...players, 'latecomer'], true)).toBe(true);
  });

  it('never warns when no split has been saved', () => {
    expect(isSplitStale([], players, false)).toBe(false);
  });

  it('treats an absent players array as nothing to warn about', () => {
    expect(isSplitStale(resolveSplitTeams({ originalTeams: original }), undefined, true)).toBe(false);
  });
});

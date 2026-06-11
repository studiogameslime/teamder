import {
  teamLetter,
  teamName,
  buildPickOrder,
  previewPath,
  reconstructPicks,
  TEAM_LETTERS,
  MIN_TEAMS,
  MAX_TEAMS,
} from '@/utils/draft';

describe('team labels', () => {
  it('letters א–ד then numeric fallback', () => {
    expect(teamLetter(0)).toBe('א');
    expect(teamLetter(1)).toBe('ב');
    expect(teamLetter(2)).toBe('ג');
    expect(teamLetter(3)).toBe('ד');
    expect(teamLetter(4)).toBe('5');
    expect(teamLetter(9)).toBe('10');
  });
  it('teamName composes "קבוצה <letter>"', () => {
    expect(teamName(0)).toBe('קבוצה א');
    expect(teamName(3)).toBe('קבוצה ד');
  });
  it('constants', () => {
    expect(MIN_TEAMS).toBe(2);
    expect(MAX_TEAMS).toBe(4);
    expect(TEAM_LETTERS).toEqual(['א', 'ב', 'ג', 'ד']);
  });
});

describe('buildPickOrder', () => {
  it('edge: non-positive teams or picks → empty', () => {
    expect(buildPickOrder(0, 5, 'regular')).toEqual([]);
    expect(buildPickOrder(2, 0, 'snake')).toEqual([]);
    expect(buildPickOrder(-1, 4, 'regular')).toEqual([]);
  });
  it('regular = always forward', () => {
    expect(buildPickOrder(2, 4, 'regular')).toEqual([0, 1, 0, 1]);
    expect(buildPickOrder(3, 6, 'regular')).toEqual([0, 1, 2, 0, 1, 2]);
    expect(buildPickOrder(4, 4, 'regular')).toEqual([0, 1, 2, 3]);
  });
  it('snake = alternating rows', () => {
    expect(buildPickOrder(2, 4, 'snake')).toEqual([0, 1, 1, 0]);
    expect(buildPickOrder(2, 6, 'snake')).toEqual([0, 1, 1, 0, 0, 1]);
    expect(buildPickOrder(3, 6, 'snake')).toEqual([0, 1, 2, 2, 1, 0]);
    expect(buildPickOrder(3, 9, 'snake')).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
  });
  it('truncates to exactly `picks`', () => {
    expect(buildPickOrder(3, 4, 'regular')).toHaveLength(4);
    expect(buildPickOrder(4, 7, 'snake')).toHaveLength(7);
  });
  it('every entry is a valid team index', () => {
    for (const o of buildPickOrder(4, 13, 'snake')) {
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(4);
    }
  });
});

describe('previewPath', () => {
  it('is two full rounds long', () => {
    expect(previewPath(2, 'regular')).toHaveLength(4);
    expect(previewPath(4, 'snake')).toHaveLength(8);
  });
});

describe('reconstructPicks', () => {
  it('round-trips a snake draft back to its pick order', () => {
    // teams: captains c0/c1, members assigned by snake order [0,1,1,0]
    const draft = {
      method: 'snake' as const,
      numTeams: 2,
      createdAt: 0,
      createdBy: 'x',
      teams: [
        { index: 0, captainId: 'c0', playerIds: ['c0', 'p0', 'p3'] },
        { index: 1, captainId: 'c1', playerIds: ['c1', 'p1', 'p2'] },
      ],
    };
    // snake order for 4 picks over 2 teams = [0,1,1,0]:
    //   pick0→team0 (p0), pick1→team1 (p1), pick2→team1 (p2), pick3→team0 (p3)
    expect(reconstructPicks(draft)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
  it('handles uneven team sizes', () => {
    const draft = {
      method: 'regular' as const,
      numTeams: 2,
      createdAt: 0,
      createdBy: 'x',
      teams: [
        { index: 0, captainId: 'c0', playerIds: ['c0', 'a', 'b'] },
        { index: 1, captainId: 'c1', playerIds: ['c1', 'c'] },
      ],
    };
    // regular order [0,1,0,1]; team1 runs out after 'c' → remaining go to team0
    expect(reconstructPicks(draft)).toEqual(['a', 'c', 'b']);
  });
});

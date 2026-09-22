// The archived pairs, and the chemistry the three scopes describe.
//
// The bug this pins: `parseSeasonTable` rebuilds its result field by field,
// and `pairs` was not among the fields. שכחת שושי's season 1 had sealed 21
// pairs — 94 mini-games together, wins, clean sheets, head-to-heads and
// directional assists — and none of it reached the client. So a closed season
// showed no "כימיה במועדון" at all, and all-time had nothing to sum.
//
// Reported by the owner: "למה אין קטגוריה של כימיה במועדון בסטטיסטיקה של
// מועדון שכחת שושי, גם במסך כל הזמנים וגם במסך עונה 1".

import { parseSeasonTable, parsePairs } from '@/utils/seasonArchive';
import { mergePairs, pickChemistry, pairKey, EMPTY_PAIR } from '@/utils/clubChemistry';

const A = 'aaa';
const B = 'bbb';
const C = 'ccc';

/** The archive shape closeSeason writes: pairs as a MAP keyed "<lo>__<hi>". */
const archiveDoc = {
  totals: { goals: 120, rounds: 22 },
  players: {
    [A]: { displayName: 'A', goals: 10, rounds: 20 },
    [B]: { displayName: 'B', goals: 4, rounds: 18 },
    [C]: { displayName: 'C', goals: 1, rounds: 12 },
  },
  pairs: {
    [`${A}__${B}`]: {
      a: A, b: B,
      sameTeam: 40, winsTogether: 25, lossesTogether: 9,
      cleanSheetsTogether: 6, against: 12, winsA: 7, winsB: 5,
      assistsAToB: 8, assistsBToA: 3,
    },
    [`${A}__${C}`]: {
      a: A, b: C,
      sameTeam: 5, winsTogether: 2, lossesTogether: 2,
      cleanSheetsTogether: 0, against: 30, winsA: 18, winsB: 12,
      assistsAToB: 1, assistsBToA: 0,
    },
  },
};

describe('a closed season carries its own chemistry', () => {
  it('parseSeasonTable exposes the pairs at all — the field that went unread', () => {
    const t = parseSeasonTable(archiveDoc);
    expect(Object.keys(t.pairs)).toHaveLength(2);
    expect(t.pairs[pairKey(A, B)].sameTeam).toBe(40);
  });

  it('every one of the nine counters survives the read', () => {
    const p = parseSeasonTable(archiveDoc).pairs[pairKey(A, B)];
    expect(p).toEqual({
      sameTeam: 40, winsTogether: 25, lossesTogether: 9,
      cleanSheetsTogether: 6, against: 12, winsA: 7, winsB: 5,
      assistsAToB: 8, assistsBToA: 3,
    });
    // Nine, not eight: a counter silently dropped here is a card that quietly
    // stops being offered, which is the failure that started this.
    expect(Object.keys(p)).toHaveLength(9);
  });

  it('and they feed pickChemistry — the same function the live section uses', () => {
    const picks = pickChemistry(parseSeasonTable(archiveDoc).pairs);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.map((p) => p.kind)).toContain('regulars');
  });

  it('keys are rebuilt from the members, so an archive merges with live rows', () => {
    // Written under a key that is NOT the sorted one. Trusting the map key
    // would produce a second entry for the same two people and halve both.
    const odd = parsePairs({ 'zzz__yyy': { a: A, b: B, sameTeam: 3 } });
    expect(Object.keys(odd)).toEqual([pairKey(A, B)]);
  });

  it('accepts the array shape too, as topDuo already had to', () => {
    const arr = parsePairs([{ a: A, b: B, sameTeam: 7 }]);
    expect(arr[pairKey(A, B)].sameTeam).toBe(7);
  });

  it('survives an archive with no pairs at all', () => {
    expect(parseSeasonTable({ ...archiveDoc, pairs: undefined }).pairs).toEqual({});
    expect(parsePairs(null)).toEqual({});
    expect(parsePairs('nonsense')).toEqual({});
  });

  it('skips a row missing either member rather than inventing a key', () => {
    expect(parsePairs([{ a: A, sameTeam: 9 }, { b: B, sameTeam: 9 }])).toEqual({});
  });
});

describe('all-time is the live window plus every sealed one', () => {
  it('adds the same pair across seasons instead of taking the newest', () => {
    const season = parseSeasonTable(archiveDoc).pairs;
    const live = { [pairKey(A, B)]: { ...EMPTY_PAIR, sameTeam: 6, winsTogether: 4 } };
    const all = mergePairs(live, season);
    // 6 live + 40 sealed. This is the number that existed nowhere before:
    // the live documents are ZEROED by a season close, so they describe the
    // running season and the archive holds the rest.
    expect(all[pairKey(A, B)].sameTeam).toBe(46);
    expect(all[pairKey(A, B)].winsTogether).toBe(29);
    // A pair that only ever played in the closed season is not lost.
    expect(all[pairKey(A, C)].against).toBe(30);
  });

  it('a pair present in only one side keeps its own totals', () => {
    const all = mergePairs({}, parseSeasonTable(archiveDoc).pairs);
    expect(all[pairKey(A, B)].assistsAToB).toBe(8);
  });
});

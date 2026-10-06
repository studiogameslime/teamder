/**
 * The one place a merged pair screen can silently swap two people.
 *
 * `communityPairStats` stores `winsA` against the lexicographically FIRST uid
 * and `assistsAToB` running from it. Whoever the screen calls "you" has no
 * bearing on that. Read the fields straight and every head-to-head number
 * belongs to the wrong player — with no error, no crash, and no value that
 * looks wrong on its own.
 *
 * So the orientation is tested from BOTH sides of the same document: the same
 * stored row, read once as the first uid and once as the second, must produce
 * mirror images of each other.
 */
import {
  EMPTY_ORIENTED,
  orientPair,
  pairKey,
  winPct,
} from '@/utils/pairOrientation';
import { EMPTY_PAIR, type PairTotals } from '@/utils/clubChemistry';

// 'aaa' sorts before 'zzz', so in every document these two share, `aaa` is the
// one the stored A-fields belong to.
const FIRST = 'aaa-uid';
const SECOND = 'zzz-uid';

const doc = (over: Partial<PairTotals>): PairTotals => ({ ...EMPTY_PAIR, ...over });

describe('the stored key', () => {
  it('is the same whichever order the caller names them', () => {
    expect(pairKey(FIRST, SECOND)).toBe(pairKey(SECOND, FIRST));
    expect(pairKey(FIRST, SECOND)).toBe(`${FIRST}__${SECOND}`);
  });
});

describe('head-to-head wins follow the VIEWER, not the document', () => {
  const row = doc({ against: 10, winsA: 7, winsB: 2 });

  it('reads the A-fields as the viewer when the viewer sorts first', () => {
    const o = orientPair(FIRST, SECOND, row);
    expect(o.winsViewer).toBe(7);
    expect(o.winsOther).toBe(2);
  });

  it('reads the SAME row mirrored when the viewer sorts second', () => {
    const o = orientPair(SECOND, FIRST, row);
    expect(o.winsViewer).toBe(2);
    expect(o.winsOther).toBe(7);
  });

  it('is a true mirror — the two readings swap and nothing else moves', () => {
    const x = orientPair(FIRST, SECOND, row);
    const y = orientPair(SECOND, FIRST, row);
    expect(x.winsViewer).toBe(y.winsOther);
    expect(x.winsOther).toBe(y.winsViewer);
    expect(x.roundsAgainst).toBe(y.roundsAgainst);
    expect(x.tiesAgainst).toBe(y.tiesAgainst);
  });
});

describe('directional assists follow the viewer too', () => {
  const row = doc({ assistsAToB: 6, assistsBToA: 3 });

  it('viewer sorts first', () => {
    const o = orientPair(FIRST, SECOND, row);
    expect(o.assistsViewerToOther).toBe(6);
    expect(o.assistsOtherToViewer).toBe(3);
  });

  it('viewer sorts second', () => {
    const o = orientPair(SECOND, FIRST, row);
    expect(o.assistsViewerToOther).toBe(3);
    expect(o.assistsOtherToViewer).toBe(6);
  });

  it('only one direction recorded, read from the far side', () => {
    const oneWay = doc({ assistsAToB: 4 });
    expect(orientPair(SECOND, FIRST, oneWay).assistsOtherToViewer).toBe(4);
    expect(orientPair(SECOND, FIRST, oneWay).assistsViewerToOther).toBe(0);
  });
});

describe('symmetric counters are the same from either side', () => {
  const row = doc({
    sameTeam: 20,
    winsTogether: 11,
    lossesTogether: 6,
    cleanSheetsTogether: 5,
  });

  it.each([
    [FIRST, SECOND],
    [SECOND, FIRST],
  ])('read as (%s, %s)', (me, them) => {
    const o = orientPair(me, them, row);
    expect(o.roundsTogether).toBe(20);
    expect(o.winsTogether).toBe(11);
    expect(o.lossesTogether).toBe(6);
    expect(o.cleanSheetsTogether).toBe(5);
  });
});

describe('ties are derived, never stored', () => {
  it('together: whatever was neither won nor lost', () => {
    const o = orientPair(FIRST, SECOND, doc({ sameTeam: 20, winsTogether: 11, lossesTogether: 6 }));
    expect(o.tiesTogether).toBe(3);
  });

  it('head-to-head: the same, from the oriented wins', () => {
    const o = orientPair(FIRST, SECOND, doc({ against: 10, winsA: 7, winsB: 2 }));
    expect(o.tiesAgainst).toBe(1);
  });

  it('never negative, however inconsistent the stored counters are', () => {
    const o = orientPair(FIRST, SECOND, doc({ sameTeam: 2, winsTogether: 3, lossesTogether: 1 }));
    expect(o.tiesTogether).toBe(0);
  });

  it('a pair that only ever drew', () => {
    const o = orientPair(FIRST, SECOND, doc({ sameTeam: 4, against: 4 }));
    expect(o.tiesTogether).toBe(4);
    expect(o.tiesAgainst).toBe(4);
    expect(o.winsTogether).toBe(0);
    expect(o.winsViewer).toBe(0);
  });
});

describe('a missing document', () => {
  it('null reads as all zeros, not as an error', () => {
    expect(orientPair(FIRST, SECOND, null)).toEqual(EMPTY_ORIENTED);
  });
  it('undefined likewise', () => {
    expect(orientPair(FIRST, SECOND, undefined)).toEqual(EMPTY_ORIENTED);
  });
});

describe('win percentage', () => {
  it('leaves draws OUT of the denominator — the app-wide definition', () => {
    // 6 won, 2 lost, 2 drawn → 75%, not 60%.
    expect(winPct(6, 2)).toBe(75);
  });

  it('is NULL with nothing decided, never 0', () => {
    // 0% is a claim about a team that lost. A pair that has only drawn, or
    // never played, has not made that claim.
    expect(winPct(0, 0)).toBeNull();
  });

  it('0 only when games were actually lost', () => {
    expect(winPct(0, 3)).toBe(0);
  });

  it('rounds to a whole percent', () => {
    expect(winPct(1, 2)).toBe(33);
    expect(winPct(2, 1)).toBe(67);
  });
});

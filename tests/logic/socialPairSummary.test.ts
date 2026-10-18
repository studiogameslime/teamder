import { socialPairSummary } from '../../functions/src/socialPairSummary';

describe('social pair lifetime summary', () => {
  const pair = {sameTeam:10,winsTogether:5,lossesTogether:3,against:8,winsA:4,winsB:3,assistsAToB:6,assistsBToA:2};
  it('orients wins and assists to either viewer without swapping symmetric totals', () => {
    const a=socialPairSummary('a','z',pair,[100,200]);
    const b=socialPairSummary('z','a',pair,[100,200]);
    expect(a.sameTeam).toEqual({games:10,wins:5,losses:3,ties:2});
    expect(b.sameTeam).toEqual(a.sameTeam);
    expect(a.against).toEqual({games:8,wins:4,losses:3,ties:1});
    expect(b.against).toEqual({games:8,wins:3,losses:4,ties:1});
    expect(a.assists).toEqual({toOther:6,fromOther:2});
    expect(b.assists).toEqual({toOther:2,fromOther:6});
    expect(a.lastSharedRoundAt).toBe(200);
    expect(a.sharedRounds).toBe(2);
  });
  it('distinguishes no shared play from missing historical totals', () => {
    expect(socialPairSummary('a','b',undefined,[]).sameTeam?.games).toBe(0);
    expect(socialPairSummary('a','b',undefined,[100]).sameTeam).toBeNull();
    expect(socialPairSummary('a','b',undefined,[100]).assists).toBeNull();
    expect(socialPairSummary('a','b',{sameTeam:1},[100]).sameTeam).toEqual({games:1,wins:0,losses:0,ties:1});
  });
  it('does not manufacture draws or negative counters from inconsistent data', () => {
    expect(socialPairSummary('a','z',{...pair,winsTogether:11},[100]).sameTeam).toBeNull();
    expect(socialPairSummary('a','z',{...pair,winsA:-1},[100]).against).toBeNull();
    expect(socialPairSummary('a','z',{...pair,assistsAToB:NaN},[100]).assists).toBeNull();
  });
});

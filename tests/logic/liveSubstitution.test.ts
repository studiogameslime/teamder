jest.mock('@/firebase/config', () => ({ getFirebase: jest.fn() }));
import { exchangeLivePlayers, moveLivePlayer } from '@/utils/liveSubstitution';
import { rosterOf, recordWinnerSkeleton, recordTieSkeleton } from '@/services/rotationEngine';
import { readRotation } from '@/firebase/firestore';
import type { DraftTeamsResult, MatchRotation } from '@/types';

const draft = () => ({ teams: [{index:0,captainId:'a',playerIds:['a','a2','a3','a4']},{index:1,captainId:'b',playerIds:['b','b2','b3','b4']},{index:2,captainId:'c',playerIds:['c','c2','c3','c4']}] } as DraftTeamsResult);
const rotation = (): MatchRotation => ({playing:[0,1],waiting:[2],loans:[],round:1,roundInstanceId:'r'});
const view = (d: DraftTeamsResult, r: MatchRotation) => d.teams.map(t => rosterOf(t.index,d.teams,r.loans).sort());
test('temporary swaps exchange the visible positions, preserve home rosters and return both halves together', () => {
  const d=draft(), r=rotation(), swapped=exchangeLivePlayers(d,r,'a','b','temporary','s');
  expect(swapped.draft.teams).toEqual(d.teams);
  expect(view(swapped.draft,swapped.rotation!)).toEqual([['a2','a3','a4','b'],['a','b2','b3','b4'],['c','c2','c3','c4']]);
  const next=recordWinnerSkeleton(0,swapped.draft.teams,swapped.rotation!,4,'temporary');
  expect(next.rotation.loans).toEqual([]); expect(rosterOf(0,next.teams,next.rotation.loans)).toHaveLength(4);
  const tie=recordTieSkeleton(swapped.draft.teams,swapped.rotation!,4,'temporary','veteranOut');
  expect(tie.rotation.loans).toEqual([]);
});
test('a filler swaps from the playing team, not from the waiting home team', () => {
  const d=draft(),r=rotation();r.loans=[{playerId:'c',homeTeam:2,filledTeam:0}];
  const swapped=exchangeLivePlayers(d,r,'c','b','temporary','s');
  expect(view(swapped.draft,swapped.rotation!)).toEqual([['a','a2','a3','a4','b'],['b2','b3','b4','c'],['c2','c3','c4']]);
  expect(swapped.draft.teams).toEqual(d.teams);
  const permanent=exchangeLivePlayers(d,r,'c','b','permanent','s');
  expect(view(permanent.draft,permanent.rotation!)).toEqual(view(swapped.draft,swapped.rotation!));
  expect(permanent.rotation!.loans).toEqual([]);
  expect(permanent.draft.teams[0].playerIds).toContain('b');expect(permanent.draft.teams[1].playerIds).toContain('c');
});
test('repeated swaps preserve everyone else and join exchanges before the next rotation',()=>{
 const d=draft(),r=rotation();const first=exchangeLivePlayers(d,r,'a','b','temporary','s1');
 const second=exchangeLivePlayers(first.draft,first.rotation,'b','c','temporary','s2');
 expect(view(second.draft,second.rotation!)).toEqual([['a2','a3','a4','c'],['a','b2','b3','b4'],['b','c2','c3','c4']]);
 expect(second.rotation!.loans.every(l=>l.swapId==='s2')).toBe(true);
 expect(recordWinnerSkeleton(0,second.draft.teams,second.rotation!,4,'temporary').rotation.loans).toEqual([]);
});
test('the real reader preserves exchange identity without changing old ordinary loans',()=>{
 const raw={...rotation(),loans:[{playerId:'a',homeTeam:0,filledTeam:1,swapId:'s'},{playerId:'c',homeTeam:2,filledTeam:0}]};
 expect(readRotation(raw)?.loans).toEqual(raw.loans);
});
test('same visible team and departed players are rejected without mutation',()=>{
 const d=draft(),r=rotation();expect(()=>exchangeLivePlayers(d,r,'a','a2','temporary','s')).toThrow();
 d.leftHome=[{playerId:'b',homeTeam:1,at:1}];expect(()=>exchangeLivePlayers(d,r,'a','b','permanent','s')).toThrow();
 expect(d.teams[0].playerIds).toEqual(['a','a2','a3','a4']);expect(r.loans).toEqual([]);
});
test('two playing teams return a temporary exchange at the next game even without a waiting queue',()=>{
 const d=draft(),r=rotation();r.waiting=[];const swapped=exchangeLivePlayers(d,r,'a','b','temporary','s');
 expect(recordWinnerSkeleton(0,d.teams,swapped.rotation!,4,'temporary').rotation.loans).toEqual([]);
 expect(recordTieSkeleton(d.teams,swapped.rotation!,4,'temporary','bothOut').rotation.loans).toEqual([]);
});
test.each(['temporary','permanent'] as const)('moving into a vacancy honours %s and refuses a full or depleted roster',mode=>{
 const d=draft(),r=rotation();d.teams[1].playerIds.pop();
 const moved=moveLivePlayer(d,r,'a',1,4,mode);
 expect(rosterOf(1,moved.draft.teams,moved.rotation!.loans)).toHaveLength(4);
 expect(moved.draft.teams[0].playerIds.includes('a')).toBe(mode==='temporary');
 expect(()=>moveLivePlayer(moved.draft,moved.rotation,'a2',1,4,mode)).toThrow();
 d.teams[0].playerIds=['a','a2'];expect(()=>moveLivePlayer(d,r,'a',1,4,mode)).toThrow();
});

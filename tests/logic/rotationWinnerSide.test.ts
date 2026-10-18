import {recordWinner,recordWinnerSkeleton} from '@/services/rotationEngine';
import {winnerRotationPreview} from '@/utils/winnerRotationPreview';
const teams=[0,1,2,3].map(index=>({index,playerIds:Array.from({length:4},(_,i)=>`team${index}-p${i}`)}));
const rotation=(playing:[number,number],waiting:number[])=>({playing,waiting,loans:[],wins:{},round:1,updatedAt:1});

test.each(['temporary','permanent'] as const)('winner keeps its original side through successive %s rotations',mode=>{
 const first=rotation([0,1],[2,3]),before=JSON.stringify(first);
 for(const commit of [recordWinnerSkeleton,recordWinner]){
  const next=commit(1,teams,first,4,mode);
  expect(next.rotation.playing).toEqual([2,1]);expect(next.rotation.waiting).toEqual([3,0]);
  expect(next.rotation.wins?.['1']).toBe(1);
  const again=commit(1,next.teams,next.rotation,4,mode);
  expect(again.rotation.playing).toEqual([3,1]);expect(again.rotation.waiting).toEqual([0,2]);
  expect(again.rotation.wins?.['1']).toBe(2);
  const opposite=commit(3,again.teams,again.rotation,4,mode);
  expect(opposite.rotation.playing).toEqual([3,0]);expect(opposite.rotation.waiting).toEqual([2,1]);
 }
 expect(JSON.stringify(first)).toBe(before);
});

test.each([{pair:[2,0],winner:0,expected:[1,0]},{pair:[2,0],winner:2,expected:[2,1]}])('preview preserves actual side for %o',({pair,winner,expected})=>{
 const state=rotation(pair as [number,number],[1,3]);
 expect(winnerRotationPreview(state,winner)?.playing).toEqual(expected);
 expect(recordWinnerSkeleton(winner,teams,state,4,'temporary').rotation.playing).toEqual(expected);
});

test('two teams without a waiting opponent retain both original sides',()=>{
 const state=rotation([0,1],[]);
 expect(recordWinner(1,teams.slice(0,2),state,4,'temporary').rotation.playing).toEqual([0,1]);
 expect(winnerRotationPreview(state,1)?.playing).toEqual([0,1]);
});


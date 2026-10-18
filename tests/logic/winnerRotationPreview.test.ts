import {winnerRotationPreview} from '@/utils/winnerRotationPreview';
import {recordWinnerSkeleton} from '@/services/rotationEngine';
const rotation=(waiting:number[])=>({playing:[2,0],waiting,loans:[],wins:{},round:4,updatedAt:1}) as any;
test.each([{waiting:[1,3],winner:2},{waiting:[1,3],winner:0},{waiting:[],winner:0}])('preview follows the committed winner-stays rotation: %o',({waiting,winner})=>{
 const r=rotation(waiting),before=JSON.stringify(r);const plan=winnerRotationPreview(r,winner)!;
 const actual=recordWinnerSkeleton(winner,[0,1,2,3].map(index=>({index,playerIds:[]})),r,5,'temporary');
 expect(plan.playing).toEqual(actual.playing);expect(plan.waiting).toEqual(actual.rotation.waiting);
 expect(plan.outgoing).toBe(waiting.length?(winner===2?0:2):undefined);expect(JSON.stringify(r)).toBe(before);
});
test('a winner outside the current pair never invents a preview',()=>{expect(winnerRotationPreview(rotation([1]),3)).toBeNull();});

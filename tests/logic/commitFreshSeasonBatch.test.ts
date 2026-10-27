jest.mock('../../functions/src/serverErrorLog',()=>({observeCaughtError:jest.fn()}));
import { commitFreshSeasonBatch } from '../../functions/src/commitFreshSeasonBatch';
const conflict=()=>Object.assign(new Error('9 FAILED_PRECONDITION: the stored version (2) does not match the required base version (1)'),{code:9});
test('a changed group version rebuilds all writes and the season guard before one successful credit',async()=>{
 let version=1,credited=0,latch=false;const guarded:number[]=[];
 const build=jest.fn(async()=>{
  const read=version;guarded.push(read);
  return {commit:async()=>{if(read===1){version=2;throw conflict();}if(latch)throw {code:6};credited++;latch=true;}};
 });
 await commitFreshSeasonBatch(build);
 expect(guarded).toEqual([1,2]);expect(credited).toBe(1);expect(latch).toBe(true);
});
test('a new season discovered during recovery stops before a second commit',async()=>{
 const closed=Object.assign(Error('season changed'),{code:'failed-precondition'});
 const commit=jest.fn().mockRejectedValue(conflict());let pass=0;
 await expect(commitFreshSeasonBatch(async()=>{if(pass++)throw closed;return {commit};})).rejects.toBe(closed);
 expect(commit).toHaveBeenCalledTimes(1);
});
test('concurrent completion collides with the create-only latch rather than crediting again',async()=>{
 const duplicate={code:6};const commit=jest.fn().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(duplicate);
 await expect(commitFreshSeasonBatch(async()=>({commit}))).rejects.toBe(duplicate);
 expect(commit).toHaveBeenCalledTimes(2);
});
test('repeated version races are bounded and remain visible to event redelivery',async()=>{
 const error=conflict(),commit=jest.fn().mockRejectedValue(error);
 await expect(commitFreshSeasonBatch(async()=>({commit}))).rejects.toBe(error);expect(commit).toHaveBeenCalledTimes(3);
});
test.each([{code:9,message:'season is closed'},{code:'permission-denied',message:'denied'},{code:'unavailable',message:'connection lost'}])('other failures are never replayed: $code',async error=>{
 const commit=jest.fn().mockRejectedValue(error);await expect(commitFreshSeasonBatch(async()=>({commit}))).rejects.toBe(error);expect(commit).toHaveBeenCalledTimes(1);
});

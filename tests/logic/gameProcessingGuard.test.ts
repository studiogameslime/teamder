import { withGameProcessingGuard, reserveGameRemoval, GameProcessingBusyError, gameRemovalBlocksWrite } from '../../functions/src/gameProcessingGuard';
import fs from 'fs';
import path from 'path';

function world() {
  const data = new Map<string, any>([['games/g', {status:'finished'}],['games/g/finishStages/complete',{at:1}]]);
  const db = {doc:(p:string)=>({path:p}),runTransaction:async(fn:any)=>fn({
    get:async(ref:any)=>({exists:data.has(ref.path),data:()=>data.get(ref.path)}),
    set:(ref:any,value:any)=>data.set(ref.path,value),
    update:(ref:any,value:any)=>data.set(ref.path,{...data.get(ref.path),...value}),
  })} as any;
  return {db,data};
}

test('a late event after parent deletion does no work and creates no lease',async()=>{
  const w=world();w.data.delete('games/g');const work=jest.fn();
  await withGameProcessingGuard(w.db,'g',work);expect(work).not.toHaveBeenCalled();expect(w.data.has('gameProcessingGuards/g')).toBe(false);
});
test('reservation blocks all subsequent workers, even if the parent is recreated',async()=>{
  const w=world();await reserveGameRemoval(w.db,'g','op');const work=jest.fn();
  await withGameProcessingGuard(w.db,'g',work);expect(work).not.toHaveBeenCalled();
  w.data.set('gameProcessingGuards/g',{state:'removed',operationId:'op',active:{}});
  await withGameProcessingGuard(w.db,'g',work);expect(work).not.toHaveBeenCalled();
});
test('a transaction writer reads the same reservation fence, including while the parent still exists',async()=>{
  const w=world(),read=()=>w.db.runTransaction((tx:any)=>gameRemovalBlocksWrite(tx,w.db,'g'));
  expect(await read()).toBe(false);await reserveGameRemoval(w.db,'g','op');expect(await read()).toBe(true);
});
test('an already running worker blocks reservation until its entire execution ends',async()=>{
  const w=world();let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);let started!:()=>void;const ready=new Promise<void>(r=>started=r);
  const running=withGameProcessingGuard(w.db,'g',async()=>{started();await gate;});await ready;
  await expect(reserveGameRemoval(w.db,'g','op')).rejects.toBeInstanceOf(GameProcessingBusyError);
  finish();await running;await reserveGameRemoval(w.db,'g','op');expect(w.data.get('gameProcessingGuards/g').state).toBe('removing');
});
test('failure releases the lease but still propagates the original processing failure',async()=>{
  const w=world();await expect(withGameProcessingGuard(w.db,'g',async()=>{throw Error('processing failed');})).rejects.toThrow('processing failed');
  expect(w.data.get('gameProcessingGuards/g').active).toEqual({});await reserveGameRemoval(w.db,'g','op');
});
test('an abandoned lease never expires automatically',async()=>{
  const w=world();w.data.set('gameProcessingGuards/g',{state:'open',active:{crashed:1}});
  await expect(reserveGameRemoval(w.db,'g','op')).rejects.toBeInstanceOf(GameProcessingBusyError);
});
test('an unfinished or partially settled evening cannot be frozen for erasure',async()=>{
  const w=world();w.data.set('games/g',{status:'active'});await expect(reserveGameRemoval(w.db,'g','op')).rejects.toThrow('fully settled');
  w.data.set('games/g',{status:'finished'});w.data.delete('games/g/finishStages/complete');await expect(reserveGameRemoval(w.db,'g','op')).rejects.toThrow('fully settled');
});
test('reservation is idempotent only for the same operation, never a different operation',async()=>{
  const w=world();await reserveGameRemoval(w.db,'g','op');await reserveGameRemoval(w.db,'g','op');
  await expect(reserveGameRemoval(w.db,'g','different')).rejects.toThrow('another operation');
});
test.each([{state:'broken',active:{}},{state:'open',active:[]},{state:'open',active:{bad:NaN}},{state:'open'}])('malformed state fails closed: %j',async bad=>{
  const w=world();w.data.set('gameProcessingGuards/g',bad);const work=jest.fn();
  await expect(withGameProcessingGuard(w.db,'g',work)).rejects.toThrow('Invalid');expect(work).not.toHaveBeenCalled();
});
test('the deployed-entry source wraps roster work after the deletion audit branch',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../functions/src/index.ts'),'utf8');
  const start=source.indexOf('export const onGameRosterChanged'),end=source.indexOf('export const onVoteWritten',start);
  const handler=source.slice(start,end);expect(handler).toContain('await withGameProcessingGuard(db, event.params.gameId, async () => {');
  expect(handler.indexOf('withGameProcessingGuard')).toBeLessThan(handler.indexOf('const attendanceAlreadyDone'));
  expect(handler.indexOf(".collection('gameDeletions')")).toBeLessThan(handler.indexOf('withGameProcessingGuard'));
});

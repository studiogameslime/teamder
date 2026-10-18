import { waitForJoinResult } from '../../src/utils/joinRequestResult';

test('waits for the server bucket and unsubscribes after assignment', async () => {
  let next: (r:any)=>void = () => {}; const stop=jest.fn();
  const p=waitForJoinResult(n=>{next=n;return stop;},()=>true);
  next({state:'queued'});
  next({state:'assigned',bucket:'waitlist'});
  expect(await p).toEqual({bucket:'waitlist'});expect(stop).toHaveBeenCalledTimes(1);
});
test('server rejection and account replacement cannot show success', async () => {
  await expect(waitForJoinResult(n=>{n({state:'rejected',reason:'GAME_JOIN_FORBIDDEN'});return ()=>{};},()=>true)).rejects.toThrow('GAME_JOIN_FORBIDDEN');
  await expect(waitForJoinResult(n=>{n({state:'assigned',bucket:'players'});return ()=>{};},()=>false)).rejects.toThrow('STALE_JOIN_SESSION');
});
test('a slow server is pending processing, never a predicted success', async () => {
  jest.useFakeTimers(); const stop=jest.fn();
  const p=waitForJoinResult(()=>stop,()=>true,100);
  const rejected=expect(p).rejects.toThrow('GAME_JOIN_PROCESSING');
  jest.advanceTimersByTime(100);await rejected;expect(stop).toHaveBeenCalledTimes(1);jest.useRealTimers();
});

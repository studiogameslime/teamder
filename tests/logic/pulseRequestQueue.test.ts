import { pulseRequestQueue } from '../../functions/src/pulseRequestQueue';
test('concurrent requests wait in two reservations instead of competing on the same document', async () => {
  let release!: (n: number) => void;
  const reserve = jest.fn().mockImplementationOnce(() => new Promise<number>(r => {release=r;})).mockImplementation(async (_uid, count) => count);
  const enter = pulseRequestQueue(reserve);
  const first = enter('owner');
  const more = Array.from({length:20},()=>enter('owner'));
  expect(reserve).toHaveBeenCalledTimes(1);
  release(1); await Promise.all([first,...more]);
  expect(reserve.mock.calls).toEqual([['owner',1],['owner',20]]);
});
test('only requests with reserved capacity proceed and the queue can be used again', async () => {
  let release!: (n:number)=>void;
  const reserve = jest.fn().mockImplementationOnce(()=>new Promise<number>(r=>{release=r;})).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
  const enter=pulseRequestQueue(reserve), first=enter('owner');
  const rest=[enter('owner'),enter('owner'),enter('owner')];
  const settled=Promise.allSettled(rest); release(1); await first;
  expect((await settled).map(r=>r.status)).toEqual(['fulfilled','rejected','rejected']);
  await expect(enter('owner')).resolves.toBeUndefined();
});
test('different administrators never block one another and reservation errors fail closed', async () => {
  const reserve=jest.fn(async(uid:string)=>{if(uid==='bad')throw Error('offline');return 1;});
  const enter=pulseRequestQueue(reserve);
  await expect(enter('bad')).rejects.toThrow('offline');
  await expect(enter('other')).resolves.toBeUndefined();
});

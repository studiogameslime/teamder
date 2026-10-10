beforeEach(()=>{jest.resetModules();jest.useFakeTimers();});
afterEach(()=>{jest.useRealTimers();});
test('first entry waits for invitation bootstrap and clears its deadline',async()=>{
 const boot=await import('@/services/entryBootstrap');let finished=false;
 const waiting=boot.waitForEntryBootstrap().then(()=>{finished=true;});
 await jest.advanceTimersByTimeAsync(100);
 expect(finished).toBe(false);
 boot.finishEntryBootstrap();await waiting;
 expect(finished).toBe(true);expect(jest.getTimerCount()).toBe(0);
});
test('a stuck bootstrap cannot keep first entry hidden indefinitely',async()=>{
 const boot=await import('@/services/entryBootstrap');const waiting=boot.waitForEntryBootstrap();
 await jest.advanceTimersByTimeAsync(4500);await waiting;
 boot.finishEntryBootstrap();await boot.waitForEntryBootstrap();
 expect(jest.getTimerCount()).toBe(0);
});

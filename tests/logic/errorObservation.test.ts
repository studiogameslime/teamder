import { installCaughtErrorSink, observeCaughtError, observedRejection, observeSettledErrors, clearCaughtErrorOrigins, observedListener } from '../../src/utils/errorObservation';
const origin = {source:'test.ts',handler:'load',site:'test:load'};
beforeEach(() => clearCaughtErrorOrigins());
test('reporting faults cannot replace a return, rejection or thrown identity', async () => {
  installCaughtErrorSink(() => { throw new Error('reporter down'); });
  const error = new Error('original');
  expect(() => observeCaughtError(error, origin)).not.toThrow();
  await expect(Promise.reject(error).catch(observedRejection(() => 42, origin))).resolves.toBe(42);
  await expect(Promise.reject(error).catch(observedRejection(e => { throw e; }, origin))).rejects.toBe(error);
});
test('parallel failures are observed without changing settled values or order', async () => {
  const sink=jest.fn();installCaughtErrorSink(sink);
  const error=new Error('failed');const results=await Promise.allSettled([Promise.resolve(8),Promise.reject(error)]);
  expect(observeSettledErrors(results,origin)).toBe(results);expect(sink).toHaveBeenCalledWith(error,origin);
});
test('subscription failures are observed with or without an existing error callback',()=>{
  const sink=jest.fn(),callback=jest.fn(),error=new Error('listener failed');installCaughtErrorSink(sink);
  observedListener(callback,origin)(error);expect(callback).toHaveBeenCalledWith(error);expect(callback).toHaveBeenCalledTimes(1);
  observedListener(undefined,origin)(error);expect(sink).toHaveBeenCalledTimes(2);
});
test('capture keeps the first origin through an error propagation chain', () => {
  const sink=jest.fn();installCaughtErrorSink(sink);const error=new Error('failed');
  observeCaughtError(error,origin);observeCaughtError(error,{...origin,source:'screen.ts'});
  expect(sink.mock.calls[1][1]).toEqual(origin);
});
test('runtime copies have the same dispatch/redaction semantics', () => {
  const fs=require('fs');
  expect(fs.readFileSync('pulse/src/services/errorObservation.ts','utf8')).toBe(fs.readFileSync('src/utils/errorObservation.ts','utf8'));
  for(const target of ['functions/src/diagnosticRedaction.ts','pulse/src/services/diagnosticRedaction.ts'])
    expect(fs.readFileSync(target,'utf8')).toBe(fs.readFileSync('src/utils/diagnosticRedaction.ts','utf8'));
});

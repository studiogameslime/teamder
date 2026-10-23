import { retryRead } from '@/services/readRetry';
import { StaleSessionError } from '@/services/staleSession';
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test.each(['functions/internal','functions/unavailable','functions/deadline-exceeded','unavailable'])('recovers a transient %s read without returning empty data', async code => {
  const read = jest.fn().mockRejectedValueOnce(Object.assign(new Error('temporary'), { code })).mockResolvedValueOnce(['club']);
  const result = retryRead(read, () => undefined);
  await jest.advanceTimersByTimeAsync(500);
  expect(await result).toEqual(['club']);
  expect(read).toHaveBeenCalledTimes(2);
});
test('exhausted reads preserve the original final failure', async () => {
  const error = Object.assign(new Error('still unavailable'), { code: 'functions/internal' });
  const read = jest.fn().mockRejectedValue(error);
  const result = expect(retryRead(read, () => undefined)).rejects.toBe(error);
  await jest.advanceTimersByTimeAsync(500); await result;
  expect(read).toHaveBeenCalledTimes(2);
});
test.each(['permission-denied','functions/unauthenticated','functions/invalid-argument'])('does not retry %s', async code => {
  const error = Object.assign(new Error('denied'), { code });
  const read = jest.fn().mockRejectedValue(error);
  await expect(retryRead(read, () => undefined)).rejects.toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
});
test('a changed account aborts before the second read', async () => {
  let owner = 'first';
  const check = () => { if (owner !== 'first') throw new StaleSessionError('first', owner); };
  const read = jest.fn().mockRejectedValue(Object.assign(new Error('temporary'), { code: 'functions/internal' }));
  const result = expect(retryRead(read, check)).rejects.toBeInstanceOf(StaleSessionError);
  await Promise.resolve(); owner = 'next';
  await jest.advanceTimersByTimeAsync(500); await result;
  expect(read).toHaveBeenCalledTimes(1);
});

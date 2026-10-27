import { mapConcurrent } from '@/utils/mapConcurrent';

test('starts only four reads and preserves input order despite reversed completion', async () => {
  const resolves: ((value: number) => void)[] = [];
  const read = jest.fn((n: number) => new Promise<number>(resolve => { resolves[n] = resolve; }));
  const pending = mapConcurrent([0, 1, 2, 3, 4, 5], 4, read);
  expect(read.mock.calls.map(([n]) => n)).toEqual([0, 1, 2, 3]);
  resolves[3](30); resolves[2](20);
  await Promise.resolve();
  expect(read.mock.calls.map(([n]) => n)).toEqual([0, 1, 2, 3, 4, 5]);
  resolves[5](50); resolves[4](40); resolves[1](10); resolves[0](0);
  expect(await pending).toEqual([0, 10, 20, 30, 40, 50]);
});

test('failure stops scheduling further reads, waits for running work, and rejects without a partial result', async () => {
  const failure = Error('offline');
  let finish!: (value: number) => void;
  const read = jest.fn((n: number) => n === 0 ? Promise.reject(failure) : new Promise<number>(resolve => { finish = resolve; }));
  const pending = mapConcurrent([0, 1, 2, 3], 2, read);
  const rejected = expect(pending).rejects.toBe(failure);
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  finish(1);
  await rejected;
});

test('empty input starts no reads and invalid concurrency fails before reading', async () => {
  const read = jest.fn();
  expect(await mapConcurrent([], 4, read)).toEqual([]);
  await expect(mapConcurrent([1], 0, read)).rejects.toThrow('Invalid concurrency');
  expect(read).not.toHaveBeenCalled();
});

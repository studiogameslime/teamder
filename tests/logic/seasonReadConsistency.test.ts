import { readConsistentSeasonSnapshot, seasonReadStamp, withSeasonReadTimeout } from '@/utils/seasonReadConsistency';
import type { GroupSeasons } from '@/types';

const season = (patch = {}): GroupSeasons => ({ enabled: true, currentId: 's1', currentNo: 1,
  count: 0, startedAt: 1, playedRounds: 5, cadence: { type: 'rounds', targetRounds: 10 }, ...patch });

test('a stalled archive read rejects with a retryable timeout and cannot deliver a late result', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (value: number) => void;
    const consume = jest.fn();
    const read = withSeasonReadTimeout(new Promise<number>(resolve => { finish = resolve; }));
    const outcome = read.then(consume, error => error);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toMatchObject({ code: 'deadline-exceeded' });
    finish(6); await Promise.resolve();
    expect(consume).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

test('a snapshot read whose first group request never returns also stops loading', async () => {
  jest.useFakeTimers();
  try {
    const read = readConsistentSeasonSnapshot(() => new Promise<null>(() => {}), async () => []);
    const outcome = read.catch(error => error);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toMatchObject({ code: 'deadline-exceeded' });
  } finally { jest.useRealTimers(); }
});

test('successful and failed reads clear their timeout', async () => {
  jest.useFakeTimers();
  try {
    await expect(withSeasonReadTimeout(Promise.resolve(6))).resolves.toBe(6);
    await expect(withSeasonReadTimeout(Promise.reject(new Error('denied')))).rejects.toThrow('denied');
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

test('a rollover during the read discards the old table and repeats the entire read', async () => {
  const old = { seasons: season() }, next = { seasons: season({ currentId: 's2', revision: 1, playedRounds: 0, count: 1 }) };
  const read = jest.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next).mockResolvedValue(next);
  const data = jest.fn(async (g: typeof old) => g.seasons.currentId === 's1' ? { goals: 40 } : { goals: 0 });
  expect(await readConsistentSeasonSnapshot(read, data)).toEqual({ group: next, data: { goals: 0 } });
  expect(data).toHaveBeenCalledTimes(2);
});

test('an unfinished operation is unavailable, never a table of zeroes', async () => {
  const data = jest.fn();
  await expect(readConsistentSeasonSnapshot(async () => ({ seasons: season({ operation: { kind: 'finishSeason', until: 1 } }) }), data)).rejects.toThrow('operation in progress');
  expect(data).not.toHaveBeenCalled();
});

test('a disappearing club or continuously changing season fails explicitly', async () => {
  await expect(readConsistentSeasonSnapshot(async () => null, async () => [])).rejects.toThrow('unavailable');
  let revision = 0;
  const read = jest.fn(async () => ({ seasons: season({ revision: revision++ }) }));
  await expect(readConsistentSeasonSnapshot(read, async () => [])).rejects.toThrow('changed during');
  expect(read).toHaveBeenCalledTimes(6);
});

test('disable, new archives, progress and failed operations invalidate both data sources', () => {
  const before = seasonReadStamp(season());
  for (const patch of [{ enabled: false }, { count: 1 }, { playedRounds: 6 }, { revision: 1 }, { currentId: 's2' },
    { operation: { kind: 'finishSeason', until: 0, failed: true } }]) {
    expect(seasonReadStamp(season(patch))).not.toBe(before);
  }
});

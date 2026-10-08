jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  query: (ref: string, ...constraints: unknown[]) => ({ ref, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, value: string) => ({ field, value }),
  limit: (value: number) => ({ limit: value }),
  startAfter: (value: unknown) => ({ cursor: value }),
  getDocs: jest.fn(),
}));
jest.mock('@/firebase/firestore', () => ({ col: { games: () => 'games' } }));
jest.mock('@/firebase/config', () => ({ getFirebase: () => ({ db: {} }) }));
import { getDocs } from 'firebase/firestore';
import { readPersonalEveningRecords } from '@/services/eveningRecordService';
const get = getDocs as jest.Mock;
const stat = { goals: 1, assists: 2, wins: 3, rounds: 5 };
const row = (id: string, data: unknown) => ({ id, data: () => data });
const snapshot = (docs: unknown[], cached = false) => ({ docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: cached } });
const game = (id: string, startsAt = 1, participantIds = ['u']) => row(id, { id, groupId: 'g', status: 'finished', startsAt, participantIds });
const run = () => readPersonalEveningRecords('g', 'u', 10, { goals: 2, assists: 3, wins: 4 });
beforeEach(() => get.mockReset());
describe('record history completeness', () => {
  it('queries only this club and this user and excludes current/future evenings', async () => {
    get.mockResolvedValueOnce(snapshot([game('old'), game('current', 10), game('future', 11)]))
      .mockResolvedValueOnce(snapshot([row('s', stat)]));
    expect(await run()).toHaveLength(3);
    expect(get.mock.calls[0][0].constraints).toContainEqual({ field: 'groupId', op: '==', value: 'g' });
    expect(get.mock.calls[1][0].constraints).toContainEqual({ field: 'gameId', op: '==', value: 'old' });
    expect(get.mock.calls[1][0].constraints).toContainEqual({ field: 'userId', op: '==', value: 'u' });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('does not claim a record on missing registered-player stats or cached history', async () => {
    get.mockResolvedValueOnce(snapshot([game('old')])).mockResolvedValueOnce(snapshot([]));
    expect(await run()).toEqual([]);
    get.mockReset().mockResolvedValueOnce(snapshot([game('old')], true));
    expect(await run()).toEqual([]);
  });
  it('allows an unrelated evening with no stat row, and includes removed registrations with a row', async () => {
    get.mockResolvedValueOnce(snapshot([game('unrelated', 1, []), game('removed', 2, [])]))
      .mockResolvedValueOnce(snapshot([])).mockResolvedValueOnce(snapshot([row('s', stat)]));
    expect(await run()).toHaveLength(3);
  });
  it('refuses duplicates and malformed stats', async () => {
    get.mockResolvedValueOnce(snapshot([game('old')])).mockResolvedValueOnce(snapshot([row('s', stat), row('s2', stat)]));
    expect(await run()).toEqual([]);
    get.mockReset().mockResolvedValueOnce(snapshot([game('old')])).mockResolvedValueOnce(snapshot([row('s', { ...stat, assists: undefined })]));
    expect(await run()).toEqual([]);
  });
  it('paginates beyond 100 evenings before judging the historical maximum', async () => {
    const page = Array.from({ length: 100 }, (_, i) => game(`old-${i}`));
    get.mockResolvedValueOnce(snapshot(page)).mockResolvedValueOnce(snapshot([game('older')]));
    get.mockImplementation(async (q) => snapshot([row('s', q.constraints.some((c: { value?: string }) => c.value === 'older')
      ? { ...stat, goals: 10, assists: 10, wins: 10 } : stat)]));
    expect(await run()).toEqual([]);
    expect(get.mock.calls[1][0].constraints).toContainEqual({ cursor: page[99] });
  });
  it('suppresses a truncated history and propagates permission/network failures to its caller', async () => {
    get.mockResolvedValue(snapshot(Array.from({ length: 100 }, (_, i) => game(`g-${i}`))));
    expect(await run()).toEqual([]);
    expect(get).toHaveBeenCalledTimes(20);
    get.mockReset().mockRejectedValue(new Error('permission-denied'));
    await expect(run()).rejects.toThrow('permission-denied');
  });
});

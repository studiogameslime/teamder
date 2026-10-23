jest.mock('firebase/firestore', () => ({ collection: jest.fn((_db, name) => name), query: jest.fn((...args) => args), where: jest.fn((...args) => args), limit: jest.fn(value => value), getDocs: jest.fn() }));
jest.mock('@/firebase/firestore', () => ({ col: { games: () => 'games' } }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) }));
import { getDocs } from 'firebase/firestore';
import { readLeaderHistory, LeaderHistoryCancelledError } from '../../src/services/leaderHistoryService';
const docs = (rows: unknown[]) => ({ size: rows.length, docs: rows.map(value => ({ data: () => value })) });
const game = { id: 'g', groupId: 'club', startsAt: 100, status: 'finished', playVerified: true, players: ['a', 'b'], arrivals: { b: 'no_show' } };
beforeEach(() => jest.resetAllMocks());
test('loads scoped played evenings, preserves all metrics, and counts actual attendance', async () => {
  (getDocs as jest.Mock).mockResolvedValueOnce(docs([game, { ...game, id: 'old', startsAt: 1 }])).mockResolvedValueOnce(docs([{ userId: 'a', goals: 2, assists: 3, rounds: 4, wins: 1 }]));
  const rows = await readLeaderHistory('club', { from: 10 }, () => true);
  expect(rows).toEqual([{ gameId: 'g', at: 100, uid: 'a', values: { goals: 2, assists: 3, rounds: 4, wins: 1, cleanSheets: 0, penScored: 0, penSaved: 0, ownGoals: 0, games: 1 } }]);
  expect(getDocs).toHaveBeenCalledTimes(2);
});
test('failed or truncated reads cannot masquerade as complete history', async () => {
  (getDocs as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await expect(readLeaderHistory('club', {}, () => true)).rejects.toThrow('offline');
  (getDocs as jest.Mock).mockResolvedValueOnce({ size: 501, docs: [] });
  await expect(readLeaderHistory('club', {}, () => true)).rejects.toThrow('LEADER_HISTORY_LIMIT');
});
test('navigation cancellation stops scheduling player-stat reads', async () => {
  (getDocs as jest.Mock).mockResolvedValueOnce(docs([game]));
  await expect(readLeaderHistory('club', {}, () => false)).rejects.toBeInstanceOf(LeaderHistoryCancelledError);
  expect(getDocs).toHaveBeenCalledTimes(1);
});

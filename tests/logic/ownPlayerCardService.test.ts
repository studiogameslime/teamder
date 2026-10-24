let mockOwner = { id: 'me', isGuest: false };
let mockUser: any = { id: 'me', stats: { goals: 36, assists: 24 } };
const mockGetDocs = jest.fn();
const mockGetUser = jest.fn((..._args: any[]) => Promise.resolve(mockUser));
jest.mock('firebase/firestore', () => ({ collection: jest.fn(), query: (...args: any[]) => args, where: (...args: any[]) => args, limit: (n: number) => n, getDocs: (...args: any[]) => mockGetDocs(...args) }));
jest.mock('@/firebase/firestore', () => ({ col: { games: () => 'games' } }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: () => ({ currentUser: mockOwner }) } }));
jest.mock('@/services/userService', () => ({ userService: { getUserById: (...args: any[]) => mockGetUser(...args) } }));
import { ownPlayerCardService } from '@/services/ownPlayerCardService';

beforeEach(() => { mockOwner = { id: 'me', isGuest: false }; mockGetDocs.mockReset(); mockGetUser.mockClear(); });

test('owner query is unbounded and carries converter ids without retyping, returning fresh lifetime goals', async () => {
  const row = { id: 'real-full-id', status: 'finished', startsAt: Date.now() - 1000, players: ['me'] };
  mockGetDocs.mockResolvedValue({ docs: [{ data: () => row }] });
  const result = await ownPlayerCardService.load('me');
  expect(mockGetDocs).toHaveBeenCalledWith(['games', ['participantIds', 'array-contains', 'me']]);
  expect(result.last).toBe(row);
  expect(result.user.stats?.goals).toBe(36);
  expect(result.attendedCount).toBe(1);
});

test('network failure remains a failure instead of an empty history', async () => {
  mockGetDocs.mockRejectedValue(new Error('offline'));
  await expect(ownPlayerCardService.load('me')).rejects.toThrow('offline');
});

test('account replacement during owner scan rejects the old result', async () => {
  let resolve!: (value: any) => void;
  mockGetDocs.mockReturnValue(new Promise(r => { resolve = r; }));
  const pending = ownPlayerCardService.load('me');
  mockOwner = { id: 'other', isGuest: false };
  resolve({ docs: [] });
  await expect(pending).rejects.toMatchObject({ name: 'StaleSessionError' });
});

test('anonymous and wrong-owner loads never issue a query', async () => {
  mockOwner.isGuest = true;
  await expect(ownPlayerCardService.load('me')).rejects.toMatchObject({ name: 'StaleSessionError' });
  mockOwner = { id: 'other', isGuest: false };
  await expect(ownPlayerCardService.lastStats('me', 'id')).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(mockGetDocs).not.toHaveBeenCalled();
});

test('last-round counters are scoped to owner and selected game; failed secondary read is not zero', async () => {
  mockGetDocs.mockResolvedValueOnce({ docs: [{ data: () => ({ rounds: 4, goals: 2 }) }] });
  await expect(ownPlayerCardService.lastStats('me', 'last-id')).resolves.toEqual({ goals: 2, assists: 0, games: 4 });
  expect(mockGetDocs.mock.calls[0][0].slice(1)).toEqual([['gameId', '==', 'last-id'], ['userId', '==', 'me'], 1]);
  mockGetDocs.mockRejectedValueOnce(new Error('offline'));
  await expect(ownPlayerCardService.lastStats('me', 'last-id')).rejects.toThrow('offline');
});

let mockCurrent: any = { id: 'viewer', isGuest: false };
let mockAuth: any = { uid: 'viewer', isAnonymous: false };
const mockCall = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: (_functions: any, name: string) => (data: any) => mockCall(name, data) }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ auth: { currentUser: mockAuth }, functions: {} }) }));
jest.mock('@/firebase/authRace', () => ({ withAuthRaceRetry: (callback: any) => callback() }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: () => ({ currentUser: mockCurrent }) } }));
import { comparisonActivityService } from '@/services/comparisonActivityService';

beforeEach(() => { mockCurrent = { id: 'viewer', isGuest: false }; mockAuth = { uid: 'viewer', isAnonymous: false }; mockCall.mockReset(); });

test('list always binds identity to the current account and passes the exact period/cursor', async () => {
  mockCall.mockResolvedValue({ data: { players: 1, comparisons: 2, rows: [], cursor: null } });
  await comparisonActivityService.list('viewer', 'all', 'opaque');
  expect(mockCall).toHaveBeenCalledWith('getMyComparisonActivity', { expectedUid: 'viewer', range: 'all', cursor: 'opaque', _diagnostic: {requestId:expect.any(String)} });
});
test('record preserves the same visit id and club/scope for server idempotence', async () => {
  mockCall.mockResolvedValue({ data: { recorded: true } });
  await comparisonActivityService.record({ expectedUid: 'viewer', targetId: 'target', groupId: 'club', visitId: 'unique-visit-00001', scope: { k: 'season', id: 's1' } });
  expect(mockCall).toHaveBeenCalledWith('recordPlayerComparison', { expectedUid: 'viewer', targetId: 'target', groupId: 'club', visitId: 'unique-visit-00001', scope: { k: 'season', id: 's1' }, _diagnostic: {requestId:expect.any(String)} });
});
test.each(['store', 'auth', 'anonymous'])('wrong %s identity cannot issue an owner request', async mode => {
  if (mode === 'store') mockCurrent.id = 'other';
  if (mode === 'auth') mockAuth.uid = 'other';
  if (mode === 'anonymous') mockAuth.isAnonymous = true;
  await expect(comparisonActivityService.list('viewer', 'month')).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(mockCall).not.toHaveBeenCalled();
});
test('a response from a replaced account is rejected and network failure is not an empty list', async () => {
  mockCall.mockImplementationOnce(async () => { mockAuth.uid = 'new'; return { data: {} }; });
  await expect(comparisonActivityService.list('viewer', 'month')).rejects.toMatchObject({ name: 'StaleSessionError' });
  mockAuth.uid = 'viewer'; mockCall.mockRejectedValueOnce(new Error('unavailable'));
  await expect(comparisonActivityService.list('viewer', 'month')).rejects.toThrow('unavailable');
});

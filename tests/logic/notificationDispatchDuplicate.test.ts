const mockGetDoc = jest.fn(), mockGetDocs = jest.fn(), mockSetDoc = jest.fn(), mockLog = jest.fn();
jest.mock('firebase/firestore', () => ({
  arrayRemove: jest.fn(), arrayUnion: jest.fn(), collection: jest.fn(), doc: jest.fn(() => 'marker'),
  getDoc: (...args: any[]) => mockGetDoc(...args), getDocs: (...args: any[]) => mockGetDocs(...args),
  setDoc: (...args: any[]) => mockSetDoc(...args), limit: jest.fn(), orderBy: jest.fn(), query: jest.fn(),
  serverTimestamp: () => 123, updateDoc: jest.fn(), where: jest.fn(),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-constants', () => ({}));
jest.mock('expo-application', () => ({}));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: {}, auth: { currentUser: { uid: 'sender' } } }) }));
jest.mock('@/services/joryio', () => ({ joryio: {} }));
jest.mock('@/firebase/firestore', () => ({ docs: {} }));
jest.mock('@/services/errorLog', () => ({ logError: (...args: any[]) => mockLog(...args), isExpectedDenial: jest.fn() }));
jest.mock('@/services/analyticsService', () => ({ AnalyticsEvent: {}, logEvent: jest.fn() }));
import { notificationsService } from '@/services/notificationsService';
const input = { type: 'gameCanceledOrUpdated' as const, recipientId: 'game', payload: { gameId: 'game', action: 'updated' } };
beforeEach(() => {
  jest.clearAllMocks(); (globalThis as any).__DEV__ = false;
  mockGetDocs.mockResolvedValue({ empty: true });
  mockGetDoc.mockResolvedValue({ exists: () => false });
  mockSetDoc.mockResolvedValue(undefined);
});
test('recipient-private existing marker is a duplicate and is never overwritten', async () => {
  mockGetDoc.mockRejectedValue({ code: 'permission-denied' });
  await notificationsService.dispatch(input);
  expect(mockSetDoc).not.toHaveBeenCalled(); expect(mockLog).not.toHaveBeenCalled();
});
test('missing readable marker creates the notification', async () => {
  await notificationsService.dispatch(input);
  expect(mockSetDoc).toHaveBeenCalledWith('marker', expect.objectContaining({ recipientId: 'game', createdByUid: 'sender' }));
});

test('strict unread dedupe only queries the signed in recipients private notifications', async () => {
  await notificationsService.dispatch(input);
  expect(mockGetDocs).not.toHaveBeenCalled();
  await notificationsService.dispatch({...input,recipientId:'sender'});
  expect(mockGetDocs).toHaveBeenCalledTimes(1);
});
test('actual create denial is still reported', async () => {
  mockSetDoc.mockRejectedValue({ code: 'permission-denied' });
  await notificationsService.dispatch(input);
  expect(mockLog).toHaveBeenCalledWith('dispatchNotification', expect.objectContaining({ code: 'permission-denied' }), expect.anything());
});
test('network failures and denied reads of own notifications stay visible', async () => {
  mockGetDoc.mockRejectedValueOnce({ code: 'unavailable' }).mockRejectedValueOnce({ code: 'permission-denied' });
  await notificationsService.dispatch(input);
  await notificationsService.dispatch({ ...input, recipientId: 'sender' });
  expect(mockLog).toHaveBeenCalledTimes(2);
});

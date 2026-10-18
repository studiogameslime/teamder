const mockStorage = { getStoreReviewLastShownAt: jest.fn(), setStoreReviewLastShownAt: jest.fn() };
const mockReview = { isAvailableAsync: jest.fn(), requestReview: jest.fn() };
const mockLog = jest.fn();
jest.mock('@/services/storage', () => ({ storage: mockStorage }));
jest.mock('expo-store-review', () => mockReview);
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('@/services/analyticsService', () => ({ AnalyticsEvent: { StoreReviewPrompted: 'review' }, logEvent: mockLog }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/services/remoteConfigService', () => ({ rcBool: () => true, rcNumber: () => 90 }));

beforeEach(() => {
  jest.resetModules(); jest.clearAllMocks();
  (globalThis as any).__DEV__ = false;
  mockStorage.getStoreReviewLastShownAt.mockResolvedValue(0);
  mockStorage.setStoreReviewLastShownAt.mockResolvedValue(undefined);
  mockReview.isAvailableAsync.mockResolvedValue(true);
  mockReview.requestReview.mockResolvedValue(undefined);
});

test('failed native review does not start a 90-day cooldown or claim a prompt', async () => {
  mockReview.requestReview.mockRejectedValueOnce(new Error('ReviewManager failed'));
  const { maybeRequestStoreReview } = require('@/services/storeReviewService');
  expect(await maybeRequestStoreReview('gameFilled', 'first')).toBe(false);
  expect(mockStorage.setStoreReviewLastShownAt).not.toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();
  expect(await maybeRequestStoreReview('matchFinished', 'second')).toBe(true);
  expect(mockStorage.setStoreReviewLastShownAt).toHaveBeenCalledTimes(1);
});

test('different contexts cannot open simultaneous review requests', async () => {
  let finish!: () => void;
  mockReview.requestReview.mockReturnValue(new Promise<void>(done => { finish = done; }));
  const { maybeRequestStoreReview } = require('@/services/storeReviewService');
  const first = maybeRequestStoreReview('gameFilled', 'one');
  await new Promise(done => setImmediate(done));
  expect(await maybeRequestStoreReview('matchFinished', 'two')).toBe(false);
  finish(); expect(await first).toBe(true);
  expect(mockReview.requestReview).toHaveBeenCalledTimes(1);
});

test('development clients never ask the real store', async () => {
  (globalThis as any).__DEV__ = true;
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { maybeRequestStoreReview } = require('@/services/storeReviewService');
  expect(await maybeRequestStoreReview('gameFilled', 'development')).toBe(false);
  expect(mockReview.requestReview).not.toHaveBeenCalled();
  consoleLog.mockRestore();
});

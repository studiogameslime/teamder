const mockAuth = { currentUser: { uid: 'A' } as { uid: string } | null };
const mockFetch = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockFetch }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ auth: mockAuth, functions: {} }) }));
jest.mock('@/firebase/authRace', () => ({ withAuthRaceRetry: (call: () => Promise<unknown>) => call() }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
import { availabilityFeedService } from '@/services/availabilityFeedService';

const answer = (city: string) => ({ data: { radiusKm: 25, hasLocation: true, viewerCity: city, days: [] } });
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(resolveFn => { resolve = resolveFn; }); return { promise, resolve }; };
beforeEach(() => { availabilityFeedService.invalidate(); mockFetch.mockReset(); mockAuth.currentUser = { uid: 'A' }; });

test('a cached city belongs to its account, not the next person on the device', async () => {
  mockFetch.mockResolvedValueOnce(answer('A-city')).mockResolvedValueOnce(answer('B-city'));
  expect((await availabilityFeedService.getAvailabilityCounts()).viewerCity).toBe('A-city');
  expect((await availabilityFeedService.getAvailabilityCounts()).viewerCity).toBe('A-city');
  mockAuth.currentUser = { uid: 'B' };
  expect((await availabilityFeedService.getAvailabilityCounts()).viewerCity).toBe('B-city');
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('a late A response is discarded and cannot detach the ongoing B request', async () => {
  const a = deferred(), b = deferred(); mockFetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const old = availabilityFeedService.getAvailabilityCounts();
  mockAuth.currentUser = { uid: 'B' }; const current = availabilityFeedService.getAvailabilityCounts();
  a.resolve(answer('A-city')); expect((await old).error).toBe(true);
  const joined = availabilityFeedService.getAvailabilityCounts();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  b.resolve(answer('B-city')); expect((await current).viewerCity).toBe('B-city'); expect((await joined).viewerCity).toBe('B-city');
});

test('logout discards a late response even before another account calls the service', async () => {
  const a = deferred(); mockFetch.mockReturnValueOnce(a.promise);
  const old = availabilityFeedService.getAvailabilityCounts(); mockAuth.currentUser = null;
  a.resolve(answer('private-old-city')); const result = await old;
  expect(result.error).toBe(true); expect(result.viewerCity).toBeUndefined();
  expect((await availabilityFeedService.getAvailabilityCounts()).error).toBe(true);
});

test('invalidate starts a fresh request and a pre-edit result never recaches or succeeds', async () => {
  const old = deferred(); mockFetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(answer('edited-city'));
  const first = availabilityFeedService.getAvailabilityCounts(); availabilityFeedService.invalidate();
  expect((await availabilityFeedService.getAvailabilityCounts()).viewerCity).toBe('edited-city');
  old.resolve(answer('stale-city')); expect((await first).error).toBe(true);
  expect((await availabilityFeedService.getAvailabilityCounts()).viewerCity).toBe('edited-city');
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

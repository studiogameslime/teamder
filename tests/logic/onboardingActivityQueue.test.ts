const mockStorage = new Map<string, string>();
const mockSend = jest.fn();
let mockUser: any = null;
let mockAuthChanged: () => void;
let mockStorageFailures = 0;
let mockUuid = 0;
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => { if (mockStorageFailures-- > 0) throw new Error('Temporary disk failure'); mockStorage.set(key, value); },
} }));
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `aaaaaaaa-bbbb-cccc-dddd-${String(++mockUuid).padStart(12, '0')}` }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: any, callback: () => void) => { mockAuthChanged = callback; return () => {}; } }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockSend }));
jest.mock('@/firebase/config', () => ({ getFirebase: () => ({ auth: { get currentUser() { return mockUser; } }, functions: {} }) }));
const key = 'teamder:onboarding-activity:v1';

beforeEach(() => { jest.resetModules(); jest.useFakeTimers(); mockStorage.clear(); mockSend.mockReset(); mockUser = null; mockStorageFailures = 0; mockUuid = 0; });
afterEach(() => { jest.useRealTimers(); });
async function drain() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
test('pre-auth taps persist and are delivered when existing guest authentication is ready', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite', password: 'never' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend).not.toHaveBeenCalled();
  expect(JSON.parse(mockStorage.get(key)!)[0].params).toEqual({ intent: 'invite' });
  mockUser = { uid: 'guest' };
  mockSend.mockImplementation(async ({ events }) => ({ data: { acknowledged: events.map((event: any) => event.id) } }));
  mockAuthChanged(); await jest.advanceTimersByTimeAsync(2000); await drain();
  expect(mockSend).toHaveBeenCalledTimes(1); expect(JSON.parse(mockStorage.get(key)!)).toEqual([]);
});
test('network failure retains original event IDs and repeated clicks are separate', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockUser = { uid: 'guest' }; mockSend.mockRejectedValueOnce(new Error('offline'));
  recordOnboardingActivity('entry_intent_selected', { intent: 'create_club' });
  recordOnboardingActivity('entry_intent_selected', { intent: 'create_club' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  const before = JSON.parse(mockStorage.get(key)!); expect(before).toHaveLength(2); expect(before[0].id).not.toBe(before[1].id);
  mockSend.mockImplementation(async ({ events }) => ({ data: { acknowledged: events.map((event: any) => event.id) } }));
  await jest.advanceTimersByTimeAsync(4000); await drain();
  expect(mockSend.mock.calls[1][0].events.map((event: any) => event.id)).toEqual(before.map((event: any) => event.id));
  expect(JSON.parse(mockStorage.get(key)!)).toEqual([]);
});
test('unrelated application actions do not enter the remote stream', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  recordOnboardingActivity('chat_message_sent', { text: 'private' });
  await drain(); expect(mockStorage.size).toBe(0);
});
test('temporary storage failure keeps the tap in memory for the next attempt', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockUser = { uid: 'guest' }; mockStorageFailures = 1;
  mockSend.mockImplementation(async ({ events }) => ({ data: { acknowledged: events.map((event: any) => event.id) } }));
  recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  await drain(); await jest.advanceTimersByTimeAsync(4000); await drain();
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend.mock.calls[0][0].events[0].params).toEqual({ intent: 'find_game' });
  expect(JSON.parse(mockStorage.get(key)!)).toEqual([]);
});

function succeed() { mockSend.mockImplementation(async ({ events }) => ({ data: { acknowledged: events.map((event: any) => event.id) } })); }
test('queued events never migrate to a different account and logout starts a new journey', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockUser = { uid: 'first' }; mockSend.mockRejectedValue(new Error('offline'));
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  const old = JSON.parse(mockStorage.get(key)!)[0];
  mockUser = null; mockAuthChanged(); mockUser = { uid: 'second' }; mockAuthChanged();
  recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  succeed(); await drain(); await jest.advanceTimersByTimeAsync(4000); await drain();
  const batch = mockSend.mock.calls[1][0];
  expect(batch.expectedUid).toBe('second'); expect(batch.events).toHaveLength(1);
  expect(batch.events[0].ownerUid).toBe('second'); expect(batch.events[0].sessionId).not.toBe(old.sessionId);
  expect(JSON.parse(mockStorage.get(key)!)).toEqual([old]);
});
test('verified guest credential link keeps the same UID and queued journey', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockUser = { uid: 'same', isAnonymous: true }; mockSend.mockRejectedValue(new Error('offline'));
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  const first = JSON.parse(mockStorage.get(key)!)[0];
  mockUser = { uid: 'same', isAnonymous: false }; mockAuthChanged();
  recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  succeed(); await drain(); await jest.advanceTimersByTimeAsync(4000);
  expect(mockSend.mock.calls[1][0].events.map((e: any) => e.sessionId)).toEqual([first.sessionId, first.sessionId]);
});
test('malformed persisted rows and future device times do not block a valid action', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockStorage.set(key, JSON.stringify([{ id: 'broken' }])); mockUser = { uid: 'same' }; succeed();
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend).toHaveBeenCalledTimes(1); expect(mockSend.mock.calls[0][0].events).toHaveLength(1);
  expect(mockStorage.has('teamder:onboarding-activity:quarantine')).toBe(true);
});
test('invalid JSON is isolated without dropping the newly recorded action', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockStorage.set(key, '{broken'); mockUser = { uid: 'same' }; succeed();
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend).toHaveBeenCalledTimes(1); expect(JSON.parse(mockStorage.get(key)!)).toEqual([]);
});
test('a permanent server rejection is isolated from the next valid event', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockUser = { uid: 'same' };
  mockSend.mockImplementation(async ({ events }) => {
    if (events.some((e: any) => e.params.intent === 'invite')) throw Object.assign(new Error('bad'), { code: 'functions/invalid-argument' });
    return { data: { acknowledged: events.map((e: any) => e.id) } };
  });
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend).toHaveBeenCalledTimes(3); expect(JSON.parse(mockStorage.get(key)!)).toEqual([]);
});

test('explicit logout creates a new journey even when the same UID is immediately restored', async () => {
  const { recordOnboardingActivity, resetOnboardingJourney } = require('@/services/onboardingActivity');
  mockUser = { uid: 'same' }; succeed();
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  const oldSession = mockSend.mock.calls[0][0].events[0].sessionId;
  resetOnboardingJourney();
  recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend.mock.calls[1][0].events[0].sessionId).not.toBe(oldSession);
});
test('future timestamp row does not poison a following normal action', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockUser = { uid: 'same' }; succeed();
  mockStorage.set(key, JSON.stringify([{ id: 'valid-session-1', sessionId: 'valid-session', sequence: 1,
    occurredAt: Date.now() + 172800000, action: 'entry_intent_selected', params: {}, ownerUid: 'same' }]));
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend.mock.calls[0][0].events).toHaveLength(1);
  expect(mockSend.mock.calls[0][0].events[0].params.intent).toBe('invite');
});

test('direct guest switch into an existing UID keeps the old guest events separate', async () => {
  const { recordOnboardingActivity } = require('@/services/onboardingActivity');
  mockUser = { uid: 'guest-a', isAnonymous: true }; mockSend.mockRejectedValue(new Error('offline'));
  recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  mockUser = { uid: 'existing-b', isAnonymous: false }; mockAuthChanged();
  recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  succeed(); await drain(); await jest.advanceTimersByTimeAsync(4000);
  const sent = mockSend.mock.calls[1][0];
  expect(sent.expectedUid).toBe('existing-b'); expect(sent.events).toHaveLength(1);
  expect(sent.events[0].params.intent).toBe('find_game');
  expect(JSON.parse(mockStorage.get(key)!)[0].ownerUid).toBe('guest-a');
});
test('persisted ownership survives a process restart with a different account', async () => {
  let service = require('@/services/onboardingActivity');
  mockUser = { uid: 'first' }; mockSend.mockRejectedValue(new Error('offline'));
  service.recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  jest.clearAllTimers(); jest.resetModules(); service = require('@/services/onboardingActivity');
  mockUser = { uid: 'second' }; succeed();
  service.recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend.mock.calls[1][0].events).toHaveLength(1);
  expect(mockSend.mock.calls[1][0].events[0].ownerUid).toBe('second');
  expect(JSON.parse(mockStorage.get(key)!)[0].ownerUid).toBe('first');
});

test('restart before authentication isolates the abandoned unowned journey without attributing it to the new account', async () => {
  let service = require('@/services/onboardingActivity');
  service.recordOnboardingActivity('entry_intent_selected', { intent: 'invite' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(JSON.parse(mockStorage.get(key)!)[0].ownerUid).toBeNull();
  jest.clearAllTimers(); jest.resetModules(); service = require('@/services/onboardingActivity');
  mockUser = { uid: 'new-account' }; succeed();
  service.recordOnboardingActivity('entry_intent_selected', { intent: 'find_game' });
  await drain(); await jest.advanceTimersByTimeAsync(2000);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend.mock.calls[0][0].events).toHaveLength(1);
  expect(mockSend.mock.calls[0][0].events[0].params.intent).toBe('find_game');
  expect(JSON.parse(mockStorage.get(key)!)).toEqual([]);
  expect(JSON.parse(mockStorage.get('teamder:onboarding-activity:quarantine')!)).toMatchObject({count:1});
});

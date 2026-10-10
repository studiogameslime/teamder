import fs from 'fs';
import { ONBOARDING_ACTIONS, safeActivityParams } from '@/utils/onboardingActivity';

const mockDocs = new Map<string, any>();
const mockSends = jest.fn(async (_message: any) => ({ successCount: 1, failureCount: 0, responses: [{}] }));
const mockRef = (path: string) => ({ path,
  get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
  update: async (values: any) => mockDocs.set(path, { ...mockDocs.get(path), ...values }),
});
jest.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: (name: string) => ({ doc: (id: string) => mockRef(`${name}/${id}`) }),
    doc: mockRef,
    runTransaction: async (work: any) => work({
      getAll: async (...refs: any[]) => Promise.all(refs.map(ref => ref.get())),
      set: (ref: any, data: any) => mockDocs.set(ref.path, data),
      create: (ref: any, data: any) => mockDocs.set(ref.path, data),
    }),
  }),
  messaging: () => ({ sendEachForMulticast: mockSends }),
}), { virtual: true });
jest.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: any, handler: any) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}), { virtual: true });
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_options: any, handler: any) => handler }), { virtual: true });
import { recordOnboardingActivity, onOnboardingActivity } from '../../functions/src/onboardingActivity';
const ingest = recordOnboardingActivity as unknown as (request: any) => Promise<any>;
const deliver = onOnboardingActivity as unknown as (event: any) => Promise<any>;
const event = { id: 'session-abcdef-1', sessionId: 'session-abcdef', sequence: 1, occurredAt: 100, action: 'entry_intent_selected', params: { intent: 'create_club', password: 'secret', is_guest: true } };
const request = (events = [event]) => ({ auth: { uid: 'real-user', token: { firebase: { sign_in_provider: 'anonymous' } } }, data: { events } });
beforeEach(() => { mockDocs.clear(); mockSends.mockClear(); });

test('catalog copies stay identical; arbitrary actions and private field values are not uploaded', () => {
  const source = fs.readFileSync('src/utils/onboardingActivity.ts', 'utf8').replace(/\r/g, '');
  for (const path of ['functions/src/onboardingActivityCatalog.ts', 'pulse/src/services/onboardingActivityCatalog.ts']) expect(fs.readFileSync(path, 'utf8').replace(/\r/g, '')).toBe(source);
  expect(safeActivityParams({ password: 'secret', email: 'private', name: 'private', query: 'private', intent: 'invite', slide: 2, reason: NaN })).toEqual({ intent: 'invite', slide: 2 });
  expect(ONBOARDING_ACTIONS.entry_intent_selected).toBeDefined();
});
test('replaying a timed-out batch acknowledges it without duplicating history or its quota', async () => {
  await ingest(request()); await ingest(request());
  expect([...mockDocs.keys()].filter(path => path.startsWith('onboardingActivity/'))).toHaveLength(1);
  const row = [...mockDocs.entries()].find(([path]) => path.startsWith('onboardingActivity/'))![1];
  expect(row.uid).toBe('real-user'); expect(row.params).toEqual({ intent: 'create_club', is_guest: true });
  expect(mockDocs.get('onboardingActivityLimits/real-user').count).toBe(1);
});
test('rejects unauthenticated, unknown and duplicate events', async () => {
  await expect(ingest({ data: { events: [event] } })).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(ingest(request([{ ...event, action: '__proto__' }]))).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(ingest(request([event, event]))).rejects.toMatchObject({ code: 'invalid-argument' });
});
test('different milestone choices send pushes, but repeated taps and trigger replays do not', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  for (const id of ['first', 'second', 'repeat']) {
    const ref = mockRef(`onboardingActivity/${id}`);
    mockDocs.set(ref.path, { ...event, params: { is_guest: true, intent: id === 'second' ? 'find_game' : 'create_club' }, uid: 'real-user', label: 'בחר איך להתחיל', pushStatus: 'pending' });
    await deliver({ data: { ref }, params: { eventId: id } });
    await deliver({ data: { ref }, params: { eventId: id } });
  }
  expect(mockSends).toHaveBeenCalledTimes(2);
  expect(mockSends.mock.calls[0][0].data.type).toBe('onboardingActivity');
});

test('all other onboarding actions remain history-only, including existing registration/creation alerts', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  for (const action of Object.keys(ONBOARDING_ACTIONS).filter(action => !['entry_source_resolved', 'entry_intent_selected'].includes(action))) {
    const ref = mockRef(`onboardingActivity/${action}`);
    mockDocs.set(ref.path, { ...event, action, uid: 'real-user' });
    await deliver({ data: { ref }, params: { eventId: action } });
    expect(mockDocs.get(ref.path).pushStatus).toBe('history_only');
  }
  expect(mockSends).not.toHaveBeenCalled();
});

test('guest entry sends one push per visit; existing-account entry does not', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  for (const [id, guest] of [['entry-one', true], ['entry-again', true], ['member', false]] as const) {
    const ref = mockRef(`onboardingActivity/${id}`);
    mockDocs.set(ref.path, { ...event, action: 'entry_source_resolved', params: { is_guest: guest, has_inviter: true }, uid: 'real-user' });
    await deliver({ data: { ref }, params: { eventId: id } });
  }
  expect(mockSends).toHaveBeenCalledTimes(1);
  expect(mockSends.mock.calls[0][0].notification.body).toContain('נכנס לאפליקציה דרך הזמנה');
});
test('mute preserves history and does not send push', async () => {
  mockDocs.set('adminConfig/prefs', { onboardingActivity: false });
  const ref = mockRef('onboardingActivity/muted'); mockDocs.set(ref.path, { ...event, uid: 'real-user' });
  await deliver({ data: { ref }, params: { eventId: 'muted' } });
  expect(mockSends).not.toHaveBeenCalled(); expect(mockDocs.get(ref.path).pushStatus).toBe('muted');
});

test('every existing analytics call site in the active onboarding screens is catalogued', () => {
  const analytics = fs.readFileSync('src/services/analyticsService.ts', 'utf8');
  const names = Object.fromEntries([...analytics.matchAll(/\b(\w+):\s*'([^']+)'/g)].map(match => [match[1], match[2]]));
  const paths = ['src/screens/SplashScreen.tsx', 'src/screens/entry/IntentScreen.tsx', 'src/screens/onboarding/PostSignInOnboardingScreen.tsx', 'src/screens/auth/EmailAuthScreen.tsx', 'src/screens/auth/SignInScreen.tsx', 'src/screens/auth/ProfileSetupScreen.tsx', 'src/components/auth/ContextualAuthSheet.tsx'];
  for (const path of paths) for (const match of fs.readFileSync(path, 'utf8').matchAll(/logEvent\(AnalyticsEvent\.(\w+)/g)) {
    expect({ path, event: names[match[1]], covered: Object.prototype.hasOwnProperty.call(ONBOARDING_ACTIONS, names[match[1]]) }).toEqual({ path, event: names[match[1]], covered: true });
  }
});

test('rejects a batch when its expected owner differs from the authenticated token', async () => {
  await expect(ingest({ ...request(), data: { events: [event], expectedUid: 'previous-user' } })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockDocs.size).toBe(0);
});
test('partial delivery retries only transiently failed devices and preserves cumulative counts', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['ok', 'retry', 'invalid'] });
  const ref = mockRef('onboardingActivity/partial'); mockDocs.set(ref.path, { ...event, uid: 'real-user' });
  mockSends.mockResolvedValueOnce({ successCount: 1, failureCount: 2, responses: [
    { success: true }, { error: { code: 'messaging/internal-error' } }, { error: { code: 'messaging/invalid-registration-token' } },
  ] } as any);
  await expect(deliver({ data: { ref }, params: { eventId: 'partial' } })).rejects.toThrow('Transient');
  mockSends.mockResolvedValueOnce({ successCount: 1, failureCount: 0, responses: [{ success: true }] } as any);
  await deliver({ data: { ref }, params: { eventId: 'partial' } });
  expect(mockSends.mock.calls[1][0].tokens).toEqual(['retry']);
  expect(mockDocs.get(ref.path)).toMatchObject({ pushStatus: 'sent', deliveredDevices: 2, failedDevices: 1 });
  expect(mockDocs.get(ref.path).deliveredTargets).toHaveLength(2);
});

test('APNS collapse identifier is stable per event and stays within its 64-byte limit', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  const ref = mockRef('onboardingActivity/collapse'); mockDocs.set(ref.path, { ...event, uid: 'real-user' });
  await deliver({ data: { ref }, params: { eventId: 'collapse' } });
  const header = mockSends.mock.calls[0][0].apns.headers['apns-collapse-id'];
  expect(header).toMatch(/^[a-f0-9]{64}$/);
  expect(Buffer.byteLength(header,'utf8')).toBe(64);
  const {createHash}=require('crypto');
  expect(header).toBe(createHash('sha256').update('collapse').digest('hex'));
});

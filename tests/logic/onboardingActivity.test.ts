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
jest.doMock(require.resolve('firebase-functions/v2/firestore', { paths: [process.cwd() + '/functions'] }), () => ({ onDocumentCreated: (_options: any, handler: any) => handler }));
const { recordOnboardingActivity, onOnboardingActivity } = require('../../functions/src/onboardingActivity');
import { onboardingGuestNumber } from '../../functions/src/onboardingGuest';
const ingest = recordOnboardingActivity as unknown as (request: any) => Promise<any>;
const deliver = onOnboardingActivity as unknown as (event: any) => Promise<any>;
const event = { id: 'session-abcdef-1', sessionId: 'session-abcdef', sequence: 1, occurredAt: 100, action: 'entry_intent_selected', params: { intent: 'create_club', password: 'secret', is_guest: true } };
const request = (events: Array<Omit<typeof event, 'params'> & { params: Record<string, unknown> }> = [event]) => ({ auth: { uid: 'real-user', token: { firebase: { sign_in_provider: 'anonymous' } } }, data: { events } });
beforeEach(() => { mockDocs.clear(); mockSends.mockClear(); });

test('catalog copies stay identical; arbitrary actions and private field values are not uploaded', () => {
  const source = fs.readFileSync('src/utils/onboardingActivity.ts', 'utf8').replace(/\r/g, '');
  for (const path of ['functions/src/onboardingActivityCatalog.ts', 'pulse/src/services/onboardingActivityCatalog.ts']) expect(fs.readFileSync(path, 'utf8').replace(/\r/g, '')).toBe(source);
  expect(safeActivityParams({ password: 'secret', email: 'private', name: 'private', query: 'private', intent: 'invite', slide: 2, reason: NaN })).toEqual({ intent: 'invite', slide: 2 });
  expect(ONBOARDING_ACTIONS.entry_intent_selected).toBeDefined();
  expect(safeActivityParams({entry_channel:'https://private.test',entry_campaign:'a@b.test'})).toEqual({});
});
test('replaying a timed-out batch acknowledges it without duplicating history or its quota', async () => {
  await ingest(request()); await ingest(request());
  expect([...mockDocs.keys()].filter(path => path.startsWith('onboardingActivity/'))).toHaveLength(1);
  const row = [...mockDocs.entries()].find(([path]) => path.startsWith('onboardingActivity/'))![1];
  expect(row.uid).toBe('real-user'); expect(row.params).toEqual({ intent: 'create_club', is_guest: true });
  expect(mockDocs.get('onboardingActivityLimits/real-user').count).toBe(1);
});

test('guest numbers belong to authenticated UIDs, survive upgrades and visits, and cannot be supplied by clients', async () => {
  await ingest(request());
  expect(await onboardingGuestNumber('real-user')).toBe(1);
  await ingest(request([{ ...event, id: 'session-second-1', sessionId: 'session-second', params: { is_guest: true, guestNumber: 999 } } as any]));
  expect(await onboardingGuestNumber('real-user')).toBe(1);
  expect(await onboardingGuestNumber('another-guest', true)).toBe(2);
  await ingest({ ...request([{ ...event, id: 'session-abcdef-2', sequence: 2, action: 'auth_completed', params: { auth_method: 'google' } } as any]), auth: { uid: 'real-user', token: { firebase: { sign_in_provider: 'google.com' } } } });
  const rows = [...mockDocs.entries()].filter(([path]) => path.startsWith('onboardingActivity/')).map(([, row]) => row);
  expect(rows.every(row => row.guestNumber === 1)).toBe(true);
  expect(await onboardingGuestNumber('unseen-member')).toBeUndefined();
});

test('ordered choices preserve previous selection, allow returning to the first choice and survive trigger reordering', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  const intents = ['create_club', 'create_club', 'one_off_game', 'create_club'];
  await ingest(request(intents.map((intent, i) => ({ ...event, id: `${event.sessionId}-${i + 1}`, sequence: i + 1, params: { intent, is_guest: true } }))));
  const rows = [...mockDocs.entries()].filter(([path]) => path.startsWith('onboardingActivity/'));
  for (const [path] of [...rows].reverse()) {
    await deliver({ data: { ref: mockRef(path) }, params: { eventId: path.split('/')[1] } });
  }
  expect(mockSends).toHaveBeenCalledTimes(3);
  expect(rows[2][1].previousIntent).toBe('create_club');
  expect(rows[3][1].previousIntent).toBe('one_off_game');
  expect(mockDocs.get(rows[1][0]).pushStatus).toBe('milestone_duplicate');
  const bodies = mockSends.mock.calls.map(([message]) => message.notification.body);
  expect(bodies.every(body => body.includes('אורח 1'))).toBe(true);
  expect(bodies.filter(body => body.includes('שינה בחירה'))).toHaveLength(2);
  await ingest(request(intents.map((intent, i) => ({ ...event, id: `${event.sessionId}-${i + 1}`, sequence: i + 1, params: { intent, is_guest: true } }))));
  expect(mockDocs.get('onboardingActivityLimits/real-user').count).toBe(4);
});

test('launch context enriches older clients across batches without overwriting explicit current event context', async () => {
  await ingest(request([{ ...event, action: 'entry_source_resolved', params: { entry_source: 'club_link', entry_channel: 'whatsapp', is_guest: true } } as any]));
  await ingest(request([{ ...event, id: `${event.sessionId}-2`, sequence: 2 }]));
  const rows = [...mockDocs.entries()].filter(([path]) => path.startsWith('onboardingActivity/')).map(([, row]) => row);
  expect(rows[1].params).toMatchObject({ entry_source: 'club_link', entry_channel: 'whatsapp', intent: 'create_club' });
});

test('the inviter from this visit survives later batches and is resolved server-side for the first authentication push', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  mockDocs.set('users/link-inviter', { name: 'רועי אורן' });
  mockDocs.set('users/real-user', { invitedBy: 'old-inviter' });
  mockDocs.set('users/old-inviter', { name: 'מזמין מהעבר' });
  await ingest(request([{ ...event, action: 'entry_source_resolved', params: { entry_source: 'club_link', has_inviter: true, inviter_uid: 'link-inviter', inviter_name: 'מזויף' } } as any]));
  await ingest({ ...request([{ ...event, id: `${event.sessionId}-2`, sequence: 2, action: 'auth_completed', params: { is_guest: false, auth_method: 'google' } } as any]), auth: { uid: 'real-user', token: { firebase: { sign_in_provider: 'google.com' } } } });
  const path = [...mockDocs.keys()].filter(path => path.startsWith('onboardingActivity/'))[1];
  expect(mockDocs.get(path).params.inviter_uid).toBe('link-inviter');
  await deliver({ data: { ref: mockRef(path) }, params: { eventId: path.split('/')[1] } });
  expect(mockSends.mock.calls[0][0].notification.body).toContain('דרך \u2068רועי אורן\u2069');
  expect(mockSends.mock.calls[0][0].notification.body).not.toMatch(/מזמין מהעבר|מזויף/);
});

test('registration prompt and successful account upgrade retain the same guest number', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  await ingest(request([{ ...event, action: 'auth_prompt_shown', params: { action_kind: 'create_club' } } as any]));
  const first = [...mockDocs.keys()].find(path => path.startsWith('onboardingActivity/'))!;
  await deliver({ data: { ref: mockRef(first) }, params: { eventId: first.split('/')[1] } });
  expect(mockSends.mock.calls[0][0].notification.body).toContain('אורח 1');
  expect(mockSends.mock.calls[0][0].notification.body).toContain('פתח את תהליך ההרשמה או ההתחברות');
  mockDocs.set('users/real-user', { name: 'מתן' });
  await ingest({ ...request([{ ...event, id: `${event.sessionId}-2`, sequence: 2, action: 'auth_completed', params: { auth_method: 'google' } } as any]), auth: { uid: 'real-user', token: { firebase: { sign_in_provider: 'google.com' } } } });
  const last = [...mockDocs.keys()].filter(path => path.startsWith('onboardingActivity/'))[1];
  await deliver({ data: { ref: mockRef(last) }, params: { eventId: last.split('/')[1] } });
  expect(mockSends.mock.calls[1][0].notification.body).toContain('מתן');
  expect(mockSends.mock.calls[1][0].notification.body).toContain('(אורח 1)');
});

test('corrupt numbering state fails rather than reusing a previously allocated guest number', async () => {
  mockDocs.set('adminConfig/onboardingGuestCounter', { lastNumber: -1 });
  await expect(onboardingGuestNumber('new-guest', true)).rejects.toThrow('Invalid onboarding guest counter');
  expect(mockDocs.has('onboardingGuests/new-guest')).toBe(false);
});

test('guest history first uploaded after an in-place upgrade still receives its number', async () => {
  await ingest({ ...request(), auth: { uid: 'real-user', token: { firebase: { sign_in_provider: 'google.com' } } } });
  expect(await onboardingGuestNumber('real-user')).toBe(1);
  const row = [...mockDocs.entries()].find(([path]) => path.startsWith('onboardingActivity/'))![1];
  expect(row).toMatchObject({ anonymous: false, guestNumber: 1 });
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
  for (const action of Object.keys(ONBOARDING_ACTIONS).filter(action => !['entry_source_resolved', 'entry_intent_selected','auth_completed','sign_in_success','auth_prompt_shown'].includes(action))) {
    const ref = mockRef(`onboardingActivity/${action}`);
    mockDocs.set(ref.path, { ...event, action, uid: 'real-user' });
    await deliver({ data: { ref }, params: { eventId: action } });
    expect(mockDocs.get(ref.path).pushStatus).toBe('history_only');
  }
  expect(mockSends).not.toHaveBeenCalled();
});

test('entry is sent once per visit for guests and restored accounts', async () => {
  mockDocs.set('adminConfig/push', { tokens: ['device'] });
  for (const [id, guest] of [['entry-one', true], ['entry-again', true], ['member', false]] as const) {
    const ref = mockRef(`onboardingActivity/${id}`);
    mockDocs.set(ref.path, { ...event, sessionId:guest?event.sessionId:'member-session',action: 'entry_source_resolved', params: { is_guest: guest, entry_source:'club_link',has_inviter: false }, uid: 'real-user' });
    await deliver({ data: { ref }, params: { eventId: id } });
  }
  expect(mockSends).toHaveBeenCalledTimes(2);
  expect(mockSends.mock.calls[0][0].notification.body).toContain('מקור: קישור למועדון');
  expect(mockSends.mock.calls[1][0].notification.body).toContain('משתמש מחובר ללא שם');
});

test('authenticated success has one milestone across both login paths, guest auth remains history only',async()=>{
  mockDocs.set('adminConfig/push',{tokens:['device']});
  mockDocs.set('users/real-user',{name:'מתן'});
  for(const [id,action,params] of [
    ['guest','sign_in_success',{method:'guest'}],
    ['authenticated','auth_completed',{auth_method:'google',entry_source:'personal_invite'}],
    ['again','sign_in_success',{method:'google',entry_source:'personal_invite'}],
  ] as const){
    const ref=mockRef(`onboardingActivity/${id}`);
    mockDocs.set(ref.path,{...event,action,params,uid:'real-user',anonymous:false});
    await deliver({data:{ref},params:{eventId:id}});
  }
  expect(mockSends).toHaveBeenCalledTimes(1);
  expect(mockSends.mock.calls[0][0].notification).toEqual({title:'התחברות לחשבון',body:expect.stringContaining('מתן')});
  expect(mockDocs.get('onboardingActivity/authenticated').pushBody).toContain('באמצעות גוגל');
  expect(mockDocs.get('onboardingActivity/guest').pushStatus).toBe('history_only');
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

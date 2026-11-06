const mockStorage = new Map<string, string>();
let mockBrokenUuid = false, mockId = 0;
const mockDiagnostic = jest.fn();
const mockAuth: {currentUser:{uid:string}|null}={currentUser:{uid:'alice'}};
let mockAuthChanged:(()=>void)|undefined;
let mockAppChanged:((state:string)=>void)|undefined;
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: async (k: string) => mockStorage.get(k) ?? null, setItem: async (k: string, v: string) => { mockStorage.set(k, v); } } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => { if (mockBrokenUuid) throw new Error('native unavailable'); return `visit-00000-${++mockId}`; } }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.3' }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: (_:string, cb:(state:string)=>void) => {mockAppChanged=cb;return { remove: jest.fn() };} } }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_:unknown, cb:()=>void) => {mockAuthChanged=cb;return ()=>{};} }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: { acknowledged: [] } }) }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ auth: mockAuth, functions: {} }) }));
jest.mock('../../src/services/diagnosticJournal', () => ({ recordDiagnostic: (...args: any[]) => mockDiagnostic(...args) }));
beforeEach(() => { jest.resetModules(); jest.useFakeTimers(); mockStorage.clear(); mockDiagnostic.mockReset(); mockBrokenUuid = false; mockId = 0; mockAuth.currentUser={uid:'alice'}; mockAuthChanged=undefined; mockAppChanged=undefined; process.env.EXPO_PUBLIC_USAGE_ACTIVITY_ENABLED = 'true'; });
afterEach(() => { jest.useRealTimers(); delete process.env.EXPO_PUBLIC_USAGE_ACTIVITY_ENABLED; });

test('collector initialization/id failures do not escape into navigation or registration', () => {
  mockBrokenUuid = true;
  const service = require('../../src/services/usageActivity');
  const stop = service.startUsageActivity();
  expect(() => service.recordUsageScreen({ name: 'MatchDetails', params: { gameId: 'a' } })).not.toThrow();
  expect(() => service.beginUsageRegistration('a', 'operation-a')('players')).not.toThrow();
  expect(() => service.resetUsageVisit()).not.toThrow();
  expect(mockDiagnostic).toHaveBeenCalled(); stop();
});
test('default-off gate creates no queue, listeners or storage writes', async () => {
  delete process.env.EXPO_PUBLIC_USAGE_ACTIVITY_ENABLED;
  const service = require('../../src/services/usageActivity'); const stop = service.startUsageActivity();
  service.recordUsageScreen({ name: 'Profile' }); await Promise.resolve();
  expect(mockStorage.size).toBe(0); stop();
});
test('context changes on one route do not inherit the previous club tab', async () => {
  const service = require('../../src/services/usageActivity'), stop = service.startUsageActivity();
  service.recordUsageScreen({ name: 'CommunityDetails', key: 'one-route', params: { groupId: 'a' } });
  service.setUsageSection('one-route', 'CommunityDetails', { groupId: 'a' }, 'stats');
  service.recordUsageScreen({ name: 'CommunityDetails', key: 'one-route', params: { groupId: 'b' } });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  const rows = JSON.parse(mockStorage.get('teamder:usage-activity:v1') ?? '[]');
  expect(rows.filter((r: any) => r.action === 'screen_view').map((r: any) => [r.groupId, r.section])).toEqual([['a', 'info'], ['a', 'stats'], ['b', 'info']]); stop();
});
test('account deletion also clears its stored events when the collection gate is disabled', async () => {
  delete process.env.EXPO_PUBLIC_USAGE_ACTIVITY_ENABLED;
  const service = require('../../src/services/usageActivity');
  mockStorage.set('teamder:usage-activity:v1', JSON.stringify([{ ownerUid: 'alice' }, { ownerUid: 'bob' }]));
  await service.forgetUsageUser('alice');
  expect(JSON.parse(mockStorage.get('teamder:usage-activity:v1')!)).toEqual([{ ownerUid: 'bob' }]);
});

test.each([true,false])('a previous account location is never replayed for another account (sign out first: %s)',async(signOut)=>{
  const service=require('../../src/services/usageActivity');
  const stop=service.startUsageActivity();
  service.recordUsageScreen({name:'MatchDetails',key:'round',params:{gameId:'alice-private-round',token:'not-for-storage'}});
  if(signOut){mockAuth.currentUser=null;mockAuthChanged!();}
  mockAuth.currentUser={uid:'bob'};mockAuthChanged!();
  mockAppChanged!('background');mockAppChanged!('active');
  service.recordUsageScreen({name:'Profile',key:'home'});
  for(let i=0;i<65;i++)await Promise.resolve();
  const raw=mockStorage.get('teamder:usage-activity:v1')??'[]';
  const rows=JSON.parse(raw);
  expect(rows.filter((r:any)=>r.ownerUid==='alice'&&r.action==='screen_view').map((r:any)=>r.gameId)).toEqual(['alice-private-round']);
  expect(rows.filter((r:any)=>r.ownerUid==='bob'&&r.action==='screen_view').map((r:any)=>r.screen)).toEqual(['Profile']);
  expect(raw).not.toContain('not-for-storage');
  stop();
});

test('chat text and player search terms never reach the persisted usage queue',async()=>{
  const service=require('../../src/services/usageActivity'),stop=service.startUsageActivity();
  service.recordUsageScreen({name:'DirectChat',key:'conversation',params:{text:'private-message-marker',convId:'private-peer'}});
  service.recordUsageScreen({name:'Players',key:'search',params:{query:'private-search-marker',name:'private-name-marker'}});
  for(let i=0;i<40;i++)await Promise.resolve();
  const raw=mockStorage.get('teamder:usage-activity:v1')??'[]';
  expect(raw).not.toMatch(/private-(message|peer|search|name)/);
  expect(JSON.parse(raw).filter((r:any)=>r.action==='screen_view').map((r:any)=>r.screen)).toEqual(['Players']);
  stop();
});

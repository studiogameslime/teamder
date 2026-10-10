const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockDisk.delete(key); }),
}}));
jest.mock('expo-linking', () => ({ parse: (input: string) => {
  const u = new URL(input); const queryParams: Record<string,string> = {};
  u.searchParams.forEach((v,k) => { queryParams[k] = v; });
  return { scheme: u.protocol.slice(0,-1), hostname: u.hostname, path: u.pathname.replace(/^\//,''), queryParams };
}}));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn(() => ({remove: jest.fn()})) } }));
jest.mock('@/services/errorLog', () => ({logError: jest.fn()}));
import { storage, type PendingInvite } from '@/services/storage';
import { receivePendingInvite, readPendingAction, clearPendingActionIfMatches, writePendingAction } from '@/services/pendingAction';
import { resolveIncomingInvite, retryUnresolvedInvite, startInviteRecovery } from '@/services/incomingInvite';
import { AppState } from 'react-native';
import { parseReferrerInvite } from '@/utils/referrerInvite';
const CREATED = Date.now();
const originalFetch = globalThis.fetch;
test('fresh-user ticket registration and resolution are ordered even when concurrent', async () => {
  mockDisk.set('footy.invite.unresolved', JSON.stringify({url:'https://teamderfc.web.app/i/code',origin:'deep_link'}));
  await Promise.all([storage.registerFreshInviteUser('new-user', CREATED), storage.markInviteAttributionResolved('https://teamderfc.web.app/i/code')]);
  expect(await storage.getFreshInviteUser('new-user')).toEqual({createdAt:CREATED});
});
test('recovery cancels background timers and resumes only on foreground', async () => {
  jest.useFakeTimers();
  const recovered=jest.fn(async()=>{});
  const stop=startInviteRecovery(recovered);
  const listener=(AppState.addEventListener as jest.Mock).mock.calls.slice(-1)[0][1];
  listener('background');
  await jest.advanceTimersByTimeAsync(20000);
  expect(recovered).not.toHaveBeenCalled();
  listener('active');
  await jest.advanceTimersByTimeAsync(1500);
  expect(recovered).toHaveBeenCalledTimes(1);
  stop();jest.useRealTimers();
});
const canonical = (payload: PendingInvite) => {
  globalThis.fetch = jest.fn(async () => ({ok: true, text: async () => JSON.stringify(payload)})) as any;
};
beforeEach(() => { mockDisk.clear(); globalThis.fetch = originalFetch; });
afterEach(() => { globalThis.fetch = originalFetch; });
const urls = [
  ['teamder://session/round1?invitedBy=sender', {type:'session',id:'round1',invitedBy:'sender'}],
  ['teamder://team/club1?invitedBy=sender', {type:'team',id:'club1',invitedBy:'sender'}],
  ['teamder://app?invitedBy=sender', {type:'app',invitedBy:'sender'}],
  ['https://teamderfc.web.app/go?b=d2hhdHNhcHA&l=ad1', {type:'app',source:'whatsapp',linkId:'ad1'}],
] as const;
describe('expanded attribution through actual ingress and persistent services', () => {
  test.each(urls)('%s survives navigation consumption for later signup', async (url, expected) => {
    const parsed = await resolveIncomingInvite(url);
    expect(parsed).toEqual(expected);
    expect(await receivePendingInvite(parsed!)).toBe(true);
    const action = await readPendingAction();
    expect(action).not.toBeNull();
    expect(await clearPendingActionIfMatches(action!)).toBe(true);
    expect(await storage.getPendingInvite()).toBeNull();
    expect(await storage.getInviteAttribution('new-user')).toEqual(expected);
    expect(await storage.getInviteAttribution('different-user')).toBeNull();
  });
  test('plain install cannot freeze out a subsequently resolved referral', async () => {
    await receivePendingInvite({type:'app',source:'play_store'},'deferred_deep_link');
    await receivePendingInvite({type:'team',id:'club',invitedBy:'friend'});
    expect(await storage.getInviteAttribution('new','referral')).toEqual({type:'team',id:'club',invitedBy:'friend'});
    expect(await storage.getInviteAttribution('new','acquisition')).toEqual({type:'app',source:'play_store'});
  });
  test('inviter first and acquisition second remain independently attributable', async () => {
    await receivePendingInvite({type:'app',invitedBy:'friend'});
    await receivePendingInvite({type:'app',source:'facebook',campaign:'campaign',linkId:'ad'});
    expect(await storage.getInviteAttribution('new','referral')).toEqual({type:'app',invitedBy:'friend'});
    expect(await storage.getInviteAttribution('new','acquisition')).toEqual({type:'app',source:'facebook',campaign:'campaign',linkId:'ad'});
  });
  test('later touch cannot overwrite the first inviter or mix acquisition campaigns', async () => {
    await receivePendingInvite({type:'team',id:'first',invitedBy:'first-friend',source:'sms',campaign:'first',linkId:'first-link'});
    await receivePendingInvite({type:'session',id:'newest',invitedBy:'later-friend',source:'facebook',campaign:'later',linkId:'later-link'});
    expect(await readPendingAction()).toMatchObject({kind:'open_game',targetId:'newest'});
    expect(await storage.getInviteAttribution('new','referral')).toMatchObject({invitedBy:'first-friend',id:'first'});
    expect(await storage.getInviteAttribution('new','acquisition')).toMatchObject({source:'sms',campaign:'first',linkId:'first-link'});
  });
  test('deferred referrer supplements attribution without replacing current navigation', async () => {
    await receivePendingInvite({type:'team',id:'current',invitedBy:'friend'});
    const referrer = parseReferrerInvite('utm_source=whatsapp&utm_campaign=launch&type=app&l=ad1');
    expect(referrer).not.toBeNull();
    expect(await receivePendingInvite(referrer!, 'deferred_deep_link')).toBe(false);
    expect(await readPendingAction()).toMatchObject({kind:'open_club',targetId:'current'});
    expect(await storage.getInviteAttribution('new','acquisition')).toMatchObject({source:'whatsapp',campaign:'launch',linkId:'ad1'});
  });
  test('business draft survives deferred invite while referral is retained', async () => {
    await writePendingAction({version:2,kind:'create_club',draftId:'draft1',origin:'in_app',createdAt:1});
    expect(await receivePendingInvite({type:'team',id:'invited-club',invitedBy:'friend'},'deferred_deep_link')).toBe(false);
    expect(await readPendingAction()).toMatchObject({kind:'create_club',draftId:'draft1'});
    expect(await storage.getInviteAttribution('new','referral')).toMatchObject({invitedBy:'friend'});
  });
  test('unresolved query inviter is never credited; canonical owner is used after recovery', async () => {
    globalThis.fetch = jest.fn(async () => {throw new Error('offline');}) as any;
    expect(await resolveIncomingInvite('https://teamderfc.web.app/i/code1?s=whatsapp&invitedBy=forged')).toBeNull();
    expect(await storage.getInviteAttribution('new')).toBeNull();
    canonical({type:'team',id:'club1',invitedBy:'canonical-owner'});
    expect(await retryUnresolvedInvite()).toBe(true);
    expect(await storage.getInviteAttribution('new','referral')).toMatchObject({id:'club1',invitedBy:'canonical-owner'});
    expect(await storage.getInviteAttribution('new','acquisition')).toMatchObject({source:'whatsapp'});
  });
  test('new explicit link cancels an old retry response and retains its attribution', async () => {
    globalThis.fetch = jest.fn(async () => {throw new Error('offline');}) as any;
    await resolveIncomingInvite('https://teamderfc.web.app/i/old');
    let release!: (value: unknown) => void;
    globalThis.fetch = jest.fn(() => new Promise(resolve => {release = resolve;})) as any;
    const retry = retryUnresolvedInvite();
    for (let i=0; i<10 && !release; i++) await Promise.resolve();
    expect(release).toBeDefined();
    const fresh = await resolveIncomingInvite('teamder://team/current?invitedBy=current-friend');
    await receivePendingInvite(fresh!);
    release({ok:true,text:async()=>JSON.stringify({type:'team',id:'stale',invitedBy:'stale-friend'})});
    expect(await retry).toBe(false);
    expect(await readPendingAction()).toMatchObject({targetId:'current'});
    expect(await storage.getInviteAttribution('new','referral')).toMatchObject({invitedBy:'current-friend'});
  });
});

// Short-code ownership comes only from the canonical payload, never query overrides.
test('canonical short code with no owner cannot acquire a forged query inviter', async () => {
  canonical({type:'team',id:'public-club'});
  const invite = await resolveIncomingInvite('https://teamderfc.web.app/i/anonymous?invitedBy=forged');
  expect(invite).toEqual({type:'team',id:'public-club'});
  await receivePendingInvite(invite!);
  expect(await storage.getInviteAttribution('new','referral')).toBeNull();
});


/** Runs the current userService declaration with only its database boundary mocked.
 * This is not a full React/auth emulator run, but does execute the actual writer. */
function accountWriter(existing: Record<string, unknown> = {}) {
  const ts = require('typescript') as typeof import('typescript');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const vm = require('vm') as typeof import('vm');
  const source = fs.readFileSync(path.join(__dirname,'../../src/services/userService.ts'),'utf8');
  const parsed = ts.createSourceFile('userService.ts',source,ts.ScriptTarget.Latest,true);
  const names = ['applyInviteAttributionIfFresh','applyAcquisitionIfFresh'];
  const declarations = parsed.statements.filter((s: any) => names.includes(s.name?.text)).map(s=>s.getText(parsed)).join('\n');
  const serviceDecl: any = parsed.statements.find((s: any) => s.declarationList?.declarations?.some((d: any) => d.name?.text === 'userService'));
  const serviceObject = serviceDecl.declarationList.declarations.find((d:any) => d.name.text === 'userService').initializer;
  const completion = serviceObject.properties.find((p:any)=>p.name?.text === 'completeDeferredInviteAttribution').getText(parsed);
  const auth: any = {currentUser:{uid:'new-user',isAnonymous:false}};
  const patches: Record<string,unknown>[] = [];
  const getDoc = jest.fn(async () => ({exists:()=>true,data:()=>({...existing})}));
  const updateDoc = jest.fn(async (_ref: string, patch: Record<string,unknown>) => {patches.push(patch);Object.assign(existing,patch);});
  const sandbox: any = {storage,USE_MOCK_DATA:false,__DEV__:false,docs:{user:(uid:string)=>uid},getDoc,updateDoc,
    serverTimestamp:()=> 'server-time',logError:jest.fn(),console,Date,getFirebase:()=>({auth})};
  vm.runInNewContext(ts.transpileModule(declarations + '\nconst userService = {'+completion+'}; globalThis.complete = () => userService.completeDeferredInviteAttribution();',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
  return {patches,getDoc,updateDoc,auth,complete:()=>sandbox.complete(),apply:async(uid:string)=>{
    auth.currentUser={uid,isAnonymous:false};
    await sandbox.applyInviteAttributionIfFresh(uid);
    await sandbox.applyAcquisitionIfFresh(uid);
  }};
}
test('resolved referrer reaches actual new-user writer after target consumption', async () => {
  const referrer = parseReferrerInvite('utm_source=whatsapp&utm_campaign=launch&target_type=team&target_id=club1&by=sender&l=ad1');
  expect(referrer).toMatchObject({type:'team',id:'club1'});
  await receivePendingInvite(referrer!, 'deferred_deep_link');
  const action = await readPendingAction();
  await clearPendingActionIfMatches(action!);
  const account = accountWriter();
  await account.apply('new-user');
  expect(account.patches).toEqual([
    {invitedBy:'sender',invitedByType:'team',invitedByTargetId:'club1',invitedAt:'server-time'},
    {acquisition:{source:'whatsapp',campaign:'launch',linkId:'ad1',gameId:'club1',at:expect.any(Number)}}
  ]);
});
test('actual writer does not overwrite existing account attribution', async () => {
  await receivePendingInvite({type:'team',id:'club',invitedBy:'new-friend',source:'sms'});
  const account = accountWriter({invitedBy:'original-friend',acquisition:{source:'original'}});
  await account.apply('user');
  expect(account.patches).toEqual([]);
});
test('actual writer declines self-referral but keeps independently valid acquisition', async () => {
  await receivePendingInvite({type:'app',invitedBy:'user',source:'facebook'});
  const account = accountWriter();
  await account.apply('user');
  expect(account.patches).toEqual([{acquisition:{source:'facebook',at:expect.any(Number)}}]);
});
test('actual writer never credits a different signed-in user from a bound install', async () => {
  await receivePendingInvite({type:'app',invitedBy:'friend',source:'sms'});
  await storage.getInviteAttribution('first-user');
  const account = accountWriter();
  await account.apply('second-user');
  expect(account.patches).toEqual([]);
});


test.each(['', '   '])('legacy target %j is rejected before becoming a navigable action', async id => {
  mockDisk.set('footy.invite.pending',JSON.stringify({type:'team',id,invitedBy:'friend'}));
  expect(await storage.getPendingInvite()).toBeNull();
  expect(await readPendingAction()).toBeNull();
});

async function offlineRegistration(url = 'https://teamderfc.web.app/i/late') {
  globalThis.fetch = jest.fn(async () => {throw new Error('offline');}) as any;
  await resolveIncomingInvite(url);
  await storage.registerFreshInviteUser('new-user',CREATED);
  canonical({type:'team',id:'club1',invitedBy:'friend',source:'whatsapp'});
  await retryUnresolvedInvite();
  return url;
}
test('signup before resolution completes referral on the same fresh account', async () => {
  await offlineRegistration();
  const account = accountWriter({createdAt:CREATED});
  await account.complete();
  expect(account.patches).toContainEqual({invitedBy:'friend',invitedByType:'team',invitedByTargetId:'club1',invitedAt:'server-time'});
});
test('late completion refuses unrelated uid, anonymous user or changed creation timestamp', async () => {
  await offlineRegistration();
  for (const auth of [{uid:'other-user',isAnonymous:false},{uid:'new-user',isAnonymous:true}]) {
    const account = accountWriter({createdAt:CREATED}); account.auth.currentUser=auth;
    await account.complete(); expect(account.patches).toEqual([]);
  }
  const account=accountWriter({createdAt:9999}); await account.complete(); expect(account.patches).toEqual([]);
});
test('expired fresh-account entitlement cannot apply attribution', async () => {
  await offlineRegistration();
  const realNow=Date.now;
  try { Date.now=()=>realNow()+25*60*60*1000;
    const account=accountWriter({createdAt:CREATED});await account.complete();expect(account.patches).toEqual([]);
  } finally {Date.now=realNow;}
});
test('replacement URL cannot inherit the unresolved registration entitlement', async () => {
  await offlineRegistration();
  // A separately registered ticket belongs to old URL, not any later invite.
  mockDisk.clear();mockDisk.set('footy.invite.unresolved',JSON.stringify({url:'https://teamderfc.web.app/i/old',origin:'deep_link'}));
  await storage.registerFreshInviteUser('new-user',CREATED);
  await storage.markInviteAttributionResolved('https://teamderfc.web.app/i/new');
  expect(await storage.getFreshInviteUser('new-user')).toBeNull();
});
test('account change during late completion cancels writes from the old auth session', async () => {
  await offlineRegistration();
  const account=accountWriter({createdAt:CREATED});
  let release!:()=>void;
  account.getDoc.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({exists:()=>true,data:()=>({createdAt:CREATED})});}));
  const pending=account.complete();
  for(let i=0;i<20&&!release;i++)await Promise.resolve();
  expect(release).toBeDefined();account.auth.currentUser={uid:'different-user',isAnonymous:false};release();
  await pending;expect(account.patches).toEqual([]);
});
test('temporary late write failure remains retryable without overwriting success', async () => {
  await offlineRegistration();const account=accountWriter({createdAt:CREATED});
  account.updateDoc.mockRejectedValueOnce(new Error('temporary database failure'));
  await account.complete();expect(account.patches).toEqual([]);
  await account.complete();expect(account.patches).toHaveLength(1);
  await account.complete();expect(account.patches).toHaveLength(1);
});


test('known invite write failure on a fresh signup can recover on a later launch', async () => {
  await receivePendingInvite({type:'team',id:'club1',invitedBy:'friend'});
  await storage.registerFreshInviteUser('new-user',CREATED);
  const account=accountWriter({createdAt:CREATED});
  account.updateDoc.mockRejectedValueOnce(new Error('temporary database failure'));
  await account.apply('new-user');expect(account.patches).toEqual([]);
  await account.complete();expect(account.patches).toHaveLength(1);
});


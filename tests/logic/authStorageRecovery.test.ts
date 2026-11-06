import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { resilientAuthStorage, AuthStorageUnavailableError } from '../../src/utils/resilientAuthStorage';
import { encryptedPersistence } from '../../src/utils/encryptedPersistence';

// Exercise the installed RN SDK, including its real availability probe and
// fallback selection. No native module, credential or network is needed.
const { initializeApp, deleteApp } = require('firebase/app');
const { initializeAuth, getReactNativePersistence, onAuthStateChanged } = require('../../node_modules/@firebase/auth/dist/rn/index.js');
let appSequence = 0;
const makeApp = () => initializeApp({ apiKey: 'local-storage-test', appId: 'local-storage-test', projectId: 'local-storage-test' }, `storage-test-${++appSequence}`);

function restored(auth: unknown, assertAuthStorageRestored: (hasUser: boolean) => void) {
  const source = ts.createSourceFile('auth.ts', fs.readFileSync('src/firebase/auth.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'waitForAuthRestore')!;
  const code = ts.transpileModule(`(${fn.getText(source).replace(/^export\s+/, '')})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(code, { USE_MOCK_DATA: false, getFirebase: () => ({ auth }), ensureIdentityWatch: jest.fn(),
    ensureNativeAuthMirror: jest.fn(), onAuthStateChanged, assertAuthStorageRestored, setTimeout })();
}

test('the actual SDK silently reports signed out when its persistence probe and saved login read fail', async () => {
  const app = makeApp();
  const fail = async () => { throw Error('device locked'); };
  try {
    const auth = initializeAuth(app, { persistence: getReactNativePersistence({ getItem: fail, setItem: fail, removeItem: fail }) });
    await auth.authStateReady();
    expect(auth.currentUser).toBeNull();
  } finally { await deleteApp(app); }
});

test('an exhausted storage failure rejects the real boot waiter instead of allowing a silent guest', async () => {
  const app = makeApp();
  const saved = new Map<string, string>(); let locked = false;
  const encrypted = encryptedPersistence({ getItem: async key => { if (locked) throw Error('device locked'); return saved.get(key) ?? null; },
    setItem: async (key,value) => { if (locked) throw Error('device locked'); saved.set(key,value); },
    removeItem: async key => { if (locked) throw Error('device locked'); saved.delete(key); } },
    { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined }, async key => key.replace(/[^a-zA-Z0-9]/g,''), () => 'fixture');
  await encrypted.setItem(`firebase:authUser:local-storage-test:${app.name}`, 'existing-secret');
  const before = [...saved.entries()]; locked = true;
  const protectedStorage = resilientAuthStorage(encrypted, async () => undefined);
  try {
    const auth = initializeAuth(app, { persistence: getReactNativePersistence(protectedStorage.storage) });
    await expect(restored(auth, protectedStorage.assertRestored)).rejects.toBeInstanceOf(AuthStorageUnavailableError);
    expect([...saved.entries()]).toEqual(before);
    expect(() => protectedStorage.assertRestored(false)).toThrow('Saved authentication could not be accessed');
  } finally { await deleteApp(app); }
});

test('a temporary startup storage failure restores the persisted account using the actual SDK', async () => {
  const app = makeApp(); const previousFetch = global.fetch;
  const token = `${Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:'saved-user',exp:2000000000,iat:1800000000})).toString('base64url')}.fixture`;
  const entries = new Map<string,string>([[`firebase:authUser:local-storage-test:${app.name}`, JSON.stringify({
    uid:'saved-user',emailVerified:false,isAnonymous:false,providerData:[{providerId:'google.com',uid:'fixture'}],
    stsTokenManager:{refreshToken:'fixture',accessToken:token,expirationTime:Date.now()+3600000},
  })]]);
  const getItem = jest.fn(async (key:string) => entries.get(key) ?? null).mockRejectedValueOnce(Error('temporary lock'));
  const protectedStorage = resilientAuthStorage({getItem, setItem:async(k,v)=>{entries.set(k,v);},removeItem:async k=>{entries.delete(k);}},async()=>undefined);
  global.fetch = jest.fn(async () => ({ok:true,json:async()=>({users:[{localId:'saved-user',emailVerified:false,providerUserInfo:[{providerId:'google.com',rawId:'fixture'}]}]})})) as any;
  try {
    const auth=initializeAuth(app,{persistence:getReactNativePersistence(protectedStorage.storage)});
    expect((await restored(auth,protectedStorage.assertRestored)).uid).toBe('saved-user');
    expect(JSON.parse(entries.get(`firebase:authUser:local-storage-test:${app.name}`)!).uid).toBe('saved-user');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally {global.fetch=previousFetch;await deleteApp(app);}
});

test('a clean fresh install still completes boot without a stored account', async () => {
  const app = makeApp(); const entries = new Map<string, string>();
  const protectedStorage = resilientAuthStorage({ getItem: async k => entries.get(k) ?? null,
    setItem: async (k,v) => { entries.set(k,v); }, removeItem: async k => { entries.delete(k); } });
  try {
    const auth = initializeAuth(app, { persistence: getReactNativePersistence(protectedStorage.storage) });
    await expect(restored(auth, protectedStorage.assertRestored)).resolves.toBeNull();
  } finally { await deleteApp(app); }
});

test.each(['getItem', 'setItem', 'removeItem'] as const)('a temporary %s error retries and retains durable availability', async operation => {
  const backing = { getItem: jest.fn(async (_k: string): Promise<string | null> => 'saved'),
    setItem: jest.fn(async (_k: string, _v: string) => undefined), removeItem: jest.fn(async (_k: string) => undefined) };
  backing[operation].mockRejectedValueOnce(Error('temporary lock'));
  const wait = jest.fn(async () => undefined), x = resilientAuthStorage(backing, wait);
  if (operation === 'getItem') expect(await x.storage.getItem('login')).toBe('saved');
  else if (operation === 'setItem') await x.storage.setItem('login', 'saved');
  else await x.storage.removeItem('login');
  expect(backing[operation]).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledWith(150);
  expect(() => x.assertRestored(false)).not.toThrow();
});

test('exhausted errors use a typed diagnostic without leaking the credential or storage key', async () => {
  const x = resilientAuthStorage({ getItem: async () => { throw Error('secret credential'); }, setItem: async () => undefined,
    removeItem: async () => undefined }, async () => undefined);
  const error = await x.storage.getItem('secret-key').catch(e => e);
  expect(error.code).toBe('AUTH_STORAGE_UNAVAILABLE');
  expect(JSON.stringify(error) + error.message).not.toMatch(/secret/);
  // If Firebase found its durable user despite the probe, it may proceed.
  expect(() => x.assertRestored(true)).not.toThrow();
});

test('logout queued during a login retry executes last and never resurrects the old login', async () => {
  const entries = new Map<string, string>(); let release!: () => void;
  const setItem = jest.fn(async (k: string, v: string) => { entries.set(k,v); }).mockRejectedValueOnce(Error('temporary lock'));
  const x = resilientAuthStorage({ getItem: async k => entries.get(k) ?? null, setItem,
    removeItem: async k => { entries.delete(k); } }, () => new Promise(resolve => { release = resolve; }));
  const login = x.storage.setItem('login','saved');
  await new Promise(setImmediate);
  const logout = x.storage.removeItem('login'); release(); await Promise.all([login, logout]);
  expect(entries.has('login')).toBe(false);
});

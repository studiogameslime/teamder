import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError } from '../../src/services/staleSession';
import { retryRead } from '../../src/services/readRetry';
import { mapConcurrent } from '../../src/utils/mapConcurrent';

function fixture(retry?: (fn: () => Promise<any>) => Promise<any>) {
  const auth = { currentUser: { uid: 'owner', isAnonymous: false } };
  const remote = jest.fn(async (): Promise<{ data: any[] }> => ({ data: [] }));
  const mirror = jest.fn(async () => ({ exists: () => true, data: () => ({id: 'bob', name: 'בוב'}) }));
  const deps: Record<string, any> = {
    'firebase/functions': { httpsCallable: () => remote },
    'firebase/firestore': {getDoc: mirror, doc: (_collection: unknown, id: string) => id},
    '@/firebase/config': { getFirebase: () => ({ auth, functions: {} }) },
    '@/firebase/firestore': {col: {usersPublic: () => 'usersPublic'}},
    '@/firebase/authRace': { withAuthRaceRetry: retry ?? ((fn: () => Promise<any>) => fn()) },
    './staleSession': { StaleSessionError },
    './readRetry': { retryRead },
    '@/utils/mapConcurrent': { mapConcurrent },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync('src/services/publicPlayerService.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {module, exports: module.exports, require: (name: string) => {if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return deps[name];}});
  return {service: module.exports, auth, remote, mirror};
}
test('a referral response arriving after account switch is rejected', async () => {
  const f = fixture();
  f.remote.mockImplementationOnce(async () => { f.auth.currentUser.uid = 'other'; return {data: []}; });
  await expect(f.service.playerReadCall('getMyPlayerReferrals', {userId: 'owner'})).rejects.toBeInstanceOf(StaleSessionError);
});
test('an auth retry cannot run a request for the previous account', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(async fn => {f.auth.currentUser.uid = 'other'; return fn();});
  await expect(f.service.playerReadCall('getMyPlayerReferrals', {userId: 'owner'})).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.remote).not.toHaveBeenCalled();
});
test('roster hydration deduplicates and splits identifiers into bounded requests, preserving failure', async () => {
  const f = fixture();
  const ids = Array.from({length: 101}, (_, i) => `player-${i}`);
  await f.service.readPlayerIdentities([...ids, ids[0]]);
  expect(f.remote.mock.calls.length).toBe(2);
  expect((f.remote.mock.calls[0] as any)[0].userIds.length).toBe(100);
  f.remote.mockRejectedValueOnce(new Error('offline'));
  await expect(f.service.readPlayerIdentities(ids)).rejects.toThrow('offline');
});
test('single-row identity uses the public mirror and never loads a full user document', async () => {
  const f = fixture();
  const result = await f.service.readPlayerIdentity('bob');
  expect(result.name).toBe('בוב');
  expect(f.remote).not.toHaveBeenCalled();
  f.mirror.mockRejectedValueOnce(Error('offline'));
  await expect(f.service.readPlayerIdentity('bob')).rejects.toThrow('offline');
});
test('missing legacy mirrors fall back to the allowlisted server, with no guest enumeration', async () => {
  const f = fixture();
  f.mirror.mockResolvedValue({exists: () => false, data: () => ({id: 'bob', name: 'בוב'})} as never);
  f.remote.mockResolvedValueOnce({data: [{id: 'bob', name: 'בוב', createdAt: 1}] as never});
  expect((await f.service.readPlayerIdentity('bob')).id).toBe('bob');
  expect(f.remote.mock.calls.length).toBe(1);
  f.auth.currentUser.isAnonymous = true;
  expect(await f.service.readPlayerIdentity('bob')).toBeNull();
  expect(f.remote.mock.calls.length).toBe(1);
});

test('public mirror response cannot be applied after account switch', async () => {
  const f = fixture();
  f.mirror.mockImplementationOnce(async () => { f.auth.currentUser.uid = 'other'; return { exists: () => true, data: () => ({ id: 'bob', name: 'Bob' }) }; });
  await expect(f.service.readPlayerIdentity('bob')).rejects.toBeInstanceOf(StaleSessionError);
});

test('guest roster response cannot be applied after account switch', async () => {
  const f = fixture(); f.auth.currentUser.isAnonymous = true;
  f.mirror.mockImplementationOnce(async () => { f.auth.currentUser.uid = 'other'; return { exists: () => true, data: () => ({ id: 'bob', name: 'Bob' }) }; });
  await expect(f.service.readPlayerIdentities(['bob'])).rejects.toBeInstanceOf(StaleSessionError);
});

function deferredPage() {
  let resolve!: (value: { data: any[] }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ data: any[] }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flushPages = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('large roster pages start at most four at once and flatten in request order', async () => {
  const f = fixture();
  const pages = Array.from({ length: 6 }, deferredPage);
  f.remote.mockImplementation(() => pages[f.remote.mock.calls.length - 1].promise);
  const ids = Array.from({ length: 501 }, (_, i) => `p-${i}`);
  const pending = f.service.readPlayerIdentities([...ids, '', ids[0]]);
  expect(f.remote).toHaveBeenCalledTimes(4);
  expect(f.remote.mock.calls.map((call: any) => call[0].userIds.length)).toEqual([100, 100, 100, 100]);
  pages[3].resolve({ data: [{ id: ids[300] }] }); await flushPages();
  expect(f.remote).toHaveBeenCalledTimes(5);
  pages[4].resolve({ data: [{ id: ids[400] }] }); await flushPages();
  expect(f.remote).toHaveBeenCalledTimes(6);
  expect((f.remote.mock.calls[5] as any)[0].userIds).toEqual([ids[500]]);
  pages[5].resolve({ data: [{ id: ids[500] }] });
  pages[2].resolve({ data: [{ id: ids[200] }] });
  pages[1].resolve({ data: [] }); // Missing identities stay missing.
  pages[0].resolve({ data: [{ id: ids[0] }] });
  expect((await pending).map((row: any) => row.id)).toEqual([ids[0], ids[200], ids[300], ids[400], ids[500]]);
});

test('a failed roster page stops queued work and never returns the successful subset', async () => {
  const f = fixture();
  const pages = Array.from({ length: 4 }, deferredPage);
  f.remote.mockImplementation(() => pages[f.remote.mock.calls.length - 1].promise);
  const pending = f.service.readPlayerIdentities(Array.from({ length: 501 }, (_, i) => `p-${i}`));
  const error = Error('offline');
  const rejected = expect(pending).rejects.toBe(error);
  pages[0].reject(error); await flushPages();
  pages.slice(1).forEach(page => page.resolve({ data: [{ id: 'partial' }] }));
  await rejected;
  expect(f.remote).toHaveBeenCalledTimes(4);
});

test('a changed owner invalidates active roster pages and prevents later pages', async () => {
  const f = fixture();
  const pages = Array.from({ length: 4 }, deferredPage);
  f.remote.mockImplementation(() => pages[f.remote.mock.calls.length - 1].promise);
  const pending = f.service.readPlayerIdentities(Array.from({ length: 501 }, (_, i) => `p-${i}`));
  const rejected = expect(pending).rejects.toBeInstanceOf(StaleSessionError);
  f.auth.currentUser.uid = 'other';
  pages[0].resolve({ data: [{ id: 'old-owner-result' }] }); await flushPages();
  pages.slice(1).forEach(page => page.resolve({ data: [] }));
  await rejected;
  expect(f.remote).toHaveBeenCalledTimes(4);
});

test('an empty roster does not call a server or a public mirror', async () => {
  const f = fixture();
  expect(await f.service.readPlayerIdentities(['', ''])).toEqual([]);
  expect(f.remote).not.toHaveBeenCalled();
  expect(f.mirror).not.toHaveBeenCalled();
});

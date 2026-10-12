import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError } from '../../src/services/staleSession';

function fixture(retry?: (fn: () => Promise<any>) => Promise<any>) {
  const auth = { currentUser: { uid: 'owner', isAnonymous: false } };
  const remote = jest.fn(async () => ({ data: [] }));
  const mirror = jest.fn(async () => ({ exists: () => true, data: () => ({id: 'bob', name: 'בוב'}) }));
  const deps: Record<string, any> = {
    'firebase/functions': { httpsCallable: () => remote },
    'firebase/firestore': {getDoc: mirror, doc: (_collection: unknown, id: string) => id},
    '@/firebase/config': { getFirebase: () => ({ auth, functions: {} }) },
    '@/firebase/firestore': {col: {usersPublic: () => 'usersPublic'}},
    '@/firebase/authRace': { withAuthRaceRetry: retry ?? ((fn: () => Promise<any>) => fn()) },
    './staleSession': { StaleSessionError },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync('src/services/publicPlayerService.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {module, exports: module.exports, require: (name: string) => deps[name]});
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

import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError } from '../../src/services/staleSession';
import { clearCaughtErrorOrigins, installCaughtErrorSink } from '../../src/utils/errorObservation';

function fixture() {
  const auth = { currentUser: { uid: 'owner', isAnonymous: false } };
  const remote = jest.fn(async () => ({}));
  const write = jest.fn(async () => undefined);
  const requests = jest.fn(async () => ({ docs: [{ data: () => ({ id: 'peer__owner', fromUserId: 'peer', toUserId: 'owner', status: 'pending' }) }] }));
  const identities = jest.fn(async () => [{ id: 'peer', name: 'Peer', createdAt: 0 }]);
  const user = jest.fn(async () => ({ id: 'owner', friends: [] }));
  const readDoc = jest.fn(async () => ({ exists: () => false }));
  const observeCaughtError = jest.fn();
  clearCaughtErrorOrigins();
  installCaughtErrorSink(observeCaughtError);
  const deps: Record<string, any> = {
    'firebase/firestore': { getDocs: requests, getDoc: readDoc, updateDoc: write, deleteDoc: write, query: (...a: any[]) => a, where: (...a: any[]) => a },
    '../utils/errorObservation': { observeCaughtError },
    'firebase/functions': { httpsCallable: () => remote },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ auth, functions: {} }) },
    '@/firebase/firestore': { col: { friendRequests: () => 'requests' }, docs: { friendRequest: (id: string) => id } },
    './userService': { userService: { getUserById: user } },
    './publicPlayerService': { readPlayerIdentities: identities },
    './staleSession': { StaleSessionError },
    '@/data/mockUsers': {}, './analyticsService': { AnalyticsEvent: {}, logEvent: jest.fn() },
    '@/services/errorLog': { logError: jest.fn(), isExpectedDenial: () => false },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync('src/services/friendsService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => {if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return deps[name];}, __DEV__: false });
  return { service: module.exports.friendsService, auth, remote, write, requests, identities, user, readDoc, observeCaughtError };
}

test('absent friend requests do not report the expected denial, and both directions are checked', async () => {
  const f = fixture(); f.readDoc.mockRejectedValue({ code: 'permission-denied' });
  await expect(f.service.getRelationship('owner', 'peer')).resolves.toBe('none');
  expect(f.readDoc).toHaveBeenCalledTimes(2);
  expect(f.observeCaughtError).not.toHaveBeenCalled();
});

test('unexpected request failures still reject and report', async () => {
  const f = fixture(); const error = new Error('offline'); f.readDoc.mockRejectedValue(error);
  await expect(f.service.getRelationship('owner', 'peer')).rejects.toBe(error);
  expect(f.observeCaughtError).toHaveBeenCalledWith(error, expect.objectContaining({ handler: 'readReq' }));
});

test.each(['sendRequest', 'acceptRequest', 'declineRequest', 'cancelRequest', 'removeFriend'])('stale %s cannot perform an action as the newly signed-in account', async method => {
  const f = fixture(); f.auth.currentUser.uid = 'new-owner';
  const args = ['acceptRequest', 'declineRequest'].includes(method) ? ['peer', 'owner'] : ['owner', 'peer'];
  await expect(f.service[method](...args)).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.remote).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});

test('request lookup cannot execute for a previous account', async () => {
  const f = fixture(); f.auth.currentUser.uid = 'new-owner';
  await expect(f.service.queryRequests('toUserId', 'owner')).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.requests).not.toHaveBeenCalled();
});

test('request response arriving after a session switch is rejected', async () => {
  const f = fixture(); f.requests.mockImplementationOnce(async () => { f.auth.currentUser.uid = 'new-owner'; return { docs: [] }; });
  await expect(f.service.listIncomingRequests('owner')).rejects.toBeInstanceOf(StaleSessionError);
});

test.each(['listIncomingRequests', 'listOutgoingRequests'])('%s preserves a failed identity read instead of claiming no requests', async method => {
  const f = fixture(); f.user.mockRejectedValue(new Error('offline')); f.identities.mockRejectedValue(new Error('offline'));
  await expect(f.service[method]('owner')).rejects.toThrow('offline');
});

test('requests hydrate public identities once and retain a genuinely missing player as unknown', async () => {
  const f = fixture(); f.identities.mockResolvedValue([]);
  const rows = await f.service.listIncomingRequests('owner');
  expect(rows).toHaveLength(1); expect(rows[0].user).toBeNull();
  expect(f.identities).toHaveBeenCalledWith(['peer']); expect(f.user).not.toHaveBeenCalled();
});

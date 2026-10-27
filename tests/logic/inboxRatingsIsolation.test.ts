import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture() {
  const memberships = [
    { id: 'admin', adminIds: ['owner'], playerIds: ['owner'], pendingPlayerIds: ['a', 'b'], adminRatings: { owner: 4 } },
    { id: 'member', adminIds: ['other'], playerIds: ['owner'], pendingPlayerIds: ['c'] },
    { id: 'personal', isPersonal: true, adminIds: ['owner'], pendingPlayerIds: ['d'] },
  ];
  const hydrate = jest.fn().mockRejectedValue(Object.assign(new Error('deadline'), { code: 'functions/deadline-exceeded' }));
  const snapshot = { docs: memberships.map(g => ({ data: () => g })) };
  const groupSource = ts.createSourceFile('group.ts', fs.readFileSync('src/services/groupService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let method = '';
  function walk(n: ts.Node) {
    if (ts.isMethodDeclaration(n) && n.name.getText(groupSource) === 'listForUser') method = n.getText(groupSource);
    ts.forEachChild(n, walk);
  }
  walk(groupSource);
  expect(method).not.toBe('');
  const js = ts.transpileModule(`({${method}})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const groupService = vm.runInNewContext(js, {
    USE_MOCK_DATA: false, isCurrentSession: () => true,
    query: () => ({}), where: () => ({}), col: { groups: () => ({}) },
    getDocs: async () => snapshot, hydrateClubAdminRatings: hydrate,
  });
  const incoming = jest.fn(async () => [{}]);
  const games = jest.fn(async () => [{ createdBy: 'owner', pending: ['e'] }, { createdBy: 'other', pending: ['f'] }]);
  const requestsJs = ts.transpileModule(fs.readFileSync('src/services/requestsService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(requestsJs, { exports, require: (name: string) => {if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';
    if (name.endsWith('groupService')) return { groupService };
    if (name.endsWith('friendsService')) return { friendsService: { listIncomingRequests: incoming } };
    if (name.endsWith('gameService')) return { gameService: { getMyLiveOrUpcomingGames: games } };
    return {};
  } });
  return { groupService, hydrate, exports, incoming };
}

test('inbox count remains correct when the unrelated ratings backend fails', async () => {
  const f = fixture();
  await expect(f.exports.getInboxCount('owner')).resolves.toBe(4);
  expect(f.hydrate).not.toHaveBeenCalled();
  // Club screens retain the original ratings contract and surface real errors.
  await expect(f.groupService.listForUser('owner')).rejects.toMatchObject({ code: 'functions/deadline-exceeded' });
  expect(f.hydrate).toHaveBeenCalledTimes(2);
});

test('a genuine inbox source failure is preserved rather than reported as zero', async () => {
  const f = fixture(), error = new Error('friend requests offline');
  f.incoming.mockRejectedValueOnce(error);
  await expect(f.exports.getInboxCount('owner')).rejects.toBe(error);
});

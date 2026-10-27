import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function compile(source: string, context: Record<string, unknown>) {
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module, ...context });
  return module.exports;
}

function deletionMethod() {
  const file = ts.createSourceFile('groupService.ts', fs.readFileSync('src/services/groupService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let body = '';
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'deleteGroup') body = node.body!.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!body) throw Error('deleteGroup method missing');
  return `module.exports=async function(groupId,callerId)${body}`;
}

test('actual club deletion stops series before any child or parent deletion and propagates a failure', async () => {
  const calls: string[] = [];
  const stop = jest.fn(async () => { calls.push('stop'); });
  const readChildren = jest.fn(async () => { calls.push('children'); return { docs: [] }; });
  const run = compile(deletionMethod(), {
    USE_MOCK_DATA: false, __DEV__: false,
    docs: { group: (id: string) => `groups/${id}`, groupPublic: (id: string) => `groupsPublic/${id}` },
    col: { games: () => 'games', joinRequests: () => 'requests' },
    getDoc: async () => ({ exists: () => true, data: () => ({ creatorId: 'owner' }) }),
    query: (value: string) => value, where: () => ({}), getDocs: readChildren,
    deleteDoc: async (path: string) => { calls.push(path); },
    seriesService: { stopForGroup: stop }, observeCaughtError: () => {}, logError: () => {},
  });
  stop.mockImplementationOnce(async () => { calls.push('stop'); throw new Error('offline'); });
  await expect(run('club', 'owner')).rejects.toThrow('offline');
  expect(calls).toEqual(['stop']); expect(readChildren).not.toHaveBeenCalled();
  calls.length = 0;
  await run('club', 'owner');
  expect(calls).toEqual(['stop', 'children', 'children', 'groups/club', 'groupsPublic/club']);
  calls.length = 0;
  await expect(run('club', 'other')).rejects.toThrow('NOT_CREATOR');
  expect(calls).toEqual([]);
});

function stopMethod() {
  const file = ts.createSourceFile('seriesService.ts', fs.readFileSync('src/services/seriesService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let body = '';
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name?.getText(file) === 'stopForGroup') body = node.body!.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!body) throw Error('stopForGroup missing');
  return `module.exports=async function(groupId)${body}`;
}

test('client stops more than one write batch, handles old missing-active fields and keeps inactive records', async () => {
  const docs = Array.from({ length: 805 }, (_, index) => ({ ref: index, data: () => ({ active: index === 804 ? false : index === 803 ? undefined : true }) }));
  const committed: any[][] = [];
  const context = {
    USE_MOCK_DATA: false, COL: 'gameSeries', Date,
    getFirebase: () => ({ db: {} }), collection: () => 'gameSeries', query: () => ({}), where: () => ({}),
    getDocs: async () => ({ docs }), writeBatch: () => {
      const batch: any[] = [];
      return { update: (ref: any, data: any) => batch.push([ref, data]), commit: async () => { committed.push(batch); } };
    },
  };
  await compile(stopMethod(), context)('club');
  expect(committed.map(batch => batch.length)).toEqual([400, 400, 4]);
  expect(committed.flat().map(([ref]) => ref)).toContain(803);
  expect(committed.flat().map(([ref]) => ref)).not.toContain(804);
  expect(committed.flat().every(([, data]) => data.active === false)).toBe(true);
  await expect(compile(stopMethod(), { ...context, getDocs: async () => { throw Error('permission denied'); } })('club')).rejects.toThrow('permission denied');
  await expect(compile(stopMethod(), { ...context, writeBatch: () => ({ update: () => {}, commit: async () => { throw Error('offline'); } }) })('club')).rejects.toThrow('offline');
});

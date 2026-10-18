import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const source = ts.createSourceFile('index.ts', fs.readFileSync('functions/src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let handler = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'ensurePersonalGroup' && node.initializer && ts.isCallExpression(node.initializer)) handler = node.initializer.arguments[1].getText(source);
  ts.forEachChild(node, visit);
} visit(source);

function setup() {
  const documents = new Map<string, any>([['users/owner', { name: 'מנהל' }]]);
  let serial = 0, fail = false, queue = Promise.resolve();
  const db = {
    collection: (collection: string) => ({ doc: (id = `allocated-${++serial}`) => ({ id, path: `${collection}/${id}` }) }),
    runTransaction: (work: any) => {
      const result = queue.then(async () => {
        const writes: Array<{ path: string; data: any; merge?: boolean }> = [];
        const value = await work({
          get: async (ref: any) => ({ exists: documents.has(ref.path), data: () => documents.get(ref.path) }),
          create: (ref: any, data: any) => writes.push({ path: ref.path, data }),
          set: (ref: any, data: any, opts: any) => writes.push({ path: ref.path, data, merge: opts?.merge }),
        });
        if (fail) throw Error('commit unavailable');
        writes.forEach(w => documents.set(w.path, { ...(w.merge ? documents.get(w.path) : {}), ...w.data }));
        return value;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  class HttpsError extends Error { constructor(public code: string, message: string) { super(message); } }
  const context: any = { module: { exports: {} }, db, HttpsError, ENFORCE_APP_CHECK: false, randomInviteCode: () => 'invite', Date };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${handler}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { documents, invoke: context.module.exports as (r: any) => Promise<any>, fail: (value: boolean) => { fail = value; } };
}
const request = { auth: { uid: 'owner' } };
test('a failed commit creates neither a group nor a dangling owner pointer; retry succeeds once', async () => {
  const s = setup(); s.fail(true);
  await expect(s.invoke(request)).rejects.toThrow('commit unavailable');
  expect([...s.documents.keys()]).toEqual(['users/owner']);
  expect(s.documents.get('users/owner').personalGroupId).toBeUndefined();
  s.fail(false); const result = await s.invoke(request);
  expect(s.documents.get('users/owner').personalGroupId).toBe(result.groupId);
  expect(s.documents.get(`groups/${result.groupId}`)).toMatchObject({ isPersonal: true, hidden: true, adminIds: ['owner'] });
});
test('concurrent requests converge on one existing personal group', async () => {
  const s = setup(); const result = await Promise.all([s.invoke(request), s.invoke(request)]);
  expect(result[0].groupId).toBe(result[1].groupId);
  expect(result.map(r => r.created)).toEqual([true, false]);
  expect([...s.documents.keys()].filter(k => k.startsWith('groups/'))).toHaveLength(1);
});
test('a promoted club is retained while a new hidden personal group is provisioned', async () => {
  const s = setup(); s.documents.set('users/owner', { personalGroupId: 'promoted' });
  s.documents.set('groups/promoted', { isPersonal: false, name: 'המועדון' });
  const result = await s.invoke(request);
  expect(result.groupId).not.toBe('promoted');
  expect(s.documents.get('groups/promoted')).toEqual({ isPersonal: false, name: 'המועדון' });
});
test('unauthenticated and missing-user calls never provision a group', async () => {
  const s = setup(); await expect(s.invoke({})).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(s.invoke({ auth: { uid: 'absent' } })).rejects.toMatchObject({ code: 'not-found' });
  expect([...s.documents.keys()]).toEqual(['users/owner']);
});

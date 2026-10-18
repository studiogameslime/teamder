import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { creationReceiptId, fingerprintCreation } from '../../functions/src/creationReceipt';

const source = ts.createSourceFile('index.ts', fs.readFileSync('functions/src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let handler = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'createGroupCallable' && node.initializer && ts.isCallExpression(node.initializer)) {
    handler = node.initializer.arguments[1].getText(source);
  }
  ts.forEachChild(node, visit);
} visit(source);

type Ref = { id: string; path: string };
type Data = Record<string, any>;
function setup() {
  const documents = new Map<string, Data>([['users/owner', { achievements: { teamsCreated: 0 } }]]);
  let serial = 0, loseAck = false, failCommit = false, queue = Promise.resolve();
  const clone = (value: Data) => structuredClone(value);
  const db = {
    collection: (collection: string) => ({ doc: (id = `server-${++serial}`): Ref => ({ id, path: `${collection}/${id}` }) }),
    runTransaction: (work: (tx: any) => Promise<unknown>) => {
      const result = queue.then(async () => {
        const writes: Array<{ ref: Ref; value: Data; create: boolean; merge: boolean }> = [];
        const result = await work({
          get: async (ref: Ref) => ({ exists: documents.has(ref.path), data: () => documents.has(ref.path) ? clone(documents.get(ref.path)!) : undefined }),
          create: (ref: Ref, value: Data) => writes.push({ ref, value, create: true, merge: false }),
          set: (ref: Ref, value: Data, opts?: { merge: boolean }) => writes.push({ ref, value, create: false, merge: !!opts?.merge }),
        });
        if (failCommit) throw Error('commit failed before writing');
        for (const write of writes) if (write.create && documents.has(write.ref.path)) throw Error('already exists');
        for (const { ref, value, merge } of writes) {
          const old = merge ? documents.get(ref.path) ?? {} : {};
          const next = { ...clone(old), ...clone(value) };
          if (value.achievements?.teamsCreated?.increment) {
            next.achievements = { ...old.achievements, teamsCreated: (old.achievements?.teamsCreated ?? 0) + value.achievements.teamsCreated.increment };
          }
          documents.set(ref.path, next);
        }
        if (loseAck) { loseAck = false; throw Error('response lost after commit'); }
        return result;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  class HttpsError extends Error { constructor(public code: string, message: string) { super(message); } }
  const context: any = { module: { exports: {} }, db, HttpsError, creationReceiptId, fingerprintCreation,
    CREATE_GROUP_RATE_CAP: 5, CREATE_GROUP_RATE_WINDOW_MS: 86400_000,
    normaliseGroupName: (s: string) => s.trim().toLowerCase(), genInviteCode: () => 'server-invite',
    pickShortString: (v: unknown, _: number, key: string, required: boolean) => {
      if (required && (typeof v !== 'string' || !v.trim())) throw new HttpsError('invalid-argument', key);
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    },
    admin: { firestore: { FieldValue: { increment: (increment: number) => ({ increment }) } } }, Date,
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${handler}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { documents, invoke: context.module.exports as (r: any) => Promise<{ groupId: string }>,
    loseAck: () => { loseAck = true; }, fail: (value: boolean) => { failCommit = value; } };
}
const request = (over: Data = {}, uid = 'owner') => ({ auth: { uid, token: {} }, data: { name: 'מועדון בדיקה', creationAttemptId: 'stable-attempt-token-1', ...over } });
const groupCount = (s: ReturnType<typeof setup>) => [...s.documents.keys()].filter(key => key.startsWith('groups/')).length;

function encodedClientPayload(input: Data) {
  const sdk = ts.createSourceFile('functions.cjs', fs.readFileSync('node_modules/@firebase/functions/dist/index.cjs.js', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = sdk.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ['encode', 'mapValues'].includes(node.name?.text ?? '')).map(node => node.getText(sdk)).join('\n');
  const client = ts.createSourceFile('groupService.ts', fs.readFileSync('src/services/groupService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let payload = '';
  const find = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(client) === 'createGroup') {
      const findCall = (child: ts.Node) => {
        if (ts.isCallExpression(child) && child.expression.getText(client) === 'fn') payload = child.arguments[0].getText(client);
        ts.forEachChild(child, findCall);
      }; findCall(node);
    }
    ts.forEachChild(node, find);
  }; find(client);
  const runtime: any = { module: { exports: {} } };
  vm.runInNewContext(`${declarations}\nmodule.exports = { encode, client: (input, baseGroup) => encode(${payload}) };`, runtime);
  return { data: runtime.module.exports.client(input, { name: 'מועדון בדיקה' }), encode: runtime.module.exports.encode };
}

test('lost response after commit retries the real callable body: one club, public doc, rate charge and achievement', async () => {
  const s = setup(); s.loseAck();
  await expect(s.invoke(request())).rejects.toThrow('response lost after commit');
  const result = await s.invoke(request());
  expect(groupCount(s)).toBe(1);
  expect(s.documents.get(`groups/${result.groupId}`)).toMatchObject({ creatorId: 'owner', name: 'מועדון בדיקה' });
  expect(s.documents.has(`groupsPublic/${result.groupId}`)).toBe(true);
  expect(s.documents.get('serverRateLimits/owner_createGroup')?.count).toBe(1);
  expect(s.documents.get('users/owner')?.achievements.teamsCreated).toBe(1);
});

test('simultaneous deliveries converge and recovery works after the daily limit is reached', async () => {
  const s = setup();
  const result = await Promise.all([s.invoke(request()), s.invoke(request())]);
  expect(result[0]).toEqual(result[1]);
  s.documents.set('serverRateLimits/owner_createGroup', { count: 5, windowStart: Date.now() });
  expect(await s.invoke(request())).toEqual(result[0]);
  expect(groupCount(s)).toBe(1);
});

test('same token with changed validated content is rejected without another write', async () => {
  const s = setup(); await s.invoke(request());
  const before = structuredClone([...s.documents]);
  await expect(s.invoke(request({ name: 'שם אחר' }))).rejects.toMatchObject({ code: 'failed-precondition' });
  expect([...s.documents]).toEqual(before);
});

test('tokens are scoped to authenticated user, never a uid in request data', async () => {
  const s = setup();
  const first = await s.invoke(request());
  const second = await s.invoke(request({ uid: 'owner' }, 'other'));
  expect(second.groupId).not.toBe(first.groupId);
  expect(s.documents.get(`groups/${second.groupId}`)?.creatorId).toBe('other');
  expect(creationReceiptId('owner', 'token')).not.toBe(creationReceiptId('other', 'token'));
});

test('failure before commit creates no receipt, rate charge, projection or achievement', async () => {
  const s = setup(); s.fail(true);
  await expect(s.invoke(request())).rejects.toThrow('commit failed before writing');
  expect([...s.documents.keys()]).toEqual(['users/owner']);
  s.fail(false); await s.invoke(request());
  expect(groupCount(s)).toBe(1);
});

test('legacy clients without token keep intentional independent creations', async () => {
  const s = setup();
  await s.invoke(request({ creationAttemptId: undefined }));
  await s.invoke(request({ creationAttemptId: undefined }));
  expect(groupCount(s)).toBe(2);
  expect(s.documents.get('serverRateLimits/owner_createGroup')?.count).toBe(2);
});

test('actual SDK encoding turns undefined into null; the real client payload omits a missing attempt token', async () => {
  const encoded = encodedClientPayload({});
  expect(encoded.encode({ creationAttemptId: undefined })).toEqual({ creationAttemptId: null });
  expect(Object.prototype.hasOwnProperty.call(encoded.data, 'creationAttemptId')).toBe(false);
  const s = setup();
  const result = await s.invoke({ auth: { uid: 'owner', token: {} }, data: encoded.data });
  expect(s.documents.get(`groups/${result.groupId}`)?.name).toBe('מועדון בדיקה');
});

test('actual SDK encoding preserves the real clients durable attempt token across delivery', async () => {
  const encoded = encodedClientPayload({ creationAttemptId: 'stable-attempt-token-1' });
  expect(encoded.data.creationAttemptId).toBe('stable-attempt-token-1');
  const s = setup();
  const req = { auth: { uid: 'owner', token: {} }, data: encoded.data };
  expect(await s.invoke(req)).toEqual(await s.invoke(req));
  expect(groupCount(s)).toBe(1);
});

test.each(['bad/slash', '', 42])('invalid attempt token %s cannot create a club', async token => {
  const s = setup();
  await expect(s.invoke(request({ creationAttemptId: token }))).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(groupCount(s)).toBe(0);
});

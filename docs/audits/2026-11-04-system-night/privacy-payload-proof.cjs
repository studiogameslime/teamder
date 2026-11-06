// Executes the current catalog validators and the built handler against a local emulator.
// No real account, remote endpoint, rules change or production document is used.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const project = 'demo-privacy-payload-' + Date.now().toString(36);
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8195';
process.env.GCLOUD_PROJECT = project;
process.env.USAGE_ACTIVITY_ENABLED = 'true';
assert(project.startsWith('demo-'));
const catalogs = ['src/utils/usageActivity.ts', 'functions/src/usageActivityCatalog.ts',
  'pulse/src/services/usageActivityCatalog.ts'].map(file => {
  const absolute = path.join(root, file);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => require(path.resolve(path.dirname(absolute), name)) });
  return { file, api: exports, keys: require(path.join(path.dirname(absolute), 'productActionKeys.json')) };
});
const now = Date.now();
const event = sequence => ({ eventId: 'visit-privacy-payload-' + sequence,
  visitId: 'visit-privacy-payload', sequence, occurredAt: now, action: 'product_action',
  productKey: 'live_goal_recorded', platform: 'android', appVersion: 'audit', schemaVersion: 1 });
const privateValue = 'PRIVATE_SENTINEL_7c392';
for (const { api, keys } of catalogs) {
  for (const key of keys) assert(api.validUsageEvent({ ...event(1), productKey: key }));
  for (const productKey of ['unknown', privateValue, 'live_goal_recorded\u202e', '__proto__', null, {}]) {
    assert(!api.validUsageEvent({ ...event(1), productKey }));
  }
  for (const key of ['screen', 'section', 'groupId', 'gameId', 'playerId', 'seasonId', 'operationId', 'resultSequence', 'result']) {
    assert(!api.validUsageEvent({ ...event(1), [key]: key === 'resultSequence' ? 2 : privateValue }));
  }
  const wire = api.usageWire({ ...event(1), uid: privateValue, ownerUid: privateValue,
    source: privateValue, labelSnapshot: privateValue, params: { name: privateValue }, password: privateValue });
  assert(!JSON.stringify(wire).includes(privateValue));
}
assert.deepEqual(catalogs[0].keys, catalogs[1].keys);
assert.deepEqual(catalogs[1].keys, catalogs[2].keys);
const admin = require(require.resolve('firebase-admin', { paths: [path.join(root, 'functions')] }));
admin.initializeApp({ projectId: project });
const { recordUsageActivity, deleteUsageForUser } = require(path.join(root, 'functions/lib/usageActivity'));
const db = admin.firestore();
const uid = 'synthetic-payload-owner';
const send = (events, provider = 'password', expectedUid = uid) => recordUsageActivity.run({
  auth: { uid, token: { firebase: { sign_in_provider: provider } } },
  data: { expectedUid, events },
});
const count = async collection => (await db.collection(collection).get()).size;
(async () => {
  await db.doc('users/' + uid).set({ name: 'synthetic' });
  await assert.rejects(send([event(1)], 'password', 'other-owner'), e => e.code === 'failed-precondition');
  assert.equal(await count('usageActivity'), 0);
  const anonymous = await send([event(1)], 'anonymous');
  assert.deepEqual(anonymous.rejected, [event(1).eventId]);
  assert.equal(await count('usageActivity'), 0);
  const missingProvider = await recordUsageActivity.run({ auth: { uid, token: {} }, data: { expectedUid: uid, events: [event(1)] } });
  assert.deepEqual(missingProvider.rejected, [event(1).eventId]);
  await send([{ ...event(1), uid: 'other-owner', source: 'server', labelSnapshot: privateValue,
    params: { name: privateValue }, password: privateValue }]);
  const rows = (await db.collection('usageActivity').get()).docs.map(doc => doc.data());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, uid);
  assert.equal(rows[0].source, 'app');
  assert(!JSON.stringify(rows).includes(privateValue));
  assert(!JSON.stringify(rows).includes('other-owner'));
  await send([{ ...event(2), productKey: privateValue }, { ...event(3), gameId: privateValue }]);
  assert.equal(await count('usageActivity'), 1);
  await db.doc('users/' + uid).update({ deletedAt: now });
  await assert.rejects(send([event(1), event(4)]), e => e.code === 'failed-precondition');
  await deleteUsageForUser(db, uid);
  for (const collection of ['usageActivity', 'usageSessions', 'usageOperations', 'usageActivityLimits', 'usageCoverage']) {
    assert.equal(await count(collection), 0);
  }
  await assert.rejects(send([event(5)]), e => e.code === 'failed-precondition');
  assert.equal(await count('usageActivity'), 0);
  const result = {
    emulator: '127.0.0.1:8195', syntheticProject: project, catalogCopies: catalogs.length,
    approvedKeysPerCopy: catalogs[0].keys.length, allApprovedKeysExecuted: true,
    unknownKeysRejected: true, productTargetFieldsRejected: true, arbitraryTextStripped: true,
    mismatchedOwnerRejected: true, anonymousAndMissingProviderRejected: true,
    forgedOwnerAndSourceStripped: true, deletedAccountRecreationRejected: true,
    cleanupCollectionsVerifiedEmpty: 5, verified: true,
  };
  fs.writeFileSync(path.join(__dirname, 'evidence/privacy-payload.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => admin.app().delete());

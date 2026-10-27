import fs from 'fs';
import { errorPresentation } from '../../functions/src/errorPresentation';
import vm from 'vm';
import ts from 'typescript';
import { redactDiagnosticText } from '../../src/utils/diagnosticRedaction';

const project = 'soccer-app-52b6b', time = Date.parse('2026-10-24T10:00:00Z');
const stamp = (ms: number) => ({ toMillis: () => ms });
function entry(eventId = 'event-one', extra: Record<string, any> = {}) {
  return { logName: `projects/${project}/logs/firebasecrashlytics.googleapis.com%2Fevents`, jsonPayload: {
    name: `projects/559368532219/apps/app-one/events/${eventId}`, eventId,
    bundleOrPackage: 'com.studiogameslime.soccerapp', platform: 'ANDROID',
    issue: { id: 'issue-one', errorType: 'FATAL' }, issueSubtitle: 'java.lang.RuntimeException - Crash Test',
    eventTime: new Date(time).toISOString(), receivedTime: new Date(time + 1000).toISOString(),
    version: { displayVersion: '1.1.58', buildVersion: '292' }, user: { id: 'signed-in-owner' },
    device: { model: 'SM-S916B' }, operatingSystem: { displayVersion: '16' },
    exceptions: [{ frames: [{ symbol: 'test.run', file: 'Test.java', line: '83' }] }], ...extra,
  } };
}
function fixture() {
  const rows = new Map<string, Record<string, any>>();
  const writes: Array<() => void> = [];
  function apply(path: string, patch: Record<string, any>, merge = true) {
    const next = merge ? { ...rows.get(path) } : {};
    for (const [key, value] of Object.entries(patch)) next[key] = value?.increment ? Number(next[key] ?? 0) + value.increment : value;
    rows.set(path, next);
  }
  function ref(path: string): any {
    return { path, get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }),
      set: async (p: any, o: any) => apply(path, p, o?.merge === true),
      update: async (p: any) => apply(path, p) };
  }
  let lock = Promise.resolve();
  const db: any = {
    doc: ref,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`),
      where: (field: string, _op: string, value: string) => ({ limit: () => ({ get: async () => {
        const docs = [...rows].filter(([p, d]) => p.startsWith(name + '/') && d[field] === value).map(([p, d]) => ({ ref: ref(p), data: () => d }));
        return { empty: !docs.length, docs };
      } }) }) }),
    runTransaction: (fn: any) => {
      const result = lock.then(async () => {
        writes.length = 0;
        const value = await fn({ get: (r: any) => r.get(),
          set: (r: any, p: any, o: any) => writes.push(() => apply(r.path, p, o?.merge === true)),
          update: (r: any, p: any) => writes.push(() => apply(r.path, p)),
          create: (r: any, p: any) => writes.push(() => { if (rows.has(r.path)) throw new Error('Already exists'); apply(r.path, p, false); }),
        });
        writes.forEach(w => w()); return value;
      });
      lock = result.then(() => undefined, () => undefined); return result;
    },
  };
  const send = jest.fn(async (m: any) => ({ responses: m.tokens.map(() => ({ success: true })) }));
  const exports: any = {};
  const firestore = { getFirestore: () => db, Timestamp: { fromMillis: stamp }, FieldValue: { increment: (n: number) => ({ increment: n }) } };
  const load = (file: string, context: Record<string, any>) => {
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, context);
  };
  load('functions/src/crashlyticsIngest.ts', { exports, require: (name: string) => {
    if (name === 'node:crypto') return require('node:crypto');
    if (name.endsWith('/firestore')) return firestore;
    if (name.endsWith('/messaging')) return { getMessaging: () => ({ sendEachForMulticast: send }) };
    if (name.includes('diagnosticRedaction')) return { redactDiagnosticText };
    throw new Error(name);
  } });
  const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ entries: [entry()] }) }));
  const worker: any = {};
  load('functions/src/crashlyticsBridge.ts', {
    exports: worker, process: { env: { GCLOUD_PROJECT: project } }, fetch, AbortSignal, console: { info: jest.fn() },
    require: (name: string) => {
      if (name === 'node:crypto') return require('node:crypto');
      if (name.endsWith('/firestore')) return firestore;
      if (name.endsWith('/app')) return { getApp: () => ({ options: { credential: { getAccessToken: async () => ({ access_token: 'local-fixture-token' }) } } }) };
      if (name.includes('observedFunctions')) return { onSchedule: (_options: any, run: any) => ({ run }) };
      if (name.startsWith('firebase-functions/v2/')) return { onSchedule: (_options: any, run: any) => ({ run }) };
      if (name.includes('crashlyticsIngest')) return exports;
      throw new Error(name);
    },
  });
  return { ...exports, ...worker, rows, send, db, fetch };
}

test('normalizes an actual provider-shaped test crash with account and binary version', () => {
  const f = fixture(), e = f.parseCrashEntry(entry(), project);
  expect(e).toMatchObject({ userId: 'signed-in-owner', version: '1.1.58 / 292', model: 'SM-S916B', isTest: true });
  expect(e.stack).toContain('Test.java:83');
  expect(e.url).toContain('/issues/issue-one');
});

test('rejects unrelated sources, apps and nonfatal mirrored JS errors', () => {
  const f = fixture();
  expect(f.parseCrashEntry({ ...entry(), logName: 'other' }, project)).toBeNull();
  expect(f.parseCrashEntry(entry('one', { bundleOrPackage: 'other' }), project)).toBeNull();
  expect(f.parseCrashEntry(entry('one', { issue: { id: 'issue', errorType: 'NON_FATAL' } }), project)).toBeNull();
  expect(() => f.parseCrashEntry(entry('one', { eventId: 'mismatched' }), project)).toThrow('identity');
});

test('duplicate and concurrent event deliveries increment only once, while distinct events accumulate', async () => {
  const f = fixture(), a = f.parseCrashEntry(entry(), project), b = f.parseCrashEntry(entry('event-two'), project);
  await Promise.all([f.importCrash(a, f.db, time), f.importCrash(a, f.db, time)]);
  expect(f.rows.get(`errors/${a.fingerprint}`).count).toBe(1);
  await f.importCrash(b, f.db, time + 1000);
  expect(f.rows.get(`errors/${a.fingerprint}`).count).toBe(2);
  expect(f.rows.get(`crashlyticsEvents/${b.receiptId}`).alertState).toBe('coalesced');
});

test('late old events preserve latest user and do not reopen a resolved issue', async () => {
  const f = fixture(), latest = f.parseCrashEntry(entry(), project);
  await f.importCrash(latest, f.db, time);
  f.rows.get(`errors/${latest.fingerprint}`).status = 'resolved';
  const older = f.parseCrashEntry(entry('old', { eventTime: new Date(time - 1000).toISOString(), user: { id: 'old-user' } }), project);
  await f.importCrash(older, f.db, time + 70_000);
  expect(f.rows.get(`errors/${latest.fingerprint}`)).toMatchObject({ status: 'resolved', lastUserId: 'signed-in-owner', count: 2 });
  expect(f.rows.get(`crashlyticsEvents/${older.receiptId}`).alertState).toBe('coalesced');
  const newer = f.parseCrashEntry(entry('new', { eventTime: new Date(time + 1000).toISOString() }), project);
  await f.importCrash(newer, f.db, time + 80_000);
  expect(f.rows.get(`errors/${latest.fingerprint}`).status).toBe('new');
});

test('per-token checkpoint retries a partial delivery without notifying the successful token twice', async () => {
  const f = fixture(), e = f.parseCrashEntry(entry(), project);
  f.rows.set('adminConfig/push', { tokens: ['one', 'two'] });
  await f.importCrash(e, f.db, time);
  f.send.mockResolvedValueOnce({ responses: [{ success: true }, { success: false, error: { code: 'messaging/internal-error' } }] });
  expect(await f.deliverCrashAlerts(f.db)).toEqual({ sent: 1, pending: 1 });
  expect(await f.deliverCrashAlerts(f.db)).toEqual({ sent: 1, pending: 0 });
  expect(f.send.mock.calls[1][0].tokens).toEqual(['two']);
  expect(f.rows.get(`crashlyticsEvents/${e.receiptId}`).alertState).toBe('sent');
});

test('muted alerts honor the current setting; missing tokens remain retryable', async () => {
  const f = fixture(), e = f.parseCrashEntry(entry(), project);
  await f.importCrash(e, f.db, time);
  expect(await f.deliverCrashAlerts(f.db)).toEqual({ sent: 0, pending: 1 });
  f.rows.set('adminConfig/prefs', { error: false });
  await f.deliverCrashAlerts(f.db);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.rows.get(`crashlyticsEvents/${e.receiptId}`).alertState).toBe('muted');
});

test('scheduled handler paginates, imports and delivers through the actual modules', async () => {
  const f = fixture(); f.rows.set('adminConfig/push', { tokens: ['one'] });
  f.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [entry()], nextPageToken: 'page-two' }) });
  await f.syncCrashlyticsToPulse.run();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(f.fetch.mock.calls[0][1].body).filter).toContain(' AND timestamp>=');
  expect(JSON.parse(f.fetch.mock.calls[1][1].body).pageToken).toBe('page-two');
  expect(f.rows.get('adminConfig/crashlyticsBridge')).toMatchObject({ imported: 1, pages: 2, leaseUntil: 0 });
  expect(f.send).toHaveBeenCalledTimes(1);
  await f.syncCrashlyticsToPulse.run();
  expect(f.send).toHaveBeenCalledTimes(1);
});

test('failed log read never advances the scan checkpoint and releases the lease', async () => {
  const f = fixture(); f.rows.set('adminConfig/crashlyticsBridge', { lastScanAt: time });
  f.fetch.mockResolvedValueOnce({ ok: false, status: 503 } as any);
  await expect(f.scanCrashlytics()).rejects.toThrow('HTTP 503');
  expect(f.rows.get('adminConfig/crashlyticsBridge')).toMatchObject({ lastScanAt: time, leaseUntil: 0 });
});

test('empty partial-search pages resume their exact window in the next invocation', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) f.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [], nextPageToken: `continue-${i}` }) });
  await f.scanCrashlytics();
  const state = f.rows.get('adminConfig/crashlyticsBridge');
  expect(state.lastScanAt).toBeUndefined();
  expect(state).toMatchObject({ scanPageToken: 'continue-19', leaseUntil: 0, pages: 20 });
  const filter = JSON.parse(f.fetch.mock.calls[0][1].body).filter;
  f.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [] }) });
  await f.scanCrashlytics();
  const resumed = JSON.parse(f.fetch.mock.calls[20][1].body);
  expect(resumed).toMatchObject({ filter, pageToken: 'continue-19' });
  expect(f.rows.get('adminConfig/crashlyticsBridge')).toMatchObject({ lastScanAt: state.scanUntil, scanPageToken: null });
});

test('legacy error trigger skips the new outbox source and still alerts on existing errors', async () => {
  const source = ts.createSourceFile('index.ts', fs.readFileSync('functions/src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let handler = '';
  function walk(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === 'onErrorLogged') handler = ((n.initializer as ts.CallExpression).arguments[1]).getText(source);
    ts.forEachChild(n, walk);
  }
  walk(source); expect(handler).not.toBe('');
  const pushToAdmins = jest.fn();
  const run = vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { pushToAdmins, errorPresentation });
  await run({ params: { fp: 'native' }, data: { data: () => ({ source: 'crashlytics' }) } });
  expect(pushToAdmins).not.toHaveBeenCalled();
  await run({ params: { fp: 'existing' }, data: { data: () => ({ category: 'action', title: 'existing error',operation:'caught:receivedInvitationsService:39f13a4226',lastCode:'deadline-exceeded' }) } });
  expect(pushToAdmins).toHaveBeenCalledWith('error', expect.any(String), 'טעינת ההזמנות לא הושלמה. השרת לא השיב בזמן.', { fp: 'existing' });
});

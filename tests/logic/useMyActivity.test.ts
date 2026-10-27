import * as providers from '../../src/utils/activityProviders';
import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { execFileSync } from 'child_process';

const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const summary = { activityMs: null, distanceM: 500, steps: 0, activeCalories: null, totalCalories: 70,
  avgHeartRateBpm: null, maxHeartRateBpm: null };
const source = { kind: 'health-connect', sourceId: 'vendor.app', readerInstallationId: 'reader',
  connectionId: 'connection', generation: 1, connectedAt: 0 };
const state = () => ({ generation: 1, source: { ...source }, dataRevision: 1, records: [] as Array<{ modifiedAtMs: number }>, summary: { ...summary } });

function fixture() {
  const slots: any[] = []; let slot = 0;
  const pendingEffects: Array<() => void> = [], listeners: Array<(s: string) => void> = [], timers: Array<() => void> = [];
  const account: any = { currentUser: { id: 'u' } }, app: any = { currentState: 'active', addEventListener: (_event: string, cb: any) => {
    listeners.push(cb); return { remove: jest.fn(() => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }) };
  } };
  const changed = (a: any[], b?: any[]) => !b || a.some((v, i) => v !== b[i]);
  const effect = (callback: any, deps: any[]) => { const i = slot++; if (slots[i] && !changed(deps, slots[i].deps)) return;
    slots[i]?.cleanup?.(); slots[i] = { deps, effect: callback }; pendingEffects.push(() => { slots[i].cleanup = callback(); }); };
  const react = {
    useState: (initial: any) => { const i = slot++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef: (initial: any) => { const i = slot++; return slots[i] ??= { current: initial }; },
    useCallback: (callback: any, deps: any[]) => { const i = slot++; if (!slots[i] || changed(deps, slots[i].deps)) slots[i] = { callback, deps }; return slots[i].callback; },
    useEffect: effect,
  };
  class HealthError extends Error { constructor(public reason: string) { super(reason); this.name = 'ActivityHealthError'; } }
  const get = jest.fn(async (..._args: any[]) => state()), set = jest.fn(async (...args: any[]) => ({ ...state(), generation: 2,
    source: args[2] ? { ...source, ...args[2], generation: 2 } : null, summary: null }));
  const save = jest.fn(async (..._args: any[]) => ({ status: 'saved' })), flush = jest.fn(async () => ({ uploaded: 0, pending: 0 }));
  const health = jest.fn(async (..._args: any[]) => ({ metrics: [{ recordType: 'steps', value: 0 }], missingPermissions: [] as string[] }));
  const discover = jest.fn(async () => [{ id: 'vendor.app', kind: 'health-connect', label: 'בריאות', detail: 'נתונים' }]);
  const permissions = jest.fn(async () => {}), installation = jest.fn(async () => 'reader');
  const devices = jest.fn(async () => [{ deviceId: 'watch', label: 'שעון', connected: true }]);
  const observe = jest.fn(), alert = jest.fn((_title, _body, buttons) => buttons[1].onPress());
  let focused: (() => void) | undefined;
  const imports: any = { '@/config/sportsActivity': { SPORTS_ACTIVITY_ENABLED: true }, '@/utils/activityProviders': providers, react, 'react-native': { Alert: { alert }, AppState: app, Platform: { OS: 'android' },
    NativeModules: { WatchBridge: { getActivityReaderInstallationId: installation, getActivityDevices: devices } } },
    '@react-navigation/native': { useFocusEffect: (callback: any) => { focused = callback; effect(callback, [callback]); } }, 'expo-crypto': { randomUUID: () => 'uuid' },
    '@/store/userStore': { useUserStore: Object.assign((select: any) => select(account), { getState: () => account }) },
    './staleSession': { isStaleSession: (e: any) => e?.name === 'StaleSessionError' },
    './myActivityService': { getMyActivityState: get, setMyActivitySource: set, saveMyActivityRecords: save, flushMyActivity: flush },
    './myActivityHealthConnect': { ActivityHealthError: HealthError, discoverActivityHealthOrigins: discover,
      readActivityHealthWindow: health, requestActivityHealthPermissions: permissions },
    '@/utils/errorObservation': { caughtErrorOrigin: () => undefined, observeCaughtError: observe } };
  const exports: any = {};
  const sandbox = (vm.runInNewContext as typeof vm.runInNewContext & { diagnosticOriginal?: typeof vm.runInNewContext }).diagnosticOriginal ?? vm.runInNewContext;
  sandbox(ts.transpileModule(fs.readFileSync('src/services/useMyActivity.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id: string) => { if (!(id in imports)) throw Error(id); return imports[id]; }, Date,
    setInterval: (cb: any) => { timers.push(cb); return cb; }, clearInterval: jest.fn() });
  const render = () => { slot = 0; const result = exports.useMyActivity(); pendingEffects.splice(0).forEach(cb => cb()); return result; };
  const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); return render(); };
  const replayEffects = () => { const all = slots.filter(s => s?.effect); all.forEach(s => s.cleanup?.()); all.forEach(s => { s.cleanup = s.effect(); }); };
  return { render, settle, replayEffects, refocus: () => focused?.(), get, set, save, health, discover, permissions, installation, devices, flush, account, alert, observe, listeners, timers, app, HealthError, exports };
}

afterEach(() => jest.useRealTimers());

test('Health Connect does not infer recording duration, preserves measured zero and separates active from total energy', async () => {
  const f = fixture(); f.render(); const view = await f.settle();
  expect(view.status).toBe('available'); expect(view.metrics).toMatchObject({ recordingMs: null, steps: 0, calories: null });
  expect(f.health).toHaveBeenCalledTimes(1); expect(f.save).toHaveBeenCalledTimes(1);
});

test('identity changed during provider read prevents upload and immediately hides the previous identity', async () => {
  const f = fixture(), pending = deferred<any>(); f.health.mockReturnValueOnce(pending.promise);
  f.render(); await f.settle(); f.account.currentUser = { id: 'other' };
  expect(f.render().metrics).toBeNull(); pending.resolve({ metrics: [{ recordType: 'steps', value: 700 }], missingPermissions: [] });
  await f.settle(); expect(f.save.mock.calls.every(args => args[0] !== 'u')).toBe(true);
});

test('stale source save reloads the new binding without retrying old-source health data', async () => {
  const f = fixture(); f.save.mockResolvedValueOnce({ status: 'stale' });
  f.get.mockResolvedValueOnce(state()).mockResolvedValueOnce({ ...state(), generation: 2,
    source: { ...source, generation: 2, sourceId: 'new.app' }, summary: null } as any);
  f.render(); const view = await f.settle();
  expect(view.selectedSourceId).toBe('health-connect:new.app'); expect(view.metrics).toBeNull(); expect(f.health).toHaveBeenCalledTimes(1);
});

test('partial grants replace previously saved metric snapshots with null instead of retaining revoked data', async () => {
  const f = fixture(); f.health.mockResolvedValueOnce({ metrics: [{ recordType: 'steps', value: 0 }], missingPermissions: ['distance', 'active-calories', 'total-calories'] });
  f.render(); const view = await f.settle();
  const saved = f.save.mock.calls[0][3];
  expect(saved.map((r: any) => [r.recordType, r.value])).toEqual([['steps', 0], ['distance', null], ['active-calories', null], ['total-calories', null]]);
  expect(view.error).toContain('לא אושרו');
});

test('permission cancellation retains selected source and discovery never changes the binding', async () => {
  const f = fixture(); f.render(); let view = await f.settle();
  f.alert.mockImplementationOnce((_a, _b, buttons) => buttons[0].onPress());
  await view.connect(); view = await f.settle();
  expect(f.permissions).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled();
  expect(view.selectedSourceId).toBe('health-connect:vendor.app'); expect(view.sources.map((s: any) => s.id)).toContain(view.selectedSourceId);
});

test('discovery rejection keeps the active source in the selection list and sanitizes telemetry', async () => {
  const f = fixture(); f.render(); let view = await f.settle();
  f.permissions.mockRejectedValueOnce(new Error('heart-rate=172 private-user'));
  await view.connect(); view = await f.settle();
  expect(view.sources.map((s: any) => s.id)).toContain('health-connect:vendor.app'); expect(f.set).not.toHaveBeenCalled();
  expect(f.observe.mock.calls[0][0].message).toBe('My activity operation failed'); expect(view.error).not.toContain('172');
});

test('preflight health read failure prevents source replacement', async () => {
  const f = fixture(); f.render(); let view = await f.settle(); await view.connect(); view = await f.settle();
  f.health.mockRejectedValueOnce(new f.HealthError('incomplete'));
  await view.selectSource('health-connect:vendor.app'); view = await f.settle();
  expect(f.set).not.toHaveBeenCalled(); expect(view.selectedSourceId).toBe('health-connect:vendor.app'); expect(view.error).toContain('המקור הקודם');
});

test.each(['unavailable','permission'])('expected health %s keeps user guidance without a software failure',async reason=>{
 const f=fixture();f.health.mockRejectedValueOnce(new f.HealthError(reason));f.render();const view=await f.settle();
 expect(view.error).toBeTruthy();expect(f.save).not.toHaveBeenCalled();expect(f.observe).not.toHaveBeenCalled();
});

test('a binding owned by another reader can display saved metrics but never reads or uploads provider data', async () => {
  const f = fixture(); f.installation.mockResolvedValue('other-reader'); f.render(); const view = await f.settle();
  expect(f.health).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(view.selectedSourceId).toBeNull();
  expect(view.error).toContain('בטלפון אחר'); expect(view.metrics?.distanceM).toBe(500);
});

test('foreground triggers refresh and background polling avoids provider reads', async () => {
  const f = fixture(); f.render(); await f.settle(); const count = f.get.mock.calls.length;
  f.app.currentState = 'background'; f.timers[0](); await f.settle(); expect(f.get).toHaveBeenCalledTimes(count);
  f.app.currentState = 'active'; f.listeners[0]('active'); await f.settle(); expect(f.get.mock.calls.length).toBeGreaterThan(count);
});

test('midnight crossed during await retains the explicitly selected day and never labels it as today', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 26, 23, 59, 59));
  const f = fixture(), pending = deferred<any>(); f.get.mockReturnValueOnce(pending.promise); f.render();
  jest.setSystemTime(new Date(2026, 9, 27, 0, 0, 2)); pending.resolve(state());
  await f.settle();
  const view = await f.settle();
  expect(view.periodLabel).toContain('26.10.2026'); expect(view.periodLabel).not.toContain('היום:');
  expect(f.health.mock.calls[0][2]).toBe(new Date(2026, 9, 27).getTime());
});

test('local day range uses calendar midnight on both DST transitions', () => {
  const script = `const fs=require('fs'),ts=require('typescript'),vm=require('vm');const e={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/useMyActivity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:e,require:()=>({}),Date});process.stdout.write(JSON.stringify(['2026-03-08T23:00:00','2026-11-01T23:00:00'].map(s=>{const now=new Date(s).getTime();return (now-e.myActivityDayRange(now).from)/3600000})));`;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env, TZ: 'America/New_York' } }).toString();
  expect(JSON.parse(output)).toEqual([22, 24]);
});


test('selected days stop at today and thirty calendar days ago while hiding the previous day during fetch', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 26, 12));
  const f = fixture(); f.render(); let view = await f.settle();
  expect(view.canNextDay).toBe(false); view.nextDay(); expect(f.render().selectedDay).toBe('2026-10-26');
  const pending = deferred<any>(); f.get.mockReturnValueOnce(pending.promise); view.previousDay();
  view = f.render(); expect(view.metrics).toBeNull(); expect(view.selectedDay).toBe('2026-10-25');
  pending.resolve(state()); view = await f.settle();
  expect(f.health.mock.calls.at(-1)![1]).toBe(new Date(2026, 9, 25).getTime());
  expect(f.health.mock.calls.at(-1)![2]).toBe(new Date(2026, 9, 26).getTime());
  for (let i = 0; i < 40; i++) { view.previousDay(); view = f.render(); }
  expect(view.selectedDay).toBe('2026-09-26'); expect(view.canPreviousDay).toBe(false);
});

test('full days before connection import without game or recording interval filtering', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 26, 12));
  const f = fixture(); f.get.mockImplementation(async () => ({ ...state(), source: { ...source, connectedAt: Date.now() } }));
  f.render(); let view = await f.settle(); view.previousDay(); f.render(); await f.settle();
  expect(f.health).toHaveBeenCalledTimes(2); expect(f.save).toHaveBeenCalledTimes(2);
  const [, from, to] = f.health.mock.calls[1];
  expect(new Date(from).getHours()).toBe(0); expect(new Date(to).getHours()).toBe(0);
  expect(to).toBeLessThan(Date.now());
});

test('automatic Health Connect refresh waits five minutes while foreground refresh remains immediate', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 26, 12));
  const f = fixture(); f.render(); await f.settle(); const count = f.get.mock.calls.length;
  jest.setSystemTime(new Date(2026, 9, 26, 12, 4)); f.timers[0](); await f.settle(); expect(f.get).toHaveBeenCalledTimes(count);
  jest.setSystemTime(new Date(2026, 9, 26, 12, 5)); f.timers[0](); await f.settle(); expect(f.get.mock.calls.length).toBeGreaterThan(count);
});


test('historical snapshot versions advance after correction and a device clock rewind', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 26, 12));
  const f = fixture(); f.render(); let view = await f.settle(); view.previousDay(); f.render(); view = await f.settle();
  const last = f.save.mock.calls.at(-1)![3][0];
  expect(last.endAtMs).toBe(new Date(2026, 9, 26).getTime());
  expect(last.modifiedAtMs).toBe(new Date(2026, 9, 26, 12).getTime());
  f.get.mockImplementation(async () => ({ ...state(), records: [last] }));
  jest.setSystemTime(new Date(2026, 9, 26, 11, 55)); await view.refresh(); await f.settle();
  const next = f.save.mock.calls.at(-1)![3][0];
  expect(next.id).toBe(last.id); expect(next.endAtMs).toBe(last.endAtMs); expect(next.modifiedAtMs).toBe(last.modifiedAtMs + 1);
});


test('returning focus refreshes saved data even before the automatic polling interval', async () => {
  const f = fixture(); f.render(); await f.settle(); const count = f.get.mock.calls.length;
  f.refocus(); await f.settle(); expect(f.get.mock.calls.length).toBeGreaterThan(count);
});

test('effect replay restores mounted state and rejects replies from the cancelled mount', async () => {
  const f = fixture(), pending = deferred<any>(); f.get.mockReturnValueOnce(pending.promise);
  f.render(); f.replayEffects(); await f.settle();
  pending.resolve({ ...state(), summary: { ...summary, steps: 9999 } });
  const view = await f.settle(); expect(view.metrics?.steps).toBe(0); expect(view.refreshing).toBe(false);
});


test('Wear energy is classified as total, while Health Connect active and total energy remain distinct', async () => {
  const f = fixture(); f.get.mockImplementation(async () => ({ ...state(), source: { ...source, kind: 'wear-health-services' }, summary: { ...summary, activeCalories: 4 } } as any));
  f.render(); const wear = await f.settle();
  expect(wear.metrics).toMatchObject({ calories: 70, caloriesKind: 'total', totalCalories: 70 });
  const hc = fixture(); hc.render(); const view = await hc.settle();
  expect(view.metrics).toMatchObject({ calories: null, caloriesKind: 'active', totalCalories: 70 });
});

test('energy classification cannot make entirely missing data look available', async () => {
  const f = fixture(); f.get.mockImplementation(async () => ({ ...state(), summary: Object.fromEntries(Object.keys(summary).map(key => [key, null])) } as any));
  f.render(); const view = await f.settle(); expect(view.status).toBe('empty');
});

test('boundary and overlap information is explanatory and keeps available data without an error', async () => {
  const f = fixture(); f.get.mockImplementation(async () => ({ ...state(), summary: { ...summary,
    excludedBoundaryRecords: 1, conflictingMetrics: ['steps'], activityBoundaryUncertain: true } } as any));
  f.render(); const view = await f.settle();
  expect(view.status).toBe('available'); expect(view.error).toBeNull();
  expect(view.dataNote).toContain('גבול היום'); expect(view.dataNote).toContain('חופפים'); expect(view.dataNote).toContain('לא ודאי');
});


test('legacy total-calorie scope is cleared but does not show a permission warning', async () => {
  const f = fixture(); f.health.mockResolvedValue({ metrics: [{ recordType: 'steps', value: 0 }], missingPermissions: ['total-calories'] });
  f.render(); const view = await f.settle();
  expect(view.error).toBeNull();
  expect(f.save.mock.calls[0][3]).toEqual(expect.arrayContaining([expect.objectContaining({ recordType: 'total-calories', value: null })]));
});
test('explicit app connection never falls back to another discovered source', async () => {
  const f = fixture(); f.render(); let view = await f.settle();
  await view.connect('com.google.android.apps.fitness'); view = await f.settle();
  expect(f.set).not.toHaveBeenCalled(); expect(view.error).toContain('עדיין לא התקבלו');
});
test('explicit app connection binds only the requested writer after disclosure and discovery', async () => {
  const f = fixture(); f.discover.mockResolvedValue([{ id: 'com.google.android.apps.fitness', kind: 'health-connect', label: 'גוגל פיט', detail: 'פעילות' }]);
  f.render(); const view = await f.settle(); await view.connect('com.google.android.apps.fitness'); await f.settle();
  expect(f.permissions).toHaveBeenCalledTimes(1);
  expect(f.set).toHaveBeenCalledWith('u', 1, expect.objectContaining({ sourceId: 'com.google.android.apps.fitness' }));
});
test('declining disclosure cannot bind the requested app', async () => {
  const f = fixture(); f.alert.mockImplementation((_title, _body, buttons) => buttons[0].onPress());
  f.render(); const view = await f.settle(); await view.connect('vendor.app'); await f.settle();
  expect(f.set).not.toHaveBeenCalled(); expect(f.permissions).not.toHaveBeenCalled();
});

test('detail approval goes directly to system permissions without another disclosure dialog', async () => {
  const f = fixture(); f.render(); const view = await f.settle(); await view.connect('vendor.app', true); await f.settle();
  expect(f.alert).not.toHaveBeenCalled(); expect(f.permissions).toHaveBeenCalledTimes(1);
  expect(f.set).not.toHaveBeenCalled(); // Reapproving the current source refreshes without resetting history.
  expect(f.health.mock.calls.length).toBeGreaterThan(1);
});

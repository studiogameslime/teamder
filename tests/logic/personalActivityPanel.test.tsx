import React from 'react';
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (v: unknown) => v } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path', Rect: 'Rect' }));
import { MyActivityRoundCard } from '../../src/components/activity/MyActivityRoundCard';
import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const summary = { gameId: 'g', eligibleMs: 120000, measuredMs: 60000, coverageRatio: 0.5,
  distanceM: 0, steps: 100, calories: null, avgHeartRateBpm: null, maxHeartRateBpm: null,
  heartRateSamples: 0, excludedBoundarySamples: 1, coverageMs: { distanceM: 60000, steps: 30000, calories: 0 } };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const text = (n: any): string => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) :
  Array.isArray(n) ? n.map(text).join(' ') : typeof n.type === 'function' ? text(n.type(n.props)) : text(n.props?.children);
const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : typeof n.type === 'function' ? nodes(n.type(n.props)) : [n, ...nodes(n.props?.children)];

function fixture() {
  const slots: any[] = []; let slot = 0;
  const effects: Array<() => void> = [];
  const account: any = { currentUser: { id: 'u' } };
  const get = jest.fn(async () => ({ status: 'available', summary }));
  const flush = jest.fn(async () => ({ uploaded: 0 }));
  const observe = jest.fn();
  const origins = new WeakMap<object, unknown>();
  const store = Object.assign((select: any) => select(account), { getState: () => account });
  const listeners: Array<(state: string) => void> = [], timers: Array<() => void> = [];
  const depsChanged = (a: any[], b?: any[]) => !b || a.some((value, i) => value !== b[i]);
  const hookReact = { ...React,
    useState: (initial: any) => {
      const i = slot++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useCallback: (callback: any, deps: any[]) => {
      const i = slot++; if (!slots[i] || depsChanged(deps, slots[i].deps)) slots[i] = { callback, deps }; return slots[i].callback;
    },
    useEffect: (effect: () => (() => void) | void, deps: any[]) => {
      const i = slot++; if (slots[i] && !depsChanged(deps, slots[i].deps)) return;
      slots[i]?.cleanup?.(); slots[i] = { deps };
      effects.push(() => { slots[i].cleanup = effect(); });
    },
  };
  const navigate = jest.fn();
  const imports: any = { '@/components/activity/MyActivityRoundCard': { MyActivityRoundCard }, '@react-navigation/native': { useNavigation: () => ({ navigate }) }, react: hookReact, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable',
    ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (v: any) => v }, Platform: { OS: 'android' },
    AppState: { addEventListener: (_name: string, cb: (state: string) => void) => { listeners.push(cb); return { remove: jest.fn() }; } } },
    '@/theme/rtl': { RTL_LABEL_ALIGN: 'left' }, '@/services/personalActivityService': { getMyPersonalActivity: get, flushPersonalActivity: flush },
    '@/store/userStore': { useUserStore: store },
    '@/services/staleSession': { isStaleSession: (error: any) => error?.name === 'StaleSessionError' },
    '@/utils/errorObservation': { observeCaughtError: observe, caughtErrorOrigin: (error: any) => origins.get(error) },
  };
  const exports: any = {};
  // This fixture explicitly verifies its diagnostic adapter. The global legacy
  // sandbox shim otherwise replaces that adapter before the module can use it.
  const sandbox = (vm.runInNewContext as typeof vm.runInNewContext & { diagnosticOriginal?: typeof vm.runInNewContext }).diagnosticOriginal ?? vm.runInNewContext;
  sandbox(ts.transpileModule(fs.readFileSync('src/components/summary/PersonalActivityPanel.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports, require: (id: string) => { if (!(id in imports)) throw Error(id); return imports[id]; },
    setInterval: (cb: () => void) => { timers.push(cb); return timers.length; }, clearInterval: jest.fn() });
  let props = { gameId: 'g', userId: 'u' };
  const render = (next?: typeof props) => { if (next) props = next; slot = 0;
    const content = exports.PersonalActivityPanel(props); effects.splice(0).forEach(effect => effect());
    return content ? exports.PersonalActivityContent(content.props) : null;
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); return render(); };
  return { exports, get, flush, account, render, settle, listeners, timers, observe, origins, navigate };
}

test('existing remote summary renders while native flush remains unresolved', async () => {
  const f = fixture(), pending = deferred<any>(); f.flush.mockReturnValue(pending.promise);
  f.render(); expect(f.get).toHaveBeenCalledTimes(1);
  const tree = await f.settle();
  expect(text(tree)).toContain('כיסוי המדידה: 50 אחוזים');
  expect(text(tree)).toContain('0.00');
});

test('null metrics remain missing while measured zero and per-metric coverage remain visible', () => {
  const f = fixture();
  const tree = f.exports.PersonalActivityContent({ state: { status: 'available', summary }, onRefresh: jest.fn() });
  expect(text(tree)).toContain('לא נמדד'); expect(text(tree)).toContain('0.00');
  expect(text(tree)).toContain('1:00'); expect(text(tree)).toContain('0:30');
  const labels = nodes(tree).filter(n => n.type === 'Text').map(n => text(n));
  expect(labels).toContain('קילומטרים'); expect(labels).toContain('קלוריות'); expect(labels).toContain('זמן שנמדד במחזור');
});

test('unknown duration coverage distinguishes HR-only measurement from an unknown participation denominator', () => {
  const f = fixture();
  const content = (eligibleMs: number) => f.exports.PersonalActivityContent({ state: { status: 'available', summary: {
    ...summary, eligibleMs, coverageRatio: null, heartRateSamples: 5, avgHeartRateBpm: 130,
  } }, onRefresh: jest.fn() });
  expect(text(content(120000))).toContain('אין מספיק מדידת משך לחישוב הכיסוי.');
  expect(text(content(0))).toContain('אין עדיין זמן משחק אישי ידוע לחישוב הכיסוי.');
});

test.each(['unavailable', 'processing', 'error'])('content gives an actionable %s state', status => {
  const f = fixture(), refresh = jest.fn();
  const tree = f.exports.PersonalActivityContent({ state: { status }, onRefresh: refresh });
  nodes(tree).find(n => n.type === 'Pressable').props.onPress();
  expect(refresh).toHaveBeenCalledTimes(1); expect(text(tree)).not.toContain('0.00');
});

test('background refresh and a failed refresh preserve the last confirmed measurement', async () => {
  const f = fixture(); f.render(); await f.settle();
  const pending = deferred<any>(); f.get.mockReturnValueOnce(pending.promise);
  f.timers[0](); f.render();
  let tree = f.render();
  expect(text(tree)).toContain('0.00'); expect(nodes(tree).some(n => n.type === 'ActivityIndicator')).toBe(true);
  expect(nodes(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'רענן מדידה אישית').props.disabled).toBe(true);
  pending.reject(new Error('offline')); tree = await f.settle();
  expect(text(tree)).toContain('0.00'); expect(text(tree)).toContain('הרענון לא הושלם');
});

test('a temporarily processing server response does not erase a loaded measurement', async () => {
  const f = fixture(); f.render(); await f.settle();
  f.get.mockResolvedValueOnce({ status: 'processing', summary: null } as any);
  f.listeners[0]('active'); f.render();
  expect(text(await f.settle())).toContain('0.00');
});

test('account change hides prior measurements immediately and ignores delayed account replies', async () => {
  const f = fixture(), old = deferred<any>(); f.get.mockReturnValueOnce(old.promise);
  f.render(); f.account.currentUser = { id: 'other' };
  expect(f.render()).toBeNull();
  f.get.mockResolvedValueOnce({ status: 'unavailable', summary: null } as any);
  f.render({ gameId: 'g', userId: 'other' });
  old.resolve({ status: 'available', summary: { ...summary, distanceM: 9999 } });
  expect(text(await f.settle())).not.toContain('10.00');
});

test('switching games hides the previous game before the replacement response arrives', async () => {
  const f = fixture(); f.render(); await f.settle();
  f.get.mockReturnValueOnce(deferred<any>().promise);
  expect(text(f.render({ gameId: 'other-game', userId: 'u' }))).not.toContain('0.00');
});

test('a successful upload triggers a fresh read while an empty flush does not duplicate reads', async () => {
  const f = fixture(), pending = deferred<any>(); f.flush.mockReturnValueOnce(pending.promise);
  f.render(); await f.settle(); expect(f.get).toHaveBeenCalledTimes(1);
  pending.resolve({ uploaded: 1 }); await f.settle(); expect(f.get).toHaveBeenCalledTimes(2);
});

test('read and upload failures report constant errors without sensor payloads or remote error text', async () => {
  const f = fixture();
  const privateFailure = Object.assign(new Error('sensor heartRateBpm=172 uid=private-user'), { samples: [{ heartRateBpm: 172 }] });
  f.get.mockRejectedValueOnce(privateFailure); f.flush.mockRejectedValueOnce(privateFailure);
  f.render(); await f.settle();
  expect(f.observe).toHaveBeenCalledTimes(2);
  for (const [error, origin] of f.observe.mock.calls) {
    expect(error).not.toBe(privateFailure); expect(error.message).not.toContain('172');
    expect(error.samples).toBeUndefined(); expect(origin.source).toContain('PersonalActivityPanel.tsx');
  }
});

test('stale-session and already observed failures are not reported again', async () => {
  const f = fixture(), stale = Object.assign(new Error('old account'), { name: 'StaleSessionError' });
  f.get.mockRejectedValueOnce(stale); f.flush.mockRejectedValueOnce(stale);
  f.render(); await f.settle(); expect(f.observe).not.toHaveBeenCalled();
  const reported = new Error('service already reported'); f.origins.set(reported, {});
  f.get.mockRejectedValueOnce(reported); f.flush.mockRejectedValueOnce(reported);
  f.timers[0](); f.render(); await f.settle(); expect(f.observe).not.toHaveBeenCalled();
});

test('failed requests from an account that changed before a render produce no diagnostics', async () => {
  const f = fixture(), pending = deferred<any>();
  f.get.mockReturnValueOnce(pending.promise); f.flush.mockReturnValueOnce(pending.promise);
  f.render(); f.account.currentUser = { id: 'other' };
  pending.reject(new Error('late private data failure')); await f.settle();
  expect(f.observe).not.toHaveBeenCalled();
});


test('compact round card opens the shared activity route and keeps round duration semantics', async () => {
  const f = fixture(); f.render(); const tree = await f.settle();
  nodes(tree).find(n => n.props.accessibilityLabel === 'פתח את הפעילות האישית שלי').props.onPress();
  expect(f.navigate).toHaveBeenCalledWith('MyActivity');
  expect(text(tree)).toContain('סיכום המחזור האישי'); expect(text(tree)).toContain('זמן שנמדד במחזור');
});

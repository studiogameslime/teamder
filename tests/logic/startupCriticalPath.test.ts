import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';

// Exercise the source hooks and timers with native animation/network boundaries
// replaced. These measurements describe intentional waits, not device startup.
function hookRuntime() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const hooks = {
    useRef(initial: any) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useCallback(callback: any) { return callback; },
    useEffect(effect: () => any, deps: any[]) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || deps.some((dep, index) => !Object.is(dep, previous.deps[index]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  return {
    hooks,
    render<T>(callback: () => T) { cursor = 0; effects = []; const tree = callback(); effects.forEach(effect => effect()); return tree; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function splash(initial: { ready: boolean; awaitStart: boolean }) {
  const runtime = hookRuntime();
  const onFinish = jest.fn();
  const storage = { getBootDurationMs: jest.fn(async () => 700), recordBootDurationMs: jest.fn(async () => {}) };
  const logEvent = jest.fn();
  const exports: any = {};
  const curve = Object.assign((value: any) => value, { out: (value: any) => value, in: (value: any) => value, quad: () => {}, cubic: () => {} });
  const fakeReact = { ...React, ...runtime.hooks };
  const modules: Record<string, any> = {
    react: fakeReact,
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', Image: 'Image', StyleSheet: { create: (value: any) => value } },
    'expo-splash-screen': { hideAsync: async () => {} },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea', useSafeAreaFrame: () => ({ width: 393, height: 852 }) },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, Easing: curve,
      useSharedValue: (value: any) => runtime.hooks.useRef(value), useAnimatedStyle: (callback: any) => callback(),
      cancelAnimation: () => {}, runOnJS: (callback: any) => callback, withSequence: (...values: any[]) => values.at(-1),
      withTiming: (value: any, config: any, callback?: (finished: boolean) => void) => { if (callback) setTimeout(() => callback(true), config.duration); return value; } },
    '@/components/entry/SplashHero': { SPLASH_IMAGE: 1 },
    '@/services/storage': { storage },
    '@/services/analyticsService': { AnalyticsEvent: { EntryWelcomeViewed: 'viewed', EntryWelcomeContinued: 'continued' }, logEvent },
    '@/theme': { colors: {}, radius: {}, spacing: {}, typography: {} },
    '@/i18n/he': { he: { entryWelcomeCta: 'מתחילים' } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/screens/SplashScreen.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, Date, setTimeout, clearTimeout, require: (id: string) => {
    if (!(id in modules)) throw new Error(id);
    return modules[id];
  } });
  let props = { ...initial, onFinish };
  const render = () => runtime.render(() => exports.SplashScreen(props));
  render();
  return { onFinish, storage, logEvent, render, update: (next: Partial<typeof initial>) => { props = { ...props, ...next }; return render(); }, unmount: runtime.unmount };
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
afterEach(() => jest.useRealTimers());

test('a ready returning launch finishes after 240 ms hold plus the existing 320 ms fade', () => {
  const fixture = splash({ ready: true, awaitStart: false });
  jest.advanceTimersByTime(559); expect(fixture.onFinish).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1); expect(fixture.onFinish).toHaveBeenCalledTimes(1);
  fixture.unmount();
});

test('a slow returning launch never skips readiness and adds no cosmetic hold after data arrives', () => {
  const fixture = splash({ ready: false, awaitStart: false });
  jest.advanceTimersByTime(5000); expect(fixture.onFinish).not.toHaveBeenCalled();
  fixture.update({ ready: true });
  jest.advanceTimersByTime(319); expect(fixture.onFinish).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1); expect(fixture.onFinish).toHaveBeenCalledTimes(1);
  fixture.unmount();
});

test('a newly resolved welcome still waits 1400 ms and requires an explicit tap', () => {
  const fixture = splash({ ready: false, awaitStart: false });
  jest.advanceTimersByTime(100);
  fixture.update({ ready: true, awaitStart: true });
  jest.advanceTimersByTime(1299); expect(fixture.logEvent).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1); expect(fixture.logEvent).toHaveBeenCalledWith('viewed', { is_guest: true });
  jest.advanceTimersByTime(5000); expect(fixture.onFinish).not.toHaveBeenCalled();
  expect(fixture.storage.getBootDurationMs).toHaveBeenCalledTimes(1);
  const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  nodes(fixture.render()).find(node => node.type === 'Pressable').props.onPress();
  jest.advanceTimersByTime(320); expect(fixture.onFinish).toHaveBeenCalledTimes(1);
  fixture.unmount();
});

test('readiness lost before handoff cancels the returning timer', () => {
  const fixture = splash({ ready: true, awaitStart: false });
  jest.advanceTimersByTime(100); fixture.update({ ready: false });
  jest.advanceTimersByTime(5000); expect(fixture.onFinish).not.toHaveBeenCalled();
  fixture.update({ ready: true }); jest.advanceTimersByTime(320); expect(fixture.onFinish).toHaveBeenCalledTimes(1);
  fixture.unmount();
});

test('profile updates reuse the same group reads/listener while account and guest transitions restart them', () => {
  const source = fs.readFileSync('src/navigation/RootNavigator.tsx', 'utf8');
  const begin = source.indexOf('  const currentUserId = currentUser?.id;');
  const end = source.indexOf('  // Live listener on the signed-in', begin);
  expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
  const runtime = hookRuntime();
  const hydrateGroup = jest.fn(); const hydratePlayers = jest.fn(); const setGameCurrentUserId = jest.fn();
  const cleanup = jest.fn(); const subscribeGroups = jest.fn(() => cleanup);
  const dependencies = { hydrateGroup, useGameStore: (select: any) => select({ setCurrentUserId: setGameCurrentUserId, hydratePlayers }),
    useGroupStore: (select: any) => select({ subscribe: subscribeGroups }), useEffect: runtime.hooks.useEffect };
  const body = vm.runInNewContext(ts.transpileModule(`(function(currentUser, input) { const { hydrateGroup, useGameStore, useGroupStore, useEffect } = input; ${source.slice(begin, end)} })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText);
  const render = (user: any) => runtime.render(() => body(user, dependencies));
  render({ id: 'a', isGuest: true });
  render({ id: 'a', isGuest: true, stats: { played: 3 } });
  render({ id: 'a', isGuest: true, name: 'שם מעודכן' });
  expect(hydrateGroup).toHaveBeenCalledTimes(1); expect(hydratePlayers).toHaveBeenCalledTimes(1); expect(cleanup).not.toHaveBeenCalled();
  render({ id: 'a', isGuest: false });
  expect(hydrateGroup).toHaveBeenCalledTimes(2); expect(cleanup).toHaveBeenCalledTimes(1);
  render({ id: 'b', isGuest: false });
  expect(hydrateGroup).toHaveBeenCalledTimes(3); expect(hydrateGroup).toHaveBeenLastCalledWith('b'); expect(cleanup).toHaveBeenCalledTimes(2);
  render(null); expect(hydrateGroup).toHaveBeenCalledTimes(3); expect(cleanup).toHaveBeenCalledTimes(3);
  runtime.unmount();
});

test.each([[false, '1', false], [true, undefined, false], [true, '0', false], [true, '1', true]])('QA dependency graph is evaluated only behind both gates: %s, %s', (dev, flag, shouldLoad) => {
  const source = fs.readFileSync('src/navigation/RootNavigator.tsx', 'utf8');
  const tree = ts.createSourceFile('RootNavigator.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statement = tree.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'QARouteLauncher'))!;
  expect(statement).toBeDefined();
  const loaded = jest.fn(() => ({ QARouteLauncher: () => 'qa' }));
  const launcher = vm.runInNewContext(ts.transpileModule(statement.getText(tree) + '; QARouteLauncher;', {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, { __DEV__: dev, process: { env: { EXPO_PUBLIC_QA_ROUTES: flag } }, require: loaded });
  expect(loaded).toHaveBeenCalledTimes(shouldLoad ? 1 : 0);
  expect(launcher()).toBe(shouldLoad ? 'qa' : null);
});

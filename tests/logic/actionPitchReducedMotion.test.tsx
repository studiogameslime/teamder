import React from 'react';

// Render each real function component with its own hook lifetime. Native hosts
// and animation drivers are replaced; the preference hook and participants are not.
jest.mock('react', () => {
  const roots = new Map<string, { slots: any[]; cursor: number }>();
  let current: { slots: any[]; cursor: number };
  let pending: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    ...jest.requireActual('react'),
    __runtime: {
      render: (key: string, work: () => unknown) => {
        const root = roots.get(key) ?? { slots: [], cursor: 0 };
        roots.set(key, root); root.cursor = 0; current = root;
        return work();
      },
      flush: () => { const work = pending; pending = []; work.forEach(effect => effect()); },
      values: (key: string) => roots.get(key)?.slots.filter(slot => slot?.current?.shared).map(slot => slot.current),
      unmount: () => {
        roots.forEach(root => root.slots.forEach(slot => { slot?.cleanup?.(); if (slot) slot.cleanup = undefined; }));
      },
      reset: () => { roots.clear(); pending = []; },
    },
    useState: (initial: unknown) => {
      const root = current, i = root.cursor++;
      if (!(i in root.slots)) root.slots[i] = { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
      return [root.slots[i].value, (value: unknown) => { mockStateWrites(value); root.slots[i].value = value; }];
    },
    useRef: (initial: unknown) => {
      const root = current, i = root.cursor++;
      return root.slots[i] ?? (root.slots[i] = { current: initial });
    },
    useEffect: (effect: () => (() => void) | void, deps?: any[]) => {
      const root = current, i = root.cursor++, previous = root.slots[i];
      if (!same(previous?.deps, deps)) {
        const slot = { deps, cleanup: undefined as (() => void) | void };
        root.slots[i] = slot;
        pending.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
});

const mockStateWrites = jest.fn();
const mockListeners = new Set<(value: boolean) => void>();
const mockRemoves: jest.Mock[] = [];
const mockReads: Array<{ resolve: (value: boolean) => void; reject: (error: Error) => void }> = [];
jest.mock('react-native', () => ({
  Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
  I18nManager: { isRTL: true }, StyleSheet: { create: (v: unknown) => v, absoluteFillObject: {} },
  AccessibilityInfo: {
    isReduceMotionEnabled: jest.fn(() => new Promise<boolean>((resolve, reject) => mockReads.push({ resolve, reject }))),
    addEventListener: jest.fn((_name: string, listener: (value: boolean) => void) => {
      mockListeners.add(listener);
      const remove = jest.fn(() => mockListeners.delete(listener));
      mockRemoves.push(remove); return { remove };
    }),
  },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: (initial: unknown) => require('react').useRef({ value: initial, shared: true }).current,
  useAnimatedStyle: (make: () => unknown) => ({ get current() { return make(); } }),
  cancelAnimation: jest.fn(),
  withTiming: jest.fn((to: unknown, config: unknown) => ({ kind: 'timing', to, config })),
  withSpring: jest.fn((to: unknown) => ({ kind: 'spring', to })),
  withDelay: jest.fn((delay: number, animation: unknown) => ({ kind: 'delay', delay, animation })),
  withSequence: jest.fn((...animations: unknown[]) => ({ kind: 'sequence', animations })),
  withRepeat: jest.fn((animation: unknown) => ({ kind: 'repeat', animation })),
}));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/assets/images/match-action-grass.png', () => 'local-grass');
jest.mock('@/assets/images/match-football.png', () => 'local-football');

import { AccessibilityInfo } from 'react-native';
import { cancelAnimation, withDelay, withRepeat, withSpring } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { MatchActionPitch } from '@/components/match/MatchActionPitch';

const runtime = (require('react') as any).__runtime;
function nodes(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function readHook() {
  const result = runtime.render('hook', useReducedMotion); runtime.flush(); return result;
}
function renderPitch(props: any) {
  const tree = runtime.render('pitch', () => MatchActionPitch(props));
  const participants = nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === 'Participant');
  expect(participants).toHaveLength(2);
  const rendered = participants.map((node, index) => runtime.render(`participant-${index}`, () => node.type(node.props)));
  runtime.flush(); return { tree, rendered };
}
function change(value: boolean) { [...mockListeners].forEach(listener => listener(value)); }
const player = (id: string) => ({ id, name: id === 'p1' ? 'גל' : 'תומר', isFiller: false });
const props = () => ({
  mode: 'penalty' as const, primary: { player: player('p1'), label: 'בועט', color: '#22C55E' },
  secondary: { player: player('p2'), label: 'שוער', color: '#2563EB' },
  activeRole: null, status: 'saved' as const, outcome: 'save' as const, animationKey: 'confirmed',
  onAnimationComplete: jest.fn(),
});

beforeEach(() => {
  jest.useFakeTimers(); runtime.reset(); jest.clearAllMocks();
  mockListeners.clear(); mockRemoves.length = 0; mockReads.length = 0;
});
afterEach(() => { runtime.unmount(); runtime.reset(); jest.useRealTimers(); });

test.each([true, false])('the initial native read supplies %s when no newer event exists', async value => {
  expect(readHook()).toBe(false);
  expect((AccessibilityInfo.addEventListener as jest.Mock).mock.invocationCallOrder[0])
    .toBeLessThan((AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mock.invocationCallOrder[0]);
  mockReads[0].resolve(value); await Promise.resolve();
  expect(readHook()).toBe(value);
});

test.each([true, false])('a live preference %s wins over a stale startup response', async value => {
  readHook(); change(value); mockReads[0].resolve(!value); await Promise.resolve();
  expect(readHook()).toBe(value);
  change(!value); expect(readHook()).toBe(!value);
});

test('a failed initial read retains an event, and unmount rejects queued event/read callbacks', async () => {
  readHook(); change(true); mockReads[0].reject(Error('unavailable')); await Promise.resolve(); await Promise.resolve();
  expect(readHook()).toBe(true);
  const queued = [...mockListeners]; runtime.unmount(); mockStateWrites.mockClear();
  queued.forEach(listener => listener(false));
  expect(mockStateWrites).not.toHaveBeenCalled();
  expect(mockRemoves[0]).toHaveBeenCalledTimes(1); expect(mockListeners.size).toBe(0);
});

test('a native read that resolves after unmount cannot update state', async () => {
  readHook(); runtime.unmount(); mockStateWrites.mockClear();
  mockReads[0].resolve(true); await Promise.resolve();
  expect(mockStateWrites).not.toHaveBeenCalled();
});

test('the rendered active participant stops and restarts its halo on live preference events', () => {
  const input = { ...props(), primary: { ...props().primary, player: null }, status: 'idle', activeRole: 'primary' };
  const first = renderPitch(input);
  expect(nodes(first.rendered[0]).some(node => node.type === 'Text' && node.props.children === '+')).toBe(true);
  const [halo] = runtime.values('participant-0');
  expect(halo.value.kind).toBe('repeat');
  change(true); (withRepeat as jest.Mock).mockClear(); renderPitch(input);
  expect(cancelAnimation).toHaveBeenCalledWith(halo); expect(halo.value).toBe(0);
  expect(withRepeat).not.toHaveBeenCalled();
  change(false); renderPitch(input); expect(halo.value.kind).toBe('repeat');
  (withRepeat as jest.Mock).mockClear(); renderPitch({ ...input, visible: false });
  expect(halo.value).toBe(0); expect(withRepeat).not.toHaveBeenCalled();
});

test.each(['preference', 'hidden'])('%s cancels participant entry, keeper lunge and ball work', trigger => {
  const input = props(); renderPitch(input);
  const [progress, net] = runtime.values('pitch');
  const primary = runtime.values('participant-0'), keeper = runtime.values('participant-1');
  expect(primary[1].value.kind).toBe('spring'); expect(keeper[2].value.kind).toBe('delay');
  expect(jest.getTimerCount()).toBe(1);
  if (trigger === 'preference') change(true);
  (withSpring as jest.Mock).mockClear(); (withDelay as jest.Mock).mockClear();
  const tree = renderPitch({ ...input, visible: trigger !== 'hidden' }).tree;
  expect(withSpring).not.toHaveBeenCalled(); expect(withDelay).not.toHaveBeenCalled();
  [...primary, ...keeper, progress, net].forEach(value => expect(cancelAnimation).toHaveBeenCalledWith(value));
  expect(primary.map((value: any) => value.value)).toEqual([0, 1, 0]);
  expect(keeper.map((value: any) => value.value)).toEqual([0, 1, 0]);
  expect(net.value).toBe(0);
  if (trigger === 'hidden') {
    expect(progress.value).toBe(0); expect(jest.getTimerCount()).toBe(0);
    expect(nodes(tree).some(node => node.type === 'Text' && node.props.children === 'עצירה!')).toBe(false);
  } else {
    expect(progress.value).toBe(1);
    jest.advanceTimersByTime(169); expect(input.onAnimationComplete).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1); expect(input.onAnimationComplete).toHaveBeenCalledTimes(1);
  }
  jest.advanceTimersByTime(2000);
  expect(input.onAnimationComplete).toHaveBeenCalledTimes(trigger === 'hidden' ? 0 : 1);
});

test('unmount removes all participant subscriptions and pending animation completion', () => {
  const input = props(); renderPitch(input);
  expect(mockListeners.size).toBe(3);
  const queued = [...mockListeners]; runtime.unmount(); mockStateWrites.mockClear();
  expect(mockListeners.size).toBe(0); expect(mockRemoves).toHaveLength(3);
  mockRemoves.forEach(remove => expect(remove).toHaveBeenCalledTimes(1));
  queued.forEach(listener => listener(true)); jest.runAllTimers();
  expect(mockStateWrites).not.toHaveBeenCalled(); expect(input.onAnimationComplete).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

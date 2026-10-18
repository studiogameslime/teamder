import fs from 'fs';
import path from 'path';

// Execute the installed RN implementations, not copies of their hit testing or
// animation maths. Only the native event emitter and layout measurements are
// controlled here; physical-device coverage is recorded separately.
const babel = require('@babel/core');
const rn = path.resolve(__dirname, '../node_modules/react-native');
const stickyPath = path.join(rn, 'Libraries/Components/ScrollView/ScrollViewStickyHeader.js');
const stickySource = fs.readFileSync(stickyPath, 'utf8');

function transpile(source: string, filename: string) {
  return babel.transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [
      ['@babel/plugin-transform-flow-strip-types', {all: true}],
      '@babel/plugin-transform-modules-commonjs',
    ],
  }).code;
}

function nativeRuntime() {
  const modules = new Map<string, {exports: any}>();
  const subscriptions = new Set<(event: {tag: number; value: number}) => void>();
  let nextTag = 1;
  const api = new Proxy({}, {get: () => jest.fn()});
  const native = {
    API: api,
    assertNativeAnimatedModule: jest.fn(),
    generateNewNodeTag: () => nextTag++,
    nativeEventEmitter: {
      addListener: (_: string, callback: (event: {tag: number; value: number}) => void) => {
        subscriptions.add(callback);
        return {remove: () => subscriptions.delete(callback)};
      },
    },
  };
  function load(filename: string): any {
    if (modules.has(filename)) return modules.get(filename)!.exports;
    const mod = {exports: {}};
    modules.set(filename, mod);
    const source = fs.readFileSync(filename, 'utf8');
    const resolve = (id: string): any => {
      if (id === 'invariant') return require('invariant');
      if (id.endsWith('NativeAnimatedHelper')) return native;
      if (id.endsWith('NativeAnimatedValidation')) return {validateInterpolation: jest.fn()};
      if (id.endsWith('/Easing')) return {linear: (n: number) => n};
      if (id.endsWith('/normalizeColor') || id.endsWith('/processColor')) return (n: unknown) => n;
      if (id.endsWith('/InteractionManager')) return {};
      if (id.endsWith('/Platform')) return {OS: 'android'};
      if (id.endsWith('/ReactNativeFeatureFlags')) return {shouldPressibilityUseW3CPointerEventsForHover: () => false};
      if (id.endsWith('/SoundManager')) return {playTouchSound: jest.fn()};
      if (id.endsWith('/UIManager')) return {};
      if (id.endsWith('/HoverState')) return {isHoverEnabled: () => false};
      if (id.endsWith('PressabilityPerformanceEventEmitter.js')) return {emitEvent: jest.fn()};
      if (id.endsWith('/Rect')) return {normalizeRect: (rect: unknown) => rect};
      if (/Animated(Node|WithChildren|Interpolation|Value|Addition|DiffClamp)$/.test(id)) {
        return load(path.resolve(path.dirname(filename), `${id}.js`));
      }
      throw new Error(`Unexpected installed RN dependency ${id}`);
    };
    new Function('require', 'module', 'exports', '__DEV__', transpile(source, filename))(
      resolve, mod, mod.exports, false,
    );
    return mod.exports;
  }
  const Value = load(path.join(rn, 'Libraries/Animated/nodes/AnimatedValue.js')).default;
  const Addition = load(path.join(rn, 'Libraries/Animated/nodes/AnimatedAddition.js')).default;
  const DiffClamp = load(path.join(rn, 'Libraries/Animated/nodes/AnimatedDiffClamp.js')).default;
  const Pressability = load(path.join(rn, 'Libraries/Pressability/Pressability.js')).default;
  return {
    Value, Pressability,
    Animated: {add: (a: any, b: any) => new Addition(a, b), diffClamp: (a: any, min: number, max: number) => new DiffClamp(a, min, max)},
    emit: (value: any, offset: number) => {
      const event = {tag: value.__getNativeTag(), value: offset};
      subscriptions.forEach(callback => callback(event));
    },
    subscriptionCount: () => subscriptions.size,
  };
}

function compileExpression(source: string, bindings: Record<string, unknown>) {
  const code = transpile(`module.exports = ${source};`, 'rn-extracted-listener.js');
  const mod = {exports: undefined as any};
  new Function('module', ...Object.keys(bindings), code)(mod, ...Object.values(bindings));
  return mod.exports;
}

function sticky(runtime: ReturnType<typeof nativeRuntime>, source = stickySource, options: Record<string, unknown> = {}) {
  const scrollValue = new runtime.Value(0, {useNativeDriver: true});
  let translated: number | null = null;
  let currentNode: any;
  const commits: number[] = [];
  const initialZero = {current: true};
  const debounce = {current: null as ReturnType<typeof setTimeout> | null};
  const setTranslateY = (value: number) => {
    translated = value;
    commits.push(value);
    // The original component's effect runs after each state commit.
    if (source.includes('haveReceivedInitialZeroTranslateY') && value !== 0) initialZero.current = false;
  };
  const listener = source.match(/const animatedValueListener = useCallback\(([\s\S]*?), \[\]\);/)?.[1];
  if (!listener) throw new Error('Installed RN sticky listener not found');
  const animatedValueListener = compileExpression(listener, {
    Platform: {OS: options.platform ?? 'android'},
    haveReceivedInitialZeroTranslateY: initialZero,
    translateYDebounceTimer: debounce,
    setTranslateY,
    setTimeout,
    clearTimeout,
  });
  const offset = options.hiddenOnScroll ? runtime.Animated.diffClamp(
    scrollValue.interpolate({extrapolateLeft: 'clamp', inputRange: [240, 241], outputRange: [0, 1]})
      .interpolate({inputRange: [0, 1], outputRange: [0, -1]}),
    -52,
    0,
  ) : null;
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*const inputRange: Array<number> = \[-1, 0\];([\s\S]*?)\n  \}, \[/);
  if (!effectMatch) throw new Error('Installed RN interpolation effect not found');
  const effect = compileExpression(`() => { const inputRange: Array<number> = [-1, 0];${effectMatch[1]}\n}`, {
    measured: true,
    layoutY: 240,
    layoutHeight: 52,
    scrollViewHeight: 700,
    nextHeaderLayoutY: undefined,
    inverted: false,
    offset,
    isFabric: true,
    scrollAnimatedValue: scrollValue,
    Animated: runtime.Animated,
    animatedValueListener,
    translateYDebounceTimer: debounce,
    clearTimeout,
    setAnimatedTranslateY: (node: any) => {
      currentNode = node;
      // Rendering the animated host makes the graph native and attaches it.
      node.__makeNative();
      node.__attach();
    },
    ...options,
  });
  let cleanup = effect();
  return {
    scrollValue,
    commits,
    translated: () => translated,
    nativeOffset: (offset: number) => runtime.emit(scrollValue, offset),
    interpolationEvent: (value: number) => animatedValueListener({value}),
    recreate: () => {cleanup(); currentNode.__detach(); cleanup = effect();},
    dispose: () => {cleanup(); currentNode.__detach();},
  };
}

function pressWithMeasuredOffset(runtime: ReturnType<typeof nativeRuntime>, measuredOffset: number, drift = 1) {
  const onPress = jest.fn();
  const onPressIn = jest.fn();
  const onPressOut = jest.fn();
  const instance = new runtime.Pressability({onPress, onPressIn, onPressOut, minPressDuration: 0});
  const node = {measure: (callback: Function) => callback(0, 240, 100, 52, 0, 240 + measuredOffset)};
  const event = (pageY: number) => ({currentTarget: node, persist: jest.fn(), nativeEvent: {pageX: 50, pageY}});
  const handlers = instance.getEventHandlers();
  handlers.onResponderGrant(event(266));
  handlers.onResponderMove(event(266 + drift));
  handlers.onResponderRelease(event(266 + drift));
  instance.reset();
  return {onPress, onPressIn, onPressOut};
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('demonstrates why a tiny movement cancels a press against stale Fabric coordinates', () => {
  const runtime = nativeRuntime();
  const stale = pressWithMeasuredOffset(runtime, 270);
  expect(stale.onPressIn).toHaveBeenCalledTimes(1);
  expect(stale.onPressOut).toHaveBeenCalledTimes(1);
  expect(stale.onPress).not.toHaveBeenCalled();
  const corrected = pressWithMeasuredOffset(runtime, 0);
  expect(corrected.onPress).toHaveBeenCalledTimes(1);
});

it('commits the real native translation, including the only zero event after returning to the top', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime);
  header.nativeOffset(510);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(270);
  header.nativeOffset(0);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(0);
  expect(pressWithMeasuredOffset(runtime, header.translated()!).onPress).toHaveBeenCalledTimes(1);
  header.dispose();
});

it('accepts a genuine zero after a nonzero translation rather than discarding it as initialization', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime);
  header.interpolationEvent(270);
  jest.advanceTimersByTime(20);
  header.interpolationEvent(0);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(0);
  header.dispose();
});

it('recreating an interpolation while scrolled preserves its real position without a transient zero', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime);
  header.nativeOffset(510);
  jest.advanceTimersByTime(20);
  const before = header.commits.length;
  header.recreate();
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(270);
  expect(header.commits.slice(before)).not.toContain(0);
  header.dispose();
});

it('recreating exactly at the top commits zero even without a subsequent scroll event', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime);
  header.nativeOffset(510);
  jest.advanceTimersByTime(20);
  header.nativeOffset(0);
  header.recreate();
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(0);
  header.dispose();
});

it('removes the native listener and pending commit when the sticky header unmounts', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime);
  header.nativeOffset(510);
  header.dispose();
  jest.advanceTimersByTime(100);
  expect(header.commits).toEqual([]);
  expect(runtime.subscriptionCount()).toBe(0);
});

it('retains the existing collision curve when a following sticky header pushes this one away', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime, stickySource, {nextHeaderLayoutY: 400});
  header.nativeOffset(510);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(108);
  header.nativeOffset(800);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(108);
  header.nativeOffset(0);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(0);
  header.dispose();
});

it('retains the existing bottom-pinned curve for inverted headers', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime, stickySource, {inverted: true, layoutY: 900});
  header.nativeOffset(510);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(258);
  header.nativeOffset(0);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(0);
  header.dispose();
});

it('preserves the hidden-on-scroll offset and restores it when scrolling back', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime, stickySource, {hiddenOnScroll: true});
  header.nativeOffset(510);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(218);
  header.nativeOffset(0);
  jest.advanceTimersByTime(20);
  expect(header.translated()).toBe(0);
  header.dispose();
});

it('does not add shadow-tree synchronization to non-Fabric headers', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime, stickySource, {isFabric: false});
  header.nativeOffset(510);
  jest.advanceTimersByTime(20);
  expect(header.commits).toEqual([]);
  expect(runtime.subscriptionCount()).toBe(0);
  header.dispose();
});

it('keeps real drag-out cancellation rather than firing actions from press-in or press-out', () => {
  const runtime = nativeRuntime();
  const drag = pressWithMeasuredOffset(runtime, 0, 200);
  expect(drag.onPressIn).toHaveBeenCalledTimes(1);
  expect(drag.onPressOut).toHaveBeenCalledTimes(1);
  expect(drag.onPress).not.toHaveBeenCalled();
});

it('retains the iOS 64ms debounce, synchronizes zero, and cancels the pending iOS commit on unmount', () => {
  const runtime = nativeRuntime();
  const header = sticky(runtime, stickySource, {platform: 'ios'});
  header.nativeOffset(510);
  jest.advanceTimersByTime(63);
  expect(header.translated()).toBeNull();
  jest.advanceTimersByTime(1);
  expect(header.translated()).toBe(270);
  header.nativeOffset(0);
  jest.advanceTimersByTime(63);
  expect(header.translated()).toBe(270);
  jest.advanceTimersByTime(1);
  expect(header.translated()).toBe(0);
  const settledCommits = [...header.commits];
  header.nativeOffset(600);
  header.dispose();
  jest.advanceTimersByTime(100);
  expect(header.commits).toEqual(settledCommits);
  expect(runtime.subscriptionCount()).toBe(0);
});

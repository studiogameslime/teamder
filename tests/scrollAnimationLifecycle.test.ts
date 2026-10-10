// Exercise timer/RAF lifetime without loading native modules in Node.
let mockMoving = false;
let mockEffects: Array<() => void | (() => void)> = [];
let mockVisible: string[] = [];
let mockSetMoving = jest.fn();
let mockNavigation: any = null;
let mockAppState = 'active';
let mockReduced = false;
let mockSubscriptions: Array<(notify: () => void) => () => void> = [];
let mockRefs: Array<{ current: unknown }> = [];
let mockRefIndex = 0;
const mockRemoveApp = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: (effect: () => void | (() => void)) => mockEffects.push(effect),
  useRef: (current: unknown) => mockRefs[mockRefIndex++] ?? (mockRefs[mockRefIndex - 1] = { current }),
  useCallback: (callback: unknown) => callback,
  useContext: () => mockNavigation,
  useSyncExternalStore: (subscribe: (notify: () => void) => () => void, read: () => unknown) => {
    mockSubscriptions.push(subscribe); return read();
  },
  useState: (initial: unknown) => {
    let value = initial;
    return [value, (next: unknown) => {
      if (typeof next === 'boolean') mockSetMoving(next);
      if (next !== value) { value = next; mockVisible.push(String(next)); }
    }];
  },
}));
jest.mock('react-native', () => ({ Text: 'Text', ScrollView: 'ScrollView', AppState: {
  get currentState() { return mockAppState; },
  addEventListener: () => ({ remove: mockRemoveApp }),
} }));
jest.mock('@/components/ScrollSurface', () => ({ useScrollActivity: () => mockMoving }));
jest.mock('@react-navigation/native', () => ({ NavigationContext: {} }));
jest.mock('@/hooks/animations/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { CountUp } from '@/components/anim/CountUp';
import { useAmbientMotion } from '@/hooks/animations/useAmbientMotion';

describe('counter work during a gesture', () => {
  let queue: Map<number, FrameRequestCallback>;
  let now: number;
  let nextId: number;
  beforeEach(() => {
    mockEffects = []; mockVisible = []; mockMoving = false;
    mockRefs = []; mockRefIndex = 0;
    queue = new Map(); now = 0; nextId = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    global.requestAnimationFrame = jest.fn(callback => { queue.set(++nextId, callback); return nextId; });
    global.cancelAnimationFrame = jest.fn(id => { queue.delete(id); });
  });
  afterEach(() => jest.restoreAllMocks());
  function frame(time: number) {
    now = time;
    const callbacks = [...queue.values()]; queue.clear();
    callbacks.forEach(callback => callback(time));
  }
  it('commits only visible integer changes and reaches the exact target', () => {
    CountUp({ from: 0, to: 2, durationMs: 700 }); mockEffects[0]();
    for (let time = 0; time <= 720; time += 16) frame(time);
    expect(mockVisible).toEqual(['1', '2']);
    expect(queue.size).toBe(0);
  });
  it('settles immediately during scrolling, preserving decimal precision', () => {
    mockMoving = true;
    CountUp({ from: 0, to: 8.85, decimals: 1 }); mockEffects[0]();
    expect(mockVisible).toEqual([(8.85).toFixed(1)]);
    expect(queue.size).toBe(0);
  });
  it('allows readable font scaling and settles without RAF under reduced motion', () => {
    mockReduced = true;
    try {
      const output = CountUp({ from: 0, to: 8.8, decimals: 1 });
      expect(output.props.allowFontScaling).toBe(true);
      expect(output.props.maxFontSizeMultiplier).toBe(1.8);
      mockEffects[0]();
      expect(mockVisible).toEqual(['8.8']);
      expect(queue.size).toBe(0);
    } finally {
      mockReduced = false;
    }
  });
  it('does not schedule an invisible animation or a zero-duration animation', () => {
    CountUp({ from: 1.01, to: 1.04, decimals: 1 }); mockEffects[0]();
    expect(queue.size).toBe(0);
    mockEffects = [];
    CountUp({ from: 0, to: 9, durationMs: 0 }); mockEffects[0]();
    expect(mockVisible.at(-1)).toBe('9');
    expect(queue.size).toBe(0);
  });
  it('cancels pending frame work on unmount or target change', () => {
    CountUp({ from: 0, to: 10 });
    const cleanup = mockEffects[0]();
    expect(queue.size).toBe(1);
    if (cleanup) cleanup();
    expect(queue.size).toBe(0);
    frame(800);
    expect(mockVisible).toEqual([]);
  });
  it('continues from the current number when a new target arrives mid-animation', () => {
    CountUp({ from: 0, to: 10, durationMs: 700 });
    const cleanup = mockEffects[0](); frame(140);
    expect(mockVisible.at(-1)).toBe('5');
    if (cleanup) cleanup();
    mockRefIndex = 0; mockEffects = []; mockVisible = [];
    CountUp({ from: 0, to: 20, durationMs: 700 }); mockEffects[0](); frame(156);
    expect(Number(mockVisible[0])).toBeLessThan(8);
    frame(840); expect(mockVisible.at(-1)).toBe('20');
  });
});

describe('ambient animation visibility', () => {
  beforeEach(() => {
    mockNavigation = null; mockAppState = 'active'; mockReduced = false; mockMoving = false;
    mockSubscriptions = []; mockRemoveApp.mockClear();
  });
  it('runs in a foreground preview but stops for scrolling, background and accessibility', () => {
    expect(useAmbientMotion()).toBe(true);
    mockMoving = true; expect(useAmbientMotion()).toBe(false);
    mockMoving = false; mockAppState = 'background'; expect(useAmbientMotion()).toBe(false);
    mockAppState = 'active'; mockReduced = true; expect(useAmbientMotion()).toBe(false);
  });
  it('stops on an unfocused kept screen and resumes when it is focused', () => {
    mockNavigation = { isFocused: () => false, addListener: jest.fn() };
    expect(useAmbientMotion()).toBe(false);
    mockNavigation.isFocused = () => true;
    expect(useAmbientMotion()).toBe(true);
  });
  it('removes focus, blur and app subscriptions when the animation unmounts', () => {
    const removed = [jest.fn(), jest.fn()];
    mockNavigation = { isFocused: () => true, addListener: jest.fn()
      .mockReturnValueOnce(removed[0]).mockReturnValueOnce(removed[1]) };
    useAmbientMotion();
    const notify = jest.fn();
    const cleanups = mockSubscriptions.map(subscribe => subscribe(notify));
    expect(mockNavigation.addListener).toHaveBeenCalledWith('focus', notify);
    expect(mockNavigation.addListener).toHaveBeenCalledWith('blur', notify);
    cleanups.forEach(cleanup => cleanup());
    expect(removed[0]).toHaveBeenCalledTimes(1); expect(removed[1]).toHaveBeenCalledTimes(1);
    expect(mockRemoveApp).toHaveBeenCalledTimes(1);
  });
});

describe('drag and momentum lifetime', () => {
  // The real wrapper uses the mocked hooks; only its native host is replaced.
  const { ScrollSurface } = jest.requireActual('@/components/ScrollSurface');
  beforeEach(() => { jest.useFakeTimers(); mockEffects = []; mockRefs = []; mockRefIndex = 0; mockSetMoving = jest.fn(); });
  afterEach(() => { jest.useRealTimers(); });
  function host(props: object = {}) {
    return ScrollSurface.render(props, null).props.children.props;
  }
  it('stays moving between drag-end and momentum, then stops at momentum-end', () => {
    const native = host(); mockEffects[0]();
    native.onScrollBeginDrag({}); native.onScrollEndDrag({});
    jest.advanceTimersByTime(50); native.onMomentumScrollBegin({});
    jest.advanceTimersByTime(200);
    expect(mockSetMoving.mock.calls.every(([value]) => value === true)).toBe(true);
    native.onMomentumScrollEnd({});
    expect(mockSetMoving).toHaveBeenLastCalledWith(false);
  });
  it('ends a drag without momentum and clears pending work on unmount', () => {
    const native = host(); const cleanup = mockEffects[0]();
    native.onScrollBeginDrag({}); native.onScrollEndDrag({});
    jest.advanceTimersByTime(120);
    expect(mockSetMoving).toHaveBeenLastCalledWith(false);
    native.onScrollBeginDrag({}); native.onScrollEndDrag({});
    if (cleanup) cleanup();
    mockSetMoving.mockClear(); jest.runAllTimers();
    expect(mockSetMoving).not.toHaveBeenCalled();
  });
  it('preserves scroll handlers, sticky headers and children order', () => {
    const begin = jest.fn(); const scroll = jest.fn(); const children = ['hero', 'tabs', 'body'];
    const native = host({ onScrollBeginDrag: begin, onScroll: scroll, stickyHeaderIndices: [1], children });
    const event = { nativeEvent: {} }; native.onScrollBeginDrag(event);
    expect(begin).toHaveBeenCalledWith(event);
    expect(native.onScroll).toBe(scroll);
    expect(native.stickyHeaderIndices).toEqual([1]);
    expect(native.children).toBe(children);
  });
});

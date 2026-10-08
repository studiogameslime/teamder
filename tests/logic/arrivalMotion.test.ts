// Run the actual hook with deterministic React lifecycle/timers; no native renderer needed.
jest.mock('react', () => {
  let slots: any[] = [], index = 0, effects: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    __runtime: {
      begin: () => { index = 0; },
      finish: () => { const pending = effects; effects = []; pending.forEach(f => f()); },
      reset: () => { slots.forEach(s => s?.cleanup?.()); slots = []; effects = []; index = 0; },
      unmount: () => slots.forEach(s => s?.cleanup?.()),
    },
    useRef: (value: unknown) => { const i = index++; return slots[i] ?? (slots[i] = { current: value }); },
    useState: (initial: unknown) => {
      const i = index++; if (!slots[i]) slots[i] = { value: initial };
      return [slots[i].value, (value: any) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn;
    },
    useEffect: (fn: () => (() => void), deps: unknown[]) => {
      const i = index++; if (!same(slots[i]?.deps, deps)) {
        const previous = slots[i]; slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
});

import { useArrivalTracker } from '../../src/hooks/animations/useArrivalTracker';
const runtime = (require('react') as any).__runtime;
function render(scope = 'round-1') { runtime.begin(); const result = useArrivalTracker(scope); runtime.finish(); return result; }

describe('arrival motion lifecycle', () => {
  beforeEach(() => { runtime.reset(); jest.useFakeTimers(); jest.setSystemTime(10000); });
  afterEach(() => { runtime.reset(); jest.useRealTimers(); });

  it('opening an existing roster does not celebrate historical registrations', () => {
    render().observe(['a', 'b']); expect(render().arrivals).toEqual({});
  });
  it('only new ids enter; metadata updates and reordering do not restart the motion', () => {
    render().observe(['a']); render().observe(['a', 'b']);
    expect(render().arrivals).toEqual({ b: 10000 });
    jest.advanceTimersByTime(100); render().observe(['b', 'a']);
    expect(render().arrivals).toEqual({ b: 10000 });
  });
  it('clears arrival tokens before a row can replay on a later remount', () => {
    render().observe([]); render().observe(['a']); jest.advanceTimersByTime(500);
    expect(render().arrivals).toEqual({});
  });
  it('scope changes ignore callbacks from the previous conversation', () => {
    const old = render(); old.observe(['a']); render('round-2').observe(['b']);
    old.observe(['a', 'old-new']); expect(render('round-2').arrivals).toEqual({});
    render('round-2').observe(['b', 'c']); expect(render('round-2').arrivals).toEqual({ c: 10000 });
  });
  it('caps a reconnect backlog to one small wave', () => {
    render().observe([]); render().observe(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(Object.keys(render().arrivals)).toEqual(['b', 'c', 'd', 'e', 'f']);
  });
  it('unmount cancels expiry and ignores a late snapshot', () => {
    const old = render(); old.observe([]); old.observe(['a']); runtime.unmount();
    expect(jest.getTimerCount()).toBe(0); old.observe(['a', 'b']); expect(jest.getTimerCount()).toBe(0);
  });
});

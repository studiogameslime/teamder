import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function runtime() {
  let slots: any[] = [], index = 0, pending: Array<() => void> = [];
  const same = (a: any[], b: any[]) => a?.length === b?.length && a?.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: any) {
      const i = index++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (value: any) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useRef(initial: any) { const i = index++; return slots[i] ??= { current: initial }; },
    useCallback(fn: any, deps: any[]) {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn };
      return slots[i].value;
    },
    useEffect(effect: any, deps: any[]) {
      const i = index++, previous = slots[i];
      if (!same(previous?.deps, deps)) {
        const slot: any = { deps }; slots[i] = slot;
        pending.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  return { hooks, begin: () => { index = 0; }, effects: () => { const work = pending; pending = []; work.forEach(fn => fn()); },
    unmount: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; pending = []; index = 0; } };
}
const deferred = () => {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const group = (id = 'club') => ({ id, adminIds: ['manager'], playerIds: ['player'], cardsEnabled: true });
const manager = { id: 'manager', isGuest: false };
let rt: ReturnType<typeof runtime>, get: jest.Mock, hydrate: jest.Mock, stats: jest.Mock, cards: jest.Mock, hook: any, log: jest.Mock;
function render(id = 'club', viewer = manager) { rt.begin(); return hook(id, viewer); }

beforeEach(() => {
  rt = runtime(); get = jest.fn().mockResolvedValue(group()); hydrate = jest.fn().mockResolvedValue([{ id: 'player', name: 'שחקן' }]);
  stats = jest.fn().mockResolvedValue({ player: { gamesPlayed: 3 } }); cards = jest.fn().mockResolvedValue({ player: { yellow: 1 } }); log = jest.fn();
  const source = ts.transpileModule(fs.readFileSync('src/hooks/useCommunityRoster.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as any };
  const dependencies: Record<string, any> = {
    react: rt.hooks,
    '@react-navigation/native': { useFocusEffect: (fn: any) => rt.hooks.useEffect(fn, [fn]) },
    '@/services': { groupService: { get, hydrateUsers: hydrate }, communityEventsService: { getActiveCardCounts: cards } },
    '@/services/gameService': { gameService: { getCommunityPlayerStats: stats } },
    '@/services/errorLog': { logError: log }, '@/utils/errorObservation': { observeCaughtError: jest.fn() },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name: string) => dependencies[name] });
  hook = module.exports.useCommunityRoster;
});
afterEach(() => rt.unmount());

test('the initial roster remains loading until member documents arrive, and commits a coherent snapshot', async () => {
  const people = deferred(); hydrate.mockReturnValue(people.promise);
  expect(render().initialLoading).toBe(true); rt.effects(); await flush();
  expect(render().group).toBeNull(); expect(render().initialLoading).toBe(true);
  people.resolve([{ id: 'player', name: 'שחקן' }]); await flush();
  const ready = render(); expect(ready.initialLoading).toBe(false); expect(ready.members).toHaveLength(1);
  expect(ready.stats.player.gamesPlayed).toBe(3); expect(ready.cardCounts.player.yellow).toBe(1);
  expect(get).toHaveBeenCalledTimes(1);
});

test('a focus refresh retains the roster and a failed refresh keeps it with an explicit failure', async () => {
  render(); rt.effects(); await flush(); const ready = render();
  const refresh = deferred(); get.mockReturnValue(refresh.promise); const request = ready.reload();
  expect(render().loading).toBe(true); expect(render().initialLoading).toBe(false); expect(render().members).toHaveLength(1);
  refresh.reject(Error('offline')); await request;
  expect(render().loading).toBe(false); expect(render().failed).toBe(true); expect(render().members).toHaveLength(1);
});

test('a failed first read is a failure rather than an empty club, and retry can recover', async () => {
  get.mockRejectedValueOnce(Error('offline')); render(); rt.effects(); await flush();
  const failure = render(); expect(failure.initialLoading).toBe(false); expect(failure.failed).toBe(true); expect(log).toHaveBeenCalledTimes(1);
  await failure.reload(); expect(render().failed).toBe(false); expect(render().members).toHaveLength(1);
});

test('a confirmed missing club ends loading without claiming a network failure', async () => {
  get.mockResolvedValue(null); render(); rt.effects(); await flush();
  expect(render()).toMatchObject({ group: null, members: [], loading: false, failed: false, initialLoading: false });
  expect(hydrate).not.toHaveBeenCalled();
});

test('switching clubs immediately hides the previous roster and ignores its late response', async () => {
  render(); rt.effects(); await flush(); const old = deferred(); get.mockReturnValueOnce(old.promise);
  const staleReload = render().reload;
  const request = staleReload();
  expect(render('other').group).toBeNull(); expect(render('other').initialLoading).toBe(true);
  get.mockResolvedValueOnce(group('other')); rt.effects(); await flush();
  old.resolve(group('club')); await request;
  expect(render('other').group.id).toBe('other');
  const reads = get.mock.calls.length; await staleReload();
  expect(get).toHaveBeenCalledTimes(reads); expect(render('other').loading).toBe(false);
});

test('an account or guest-status change hides all previous admin data before focus effects run', async () => {
  render(); rt.effects(); await flush(); expect(render().cardCounts.player).toBeDefined();
  const other = { id: 'other', isGuest: false };
  expect(render('club', other)).toMatchObject({ group: null, members: [], cardCounts: {}, initialLoading: true });
  rt.effects(); await flush(); expect(render('club', other).members).toHaveLength(1);
  expect(cards).toHaveBeenCalledTimes(1);
  expect(render('club', { ...other, isGuest: true }).group).toBeNull();
});

test('a newer reload wins over an older request, and unmount stops member hydration', async () => {
  render(); rt.effects(); await flush();
  const old = deferred(); get.mockReturnValueOnce(old.promise); const first = render().reload();
  get.mockResolvedValueOnce({ ...group(), name: 'החדש' }); await render().reload();
  old.resolve({ ...group(), name: 'הישן' }); await first; expect(render().group.name).toBe('החדש');
  const late = deferred(); get.mockReturnValueOnce(late.promise); const last = render().reload();
  const lateReload = render().reload;
  const reads = hydrate.mock.calls.length; rt.unmount(); late.resolve(group()); await last;
  expect(hydrate).toHaveBeenCalledTimes(reads);
  const groupReads = get.mock.calls.length; await lateReload(); expect(get).toHaveBeenCalledTimes(groupReads);
});

test('optional statistics failure preserves the successful member list, reports missing details and card queries remain admin-only', async () => {
  stats.mockRejectedValueOnce(Error('stats unavailable')); render('club', { id: 'player', isGuest: false }); rt.effects(); await flush();
  expect(render('club', { id: 'player', isGuest: false })).toMatchObject({ failed: true, stats: null, members: [{ id: 'player', name: 'שחקן' }] });
  expect(cards).not.toHaveBeenCalled();
});
test('a partial refresh keeps confirmed statistics and cards instead of replacing them with empty objects',async()=>{
  render();rt.effects();await flush();expect(render().stats.player.gamesPlayed).toBe(3);expect(render().cardCounts.player.yellow).toBe(1);
  stats.mockRejectedValueOnce(Error('stats offline'));cards.mockRejectedValueOnce(Error('cards offline'));await render().reload();
  expect(render()).toMatchObject({failed:true,loading:false,stats:{player:{gamesPlayed:3}},cardCounts:{player:{yellow:1}}});
  await render().reload();expect(render().failed).toBe(false);
});

test('the roster becomes usable while statistics/cards are pending and each detail arrives independently', async () => {
  const slowStats = deferred(), slowCards = deferred();
  stats.mockReturnValue(slowStats.promise); cards.mockReturnValue(slowCards.promise);
  render(); rt.effects(); await flush();
  expect(render()).toMatchObject({ initialLoading: false, loading: true, group: { id: 'club' }, members: [{ id: 'player', name: 'שחקן' }], stats: null, cardCounts: {} });
  slowCards.resolve({ player: { yellow: 2 } }); await flush();
  expect(render()).toMatchObject({ loading: true, stats: null, cardCounts: { player: { yellow: 2 } } });
  slowStats.resolve({ player: { gamesPlayed: 7 } }); await flush();
  expect(render()).toMatchObject({ loading: false, stats: { player: { gamesPlayed: 7 } }, cardCounts: { player: { yellow: 2 } } });
});

test('late optional admin details cannot reappear after the viewer changes', async () => {
  const slowStats = deferred(), slowCards = deferred();
  stats.mockReturnValueOnce(slowStats.promise); cards.mockReturnValueOnce(slowCards.promise);
  render(); rt.effects(); await flush();
  const viewer = { id: 'player', isGuest: false };
  render('club', viewer); rt.effects(); await flush();
  slowStats.resolve({ player: { gamesPlayed: 999 } }); slowCards.resolve({ player: { yellow: 99 } }); await flush();
  expect(render('club', viewer)).toMatchObject({ loading: false, stats: { player: { gamesPlayed: 3 } }, cardCounts: {} });
});

function skeletonModule(reduced: () => boolean) {
  const repeat = jest.fn(value => value), cancel = jest.fn();
  const module = { exports: {} as any };
  const source = ts.transpileModule(fs.readFileSync('src/components/loading/ScreenSkeletons.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const dependencies: Record<string, any> = {
    react: { ...jest.requireActual('react'), ...rt.hooks },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (x: any) => x, hairlineWidth: 1 } },
    '@expo/vector-icons': { Ionicons: 'Icon' }, '@/theme': { RTL_LABEL_ALIGN: 'left' },
    '@/hooks/animations/useReducedMotion': { useReducedMotion: reduced },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: (x: any) => rt.hooks.useRef({ value: x }).current,
      useAnimatedStyle: (fn: any) => fn(), withRepeat: repeat, withTiming: (x: any) => x,
      cancelAnimation: cancel, Easing: { inOut: () => 0, quad: 0 } },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name: string) => dependencies[name], setTimeout, clearTimeout });
  return { ...module.exports, repeat, cancel };
}

test('a slow-loading notice changes once after four seconds and its timer is cleared on unmount', () => {
  jest.useFakeTimers();
  try {
    const module = skeletonModule(() => false);
    const draw = () => { rt.begin(); return module.LoadingNotice({ label: 'טוענים שחקנים' }); };
    expect(draw().props.accessibilityLabel).toBe('טוענים שחקנים'); rt.effects();
    jest.advanceTimersByTime(3999); expect(draw().props.accessibilityLabel).toBe('טוענים שחקנים');
    jest.advanceTimersByTime(1); expect(draw().props.accessibilityLabel).toContain('עדיין נטענים');
    expect(draw().props.accessibilityValue).toBeUndefined();
    rt.unmount(); draw(); rt.effects(); expect(jest.getTimerCount()).toBe(1);
    rt.unmount(); expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

test('the shared skeleton pulse stops for reduced motion and decorative blocks are hidden from accessibility', () => {
  let reduced = true;
  const module = skeletonModule(() => reduced);
  const draw = () => {
    rt.begin(); const element = module.PersonalStatsSkeleton(); return element.type(element.props);
  };
  let tree = draw(); rt.effects(); expect(module.repeat).not.toHaveBeenCalled();
  expect(tree.props.children[0].props.importantForAccessibility).toBe('no-hide-descendants');
  reduced = false; draw(); rt.effects(); expect(module.repeat).toHaveBeenCalledTimes(1);
  reduced = true; tree = draw(); rt.effects();
  expect(Object.assign({}, ...draw().props.children[0].props.style).opacity).toBe(1);
  const cancellations = module.cancel.mock.calls.length; rt.unmount();
  expect(module.cancel.mock.calls.length).toBeGreaterThan(cancellations);
});

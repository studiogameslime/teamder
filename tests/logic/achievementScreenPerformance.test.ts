import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture() {
  const sourceFile = process.env.ACHIEVEMENT_PERFORMANCE_SOURCE || 'src/screens/profile/AchievementsScreen.tsx';
  const source = fs.readFileSync(sourceFile, 'utf8');
  let slots: any[] = [], cursor = 0;
  const effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const actualReact = jest.requireActual('react');
  const react = { ...actualReact,
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useState(initial: any) {
      const index = cursor++, slot = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, (value: any) => { slot.value = typeof value === 'function' ? value(slot.value) : value; }];
    },
    useMemo(fn: () => any, deps: any[]) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useEffect(effect: () => any, deps: any[]) {
      const index = cursor++, previous = slots[index];
      if (same(previous?.deps, deps)) return;
      const slot: any = { deps }; slots[index] = slot;
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
  let user: any = { id: 'owner', name: 'שחקן', friends: ['friend'], stats: { goals: 3, assists: 2, cleanSheets: 1 } };
  let groups: any[] = [{ id: 'club', adminIds: ['owner', 'admin'], playerIds: ['owner', 'peer'] }];
  const deriveCounters = jest.fn().mockResolvedValue({ gamesJoined: 4 });
  const persistDerivedUnlocks = jest.fn().mockResolvedValue([]);
  const listFromCounters = jest.fn().mockReturnValue([]), list = jest.fn().mockReturnValue([]);
  const userRead = jest.fn(async () => user), titlesRead = jest.fn().mockResolvedValue([]);
  const observe = jest.fn();
  const deps: Record<string, any> = {
    react,
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: (v: any) => v } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/services/achievementsService': { achievementsService: { deriveCounters, persistDerivedUnlocks, listFromCounters, list } },
    '@/services/seasonTitlesService': { seasonTitlesService: { list: titlesRead } },
    '@/services': { userService: { getUserById: userRead } },
    '@/store/userStore': { useUserStore: Object.assign((select: any) => select({ currentUser: user }), { getState: () => ({ currentUser: user }) }) },
    '@/store/groupStore': { useGroupStore: (select: any) => select({ groups }) },
    '@/theme': { colors: {}, RTL_LABEL_ALIGN: 'left' }, '@/i18n/he': { he: { retry: 'שוב' } },
    '@/services/analyticsService': { logEvent: jest.fn(), AnalyticsEvent: {} }, '@/services/errorLog': { logError: jest.fn() },
    '../../utils/errorObservation': { observeCaughtError: observe },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, require: (name: string) => deps[name] ?? new Proxy({}, { get: (_target, key) => String(key) }),
  });
  const draw = (commit = true) => { cursor = 0; const tree = module.exports.AchievementsScreen(); if (commit) effects.splice(0).forEach(run => run()); return tree; };
  return { draw, deriveCounters, persistDerivedUnlocks, listFromCounters, list, userRead, titlesRead, observe,
    get user() { return user; }, set user(value: any) { user = value; },
    get groups() { return groups; }, set groups(value: any[]) { groups = value; },
    commit() { effects.splice(0).forEach(run => run()); }, unmount() { slots.forEach(slot => slot?.cleanup?.()); slots = []; } };
}

test('five unrelated profile/club replacements keep one derivation instead of six full scans', async () => {
  const f = fixture(); f.draw(); await flush();
  for (let i = 0; i < 5; i++) {
    f.user = { ...f.user, name: 'שם ' + i };
    f.groups = f.groups.map(group => ({ ...group, name: 'שם מועדון ' + i, adminIds: [...group.adminIds].reverse(), playerIds: [...group.playerIds].reverse(), creatorId: 'owner' }));
    // Adding an explicit creator equivalent to the existing first admin is
    // semantically unchanged, even if subsequent admin order differs.
    f.draw(); await flush();
  }
  expect(f.deriveCounters).toHaveBeenCalledTimes(1);
  expect(f.persistDerivedUnlocks).toHaveBeenCalledTimes(1);
  expect(f.userRead).toHaveBeenCalledTimes(1); f.unmount();
});

test.each(['player', 'admin', 'founder', 'club'])('an actual %s identity/membership change refreshes the achievement sources', async field => {
  const f = fixture(); f.draw(); await flush();
  const g = f.groups[0];
  f.groups = field === 'player' ? [{ ...g, playerIds: [...g.playerIds, 'new-player'] }]
    : field === 'admin' ? [{ ...g, adminIds: ['admin'] }]
    : field === 'founder' ? [{ ...g, creatorId: 'other' }]
    : [...f.groups, { id: 'new-club', playerIds: ['owner'], adminIds: [] }];
  f.draw(); await flush(); expect(f.deriveCounters).toHaveBeenCalledTimes(2); f.unmount();
});

test('the first-admin fallback remains meaningful when no creator is stored', async () => {
  const f = fixture(); f.draw(); await flush();
  f.groups = [{ ...f.groups[0], adminIds: ['admin', 'owner'] }];
  f.draw(); await flush(); expect(f.deriveCounters).toHaveBeenCalledTimes(2); f.unmount();
});

test('changed totals still refresh, and old-account derived counters never render for the new owner', async () => {
  const f = fixture(); f.draw(); await flush();
  f.user = { ...f.user, stats: { ...f.user.stats, goals: 4 } }; f.draw(); await flush();
  expect(f.deriveCounters).toHaveBeenCalledTimes(2);
  f.listFromCounters.mockClear(); f.list.mockClear();
  f.user = { ...f.user, id: 'other', name: 'שחקן אחר' };
  f.draw(false);
  expect(f.listFromCounters).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
  f.commit(); await flush(); expect(f.deriveCounters).toHaveBeenLastCalledWith('other', expect.anything()); f.unmount();
});

test('a late derivation after leaving does not persist or publish newly unlocked tiers', async () => {
  const f = fixture(), waiting = deferred(); f.deriveCounters.mockReturnValue(waiting.promise);
  f.draw(); f.unmount(); waiting.resolve({ gamesJoined: 9 }); await flush();
  expect(f.persistDerivedUnlocks).not.toHaveBeenCalled();
});

test('rendering a new account invalidates a late result before effect cleanup runs', async () => {
  const f = fixture(), waiting = deferred(); f.deriveCounters.mockReturnValueOnce(waiting.promise);
  f.draw(); f.user = { ...f.user, id: 'other' }; f.draw(false);
  waiting.resolve({ gamesJoined: 9 }); await flush();
  expect(f.persistDerivedUnlocks).not.toHaveBeenCalled();
  f.commit(); await flush(); expect(f.persistDerivedUnlocks).toHaveBeenCalledWith('other', { gamesJoined: 4 }); f.unmount();
});

test('an offline derivation keeps the saved achievement path available and retry starts a fresh read', async () => {
  const f = fixture(); f.deriveCounters.mockRejectedValueOnce(Error('offline'));
  f.draw(); await flush(); const tree = f.draw();
  const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes)
    : [node, ...nodes(node.props?.children)];
  expect(f.list).toHaveBeenCalled();
  nodes(tree).filter(node => node.props?.accessibilityRole === 'tab')[1].props.onPress();
  const personal = f.draw();
  nodes(personal).find(node => node.type === 'Button' && node.props.title === 'שוב').props.onPress();
  f.draw(); await flush(); expect(f.deriveCounters).toHaveBeenCalledTimes(2);
  f.unmount();
});

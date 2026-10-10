// Executes the original Root consumer and its real retry callbacks. The small
// hook scheduler below models effect dependencies/cleanup; it is not a native
// navigator or a React renderer (neither renderer is installed in this repo).
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (k: string) => mockDisk.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockDisk.set(k, v); }),
  removeItem: jest.fn(async (k: string) => { mockDisk.delete(k); }),
} }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
import { storage } from '@/services/storage';
import { readPendingAction, writePendingAction, clearPendingActionIfMatches, pendingActionMatches, isOpenKind, PendingAction } from '@/services/pendingAction';
import { invitePreflight } from '@/services/invitePreflight';
import { useEntryStore } from '@/store/entryStore';
import { wasLandingShown, markLandingShown } from '@/services/inviteLanding';
import { decideEntry } from '@/navigation/entryGate';

const action = (kind: 'open_game' | 'open_club' | 'open_invite', id = 'target'): PendingAction => {
  const base = { version: 2, origin: 'deep_link' as const, createdAt: Date.now(), invitedBy: 'sender-' + id };
  return kind === 'open_invite' ? { ...base, kind } : { ...base, kind, targetId: id };
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
const cleanups: Array<() => void> = [];

function mount(overrides: Record<string, any> = {}) {
  const source = fs.readFileSync('src/navigation/RootNavigator.tsx', 'utf8');
  const begin = source.indexOf('  const consumedRef =');
  const end = source.indexOf('  // ── Resuming what somebody', begin);
  expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
  const js = ts.transpileModule('(function render(input){ const {currentUser,profileComplete,hasCompletedOnboarding,entryDecision,entryInvite,groupHydrated}=input;' + source.slice(begin, end) + '})', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const slots: any[] = []; let index = 0; let mounted = true;
  let effects: Array<() => void> = []; let queued = false;
  const schedule = () => { if (!mounted || queued) return; queued = true; void Promise.resolve().then(() => { queued = false; render(); }); };
  const state: any = {
    __DEV__: false, console, Date, setTimeout, clearTimeout,
    readPendingAction, clearPendingActionIfMatches, pendingActionMatches, isOpenKind, invitePreflight,
    currentUser: { id: 'guest', isGuest: true }, profileComplete: false, hasCompletedOnboarding: false,
    entryDecision: 'app', entryInvite: null, groupHydrated: true,
    useEntryStore: Object.assign((select: Function) => select(useEntryStore.getState()), { getState: useEntryStore.getState }),
    useUserStore: { getState: () => ({ currentUser: state.currentUser, isProfileComplete: () => state.profileComplete, hasCompletedOnboarding: () => state.hasCompletedOnboarding }) },
    useGroupStore: { getState: () => ({ hydrated: state.groupHydrated, groups: [] }) },
    gameService: { getGameById: jest.fn(async () => ({})) }, groupService: { getPublic: jest.fn(async () => ({})) },
    wasLandingShown: jest.fn(wasLandingShown), markLandingShown: jest.fn(markLandingShown),
    navigatePersonalInvite: jest.fn(() => true), navigateInvite: jest.fn(() => true),
    AnalyticsEvent: new Proxy({}, { get: (_, k) => k }), logEvent: jest.fn(), toast: { error: jest.fn() },
    ...overrides,
    useRef: (initial: any) => { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
    useState: (initial: any) => { const i = index++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, (next: any) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; schedule(); }]; },
    useEffect: (fn: () => any, deps: any[]) => { const i = index++; const prev = slots[i]; if (!prev || deps.length !== prev.deps.length || deps.some((v, j) => !Object.is(v, prev.deps[j]))) { effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); } },
  };
  // Compile the policy unchanged, substituting only the live stores at its
  // module boundary. This catches missing guards without mocking the policy.
  const policyPath = 'src/services/inviteNavigationPolicy.ts';
  if (fs.existsSync(policyPath)) {
    const exports: any = {};
    const policy = ts.transpileModule(fs.readFileSync(policyPath, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(policy, { exports, require: (name: string) => {
      if (name.endsWith('/userStore')) return { useUserStore: state.useUserStore };
      if (name.endsWith('/groupStore')) return { useGroupStore: state.useGroupStore };
      if (name.endsWith('/entryStore')) return { useEntryStore: state.useEntryStore };
      if (name.endsWith('/entryGate')) return { decideEntry };
      throw new Error('Unexpected policy dependency: ' + name);
    } });
    state.canNavigateInvitation = exports.canNavigateInvitation;
  }
  const body = vm.runInNewContext(js, state);
  function render() { if (!mounted) return; index = 0; effects = []; body(state); const batch = effects; for (const effect of batch) effect(); }
  const unsub = useEntryStore.subscribe(() => schedule());
  const unmount = () => { mounted = false; unsub(); for (const slot of slots) slot?.cleanup?.(); };
  cleanups.push(unmount);
  render();
  return { state, update: (next: Record<string, any>) => { Object.assign(state, next); render(); },
    unmount };
}
beforeEach(() => { jest.useFakeTimers(); mockDisk.clear(); useEntryStore.setState({ organicCompleted: true, invite: null, pendingIntent: null, suppressAutoConsume: false }); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); jest.useRealTimers(); });

test('personal invite retries the real timer and marks shown only after success', async () => {
  await writePendingAction(action('open_invite'));
  const navigatePersonalInvite = jest.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const root = mount({ navigatePersonalInvite });
  await settle(); expect(navigatePersonalInvite).toHaveBeenCalledTimes(1); expect(root.state.markLandingShown).not.toHaveBeenCalled();
  jest.advanceTimersByTime(500); await settle();
  expect(navigatePersonalInvite).toHaveBeenCalledTimes(2); expect(root.state.markLandingShown).toHaveBeenCalledTimes(1);
  expect(await readPendingAction()).toMatchObject({ kind: 'open_invite' }); root.unmount();
});
test('failed target navigation has exactly three timed retries', async () => {
  await writePendingAction(action('open_game')); const navigateInvite = jest.fn(() => false); const root = mount({ navigateInvite });
  await settle(); for (const ms of [500, 1000, 1500, 10000]) { jest.advanceTimersByTime(ms); await settle(); }
  expect(navigateInvite).toHaveBeenCalledTimes(4); expect(await readPendingAction()).toMatchObject({ kind: 'open_game' }); root.unmount();
});
test('personal check completing after a fresh link never opens or latches the old sender', async () => {
  await writePendingAction(action('open_invite', 'old')); const gate = deferred<boolean>();
  const root = mount({ wasLandingShown: jest.fn(() => gate.promise) }); await settle();
  await writePendingAction(action('open_club', 'new')); gate.resolve(false); await settle();
  expect(root.state.navigatePersonalInvite).not.toHaveBeenCalled(); expect(root.state.markLandingShown).not.toHaveBeenCalled();
  jest.advanceTimersByTime(50); await settle(); expect(root.state.navigateInvite).toHaveBeenCalledWith(expect.objectContaining({ type: 'team', id: 'new' })); root.unmount();
});
test.each(['open_invite', 'open_game'] as const)('%s respects a new explicit choice during async work', async kind => {
  await writePendingAction(action(kind)); const gate = deferred<any>();
  const root = mount(kind === 'open_invite' ? { wasLandingShown: () => gate.promise } : { gameService: { getGameById: () => gate.promise } });
  await settle(); await useEntryStore.getState().chooseIntent('create_club'); gate.resolve(kind === 'open_invite' ? false : {}); await settle();
  expect(root.state.navigatePersonalInvite).not.toHaveBeenCalled(); expect(root.state.navigateInvite).not.toHaveBeenCalled(); expect(await readPendingAction()).not.toBeNull(); root.unmount();
});
test.each(['open_invite', 'open_game'] as const)('%s does not navigate after root unmount', async kind => {
  await writePendingAction(action(kind)); const gate = deferred<any>();
  const root = mount(kind === 'open_invite' ? { wasLandingShown: () => gate.promise } : { gameService: { getGameById: () => gate.promise } });
  await settle(); root.unmount(); gate.resolve(kind === 'open_invite' ? false : {}); await settle(); jest.advanceTimersByTime(10000); await settle();
  expect(root.state.navigatePersonalInvite).not.toHaveBeenCalled(); expect(root.state.navigateInvite).not.toHaveBeenCalled(); expect(root.state.markLandingShown).not.toHaveBeenCalled();
});
test.each(['open_invite', 'open_game'] as const)('%s does not navigate an old session after identity/profile gate changes', async kind => {
  await writePendingAction(action(kind)); const gate = deferred<any>();
  const root = mount(kind === 'open_invite' ? { wasLandingShown: () => gate.promise } : { gameService: { getGameById: () => gate.promise } });
  await settle(); root.update({ currentUser: { id: 'different', isGuest: false }, profileComplete: false, hasCompletedOnboarding: false, entryDecision: 'entry' });
  gate.resolve(kind === 'open_invite' ? false : {}); await settle();
  expect(root.state.navigatePersonalInvite).not.toHaveBeenCalled(); expect(root.state.navigateInvite).not.toHaveBeenCalled(); expect(await readPendingAction()).not.toBeNull(); root.unmount();
});
test('four second slow preflight navigates optimistically and ignores late deletion', async () => {
  await writePendingAction(action('open_game')); const gate = deferred<any>(); const root = mount({ gameService: { getGameById: () => gate.promise } });
  await settle(); expect(root.state.navigateInvite).not.toHaveBeenCalled(); jest.advanceTimersByTime(4000); await settle();
  expect(root.state.navigateInvite).toHaveBeenCalledTimes(1); expect(await readPendingAction()).toBeNull(); gate.resolve(null); await settle(); expect(root.state.toast.error).not.toHaveBeenCalled(); root.unmount();
});
test('draft actions are retained without target navigation', async () => {
  await writePendingAction({ version: 2, kind: 'create_club', draftId: 'work', origin: 'in_app', createdAt: Date.now() });
  const root = mount(); await settle(); jest.advanceTimersByTime(10000); await settle();
  expect(await readPendingAction()).toHaveProperty('draftId', 'work'); expect(root.state.navigateInvite).not.toHaveBeenCalled(); root.unmount();
});
test('successful guest target navigation retains attribution', async () => {
  await writePendingAction(action('open_game')); const root = mount(); await settle();
  expect(root.state.navigateInvite).toHaveBeenCalledTimes(1); expect(await readPendingAction()).toBeNull(); expect(await storage.getInviteAttribution('fresh-account')).toHaveProperty('invitedBy', 'sender-target'); root.unmount();
});
test.each(['open_invite', 'open_game'] as const)('%s resumes for the new ready account after the old session is invalidated', async kind => {
  await writePendingAction(action(kind)); const gate = deferred<any>(); let calls = 0;
  const read = () => ++calls === 1 ? gate.promise : Promise.resolve(kind === 'open_invite' ? false : {});
  const root = mount(kind === 'open_invite' ? { wasLandingShown: read } : { gameService: { getGameById: read } });
  await settle(); root.update({ currentUser: { id: 'ready-account', isGuest: false }, profileComplete: true, hasCompletedOnboarding: true });
  gate.resolve(kind === 'open_invite' ? false : {}); await settle(); jest.advanceTimersByTime(3000); await settle();
  expect(calls).toBe(2);
  expect(kind === 'open_invite' ? root.state.navigatePersonalInvite : root.state.navigateInvite).toHaveBeenCalledTimes(1); root.unmount();
});
test.each([
  { currentUser: null },
  { currentUser: { id: 'known', isGuest: false }, profileComplete: false, hasCompletedOnboarding: true },
  { currentUser: { id: 'known', isGuest: false }, profileComplete: true, hasCompletedOnboarding: false },
  { entryDecision: 'entry' }, { entryDecision: 'unknown' }, { groupHydrated: false },
])('does not start target reads before readiness: %j', async initial => {
  await writePendingAction(action('open_game')); const root = mount(initial); await settle();
  expect(root.state.gameService.getGameById).not.toHaveBeenCalled(); expect(root.state.navigateInvite).not.toHaveBeenCalled(); expect(await readPendingAction()).not.toBeNull(); root.unmount();
});
test.each(['open_game', 'open_club'] as const)('a deleted %s shows error and clears only its own pending attempt', async kind => {
  await writePendingAction(action(kind)); const root = mount({ gameService: { getGameById: async () => null }, groupService: { getPublic: async () => null } }); await settle();
  expect(root.state.navigateInvite).not.toHaveBeenCalled(); expect(root.state.toast.error).toHaveBeenCalledTimes(1); expect(await readPendingAction()).toBeNull(); root.unmount();
});
test.each(['ACCESS_BLOCKED', 'unavailable'])('a %s preflight error opens destination loading/access UI instead of declaring dead', async code => {
  await writePendingAction(action('open_game')); const root = mount({ gameService: { getGameById: async () => { throw Object.assign(new Error('failed'), { code }); } } }); await settle();
  expect(root.state.navigateInvite).toHaveBeenCalledTimes(1); expect(root.state.toast.error).not.toHaveBeenCalled(); root.unmount();
});
test('a club member is navigated with membership taken from live store', async () => {
  await writePendingAction(action('open_club')); const root = mount({ useGroupStore: { getState: () => ({ hydrated: true, groups: [{ id: 'target' }] }) } }); await settle();
  expect(root.state.navigateInvite).toHaveBeenCalledWith({ type: 'team', id: 'target', isMember: true }); root.unmount();
});
test.each([true, false])('personal invitation alreadyShown=%s never invents or repeats a landing', async shown => {
  const value = action('open_invite'); if (!shown) delete value.invitedBy;
  await writePendingAction(value); const root = mount({ wasLandingShown: jest.fn(async () => shown) }); await settle();
  expect(root.state.navigatePersonalInvite).not.toHaveBeenCalled(); expect(root.state.markLandingShown).not.toHaveBeenCalled(); expect(await readPendingAction()).not.toBeNull(); root.unmount();
});
test('personal landing is durably shown once across rerender and remount while attribution stays', async () => {
  await writePendingAction(action('open_invite')); const first = mount(); await settle();
  expect(first.state.navigatePersonalInvite).toHaveBeenCalledTimes(1);
  first.update({ entryInvite: { kind: 'referral', invitedBy: 'sender-target' } }); await settle();
  expect(first.state.navigatePersonalInvite).toHaveBeenCalledTimes(1); first.unmount();
  const second = mount(); await settle(); expect(second.state.navigatePersonalInvite).not.toHaveBeenCalled();
  expect(await storage.getInviteAttribution('fresh')).toHaveProperty('invitedBy', 'sender-target'); second.unmount();
});

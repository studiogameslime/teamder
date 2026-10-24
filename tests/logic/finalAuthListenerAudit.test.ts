import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { subscribeUserSession, suspendUserSessionListeners } from '@/services/userSessionListeners';
import { retryRead } from '@/services/readRetry';
import { StaleSessionError } from '@/services/staleSession';

function actualMethod(file: string, name: string, context: object) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let method = '';
  const walk = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === name) method = node.getText(source);
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!method) throw Error(`Missing ${name}`);
  return vm.runInNewContext(ts.transpileModule(`({${method}}).${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

function actualProperty(file: string, name: string, context: object) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  const walk = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) expression = node.initializer.getText(source);
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!expression) throw Error(`Missing ${name}`);
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

type Observation = { next: (snap: any) => void; fail?: (error: unknown) => void; stop: jest.Mock };
function unreadSetup() {
  const auth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'listener-owner' } };
  const observations: Observation[] = [];
  const logError = jest.fn();
  const subscribe = actualMethod('src/services/chatService.ts', 'subscribeUnread', {
    USE_MOCK_DATA: false, getFirebase: () => ({ auth }), subscribeUserSession,
    col: { userChatUnread: (uid: string) => uid }, logError, __DEV__: false, console,
    onSnapshot: (_ref: unknown, next: Observation['next'], fail?: Observation['fail']) => {
      const observation = { next, fail, stop: jest.fn() }; observations.push(observation); return observation.stop;
    },
  });
  const seen = jest.fn(), failed = jest.fn();
  const stop = subscribe('listener-owner', seen, failed);
  return { auth, observations, seen, failed, stop, logError };
}

test('unread permission failure for the active account is handled and reported without erasing confirmed data', () => {
  const x = unreadSetup();
  try {
    expect(typeof x.observations[0].fail).toBe('function');
    const error = Object.assign(Error('denied'), { code: 'permission-denied' });
    x.observations[0].fail!(error);
    expect(x.failed).toHaveBeenCalledWith(error);
    expect(x.logError).toHaveBeenCalledWith('subscribeUnread', error, { uid: 'listener-owner' });
    expect(x.seen).not.toHaveBeenCalled();
  } finally { x.stop(); }
});

test('unread cleanup rejects queued data and errors rather than repopulating the next account badge', () => {
  const x = unreadSetup(); x.stop();
  x.observations[0].next({ docs: [] }); x.observations[0].fail?.(Error('late'));
  expect(x.observations[0].stop).toHaveBeenCalledTimes(1);
  expect(x.seen).not.toHaveBeenCalled(); expect(x.failed).not.toHaveBeenCalled(); expect(x.logError).not.toHaveBeenCalled();
});

test('unread callbacks from a revoked identity do not update or report failures under its replacement', () => {
  const x = unreadSetup();
  try {
    x.auth.currentUser = { uid: 'next-account' };
    x.observations[0].next({ docs: [] }); x.observations[0].fail?.(Error('revoked'));
    expect(x.seen).not.toHaveBeenCalled(); expect(x.failed).not.toHaveBeenCalled(); expect(x.logError).not.toHaveBeenCalled();
  } finally { x.stop(); }
});

function gameSetup(uid = 'game-listener-owner', auth: { currentUser: { uid: string } | null } = { currentUser: { uid } }, failSecondSetup = false) {
  const observations: Observation[] = [];
  const logError = jest.fn(), seen = jest.fn();
  const subscribe = actualMethod('src/services/gameService.ts', 'subscribeMyLiveOrUpcomingGames', {
    USE_MOCK_DATA: false, getFirebase: () => ({ auth }), subscribeUserSession,
    col: { games: () => 'games' }, query: (...args: unknown[]) => args, where: (...args: unknown[]) => args,
    myGamesFloor: () => 0, isStaleAfterStart: () => false, logError, __DEV__: false, console,
    onSnapshot: (_ref: unknown, next: Observation['next'], fail?: Observation['fail']) => {
      if (failSecondSetup && observations.length === 1) throw Error('second query failed');
      const observation = { next, fail, stop: jest.fn() }; observations.push(observation); return observation.stop;
    },
  });
  const stop = subscribe(uid, seen);
  return { auth, observations, seen, stop, logError };
}

test('both watch game listeners report active permission failures and never turn them into an empty successful list', () => {
  const x = gameSetup();
  try {
    const error = Object.assign(Error('denied'), { code: 'permission-denied' });
    x.observations.forEach(o => o.fail!(error));
    expect(x.logError).toHaveBeenCalledTimes(2); expect(x.seen).not.toHaveBeenCalled();
  } finally { x.stop(); }
});

test('both watch listeners detach together and ignore callbacks queued before account replacement', () => {
  const x = gameSetup();
  x.auth.currentUser = { uid: 'next-account' }; x.stop();
  x.observations.forEach(o => { o.next({ docs: [] }); o.fail!(Error('revoked')); expect(o.stop).toHaveBeenCalledTimes(1); });
  expect(x.logError).not.toHaveBeenCalled(); expect(x.seen).not.toHaveBeenCalled();
});

test('failure to attach the second watch query cleans the first and reports the active error', () => {
  const x = gameSetup('partial-owner', undefined, true);
  try {
    expect(x.observations).toHaveLength(1); expect(x.observations[0].stop).toHaveBeenCalledTimes(1);
    expect(x.logError).toHaveBeenCalledWith('subscribeMyLiveOrUpcomingGames', expect.objectContaining({ message: 'second query failed' }), { userId: 'partial-owner' });
    x.observations[0].next({ docs: [] }); x.observations[0].fail!(Error('queued after partial failure'));
    expect(x.logError).toHaveBeenCalledTimes(1);
    expect(x.seen).not.toHaveBeenCalled();
  } finally { x.stop(); }
});

test('profile subscription suspends before auth revocation and cannot apply a queued old profile after resume', () => {
  const uid = 'profile-owner', auth: any = { currentUser: { uid } };
  let state: any = { currentUser: { id: uid, name: 'קודם' } };
  const observations: Observation[] = [], logError = jest.fn();
  const subscribe = actualProperty('src/store/userStore.ts', 'subscribeCurrentUser', {
    USE_MOCK_DATA: false, getFirebase: () => ({ auth }), get: () => state, set: (patch: object) => { state = { ...state, ...patch }; },
    subscribeUserSession, docs: { user: (id: string) => id }, logError, __DEV__: false, console,
    onSnapshot: (_ref: unknown, next: Observation['next'], fail?: Observation['fail']) => {
      const observation = { next, fail, stop: jest.fn() }; observations.push(observation); return observation.stop;
    },
  });
  const stop = subscribe(uid), release = suspendUserSessionListeners(uid);
  try {
    expect(observations[0].stop).toHaveBeenCalledTimes(1); release(); expect(observations).toHaveLength(2);
    observations[0].next({ exists: () => true, data: () => ({ id: uid, name: 'ישן' }) });
    observations[0].fail!(Error('old')); expect(state.currentUser.name).toBe('קודם'); expect(logError).not.toHaveBeenCalled();
    observations[1].next({ exists: () => true, data: () => ({ id: uid, name: 'עדכני' }) }); expect(state.currentUser.name).toBe('עדכני');
    observations[1].fail!(Error('active')); expect(logError).toHaveBeenCalledTimes(1);
    auth.currentUser = { uid: 'replacement' }; observations[1].fail!(Error('revoked')); expect(logError).toHaveBeenCalledTimes(1);
  } finally { release(); stop(); }
});

test('club subscription discards in-flight hydration and queued permission errors when teardown invalidates its generation', async () => {
  const uid = 'clubs-owner'; let current = uid;
  const observations: Observation[] = [], seen = jest.fn(), failed = jest.fn();
  let resolveHydration!: (value: object) => void;
  const subscribe = actualMethod('src/services/groupService.ts', 'subscribeForUser', {
    USE_MOCK_DATA: false, isCurrentSession: (expected: string) => current === expected, subscribeUserSession, retryRead,
    query: (ref: unknown) => ref, where: () => ({}), col: { groups: () => 'groups' },
    hydrateClubAdminRatings: () => new Promise(resolve => { resolveHydration = resolve; }),
    onSnapshot: (_ref: unknown, next: Observation['next'], fail?: Observation['fail']) => {
      const observation = { next, fail, stop: jest.fn() }; observations.push(observation); return observation.stop;
    },
  });
  const stop = subscribe(uid, seen, failed);
  try {
    observations[0].fail!(Error('active')); expect(failed).toHaveBeenCalledTimes(1);
    observations[0].next({ docs: [{ data: () => ({ id: 'club' }) }] });
    const release = suspendUserSessionListeners(uid); expect(observations[0].stop).toHaveBeenCalledTimes(1);
    current = 'replacement'; release(); resolveHydration({ id: 'old-club' }); await new Promise(setImmediate);
    observations[0].fail!(Error('old')); expect(seen).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledTimes(1);
  } finally { stop(); }
});

test.each(['recover','persistent','stale'])('club hydration retries a transient failure and handles %s without empty data', async mode => {
  jest.useFakeTimers(); let current='clubs-owner';
  const seen=jest.fn(),failed=jest.fn(),observations:Observation[]=[];
  const error=Object.assign(Error('deadline'),{code:'functions/deadline-exceeded'});
  const hydrate=jest.fn().mockRejectedValueOnce(error);
  if(mode==='persistent')hydrate.mockRejectedValue(error);else hydrate.mockResolvedValue({id:'club',adminRatings:{owner:4}});
  const subscribe=actualMethod('src/services/groupService.ts','subscribeForUser',{
    USE_MOCK_DATA:false,isCurrentSession:(uid:string)=>uid===current,subscribeUserSession,retryRead,StaleSessionError,
    query:(q:unknown)=>q,where:()=>({}),col:{groups:()=> 'groups'},hydrateClubAdminRatings:hydrate,
    onSnapshot:(_:unknown,next:Observation['next'],fail:Observation['fail'])=>{const value={next,fail,stop:jest.fn()};observations.push(value);return value.stop;},
  });
  const stop=subscribe(current,seen,failed);
  try {
    observations[0].next({docs:[{data:()=>({id:'club'})}]});
    await jest.advanceTimersByTimeAsync(1);expect(seen).not.toHaveBeenCalled();
    if(mode==='stale')current='replacement';
    await jest.advanceTimersByTimeAsync(500);
    if(mode==='recover'){expect(seen).toHaveBeenCalledWith([{id:'club',adminRatings:{owner:4}}]);expect(failed).not.toHaveBeenCalled();}
    else {expect(seen).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledTimes(mode==='persistent'?1:0);}
    expect(hydrate).toHaveBeenCalledTimes(mode==='stale'?1:2);
  } finally {stop();jest.useRealTimers();}
});

test('sign-out stops unread and both actual watch subscriptions before service auth teardown, after token removal', async () => {
  const unread = unreadSetup(), games = gameSetup('listener-owner', unread.auth);
  const order: string[] = [];
  const old = { id: 'listener-owner', name: 'חשבון', onboardingCompleted: true };
  let state: any = { currentUser: old, onboardingDone: true };
  const signOut = actualProperty('src/store/userStore.ts', 'signOut', {
    get: () => state, set: (patch: object) => { state = { ...state, ...patch }; },
    removeDeviceTokenBeforeAuthTeardown: async () => { order.push('token'); expect(unread.observations[0].stop).not.toHaveBeenCalled(); },
    suspendUserSessionListeners,
    userService: { signOut: async () => {
      order.push('auth'); expect(unread.observations[0].stop).toHaveBeenCalledTimes(1);
      games.observations.forEach(o => expect(o.stop).toHaveBeenCalledTimes(1));
      unread.auth.currentUser = null;
      unread.observations[0].next({ docs: [] }); unread.observations[0].fail!(Error('auth revoked'));
      games.observations.forEach(o => { o.next({ docs: [] }); o.fail!(Error('auth revoked')); });
    } },
    useGroupStore: { getState: () => ({ reset: jest.fn() }) }, useGameStore: { getState: () => ({ reset: jest.fn() }) }, useChatStore: { getState: () => ({ clear: jest.fn() }) },
    clearTrail() {}, clearSignedOutUserState: async () => {}, logEvent() {}, AnalyticsEvent: {},
    startSilentGuest: async (set: (x: object) => void) => { unread.auth.currentUser = { uid: 'fresh-guest' }; set({ currentUser: { id: 'fresh-guest', isGuest: true } }); },
  });
  try {
    await signOut();
    expect(order).toEqual(['token', 'auth']); expect(state.currentUser.id).toBe('fresh-guest');
    expect(unread.seen).not.toHaveBeenCalled(); expect(unread.failed).not.toHaveBeenCalled(); expect(unread.logError).not.toHaveBeenCalled();
    expect(games.seen).not.toHaveBeenCalled(); expect(games.logError).not.toHaveBeenCalled();
    expect(unread.observations).toHaveLength(1);
  } finally { unread.stop(); games.stop(); }
});

test('failed service sign-out resumes the same account with a new generation and preserves its identity', async () => {
  const x = unreadSetup(); let state: any = { currentUser: { id: 'listener-owner' } };
  const signOut = actualProperty('src/store/userStore.ts', 'signOut', {
    get: () => state, set: (patch: object) => { state = { ...state, ...patch }; },
    removeDeviceTokenBeforeAuthTeardown: async () => {}, suspendUserSessionListeners,
    userService: { signOut: async () => { throw Error('provider unavailable'); } },
  });
  try {
    await expect(signOut()).rejects.toThrow('provider unavailable');
    expect(state.currentUser.id).toBe('listener-owner'); expect(x.observations).toHaveLength(2);
    x.observations[0].next({ docs: [] }); x.observations[0].fail!(Error('old queued callback'));
    expect(x.seen).not.toHaveBeenCalled(); expect(x.failed).not.toHaveBeenCalled();
    x.observations[1].next({ docs: [] }); expect(x.seen).toHaveBeenCalledTimes(1);
  } finally { x.stop(); }
});

test('subscriptions requested while teardown awaits cannot attach, and a nested suspension releases only once', () => {
  const release1 = suspendUserSessionListeners('suspended-owner'), release2 = suspendUserSessionListeners('suspended-owner');
  const attach = jest.fn(() => jest.fn());
  const stop = subscribeUserSession('suspended-owner', () => true, attach, jest.fn());
  try {
    expect(attach).not.toHaveBeenCalled(); release1(); release1(); expect(attach).not.toHaveBeenCalled();
    release2(); expect(attach).toHaveBeenCalledTimes(1);
  } finally { release1(); release2(); stop(); }
});

test('a different active identity cannot open a requested old-account listener or receive a fabricated empty result', () => {
  const attach = jest.fn(() => jest.fn()), failed = jest.fn();
  const stop = subscribeUserSession('old-owner', () => false, attach, failed); stop();
  expect(attach).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});

test('synchronous setup failure remains a real error for the active account', () => {
  const error = Error('query setup failed'), failed = jest.fn();
  const stop = subscribeUserSession('active-owner', () => true, () => { throw error; }, failed); stop();
  expect(failed).toHaveBeenCalledWith(error);
});

test('cold cached-profile hydration waits for restored Firebase identity before publishing an id or attaching its reads', async () => {
  const uid = 'cold-cache-owner', auth: any = { currentUser: null };
  let restore!: (user: object) => void;
  const restored = new Promise(resolve => { restore = resolve; });
  const cached = { id: uid, name: 'שם שמור' }, readCachedAuthUser = jest.fn(async () => cached);
  const getCurrentUser = actualMethod('src/services/userService.ts', 'getCurrentUser', {
    USE_MOCK_DATA: false, waitForAuthRestore: () => restored, docs: { user: (id: string) => id },
    getDoc: async () => { throw Error('offline profile'); }, readCachedAuthUser,
    setTimeout, clearTimeout, __DEV__: false, console,
  });
  let state: any = { currentUser: null };
  const attach = jest.fn(() => jest.fn()); let stop: (() => void) | undefined;
  const hydrate = actualProperty('src/store/userStore.ts', 'hydrate', {
    __DEV__: false, USE_MOCK_DATA: false,
    storage: { getOnboardingDone: async () => true }, userService: { getCurrentUser },
    set: (patch: any) => {
      state = { ...state, ...patch };
      if (patch.currentUser) stop = subscribeUserSession(uid, () => auth.currentUser?.uid === uid, attach, jest.fn());
    },
  });
  try {
    const pending = hydrate(); await Promise.resolve(); await Promise.resolve();
    expect(state.currentUser).toBeNull(); expect(attach).not.toHaveBeenCalled(); expect(readCachedAuthUser).not.toHaveBeenCalled();
    auth.currentUser = { uid }; restore({ uid, isAnonymous: false }); await pending;
    expect(readCachedAuthUser).toHaveBeenCalledWith(uid); expect(state.currentUser).toEqual(cached); expect(attach).toHaveBeenCalledTimes(1);
  } finally { stop?.(); }
});

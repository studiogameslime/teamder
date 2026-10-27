import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { installCaughtErrorSink, clearCaughtErrorOrigins } from '../../src/utils/errorObservation';
import { parseAppLink } from '../../src/utils/appLinks';

function fixture() {
  const effects: (() => void | (() => void))[] = [];
  const intervals: (() => void)[] = [];
  const bridge = { publishState: jest.fn(async (_json: string) => undefined) };
  const observe = jest.fn();
  clearCaughtErrorOrigins();
  installCaughtErrorSink(observe);
  const getUser = jest.fn(async (id: string) => ({ name: id, photoUrl: '' }));
  let snapshot: (games: unknown[]) => void = () => {};
  let now = 1_000_000;
  const clock = { serverNow: () => now, getServerOffsetMs: () => 300_000, syncServerClock: jest.fn(async () => 0) };
  const imports: Record<string, unknown> = {
    react: { useEffect: (effect: typeof effects[number]) => effects.push(effect), useState: () => [0, jest.fn()] },
    'react-native': { NativeModules: { WatchBridge: bridge }, Platform: { OS: 'android' } },
    '@/firebase/config': { USE_MOCK_DATA: false },
    '@/services/gameService': { gameService: { subscribeMyLiveOrUpcomingGames: (_id: string, cb: typeof snapshot) => { snapshot = cb; return jest.fn(); } } },
    '@/services/serverClock': clock,
    '@/services/userService': { userService: { getUserById: getUser } },
    '@/store/userStore': { useUserStore: () => 'שם' },
    '../utils/errorObservation': { observeCaughtError: observe },
    '../utils/expectedIntegrationError': { isWearableApiUnavailable: () => false },
    '../native/nativeDiagnostics': { drainNativeDiagnostics: jest.fn() },
  };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(fs.readFileSync('src/services/watchSyncService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => {
    if (!(id in imports)) throw new Error(id);
    return imports[id];
  }, Date, __DEV__: false, setInterval: (cb: () => void) => { intervals.push(cb); return 1; }, clearInterval: jest.fn() });
  return { exports, bridge, clock, observe, getUser, effects, intervals,
    snapshot: (games: unknown[]) => snapshot(games), setNow: (value: number) => { now = value; } };
}
const viewer = { id: 'owner', name: 'שם' };
const live = (extra = {}) => ({ id: 'g', title: 'מחזור', status: 'active', createdBy: 'owner',
  startsAt: 900_000, players: ['owner'], guests: [], liveMatch: { phase: 'playing', timerRunning: true,
    timerAccumulatedMs: 10_000, timerLastStartedAt: 980_000 }, ...extra });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test.each(['finished', 'cancelled'])('terminal %s game never becomes live from a leftover liveMatch', async status => {
  const f = fixture();
  expect((await f.exports.computeWatchPayload([live({ status })], viewer)).kind).toBe('notRegistered');
});
test('server time determines upcoming eligibility despite a skewed phone clock', async () => {
  const f = fixture();
  const payload = await f.exports.computeWatchPayload([live({ liveMatch: null, startsAt: 1_100_000 })], viewer);
  expect(payload.kind).toBe('upcoming');
});
test('live base, controller and active guests preserve their distinct meanings', async () => {
  const f = fixture(); f.getUser.mockRejectedValueOnce(new Error('unavailable'));
  const payload = await f.exports.computeWatchPayload([live({ guests: [{ name: 'אורח' }, { name: 'ממתין', waitlisted: true }] })], viewer);
  expect(payload.timer.baseElapsedMs).toBe(30_000);
  expect(payload.playersCount).toBe(2);
  expect(payload.players[0].name).toBe('שחקן');
  expect(payload.canControl).toBe(true);
});

test('a delayed kickoff stays visible through six hours without implying a played evening', async () => {
  const f = fixture(); f.setNow(30_000_000);
  const game = live({ liveMatch: null, status: 'open', startsAt: 30_000_000 - 6 * 3600_000 });
  expect((await f.exports.computeWatchPayload([game], viewer)).kind).toBe('upcoming');
  f.setNow(30_000_001);
  expect((await f.exports.computeWatchPayload([game], viewer)).kind).toBe('notRegistered');
});

test.each(['waitlist', 'pending'])('the phone payload preserves %s as distinct from registration', async membership => {
  const f = fixture();
  const game = live({ createdBy: 'another', players: ['another'], [membership]: ['owner'] });
  const payload = await f.exports.computeWatchPayload([game], viewer);
  expect(payload.registration).toBe(membership);
  expect(payload.canControl).toBe(false);
});

test('the payload binds stable roster ids and the exact rotation instance', async () => {
  const f = fixture();
  const payload = await f.exports.computeWatchPayload([live({ rotation: { roundInstanceId: 'stable-round' }, guests: [{ id: 'guest-a', name: 'אורח' }] })], viewer);
  expect(payload.timerRoundId).toBe('rotation:stable-round');
  expect(payload.players.map((row: {id: string}) => row.id)).toEqual(['owner', 'guest-a']);
});
test('a slow old publish cannot overwrite a newer initiated snapshot', async () => {
  const f = fixture(); let finish!: (value: any) => void;
  f.getUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = f.exports.publishWatchState([live()], viewer); await flush();
  await f.exports.publishWatchState([], { id: '', name: '' });
  finish({ name: 'old' }); await old;
  expect(f.bridge.publishState).toHaveBeenCalledTimes(1);
  expect(JSON.parse(f.bridge.publishState.mock.calls[0][0]).kind).toBe('notRegistered');
});
test('unmount cancels an in-flight roster read and clears all cached viewer identity', async () => {
  const f = fixture(); let finish!: (value: any) => void;
  f.getUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.exports.useWatchSync('owner'); const cleanup = f.effects[0]() as () => void;
  f.snapshot([live()]); await flush(); cleanup(); await flush();
  finish({ name: 'old' }); await flush();
  const payloads = f.bridge.publishState.mock.calls.map(([json]) => JSON.parse(json));
  expect(payloads).toHaveLength(1);
  expect(payloads[0].viewer).toEqual({ id: '', name: '' });
});
test('cold logged-out mount clears persisted state', async () => {
  const f = fixture(); f.exports.useWatchSync(null); f.effects[0](); await flush();
  expect(JSON.parse(f.bridge.publishState.mock.calls[0][0]).viewer.id).toBe('');
});
test('periodic refresh waits for real snapshot and re-evaluates registration opening', async () => {
  const f = fixture(); f.exports.useWatchSync('owner'); f.effects[0]();
  f.intervals[0](); await flush(); expect(f.bridge.publishState).not.toHaveBeenCalled();
  f.snapshot([live({ liveMatch: null, status: 'scheduled', startsAt: 1_200_000, registrationOpensAt: 1_050_000 })]); await flush();
  expect(JSON.parse(f.bridge.publishState.mock.calls[0][0]).kind).toBe('scheduled');
  f.setNow(1_060_000); f.intervals[0](); await flush();
  expect(JSON.parse(f.bridge.publishState.mock.calls[1][0]).kind).toBe('upcoming');
});
test('clock synchronization rejection is contained and reported', async () => {
  const f = fixture(); f.clock.syncServerClock.mockRejectedValueOnce(new Error('clock'));
  await expect(f.exports.publishWatchState([], viewer)).resolves.toBeUndefined();
  expect(f.observe).toHaveBeenCalled(); expect(f.bridge.publishState).not.toHaveBeenCalled();
});

test('the watch create action resolves through the real phone destination parser', () => {
  const source = fs.readFileSync('plugins/wear-src/wear/src/main/java/com/studiogameslime/soccerapp/wear/MainActivity.kt', 'utf8');
  const url = source.match(/setData\(Uri.parse\("([^"]+)"\)\)/)?.[1];
  expect(url).toBeDefined();
  expect(parseAppLink(url!)).toEqual({ dest: 'create-game' });
});

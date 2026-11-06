// Controlled delays on real production hooks; never a device latency claim.
const fs = require('fs'), path = require('path'), ts = require('typescript'), vm = require('vm');
const assert = require('assert'), crypto = require('crypto'), FakeTimers = require('@sinonjs/fake-timers');
const out = path.resolve('artifacts/performance-2026-11-04');
async function roster(phase) {
  const file = path.join(phase === 'before' ? path.join(out, 'before-src') : process.cwd(), 'src/hooks/useCommunityRoster.ts');
  const code = fs.readFileSync(file, 'utf8'), clock = FakeTimers.createClock(0), module = { exports: {} };
  let firstContentMs = null, completeMs = null;
  const slots = []; let cursor = 0;
  const hooks = {
    useRef: value => slots[cursor++] ??= { current: value },
    useCallback: fn => fn,
    useState(initial) {
      const index = cursor++, slot = slots[index] ??= { value: initial };
      return [slot.value, value => {
        slot.value = typeof value === 'function' ? value(slot.value) : value;
        if (slot.value?.data?.members?.length && firstContentMs === null) firstContentMs = clock.now;
        if (slot.value?.loading === false) completeMs = clock.now;
      }];
    },
  };
  const delay = (ms, value) => new Promise(resolve => clock.setTimeout(() => resolve(value), ms));
  const group = { id: 'club', adminIds: ['manager'], playerIds: ['player'], cardsEnabled: true };
  const deps = {
    react: hooks, '@react-navigation/native': { useFocusEffect: fn => fn() },
    '@/services': { groupService: { get: () => delay(100, group), hydrateUsers: () => delay(200, [{ id: 'player', name: 'שחקן' }]) },
      communityEventsService: { getActiveCardCounts: () => delay(1200, { player: { yellow: 1 } }) } },
    '@/services/gameService': { gameService: { getCommunityPlayerStats: () => delay(900, { player: { gamesPlayed: 3 } }) } },
    '@/services/errorLog': { logError() {} }, '@/utils/errorObservation': { observeCaughtError() {} },
  };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, require: name => { assert(deps[name], name); return deps[name]; },
  });
  module.exports.useCommunityRoster('club', { id: 'manager', isGuest: false });
  await clock.tickAsync(1500);
  assert(firstContentMs !== null && completeMs !== null);
  return { phase, firstContentMs, completeMs, sourceSha256: crypto.createHash('sha256').update(code.replace(/\r\n/g, '\n')).digest('hex') };
}
async function hiddenTimer(phase) {
  const file = path.join(phase === 'before' ? path.join(out, 'before-src') : process.cwd(), 'src/services/useSyncedTimer.ts');
  const clock = FakeTimers.createClock(10000), module = { exports: {} }; let updates = 0, syncs = 0;
  const deps = { react: { useRef: value => ({ current: value }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => { ++updates; }], useEffect: effect => effect() },
    '@/services/serverClock': { serverNow: () => clock.now, syncServerClock: () => { ++syncs; } } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, setInterval: clock.setInterval.bind(clock), clearInterval: clock.clearInterval.bind(clock), require: name => deps[name],
  });
  module.exports.useSyncedTimer({ timerRunning: true, timerLastStartedAt: 9000 }, false);
  const initialUpdates = updates; await clock.tickAsync(60000);
  return { phase, hiddenMs: 60000, displayUpdates: updates - initialUpdates, syncCalls: syncs };
}
(async () => {
  const results = { method: 'production hooks with controlled delay and fake clock; no network/device latency measurement',
    input: { groupMs: 100, memberMs: 200, statsMs: 900, cardsMs: 1200 },
    roster: [await roster('before'), await roster('after')], hiddenTimer: [await hiddenTimer('before'), await hiddenTimer('after')] };
  assert.equal(results.roster[0].firstContentMs, 1300); assert.equal(results.roster[1].firstContentMs, 300);
  assert.equal(results.roster[0].completeMs, results.roster[1].completeMs);
  assert.equal(results.hiddenTimer[0].displayUpdates, 240); assert.equal(results.hiddenTimer[1].displayUpdates, 0);
  fs.writeFileSync(path.join(out, 'controlled-loading-metrics.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });

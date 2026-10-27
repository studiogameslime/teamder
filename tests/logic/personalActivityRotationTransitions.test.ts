import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { resolveRoundInstance, roundCommitKey } from '../../src/services/rotationEngine';
import { rotationWriteSource } from '../../src/services/rotationWriteSource';

const ast = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const methods: string[] = [];
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && ['stopRotation', '_persistRotation'].includes(node.name.getText(ast))) methods.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const compiled = ts.transpileModule(`module.exports={${methods.join(',')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const initial = () => ({ id: 'g', status: 'active', players: ['a', 'b'], guests: [],
  rotation: { round: 3, roundInstanceId: 'round3', roundInstanceRound: 3, playing: [0, 1], waiting: [2], loans: [],
    baseTeams: [{ index: 0, playerIds: ['original'] }, { index: 1, playerIds: ['b'] }] },
  draftTeams: { teams: [{ index: 0, captainId: 'filler', playerIds: ['filler'] }, { index: 1, captainId: 'b', playerIds: ['b'] }],
    leftHome: [{ playerId: 'original', homeTeam: 0 }] },
  liveMatch: { phase: 'roundRunning', startedAt: 10, roundNumber: 7, timerRunning: true, timerLastStartedAt: 100,
    timerAccumulatedMs: 1000, timerEvents: [{ type: 'start', at: 100 }], activeIntervals: [{ s: 10, e: 50 }],
    scoreA: 0, scoreB: 0, goals: [], inPlayPenalties: [], assignments: { filler: 'teamA', b: 'teamB' },
    benchOrder: ['original'], shootout: { firstTeam: 'A', kicks: [] } },
});
function harness(mock = false) {
  const state: any = initial();
  const writes: any[] = [];
  let now = 500;
  let retry: (() => void) | undefined;
  const apply = (patch: any) => {
    writes.push(structuredClone(patch));
    for (const [key, value] of Object.entries(patch)) {
      const path = key.split('.'); let target = state;
      for (const part of path.slice(0, -1)) target = target[part] ??= {};
      target[path.at(-1)!] = structuredClone(value);
    }
  };
  const context = { module: { exports: {} as any }, USE_MOCK_DATA: mock, mockGamesV2: [state],
    Date: class extends Date { static now() { return now; } }, serverNow: () => now,
    changedTimerRound: () => new Error('TIMER_CHANGED'), stripUndefined: (v: unknown) => JSON.parse(JSON.stringify(v)),
    resolveRoundInstance, rotationWriteSource, docs: { game: () => ({}) }, getFirebase: () => ({ db: {} }),
    runTransaction: async (_db: unknown, callback: any) => {
      const attempt = async (commit: boolean) => callback({ get: async () => ({ exists: () => true, data: () => structuredClone(state) }),
        update: (_ref: unknown, patch: any) => { if (commit) apply(patch); } });
      if (retry) { await attempt(false); retry(); retry = undefined; }
      return attempt(true);
    },
  };
  vm.runInNewContext(compiled, context);
  const service = context.module.exports;
  const save = (reset = true, sameRound = false) => service._persistRotation('g', structuredClone(state.draftTeams), {
    rotation: { ...structuredClone(state.rotation), round: sameRound ? 3 : 4 }, teams: structuredClone(state.draftTeams.teams),
  }, reset ? { userId: 'owner', userName: 'מנהל' } : undefined, rotationWriteSource(state));
  return { state, writes, service, save, retry: (fn: () => void) => { retry = fn; }, setNow: (n: number) => { now = n; } };
}

test.each([false, true])('stopping rotation closes activity and restores current base atomically (mock=%s)', async mock => {
  const x = harness(mock); await x.service.stopRotation('g');
  expect(x.state.rotation).toBeFalsy();
  expect(x.state.liveMatch).toMatchObject({ timerRunning: false, timerLastStartedAt: null, timerAccumulatedMs: 0,
    startedAt: 10, roundNumber: 8, phase: 'roundReady', assignments: {}, goals: [], scoreA: 0, scoreB: 0,
    activeIntervals: [{ s: 10, e: 50 }, { s: 100, e: 500 }] });
  expect(x.state.liveMatch.shootout).toBeUndefined();
  expect(x.state.draftTeams.teams[0]).toMatchObject({ playerIds: ['original'], captainId: 'original' });
  expect(x.state.draftTeams.leftHome).toEqual([]);
  await x.service.stopRotation('g');
  expect(x.state.liveMatch.activeIntervals).toHaveLength(2);
  expect(x.state.liveMatch.roundNumber).toBe(8);
});

test('retry closes only the latest running interval and restores the latest committed base', async () => {
  const x = harness();
  x.retry(() => { x.state.liveMatch.timerLastStartedAt = 350; x.state.rotation.baseTeams[0].playerIds = ['new-base']; x.setNow(700); });
  await x.service.stopRotation('g');
  expect(x.writes).toHaveLength(1);
  expect(x.state.liveMatch.activeIntervals).toEqual([{ s: 10, e: 50 }, { s: 350, e: 700 }]);
  expect(x.state.draftTeams.teams[0].playerIds).toEqual(['new-base']);
});

test.each([false, true])('next rotation closes the prior interval before zeroing the timer (mock=%s)', async mock => {
  const x = harness(mock); await x.save();
  expect(x.state.liveMatch.activeIntervals).toEqual([{ s: 10, e: 50 }, { s: 100, e: 500 }]);
  expect(x.state.liveMatch.timerRunning).toBe(false);
  expect(x.state.liveMatch.startedAt).toBe(10);
  expect(roundCommitKey(x.state.rotation)).not.toBe('round3');
});

test('mid-game fill preserves round identity, running timer and earlier intervals', async () => {
  const x = harness(); const before = structuredClone(x.state.liveMatch);
  await x.save(false, true);
  expect(x.state.liveMatch).toEqual(before);
  expect(roundCommitKey(x.state.rotation)).toBe('round3');
});

test('clock change during retry refuses the old rotation proposal without writing', async () => {
  const x = harness(); x.retry(() => { x.state.liveMatch.timerLastStartedAt = 450; });
  await expect(x.save()).rejects.toThrow();
  expect(x.writes).toHaveLength(0);
  expect(x.state.liveMatch.timerRunning).toBe(true);
});

test.each([false, true])('future start timestamp never adds a negative activity segment (mock=%s)', async mock => {
  const x = harness(mock); x.state.liveMatch.timerLastStartedAt = 900;
  await x.save();
  expect(x.state.liveMatch.activeIntervals).toEqual([{ s: 10, e: 50 }]);
});

test('terminal round cannot be stopped and reset through rotation', async () => {
  const x = harness(); x.state.status = 'finished';
  await expect(x.service.stopRotation('g')).rejects.toThrow('TIMER_CHANGED');
  expect(x.writes).toHaveLength(0);
});

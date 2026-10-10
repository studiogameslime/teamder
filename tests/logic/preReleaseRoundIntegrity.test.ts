import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { matchesLiveRound } from '../../functions/src/liveRoundCommit';
import { decideSpotOffer } from '../../functions/src/spotOfferDecision';
import { rotationWriteSource } from '../../src/services/rotationWriteSource';

// Execute the actual service methods; isolated I/O, no account or production writes.
const file = path.resolve(__dirname, '../../src/services/gameService.ts');
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
let service: ts.ObjectLiteralExpression;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'gameService') service = node.initializer as ts.ObjectLiteralExpression;
  ts.forEachChild(node, visit);
}
visit(source);
const names = ['endEvening', '_commitRoundStatsAndClear', 'recordGoal', 'removeGoal', 'prepareRoundResult', '_persistRotation', 'commitFilledRotation'];
const methods = names.map(name => service.properties.find(property => property.name?.getText(source) === name)!.getText(source));
const compiled = ts.transpileModule('module.exports = {' + methods.join(',') + '}', {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const initial = () => ({ status: 'active', groupId: 'club', players: ['a', 'b'],
  liveMatch: { phase: 'roundRunning', timerRunning: true, timerLastStartedAt: 100, timerAccumulatedMs: 0,
    goals: [{ id: 'g1', team: 'A', scorerId: 'a', minute: 1 }], scoreA: 1, scoreB: 0, goalTally: { a: 1 } },
  rotation: { roundInstanceId: 'r1', playing: [0, 1], updatedAt: 1 },
  draftTeams: { teams: [{ index: 0, playerIds: ['a'] }, { index: 1, playerIds: ['b'] }] },
});
function world(state = initial(), callable?: (payload: any, world: any) => Promise<any>, protocol = 2) {
  let data: any = clone(state);
  const commits: any[] = [];
  let applied = 0;
  const patch = (updates: any) => {
    for (const [key, value] of Object.entries(updates) as [string, any][]) {
      const keys = key.split('.');
      let target = data;
      for (const segment of keys.slice(0, -1)) target = target[segment] ??= {};
      const field = keys[keys.length - 1];
      if (value?.kind === 'union') target[field] = [...(target[field] ?? []), ...value.items];
      else if (value?.kind === 'remove') target[field] = (target[field] ?? []).filter((row: any) => JSON.stringify(row) !== JSON.stringify(value.item));
      else if (value?.kind === 'inc') target[field] = (target[field] ?? 0) + value.by;
      else target[field] = clone(value);
    }
  };
  const snapshot = () => ({ exists: () => true, data: () => clone(data) });
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: false, __DEV__: false,
    getFirebase: () => ({ db: {}, functions: {} }), doc: () => ({}), docs: { game: () => ({}) },
    getDoc: async () => snapshot(),
    runTransaction: async (_: any, fn: any) => {
      const writes: any[] = [];
      const result = await fn({ get: async () => snapshot(), update: (_: any, updates: any) => writes.push(updates) });
      writes.forEach(patch);
      return result;
    },
    arrayUnion: (...items: any[]) => ({ kind: 'union', items }), arrayRemove: (item: any) => ({ kind: 'remove', item }),
    increment: (by: number) => ({ kind: 'inc', by }), serverNow: () => 10000,
    roundCommitKey: (rotation: any) => rotation.roundInstanceId,
    rotationWriteSource,
    resolveRoundInstance: (rotation: any) => ({ roundInstanceId: `r${rotation.round}_mint`, roundInstanceRound: rotation.round }),
    effectiveRosterOf: (index: number, teams: any[]) => teams.find(team => team.index === index)?.playerIds ?? [],
    buildShootoutPenaltyPayload: (shootout: any) => shootout?.kicks ?? [],
    playersPerTeamFor: () => 5, effFillMode: () => 'off',
    recordWinnerSkeleton: (index: number) => ({ pickedWinnerIndex: index }),
    recordTieSkeleton: (_teams: any, _rotation: any, _perTeam: any, _fillMode: any, mode: any) => ({ pickedTieMode: mode }),
    logError: () => {}, logEvent: () => {}, AnalyticsEvent: {},
    require: () => ({ httpsCallable: () => async (payload: any) => {
      commits.push(clone(payload));
      const authoritative = callable ? await callable(payload, api) : undefined;
      if (data.lastCommittedRoundId !== payload.roundId) {
        if (!matchesLiveRound(data, payload.roundId, payload.liveGoalIds, { rotationUpdatedAt: payload.rotationUpdatedAt, penalties: payload.penalties })) {
          throw new Error('conflicting live board');
        }
        applied++;
        data.lastCommittedRoundId = payload.roundId;
        data.liveMatch.goals = []; data.liveMatch.scoreA = 0; data.liveMatch.scoreB = 0;
      }
      return { data: { ok: true, protocol, winnerSide: payload.winnerSide, tieResolution: payload.tieResolution ?? null, ...authoritative } };
    } }),
  };
  vm.runInNewContext(compiled, context);
  context.module.exports.getGameById = async () => clone(data);
  const api = { service: context.module.exports, read: () => clone(data), patch, commits, applied: () => applied };
  return api;
}

describe('final round integrity using the real service methods', () => {
  it('does not overwrite an already advanced round or its new goal with a second fill', async () => {
    const w = world(); w.patch({ 'liveMatch.goals': [], 'liveMatch.scoreA': 0 });
    const before = w.read(); const source = rotationWriteSource(before);
    const result = { rotation: { ...before.rotation, round: 2, updatedAt: 2 }, teams: before.draftTeams.teams };
    await w.service.commitFilledRotation('g', before.draftTeams, result, undefined, { userId: 'admin', userName: '' }, source);
    await w.service.recordGoal('g', { team: 'B', scorerId: 'b', minute: 1 });
    const advanced = w.read();
    await expect(w.service.commitFilledRotation('g', before.draftTeams, result, undefined, { userId: 'other', userName: '' }, source)).rejects.toThrow('השתנו');
    expect(w.read()).toEqual(advanced); expect(w.read().liveMatch.scoreB).toBe(1);
  });
  it('preserves a lineup edit made while the fill dialog was open', async () => {
    const w = world(); const before = w.read(); const source = rotationWriteSource(before);
    w.patch({ 'draftTeams.leftHome': [{ playerId: 'a', homeTeam: 0 }] });
    const changed = w.read();
    await expect(w.service.commitFilledRotation('g', before.draftTeams,
      { rotation: { ...before.rotation, round: 2 }, teams: before.draftTeams.teams }, undefined, undefined, source)).rejects.toThrow('השתנו');
    expect(w.read()).toEqual(changed);
  });
  it('preserves a clock started by another admin while choosing fillers', async () => {
    const w = world(); const before = w.read(); const source = rotationWriteSource(before);
    w.patch({ 'liveMatch.timerLastStartedAt': 900 });
    await expect(w.service.commitFilledRotation('g', before.draftTeams,
      { rotation: { ...before.rotation, round: 2 }, teams: before.draftTeams.teams }, undefined,
      { userId: 'admin', userName: '' }, source)).rejects.toThrow('השתנו');
    expect(w.read().liveMatch.timerLastStartedAt).toBe(900);
  });
  it('preserves a late goal from an older client before resetting the clock', async () => {
    const w = world(); w.patch({ 'liveMatch.goals': [], 'liveMatch.scoreA': 0 });
    const before = w.read(); const source = rotationWriteSource(before);
    w.patch({ 'liveMatch.goals': [{ id: 'late', team: 'B' }], 'liveMatch.scoreB': 1 });
    await expect(w.service.commitFilledRotation('g', before.draftTeams,
      { rotation: { ...before.rotation, round: 2 }, teams: before.draftTeams.teams }, undefined,
      { userId: 'admin', userName: '' }, source)).rejects.toThrow('נוספה תוצאה');
    expect(w.read().liveMatch.scoreB).toBe(1); expect(w.read().liveMatch.goals[0].id).toBe('late');
  });
  it('rejects an unguarded fill rather than guessing its source', async () => {
    const w = world(); const before = w.read();
    await expect(w.service.commitFilledRotation('g', before.draftTeams,
      { rotation: { ...before.rotation, round: 2 }, teams: before.draftTeams.teams })).rejects.toThrow('המקור חסר');
    expect(w.read()).toEqual(before);
  });
  it('a failed result keeps the evening active and a retry credits it once', async () => {
    let fail = true;
    const w = world(initial(), async () => { if (fail) throw new Error('unavailable'); });
    await expect(w.service.endEvening('g')).rejects.toThrow('unavailable');
    expect(w.read().status).toBe('active'); expect(w.read().liveMatch.goals).toHaveLength(1);
    fail = false;
    await w.service.endEvening('g'); await w.service.endEvening('g');
    expect(w.read().status).toBe('finished'); expect(w.applied()).toBe(1);
  });
  it('commits a running 0:0 as a tie', async () => {
    const state = initial(); state.liveMatch.goals = []; state.liveMatch.scoreA = 0;
    const w = world(state); await w.service.endEvening('g');
    expect(w.commits).toHaveLength(1); expect(w.commits[0].winnerSide).toBe('tie');
  });
  it('commits a paused 0:0 with accumulated playing time', async () => {
    const state = initial(); state.liveMatch.goals = []; state.liveMatch.scoreA = 0;
    state.liveMatch.timerRunning = false; state.liveMatch.timerAccumulatedMs = 500;
    const w = world(state); await w.service.endEvening('g'); expect(w.applied()).toBe(1);
  });
  it('does not manufacture a mini-game from a prepared empty rotation', async () => {
    const state = initial(); state.liveMatch.goals = []; state.liveMatch.scoreA = 0; state.liveMatch.timerRunning = false;
    const w = world(state); await w.service.endEvening('g'); expect(w.commits).toHaveLength(0);
  });
  it('does not replay an already committed round after a lost response', async () => {
    let first = true;
    const w = world(initial(), async (payload, current) => {
      if (first) {
        first = false; current.patch({ lastCommittedRoundId: payload.roundId, 'liveMatch.goals': [], 'liveMatch.scoreA': 0 });
        throw new Error('response lost');
      }
    });
    await expect(w.service.endEvening('g')).rejects.toThrow('response lost');
    await w.service.endEvening('g'); expect(w.commits).toHaveLength(1); expect(w.read().status).toBe('finished');
  });
  it('a concurrent goal before commit rejects the old result and preserves both goals', async () => {
    const state = initial();
    const w = world(state, async (_, current) => current.service.recordGoal('g', { team: 'B', scorerId: 'b', minute: 2 }));
    await expect(w.service._commitRoundStatsAndClear('g', state.liveMatch, state.rotation, state.draftTeams, 'A')).rejects.toThrow('conflicting live board');
    expect(w.read().liveMatch.goals).toHaveLength(2); expect(w.applied()).toBe(0);
  });
  it('rejects a goal or undo after the current round was committed', async () => {
    const w = world(); w.patch({ lastCommittedRoundId: 'r1' });
    await expect(w.service.recordGoal('g', { team: 'A', scorerId: 'a', minute: 2 })).rejects.toThrow();
    await expect(w.service.removeGoal('g', 'g1')).rejects.toThrow();
    expect(w.read().liveMatch.scoreA).toBe(1);
  });
  it('two sequential undos of the same goal decrement only once', async () => {
    const w = world(); await w.service.removeGoal('g', 'g1'); await w.service.removeGoal('g', 'g1');
    expect(w.read().liveMatch.scoreA).toBe(0); expect(w.read().liveMatch.goalTally.a).toBe(0);
  });
  it('new round accepts a goal despite the prior committed marker', async () => {
    const w = world(); w.patch({ lastCommittedRoundId: 'r0' });
    await w.service.recordGoal('g', { team: 'B', scorerId: 'b', minute: 2 }); expect(w.read().liveMatch.goals).toHaveLength(2);
  });
  it('refuses success from an old server that cannot clear atomically', async () => {
    const w = world(initial(), undefined, 1);
    await expect(w.service.endEvening('g')).rejects.toThrow('עדכון שרת'); expect(w.read().status).toBe('active');
  });
  it('a delayed result response never clears a goal from the next round', async () => {
    const state = initial();
    const w = world(state, async (payload, current) => {
      current.patch({ lastCommittedRoundId: payload.roundId,
        rotation: { ...state.rotation, roundInstanceId: 'r2' },
        'liveMatch.goals': [{ id: 'next', team: 'B', scorerId: 'b', minute: 1 }],
        'liveMatch.scoreA': 0, 'liveMatch.scoreB': 1 });
    });
    await w.service._commitRoundStatsAndClear('g', state.liveMatch, state.rotation, state.draftTeams, 'A');
    expect(w.read().liveMatch.goals[0].id).toBe('next'); expect(w.read().liveMatch.scoreB).toBe(1);
  });
  it('end evening rejects an intervening rotation and preserves the next result', async () => {
    const state = initial();
    const w = world(state, async (payload, current) => {
      current.patch({ lastCommittedRoundId: payload.roundId,
        rotation: { ...state.rotation, roundInstanceId: 'r2' }, 'liveMatch.goals': [] });
    });
    await expect(w.service.endEvening('g')).rejects.toThrow('המשחק השתנה'); expect(w.read().status).toBe('active');
  });
  it('rotates according to the committed winner when another admin won the race', async () => {
    const w = world(initial(), async () => ({ winnerSide: 'B' }));
    const result = await w.service.prepareRoundResult('g', 'admin', 'A');
    expect(result.outcome).toBe('B'); expect(result.skeleton.pickedWinnerIndex).toBe(1);
  });
  it('uses the stored tie policy when admins chose competing tie decisions', async () => {
    const state = initial(); state.liveMatch.goals = []; state.liveMatch.scoreA = 0;
    const w = world(state, async () => ({ winnerSide: 'tie', tieResolution: 'veteranOut' }));
    const result = await w.service.prepareRoundResult('g', 'admin', undefined, 'bothOut');
    expect(result.outcome).toBe('tie'); expect(result.skeleton.pickedTieMode).toBe('veteranOut');
  });
});

describe('server live-board snapshot guards', () => {
  it('rejects stale rotation, added/removed goals, and changed penalties', () => {
    const game = initial();
    expect(matchesLiveRound(game, 'r1', ['g1'], { rotationUpdatedAt: 1, penalties: [] })).toBe(true);
    expect(matchesLiveRound(game, 'r2', ['g1'])).toBe(false);
    expect(matchesLiveRound(game, 'r1', [])).toBe(false);
    expect(matchesLiveRound(game, 'r1', ['g1', 'g2'])).toBe(false);
    expect(matchesLiveRound(game, 'r1', ['g1'], { rotationUpdatedAt: 2, penalties: [] })).toBe(false);
    expect(matchesLiveRound(game, 'r1', ['g1'], { rotationUpdatedAt: 1, penalties: [{ kickerId: 'a', scored: true }] })).toBe(false);
  });
});

describe('offer decisions are restricted to the existing offer owner', () => {
  const game = () => ({ status: 'open', players: ['c'], waitlist: ['a', 'b'], pending: ['d'], guests: [], maxPlayers: 4, pendingPromotion: { uid: 'a' } });
  it('confirm fills one slot and chains the next offer while preserving the participant union', () => {
    const result = decideSpotOffer(game(), 'a', 'confirm', 10);
    expect(result).toMatchObject({ changed: true, patch: { players: ['c', 'a'], waitlist: ['b'], pendingPromotion: { uid: 'b' }, participantIds: ['c', 'a', 'b', 'd'] } });
  });
  it('pass removes only the caller and chains the next offer', () => {
    expect(decideSpotOffer(game(), 'a', 'pass', 10)).toMatchObject({ patch: { players: ['c'], waitlist: ['b'], pendingPromotion: { uid: 'b' } } });
  });
  it('locked registration still lets an existing offered waitlisted player confirm', () => {
    expect(decideSpotOffer({ ...game(), status: 'locked' }, 'a', 'confirm', 10)).toMatchObject({ changed: true });
  });
  it('does not add a new player or resolve another player offer', () => {
    expect(() => decideSpotOffer(game(), 'stranger', 'confirm', 10)).toThrow('STALE_OFFER');
    expect(decideSpotOffer(game(), 'b', 'pass', 10)).toEqual({ changed: false });
  });
  it('enforces real capacity including active guests and excludes queued guests', () => {
    expect(() => decideSpotOffer({ ...game(), maxPlayers: 2, guests: [{ waitlisted: false }] }, 'a', 'confirm', 10)).toThrow('GROUP_FULL');
    expect(decideSpotOffer({ ...game(), maxPlayers: 2, guests: [{ waitlisted: true }] }, 'a', 'confirm', 10)).toMatchObject({ changed: true, patch: { pendingPromotion: null } });
  });
  it('is idempotent after confirm and rejects stale/finished offers', () => {
    expect(decideSpotOffer({ ...game(), players: ['a'] }, 'a', 'confirm', 10)).toEqual({ changed: false });
    expect(() => decideSpotOffer({ ...game(), waitlist: [] }, 'a', 'confirm', 10)).toThrow('STALE_OFFER');
    expect(() => decideSpotOffer({ ...game(), status: 'finished' }, 'a', 'confirm', 10)).toThrow('GAME_NOT_OPEN');
  });
});

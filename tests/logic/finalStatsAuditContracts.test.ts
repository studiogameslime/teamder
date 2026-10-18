import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { buildRoundSides } from '../../functions/src/roundSides';
import { roundParticipantSides } from '../../functions/src/roundParticipants';
import { StatBatch, MAX_ROUND_BATCH_OPS } from '../../functions/src/statBatch';
import { liveRoundKey, liveLineupFingerprint, matchesLiveRound } from '../../functions/src/liveRoundCommit';
import { liveSeasonStamp } from '../../functions/src/liveSeasonStamp';
import { assertSeasonOpenForGame } from '../../functions/src/seasonLock';
import { commitRoundInOrder } from '../../functions/src/commitProtocol';
import { reduceRounds, RoundHistoryDoc } from '../../src/utils/eveningStats';
import { aggregatePenalties, buildShootoutPenaltyPayload, pctOf } from '../../src/utils/penaltyStats';

// Run the complete current callable, including participant restoration, folded
// writes, history, marker and protocol-2 live clear. Only SDK I/O is replaced.
const source = fs.readFileSync('functions/src/index.ts', 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
let callable = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'commitRoundStats') callable = node.initializer!.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
const compiled = ts.transpileModule(`(${callable})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function world(size = 4, guests = false) {
  const side = (name: string) => Array.from({ length: size }, (_, i) => `${guests ? 'guest:' : ''}${name}${i}`);
  const sideA = side('a'), sideB = side('b');
  const state: any = { createdBy: 'manager', groupId: 'club', status: 'active',
    players: guests ? [] : [...sideA, ...sideB], guests: guests ? [...sideA, ...sideB].map(id => ({ id: id.slice(6) })) : [],
    rotation: { roundInstanceId: 'r', updatedAt: 1 }, liveMatch: { scoreA: 0, scoreB: 0, goals: [] } };
  const documents = new Map<string, any>([['games/audit', state], ['groups/club', { adminIds: ['manager'] }]]);
  const increment = (n: number) => ({ __increment: n });
  const remove = { __delete: true };
  function merge(target: any, patch: any) {
    for (const [key, value] of Object.entries(patch) as [string, any][]) {
      const path = key.split('.'); let parent = target;
      for (const piece of path.slice(0, -1)) parent = parent[piece] ??= {};
      const leaf = path[path.length - 1];
      if (value?.__increment !== undefined) parent[leaf] = (parent[leaf] ?? 0) + value.__increment;
      else if (value?.__delete) delete parent[leaf];
      else if (value && typeof value === 'object' && !Array.isArray(value)) merge(parent[leaf] ??= {}, value);
      else parent[leaf] = value;
    }
  }
  const ref = (path: string): any => ({ path, collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ exists: documents.has(path), ref: ref(path), updateTime: 1, createTime: { toMillis: () => 2000 },
      data: () => documents.get(path), get: (key: string) => documents.get(path)?.[key] }),
    set: async (patch: any) => merge(documents.get(path) ?? {}, patch),
    update: async (patch: any) => merge(documents.get(path), patch),
    create: async (patch: any) => { if (documents.has(path)) throw Object.assign(Error('exists'), { code: 6 }); documents.set(path, patch); },
  });
  const collection = (path: string): any => ({ doc: (id: string) => ref(`${path}/${id}`) });
  let commits = 0;
  const db = { collection, batch: () => {
    const writes: { kind: string; ref: any; data: any }[] = [];
    const batch = { create: (reference: any, data: any) => { writes.push({ kind: 'create', ref: reference, data }); return batch; },
      set: (reference: any, data: any) => { writes.push({ kind: 'set', ref: reference, data }); return batch; },
      update: (reference: any, data: any) => { writes.push({ kind: 'update', ref: reference, data }); return batch; },
      commit: async () => {
        for (const write of writes) if (write.kind === 'create' && documents.has(write.ref.path)) throw Object.assign(Error('exists'), { code: 6 });
        for (const write of writes) { const value = documents.get(write.ref.path) ?? {}; merge(value, write.data); documents.set(write.ref.path, value); }
        commits += 1;
      } };
    return batch;
  } };
  class HttpsError extends Error { constructor(public code: string, message: string) { super(message); } }
  const handler = vm.runInNewContext(compiled, { onCall: (_: unknown, handler: any) => handler, ENFORCE_APP_CHECK: false,
    db, HttpsError, admin: { firestore: { FieldValue: { increment, delete: () => remove } } },
    liveRoundKey, matchesLiveRound, buildRoundSides, roundParticipantSides, StatBatch, MAX_ROUND_BATCH_OPS, commitRoundInOrder,
    liveSeasonStamp, assertSeasonOpenForGame, isReal: (id: string) => !id.startsWith('guest:'),
    console: { log() {}, error() {} }, Date });
  const payload: any = { gameId: 'audit', roundId: 'r', sideA, sideB, teamAIndex: 0, teamBIndex: 1,
    winnerSide: 'A', goals: [], penalties: [], liveGoalIds: [], rotationUpdatedAt: 1 };
  function goals(events: any[]) {
    payload.goals = events; payload.liveGoalIds = events.map((_, i) => `goal-${i}`);
    state.liveMatch.goals = events.map((event, i) => ({ id: payload.liveGoalIds[i], ...event }));
    state.liveMatch.scoreA = events.filter(goal => goal.team === 'A').length;
    state.liveMatch.scoreB = events.filter(goal => goal.team === 'B').length;
  }
  return { state, documents, payload, goals, save: () => handler({ auth: { uid: 'manager' }, data: payload }), commits: () => commits };
}

test.each([4, 7, 11])('the full %s-a-side server and history reducer agree on 3:1, guests, unknown and own goals after retry', async size => {
  const x = world(size, true);
  x.state.players = ['real-scorer', 'real-assister'];
  x.payload.sideA[0] = 'real-scorer';
  x.payload.sideB[0] = 'real-assister';
  x.goals([
    { team: 'A', scorerId: 'real-scorer', assisterId: 'guest:a1', assistStatus: 'player' },
    { team: 'B', scorerId: 'guest:b1', assisterId: 'real-assister', assistStatus: 'player' },
    { team: 'A', scorerId: null, assisterId: null, assistStatus: 'none' },
    { team: 'A', scorerId: 'guest:b2', assisterId: null, ownGoal: true, assistStatus: 'none' },
  ]);
  await x.save(); await x.save();
  const history = x.documents.get('games/audit/roundHistory/r') as RoundHistoryDoc;
  expect(history).toMatchObject({ scoreA: 3, scoreB: 1, winnerSide: 'A' });
  expect(history.goals).toHaveLength(4);
  expect(x.documents.get('gamePlayerStats/audit__real-scorer')).toMatchObject({ goals: 1, rounds: 1, wins: 1, actualTeamGoalsFor: 3, actualTeamGoalsAgainst: 1, teamScoreRounds: 1 });
  expect(x.documents.get('gamePlayerStats/audit__guest:a1')).toMatchObject({ assists: 1, rounds: 1, wins: 1 });
  expect(x.documents.get('gamePlayerStats/audit__guest:b2').goals ?? 0).toBe(0);
  expect(reduceRounds('guest:a1', [history])).toMatchObject({ playedRounds: 1, contribution: { touched: 1, teamGoals: 3, pct: 33 }, teamGoalsAgainst: 1 });
  expect(reduceRounds('real-assister', [history])).toMatchObject({ playedRounds: 1, contribution: { touched: 1, teamGoals: 1, pct: 100 } });
  expect(x.commits()).toBe(1);
  expect(x.state.liveMatch.goals).toEqual([]);
  expect([...x.documents.keys()].some(path => /^(users|communityPlayerStats|communityPairStats)\//.test(path) && path.includes('guest:'))).toBe(false);
});

test.each([61, 101])('a verified %s-event board is never truncated and then completely cleared', async count => {
  const x = world();
  x.goals(Array.from({ length: count }, () => ({ team: 'A', scorerId: 'a0', assisterId: null, assistStatus: 'none' })));
  expect(matchesLiveRound(x.state, 'r', x.payload.liveGoalIds, { rotationUpdatedAt: 1, penalties: [] })).toBe(true);
  await x.save(); await x.save();
  expect(x.documents.get('games/audit/roundHistory/r').goals).toHaveLength(count);
  expect(x.documents.get('games/audit/roundHistory/r').scoreA).toBe(count);
  expect(x.documents.get('users/a0').stats.goals).toBe(count);
  expect(x.documents.get('gamePlayerStats/audit__a0').rounds).toBe(1);
  expect(x.state.liveMatch.goals).toEqual([]);
  expect(x.commits()).toBe(1);
});

test('a registered outgoing guest contributor does not lose its appearance at the historical side bound', async () => {
  const x = world(11, true);
  const outgoing = Array.from({ length: 15 }, (_, i) => `guest:outgoing-${i}`);
  x.state.guests.push(...outgoing.map(id => ({ id: id.slice(6) })));
  x.goals(outgoing.map(scorerId => ({ team: 'A', scorerId, assisterId: null, assistStatus: 'none' })));
  await x.save();
  const history = x.documents.get('games/audit/roundHistory/r');
  expect(history.teamA).toHaveLength(26);
  expect(x.documents.get(`gamePlayerStats/audit__${outgoing[14]}`)).toMatchObject({ goals: 1, rounds: 1, wins: 1 });
  expect(x.state.liveMatch.goals).toEqual([]);
});

test('legacy unverified input keeps its previous sixty-goal bound and cannot clear an unrelated live board', async () => {
  const x = world();
  x.goals(Array.from({ length: 101 }, () => ({ team: 'A', scorerId: 'a0' })));
  delete x.payload.liveGoalIds;
  await x.save();
  expect(x.documents.get('games/audit/roundHistory/r').goals).toHaveLength(60);
  expect(x.documents.get('users/a0').stats.goals).toBe(60);
  expect(x.state.liveMatch.goals).toHaveLength(101);
});

test.each([false, true])('expanded history never adds an unregistered real or guest identity (legacy=%s)', async legacy => {
  const x = world(11, true);
  const legitimate = Array.from({ length: 15 }, (_, i) => `guest:outgoing-${i}`);
  x.state.guests.push(...legitimate.map(id => ({ id: id.slice(6) })));
  x.payload.sideA.push('not-this-game', 'guest:not-this-game');
  x.goals([...legitimate, 'not-this-game', 'guest:not-this-game'].map(scorerId => ({ team: 'A', scorerId, assisterId: 'another-stranger', assistStatus: 'player' })));
  if (legacy) delete x.payload.liveGoalIds;
  await x.save();
  const history = x.documents.get('games/audit/roundHistory/r');
  expect(history.teamA).not.toContain('not-this-game');
  expect(history.teamA).not.toContain('guest:not-this-game');
  expect(history.teamA).not.toContain('another-stranger');
  expect(history.teamA).toHaveLength(legacy ? 25 : 26);
  for (const path of x.documents.keys()) {
    expect(/^(users|gamePlayerStats|communityPlayerStats|pairStats|communityPairStats)\//.test(path) &&
      ['not-this-game', 'another-stranger'].some(id => path.includes(id))).toBe(false);
  }
});

test('the real operation ceiling rejects expanded participation without any partial write or live clear, including retry', async () => {
  const x = world(11, true);
  const outgoing = Array.from({ length: MAX_ROUND_BATCH_OPS }, (_, i) => `guest:outgoing-${i}`);
  x.state.guests.push(...outgoing.map(id => ({ id: id.slice(6) })));
  x.goals(outgoing.map(scorerId => ({ team: 'A', scorerId, assisterId: null, assistStatus: 'none' })));
  const before = JSON.parse(JSON.stringify([...x.documents]));
  expect(matchesLiveRound(x.state, 'r', x.payload.liveGoalIds, { rotationUpdatedAt: 1, penalties: [] })).toBe(true);
  await expect(x.save()).rejects.toMatchObject({ code: 'resource-exhausted' });
  await expect(x.save()).rejects.toMatchObject({ code: 'resource-exhausted' });
  expect([...x.documents]).toEqual(before);
  expect(x.commits()).toBe(0);
  expect(x.state.liveMatch.goals).toHaveLength(MAX_ROUND_BATCH_OPS);
  expect(x.documents.has('games/audit/committedRounds/r')).toBe(false);
  expect(x.documents.has('games/audit/roundHistory/r')).toBe(false);
});

test.each([4, 7, 11])('the full %s-a-side commit, pure aggregation and history agree on 27 shootout kicks with no field goals', async size => {
  const x = world(size);
  const outcomes = ['goal', 'save', 'miss'] as const;
  x.payload.penalties = Array.from({ length: 27 }, (_, i) => ({ kickerId: 'a0', keeperId: 'b0', scored: i % 3 === 0, outcome: outcomes[i % 3] }));
  x.state.liveMatch.shootout = { firstTeam: 'A', kicks: x.payload.penalties.map((kick: any, i: number) => ({ id: `kick-${i}`, at: i, team: 'A', ...kick })) };
  expect(buildShootoutPenaltyPayload(x.state.liveMatch.shootout)).toEqual(x.payload.penalties);
  const aggregate = aggregatePenalties(x.payload.penalties, { isReal: id => !id.startsWith('guest:'), isOnField: id => [...x.payload.sideA, ...x.payload.sideB].includes(id) });
  await x.save(); await x.save();
  const history = x.documents.get('games/audit/roundHistory/r');
  expect(history).toMatchObject({ scoreA: 0, scoreB: 0, goals: [] });
  expect(history.penalties).toHaveLength(27);
  expect(aggregate.byKicker.a0).toEqual({ taken: 27, scored: 9, missed: 18 });
  expect(aggregate.byKeeper.b0).toEqual({ faced: 27, saved: 9, conceded: 9 });
  for (const path of ['users/b0', 'communityPlayerStats/club__b0', 'gamePlayerStats/audit__b0']) {
    const row = x.documents.get(path); const stats = path.startsWith('users/') ? row.stats : row;
    expect(stats).toMatchObject({ penFaced: 27, penSaved: 9, penConceded: 9 });
    expect(stats.goals ?? 0).toBe(0);
  }
  expect(reduceRounds('b0', [history]).pen).toEqual({ scored: 0, saved: 9, missed: 0, conceded: 9 });
  expect(pctOf(aggregate.byKeeper.b0.saved, aggregate.byKeeper.b0.faced)).toBe(33);
  expect(x.documents.get('communityStats/club')).toMatchObject({ goals: 0, rounds: 1, shootoutRounds: 1, scorelessRounds: 1, countedRounds: 1 });
  expect(x.commits()).toBe(1);
});

test.each(['finished', 'cancelled'])('a delayed request cannot credit a previously uncommitted mini-game after the evening became %s', async status => {
  const x = world();
  x.goals([{ team: 'A', scorerId: 'a0' }]);
  // Another manager closes the evening before this request reaches the server.
  // Its rotation identity and live snapshot still match the delayed request.
  x.state.status = status;
  const before = JSON.parse(JSON.stringify([...x.documents]));
  await expect(x.save()).rejects.toMatchObject({ code: 'failed-precondition' });
  expect([...x.documents]).toEqual(before);
  expect(x.commits()).toBe(0);
});

test('a lost response still retries successfully after the already-credited evening was closed', async () => {
  const x = world();
  x.goals([{ team: 'A', scorerId: 'a0' }]);
  await x.save(); x.state.status = 'finished';
  await expect(x.save()).resolves.toMatchObject({ alreadyCommitted: true, protocol: 2 });
  expect(x.commits()).toBe(1);
  expect(x.documents.get('users/a0').stats.goals).toBe(1);
});

function addLineup(x: ReturnType<typeof world>) {
  x.state.rotation.playing = [0, 1]; x.state.rotation.loans = [];
  x.state.draftTeams = { teams: [
    { index: 0, playerIds: [...x.payload.sideA], colorKey: 'red' },
    { index: 1, playerIds: [...x.payload.sideB], colorKey: 'blue' },
  ], leftHome: [] };
  x.payload.liveLineupFingerprint = liveLineupFingerprint(x.state);
}

test.each([
  ['redraft', (state: any) => { state.draftTeams.teams[0].playerIds.reverse(); }],
  ['colours', (state: any) => { state.draftTeams.teams[0].colorKey = 'green'; }],
  ['playing sides', (state: any) => { state.rotation.playing.reverse(); }],
  ['go home', (state: any) => { state.draftTeams.leftHome.push({ playerId: 'a0', homeTeam: 0 }); }],
  ['temporary loan', (state: any) => { state.rotation.loans.push({ playerId: 'a1', homeTeam: 0, filledTeam: 1, swapId: 'swap' }); }],
] as const)('the complete server refuses stale %s attribution even when the round and timestamp did not change', async (_kind, mutate) => {
  const x = world(); addLineup(x);
  x.goals([{ team: 'A', scorerId: 'a0' }]);
  mutate(x.state);
  const before = JSON.parse(JSON.stringify([...x.documents]));
  expect(x.state.rotation).toMatchObject({ roundInstanceId: 'r', updatedAt: 1 });
  await expect(x.save()).rejects.toMatchObject({ code: 'failed-precondition' });
  expect([...x.documents]).toEqual(before);
  expect(x.commits()).toBe(0);
  expect(x.state.liveMatch.goals).toHaveLength(1);
});

test.each([null, '', 5])('an explicitly invalid lineup fingerprint %s cannot fall back to the legacy path', async fingerprint => {
  const x = world(); addLineup(x); x.payload.liveLineupFingerprint = fingerprint;
  await expect(x.save()).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(x.commits()).toBe(0);
});

test('a matching lineup fingerprint credits once while old callers may still omit the new field', async () => {
  const current = world(); addLineup(current);
  await current.save(); await current.save();
  expect(current.commits()).toBe(1);
  const old = world(); addLineup(old); delete old.payload.liveLineupFingerprint;
  old.state.draftTeams.teams[0].colorKey = 'green';
  await old.save();
  expect(old.commits()).toBe(1);
});

test('lineup identity ignores metadata and left-home order but preserves all attribution fields', () => {
  const x = world(); addLineup(x);
  x.state.draftTeams.leftHome = [{ playerId: 'left-a', at: 10 }, { playerId: 'left-b', at: 20 }];
  const before = liveLineupFingerprint(x.state);
  x.state.updatedAt = 100; x.state.rotation.waiting = [2, 3];
  x.state.draftTeams.published = true; x.state.draftTeams.teams[0].captainId = 'a1';
  x.state.draftTeams.leftHome.reverse(); x.state.draftTeams.leftHome[0].at = 200;
  expect(liveLineupFingerprint(x.state)).toBe(before);
  x.state.rotation.loans = [{ playerId: 'a1', homeTeam: 0, filledTeam: 1 }];
  const loan = liveLineupFingerprint(x.state);
  x.state.rotation.loans[0].swapId = 'connected-swap';
  expect(liveLineupFingerprint(x.state)).not.toBe(loan);
});

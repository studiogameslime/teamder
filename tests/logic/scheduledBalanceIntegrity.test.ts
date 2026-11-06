import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as core from '../../functions/src/teamBalanceCore';
import { applyScheduledColors } from '../../functions/src/draftColors';

function sourceFunctions(file: string, names: string[]) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  return ast.statements.filter(n =>
    ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? '') ||
    ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.getText(ast))),
  ).map(n => n.getText(ast)).join('\n');
}

function harness(freshPatch: Record<string, unknown> = {}, method = 'generateDraftTeamsForGame') {
  const players = Array.from({ length: 21 }, (_, i) => `p${i}`);
  const ratings = Object.fromEntries(players.map((id, i) => [id, 1 + i % 5]));
  const initial: any = { id: 'game', groupId: 'club', createdBy: 'manager', status: 'open',
    format: '3v3', numberOfTeams: 7, players, guests: [], autoTeamsMethod: 'rating',
    startsAt: Date.now() + 30 * 60 * 1000, ...(method === 'generateForGame' ? {} : { autoTeamsAt: 1 }) };
  const current: any = { ...initial, ...freshPatch };
  const errors = jest.fn(), notify = jest.fn();
  const balanceCalls: core.CoreInput[] = [];
  const ref = { id: initial.id };
  const group: any = { internalRating: true, adminRatings: ratings };
  const policy = { legacy: false };
  const reads: string[] = [];
  const document = (path: string) => ({ path });
  const context: any = { ...core, applyScheduledColors, exports: {}, Math,
    balanceCore: (input: core.CoreInput) => { balanceCalls.push(input); return core.balanceCore(input); },
    GUEST_ID_PREFIX: 'guest:', DEFAULT_AUTO_BALANCE_MINUTES: 60,
    legacyClubRatingsCompat: () => policy.legacy,
    loadRecentSplits: async () => [],
    fanOutTeamsReadyPush: notify, observeCaughtError: errors,
    console: { log() {}, error: errors },
    admin: { firestore: { FieldValue: { delete: () => null } } },
    db: {
      doc: document,
      collection: (collection: string) => ({ doc: (id: string) => ({ ...document(`${collection}/${id}`),
        collection: (child: string) => ({ doc: (uid: string) => document(`${collection}/${id}/${child}/${uid}`) }) }) }),
      runTransaction: async (fn: any) => fn({ get: async (target: any) => {
        reads.push(target.path ?? 'game');
        return { exists: true, data: () => target === ref ? current : target.path.endsWith('/private/adminRatings') ? { ratings } : group };
      }, getAll: async (...refs: any[]) => refs.map(target => {
        reads.push(target.path);
        return { exists: true, data: () => ({ average: ratings[target.path.split('/').pop()], count: 1 }) };
      }),
        update: (_ref: unknown, patch: unknown) => Object.assign(current, patch) }),
    },
  };
  context.getFirestore = () => context.db;
  const names = ['perTeamSize', 'balanceTeamsV1', 'buildDraftTeamsFromBalance', 'generateDraftTeamsForGame', 'generateForGame', 'scheduledBalanceDue', 'loadScheduledBalanceRatings', 'loadGroupRatings'];
  const code = sourceFunctions('functions/src/clubAdminRatings.ts', ['readServerAdminRatings', 'cleanAdminRatings']) + '\n' +
    sourceFunctions('functions/src/index.ts', names) + '\nexports.api={balanceTeamsV1,buildDraftTeamsFromBalance,generateDraftTeamsForGame,generateForGame};';
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { api: context.exports.api, current, initial, ratings, errors, notify, ref, balanceCalls, group, policy, reads };
}

function seed() {
  let state = 42;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test.each([2, 3, 4, 5, 6, 7])('scheduled save retains every player in %i teams', async count => {
  const h = harness({ numberOfTeams: count });
  h.initial.numberOfTeams = count;
  await h.api.generateDraftTeamsForGame(h.ref, h.initial);
  expect(h.errors).not.toHaveBeenCalled();
  const draft = h.current.draftTeams;
  expect(draft.teams).toHaveLength(count);
  const ids = draft.teams.flatMap((t: any) => t.playerIds);
  expect(ids.slice().sort()).toEqual(h.current.players.slice().sort());
  expect(new Set(ids).size).toBe(ids.length);
  expect(draft.originalTeams).toEqual(draft.teams);
  expect(draft.published).toBe(true);
  expect(h.current.teamBalanceMeta.teamRatings).toHaveLength(count);
  expect(h.notify).toHaveBeenCalledTimes(1);
});

test.each(['generateDraftTeamsForGame', 'generateForGame'])('%s excludes waitlisted guests using the transactional roster', async method => {
  const h = harness({ guests: [{ id: 'active', estimatedRating: 4 }, { id: 'waiting', estimatedRating: 5, waitlisted: true }] }, method);
  await h.api[method](h.ref, h.initial);
  expect(h.errors).not.toHaveBeenCalled();
  const ids = method === 'generateForGame' ? Object.keys(h.current.liveMatch.assignments)
    : h.current.draftTeams.teams.flatMap((t: any) => t.playerIds);
  expect(ids).toContain('guest:active');
  expect(ids).not.toContain('guest:waiting');
});

test('scheduled balance and captain selection use 2.5 for unrated players', () => {
  const h = harness();
  const ratings = { rated: 2.8, low: 1, zero: 0 };
  const actual = h.api.balanceTeamsV1(['missing', 'rated', 'low', 'zero'], ratings, 1, 5, []);
  expect(actual.unratedCount).toBe(2);
  expect(actual.teamRatings).toEqual([2.2]); // (2.5 + 2.8 + 1 + 2.5) / 4
  const teams = h.api.buildDraftTeamsFromBalance(actual.assignments, ratings, 1, 'manager');
  expect(teams[0].captainId).toBe('rated');
  expect(ratings).toEqual({ rated: 2.8, low: 1, zero: 0 });
});

test('the legacy assignment reader retains teams six and seven', async () => {
  const h = harness({}, 'generateForGame');
  await h.api.generateForGame(h.ref, h.initial);
  expect(h.errors).not.toHaveBeenCalled();
  expect(h.current.liveMatch.benchOrder).toEqual([]);
  const context: any = { exports: {} };
  const code = sourceFunctions('src/firebase/firestore.ts', ['VALID_ZONES', 'VALID_PHASES', 'readLiveMatch']);
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const read = context.exports.readLiveMatch(h.current.liveMatch);
  expect(read.assignments).toEqual(h.current.liveMatch.assignments);
  expect(Object.values(read.assignments)).toContain('teamF');
  expect(Object.values(read.assignments)).toContain('teamG');
});

test.each([2, 3, 5, 7])('the adapter preserves core membership and metrics with %i teams', count => {
  const h = harness();
  const random = jest.spyOn(Math, 'random').mockImplementation(seed());
  try {
    const actual = h.api.balanceTeamsV1(h.initial.players, h.ratings, count, 11, []);
    const teams = h.api.buildDraftTeamsFromBalance(actual.assignments, h.ratings, count, 'manager');
    random.mockImplementation(seed());
    const expected = core.balanceCore({ playerIds: h.initial.players, ratings: h.ratings, numTeams: count, perTeam: 11 });
    expect(teams.map((t: any) => t.playerIds.slice().sort())).toEqual(expected.teams.map(t => t.slice().sort()));
    expect(actual.gap).toBe(expected.gap);
    expect(actual.repeat).toBe(expected.repeat);
    expect(actual.band).toBe(expected.band);
    expect(actual.fallback).toBe(expected.fallback);
  } finally { random.mockRestore(); }
});

test.each(['generateDraftTeamsForGame', 'generateForGame'])('%s leaves an intervening manager allocation intact', async method => {
  const draftTeams = { teams: [{ index: 0, playerIds: ['p0'] }] };
  const h = harness({ draftTeams }, method);
  const before = JSON.stringify(h.current);
  await h.api[method](h.ref, h.initial);
  expect(JSON.stringify(h.current)).toBe(before);
  expect(h.notify).not.toHaveBeenCalled();
});

describe.each(['generateDraftTeamsForGame', 'generateForGame'])('%s transactional inputs', method => {
  test.each(['cancelled', 'finished', 'live'])('does not save or notify after status changes to %s', async status => {
    const h = harness({ status }, method), before = JSON.stringify(h.current);
    await h.api[method](h.ref, h.initial);
    expect(h.errors).not.toHaveBeenCalled();
    expect(JSON.stringify(h.current)).toBe(before);
    expect(h.balanceCalls).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  test.each([false, true, 'peer'])('a newly joined player keeps his rating (source=%s)', async source => {
    const h = harness({}, method);
    h.current.players = [...h.initial.players, 'late'];
    h.ratings.late = 5;
    h.policy.legacy = source === true;
    h.group.internalRating = source !== 'peer';
    await h.api[method](h.ref, h.initial);
    expect(h.errors).not.toHaveBeenCalled();
    expect(h.balanceCalls[0].playerIds).toContain('late');
    expect(h.balanceCalls[0].ratings.late).toBe(5);
    expect(h.reads[0]).toBe('game');
    expect(h.reads).toContain(source === 'peer' ? 'groups/club/ratings/late'
      : source === true ? 'groups/club' : 'groups/club/private/adminRatings');
  });

  test('uses the latest team count and format', async () => {
    const h = harness({ numberOfTeams: 6, format: '8v8' }, method);
    await h.api[method](h.ref, h.initial);
    expect(h.errors).not.toHaveBeenCalled();
    expect(h.balanceCalls[0].numTeams).toBe(6);
    expect(h.balanceCalls[0].perTeam).toBe(8);
  });

  test('a switch to random removes every rating including guests', async () => {
    const h = harness({ autoTeamsMethod: 'random', guests: [{ id: 'active', estimatedRating: 5 }] }, method);
    await h.api[method](h.ref, h.initial);
    expect(h.errors).not.toHaveBeenCalled();
    expect(h.balanceCalls[0].ratings).toEqual({});
    expect(h.balanceCalls[0].pairWeights).toBeUndefined();
    expect(h.reads).toEqual(['game']);
  });

  test('a switch from random to rating reads the current ratings', async () => {
    const h = harness({}, method);
    h.initial.autoTeamsMethod = 'random';
    await h.api[method](h.ref, h.initial);
    expect(h.errors).not.toHaveBeenCalled();
    expect(h.balanceCalls[0].ratings.p4).toBe(5);
  });

  test('does not reuse history from a different club', async () => {
    const h = harness({ groupId: 'other' }, method), before = JSON.stringify(h.current);
    await h.api[method](h.ref, h.initial);
    expect(JSON.stringify(h.current)).toBe(before);
    expect(h.balanceCalls).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

test.each([undefined, 0, Date.now() + 60 * 60 * 1000])('removed or postponed explicit schedule does not generate (%s)', async autoTeamsAt => {
  const h = harness({ autoTeamsAt }), before = JSON.stringify(h.current);
  await h.api.generateDraftTeamsForGame(h.ref, h.initial);
  expect(JSON.stringify(h.current)).toBe(before);
  expect(h.balanceCalls).toHaveLength(0);
  expect(h.notify).not.toHaveBeenCalled();
});

test.each([{ autoTeamGenerationMinutesBeforeStart: 0 }, { startsAt: Date.now() - 60000 }, { autoTeamsAt: 1 }])('legacy route rechecks its current schedule (%j)', async patch => {
  const h = harness(patch, 'generateForGame'), before = JSON.stringify(h.current);
  await h.api.generateForGame(h.ref, h.initial);
  expect(JSON.stringify(h.current)).toBe(before);
  expect(h.balanceCalls).toHaveLength(0);
});

import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { createManualDraft, hasManualDraft, manualDraftRevision } from '@/utils/manualAllocation';
import { resolveSplitTeams } from '@/utils/draftTeamsView';
import { rotationWriteSource } from '@/services/rotationWriteSource';

// Execute the actual service save, including its transaction, not a duplicate
// implementation of replacement. The database records only the emitted patch.
function harness(mock = false) {
  const ast = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let method = '';
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'saveDraftTeams') method = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const old = createManualDraft([['a', 'b'], ['c', 'd']], 'owner', 1);
  const current: any = {
    id: 'game', status: 'live', players: ['a', 'b', 'c', 'd'], guests: [], draftTeams: old,
    liveMatch: { startedAt: 5, scoreA: 2, scoreB: 1, goals: [{ scorerId: 'a' }], timerRunning: true },
    rotation: { playing: [0, 1], waiting: [], round: 4, roundInstanceId: 'four', roundInstanceRound: 4,
      loans: [{ playerId: 'a', from: 0, to: 1 }], wins: { 0: 2, 1: 1 }, lastRoundAt: 12,
      baseTeams: old.teams.map(t => ({ index: t.index, playerIds: [...t.playerIds] })) },
  };
  const validateDraftRoster = jest.fn();
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: mock, mockGamesV2: [current],
    validateDraftRoster, docs: { game: () => ({}) }, getFirebase: () => ({ db: {} }), stripUndefined: (v: any) => v,
    runTransaction: async (_: any, fn: any) => fn({
      get: async () => ({ exists: () => true, data: () => current }),
      update: (_ref: any, patch: any) => Object.assign(current, patch),
    }), Date };
  vm.runInNewContext(ts.transpileModule('module.exports={' + method + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { service: context.module.exports, current, validateDraftRoster };
}

test.each([false, true])('before kickoff every new allocation replaces the saved split (mock=%s)', async mock => {
  const { service, current, validateDraftRoster } = harness(mock);
  delete current.rotation; delete current.liveMatch; current.status = 'open';
  const live = JSON.stringify(current.liveMatch);
  const oldLocal = JSON.stringify({ teams: [['a'], ['b', 'c', 'd']], baseDraftRevision: manualDraftRevision(current.draftTeams) });
  for (const [index, ids] of [
    [['a', 'c'], ['b', 'd']], // automatic
    [['d', 'a'], ['c', 'b']], // manual
    [['c', 'd'], ['a', 'b']], // random
    [['b', 'c'], ['d', 'a']], // captain
  ].entries()) {
    const next = createManualDraft(ids, 'owner', 100 + index);
    // The legacy editor spreads the old snapshot when saving new teams.
    next.originalTeams = current.draftTeams.originalTeams;
    const oldSource = rotationWriteSource(current);
    await service.saveDraftTeams('game', next, index === 0 ? { algorithm: 'rating_balanced_v2' } : undefined, true);
    expect(current.draftTeams.teams.map((t: any) => t.playerIds)).toEqual(ids);
    expect(resolveSplitTeams(current.draftTeams, current.rotation).map(t => t.playerIds)).toEqual(ids);
    expect(current.rotation).toBeUndefined();
    expect(JSON.stringify(current.liveMatch)).toBe(live);
    expect(rotationWriteSource(current)).not.toBe(oldSource);
    expect(hasManualDraft(oldLocal, manualDraftRevision(current.draftTeams))).toBe(false);
    if (index > 0) expect(current.teamBalanceMeta ?? null).toBeNull();
  }
  expect(validateDraftRoster).toHaveBeenCalledTimes(4);
});

test('legacy editor cannot bypass current-game reset confirmation once rotation exists', async () => {
  const { service, current } = harness();
  service.getGameById = () => { throw Error('a preflight read must not determine the saved rotation'); };
  const next = createManualDraft([['a', 'd'], ['b', 'c']], 'owner', 20);
  const before = structuredClone(current);
  await expect(service.saveDraftTeams('game', next)).rejects.toThrow('עריכת המחזור');
  expect(current.rotation.roundInstanceId).toBe('four');
  expect(current).toEqual(before);
});

test('rejected replacement does not partially change the saved allocation', async () => {
  const { service, current, validateDraftRoster } = harness();
  delete current.rotation; current.status = 'open';
  const before = JSON.stringify(current);
  validateDraftRoster.mockImplementation(() => { throw Error('DRAFT_ROSTER_CHANGED'); });
  await expect(service.saveDraftTeams('game', createManualDraft([['d', 'b'], ['c', 'a']], 'owner', 20), undefined, true)).rejects.toThrow('DRAFT_ROSTER_CHANGED');
  expect(JSON.stringify(current)).toBe(before);
});

test.each([3, 4, 7])('legacy replacement of %s groups cannot change a live queue', async count => {
  const { service, current } = harness();
  current.rotation.playing = [1, 0];
  current.rotation.waiting = [2];
  const groups = Array.from({ length: count }, (_, index) => [`p${index}a`, `p${index}b`]);
  const before = structuredClone(current);
  await expect(service.saveDraftTeams('game', createManualDraft(groups, 'owner', 20))).rejects.toThrow('עריכת המחזור');
  expect(current).toEqual(before);
});

test('a replacement cannot remove a side currently playing and leave a dangling live reference', async () => {
  const { service, current } = harness();
  current.rotation.playing = [0, 2];
  const before = JSON.stringify(current);
  await expect(service.saveDraftTeams('game', createManualDraft([['a', 'b'], ['c', 'd']], 'owner', 20))).rejects.toThrow('עריכת המחזור');
  expect(JSON.stringify(current)).toBe(before);
});

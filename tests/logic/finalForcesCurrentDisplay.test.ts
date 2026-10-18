import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { resolveCurrentSplitTeams, resolveSplitTeams } from '@/utils/draftTeamsView';
import { createManualDraft, manualDraftRevision, restoreManualTeams } from '@/utils/manualAllocation';
import { activeDraftRosterIds, validateDraftRoster } from '@/utils/draftIntegrity';
import type { DraftTeamsResult, Game } from '@/types';

const team = (index: number, playerIds: string[], colorKey = 'red') => ({ index, captainId: playerIds[0], playerIds, colorKey });
const fixture = (): Game => ({
  id: 'round', groupId: 'club', title: 'בדיקת תצוגת כוחות', startsAt: 1, createdAt: 1,
  fieldName: 'מגרש בדיקה', maxPlayers: 14, waitlist: [], matches: [], currentMatchIndex: 0, locked: true,
  numberOfTeams: 2, format: '7v7', status: 'active', players: ['a', 'home', 'filler', 'b'],
  guests: [{ id: 'new', name: 'אורח שקודם', addedBy: 'owner', createdAt: 1, waitlisted: false },
    { id: 'waiting', name: 'אורח ממתין', addedBy: 'owner', createdAt: 1, waitlisted: true }],
  draftTeams: { method: 'regular', numTeams: 2, createdBy: 'owner', createdAt: 1, teams: [team(0, ['a', 'filler']), team(1, ['b'])],
    originalTeams: [team(0, ['guest:removed', 'a', 'home']), team(1, ['b', 'filler'], 'blue')],
    leftHome: [{ playerId: 'home', homeTeam: 0, at: 2 }] },
  rotation: { playing: [0, 1], waiting: [], baseTeams: [{ index: 0, playerIds: ['a', 'home'] }, { index: 1, playerIds: ['b', 'filler'] }],
    loans: [{ playerId: 'filler', homeTeam: 1, filledTeam: 0 }] },
});

test('current allocation removes a deleted guest from cards/count/share without modifying the historical split', () => {
  const game = fixture(), before = JSON.stringify(game);
  const current = resolveCurrentSplitTeams(game.draftTeams, game.rotation, game);
  expect(current.map(t => t.playerIds)).toEqual([['a', 'home'], ['b', 'filler']]);
  expect(current[0]).toMatchObject({ captainId: 'a', colorKey: 'red' });
  expect(current.reduce((n, t) => n + t.playerIds.length, 0)).toBe(4);
  expect(current.flatMap(t => t.playerIds).every(id => game.players.includes(id))).toBe(true);
  expect(JSON.stringify(game)).toBe(before);
  expect(resolveSplitTeams(game.draftTeams, game.rotation)[0].playerIds).toContain('guest:removed');
});

test('going home and a loan retain their saved home grouping in the allocation record', () => {
  const game = fixture(), current = resolveCurrentSplitTeams(game.draftTeams, game.rotation, game);
  expect(current[0].playerIds).toContain('home');
  expect(current[0].playerIds).not.toContain('filler');
  expect(current[1].playerIds).toContain('filler');
});

test('legacy baseline fallback filters deleted users and waiting guests while preserving current valid guest identity', () => {
  const current = resolveCurrentSplitTeams({ teams: [team(0, ['gone', 'guest:active', 'guest:waiting'])] },
    { baseTeams: [{ index: 0, playerIds: ['gone', 'guest:active', 'guest:waiting'] }] },
    { players: [], guests: [{ id: 'active' }, { id: 'waiting', waitlisted: true }] });
  expect(current[0]).toEqual({ index: 0, captainId: 'guest:active', playerIds: ['guest:active'], colorKey: 'red' });
});

test('a fully removed team has no invented avatar or captain', () => {
  expect(resolveCurrentSplitTeams({ originalTeams: [team(0, ['guest:removed'])] }, undefined, { players: [], guests: [] }))
    .toEqual([{ index: 0, captainId: '', playerIds: [], colorKey: 'red' }]);
});

test('the actual details selector uses the filtered current allocation while finished/cancelled preserve the historical record', () => {
  const file = 'src/screens/games/MatchDetailsScreen.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'splitTeams') expression = node.initializer!.getText(source);
    ts.forEachChild(node, visit);
  }; visit(source);
  const context: any = { module: { exports: {} }, resolveSplitTeams, resolveCurrentSplitTeams,
    isTerminalGame: (game: { status: string }) => ['finished', 'cancelled'].includes(game.status) };
  vm.runInNewContext(ts.transpileModule('module.exports=(game)=>{const draftTeams=game.draftTeams;return ' + expression + ';}', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const game = fixture();
  expect(context.module.exports(game)[0].playerIds).toEqual(['a', 'home']);
  for (const status of ['finished', 'cancelled']) {
    expect(context.module.exports({ ...game, status })[0].playerIds).toEqual(['guest:removed', 'a', 'home']);
  }
});

test('manual edit restores the current working teams and cannot import deleted guests from the original snapshot', () => {
  const game = fixture();
  const roster = activeDraftRosterIds(game);
  const edited = restoreManualTeams(game.draftTeams!.teams.map(t => t.playerIds), roster, 2, 7);
  expect(edited).toEqual([['a', 'filler'], ['b']]);
  expect(edited.flat()).not.toContain('guest:removed');
  expect(edited.flat()).not.toContain('home');
});

function manualEditor(assignedNewGuest: boolean) {
  const file = 'src/components/draft/ManualAllocation.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ['assigned', 'pool', 'save'].includes(node.name.getText(source))) nodes.set(node.name.getText(source), node.getText(source));
    ts.forEachChild(node, visit);
  }; visit(source);
  const game = { ...fixture(), id: 'round', numberOfTeams: 2, format: '7v7' as const };
  const players = activeDraftRosterIds(game).map(id => ({ id, name: id === 'guest:new' ? 'אורח שקודם' : id }));
  const teams = [['a', 'filler'], assignedNewGuest ? ['b', 'guest:new'] : ['b']];
  const saveDraftTeams = jest.fn(async (_id: string, draft: DraftTeamsResult) => { validateDraftRoster(draft, game, game); });
  const context: any = { module: { exports: {} }, game, teams, players, activeDraftRosterIds, createManualDraft, manualDraftRevision,
    gameService: { getGameById: jest.fn(async () => game), saveDraftTeams },
    lock: { current: false }, ready: true, setSaving: jest.fn(), key: 'editor', preview: false, userId: 'owner',
    rosterKey: players.map(p => p.id).sort().join('|'), AsyncStorage: { setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
    setDirty: jest.fn(), toast: { success: jest.fn(), error: jest.fn() }, allowLeave: { current: false }, onSaved: jest.fn(), logError: jest.fn(), Date,
  };
  vm.runInNewContext(ts.transpileModule('const ' + nodes.get('assigned') + ';const ' + nodes.get('pool') + ';const ' + nodes.get('save') +
    ';module.exports={pool,save};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, editor: context.module.exports, saveDraftTeams };
}

test('actual manual editor exposes the promoted unassigned guest without resurrecting a removed guest', async () => {
  const x = manualEditor(false);
  expect(x.editor.pool).toEqual([{ id: 'guest:new', name: 'אורח שקודם' }]);
  await x.editor.save();
  expect(x.saveDraftTeams).not.toHaveBeenCalled();
  expect(x.context.AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(x.context.toast.error).not.toHaveBeenCalled();
});

test('actual manual editor saves a complete assignment even when both teams have fewer than seven players', async () => {
  const x = manualEditor(true);
  expect(x.editor.pool).toEqual([]);
  await x.editor.save();
  expect(x.saveDraftTeams).toHaveBeenCalledTimes(1);
  expect(x.saveDraftTeams.mock.calls[0][1].teams.map((t: { playerIds: string[] }) => t.playerIds)).toEqual([['a', 'filler'], ['b', 'guest:new']]);
  expect(x.context.onSaved).toHaveBeenCalledTimes(1);
  expect(x.context.toast.error).not.toHaveBeenCalled();
});

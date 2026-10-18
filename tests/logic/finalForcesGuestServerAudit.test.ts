import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const source = ts.createSourceFile('index.ts', fs.readFileSync('functions/src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let trigger: ts.Node | undefined, helper = '';
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'onGameRosterChanged') trigger = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'pruneUidsFromTeamsSrv') helper = node.getText(source);
  ts.forEachChild(node, find);
}
find(source);
// Execute the actual trigger's removal discovery expressions and its helper.
// I/O and unrelated fan-out are deliberately outside this isolated regression.
const names = new Set(['beforePlayers', 'afterPlayers', 'beforeActiveGuests', 'afterActiveGuests', 'guestSeatFreed',
  'afterGuestIds', 'removedGuestRosterIds', 'previousOfferUid', 'guestOfferSeatFreed', 'rosterShrank', 'stillHere', 'departed']);
const declarations: string[] = [];
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && names.delete(node.name.getText(source))) declarations.push('const ' + node.getText(source) + ';');
  ts.forEachChild(node, collect);
}
collect(trigger!);
const context: any = { module: { exports: {} }, Date };
vm.runInNewContext(ts.transpileModule(helper + '\nmodule.exports={discover:(before,after)=>{' + declarations.join('\n') +
  ';return {rosterShrank,departed:[...departed]};},prune:pruneUidsFromTeamsSrv}', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { discover, prune } = context.module.exports;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const lineup = () => ({ players: ['member'], guests: [],
  draftTeams: { teams: [{ index: 0, playerIds: ['member', 'guest:g', 'removed'] }],
    originalTeams: [{ index: 0, playerIds: ['member', 'guest:g', 'removed'] }], leftHome: [] },
  rotation: { playing: [0, 1], loans: [{ playerId: 'guest:g', homeTeam: 0, filledTeam: 1 }],
    baseTeams: [{ index: 0, playerIds: ['member', 'guest:g', 'removed'] }] },
  liveMatch: { goals: [{ scorerId: 'guest:g' }], scoreA: 1, shootout: { kicks: [{ kickerId: 'guest:g' }] } },
});

test('an old client removing a guest is discovered and pruned without any real player departure', () => {
  const before = { players: ['member'], guests: [{ id: 'g' }] }, after = { players: ['member'], guests: [] };
  const result = discover(before, after);
  expect(result).toEqual({ rosterShrank: true, departed: ['guest:g'] });
  const current = lineup(), saved = clone(current);
  const patch = prune(current, new Set(result.departed));
  expect(patch.draftTeams.teams[0].playerIds).toEqual(['member', 'removed']);
  expect(patch.rotation.loans).toEqual([]);
  expect(patch.draftTeams.originalTeams).toEqual(saved.draftTeams.originalTeams);
  expect(patch.liveMatch).toBeUndefined();
  expect(current).toEqual(saved);
});

test('replacing one guest with another at equal occupancy still cleans the removed identity', () => {
  expect(discover({ players: ['member'], guests: [{ id: 'g' }] }, { players: ['member'], guests: [{ id: 'new' }] }))
    .toEqual({ rosterShrank: true, departed: ['guest:g'] });
});

test.each(['players', 'waitlist', 'pending'])('a delayed removal cannot prune a real person who rejoined %s', key => {
  const current = { ...lineup(), [key]: ['member', 'removed'] };
  expect(prune(current, new Set(['removed']))).toEqual({});
});

test.each([false, true])('a delayed guest removal cannot prune the same restored identity (waiting=%s)', waitlisted => {
  const current = { ...lineup(), guests: [{ id: 'g', waitlisted }] };
  expect(prune(current, new Set(['guest:g']))).toEqual({});
});

test('one stale event can clean a truly departed player while keeping a rejoined guest', () => {
  const current = { ...lineup(), guests: [{ id: 'g' }] };
  const patch = prune(current, new Set(['removed', 'guest:g']));
  expect(patch.draftTeams.teams[0].playerIds).toEqual(['member', 'guest:g']);
  expect(patch.rotation.baseTeams[0].playerIds).toEqual(['member', 'guest:g']);
  expect(patch.rotation.loans).toEqual(current.rotation.loans);
});

import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
jest.mock('../../functions/src/serverErrorLog', () => ({ observeCaughtError: jest.fn() }));
import { sendWidgetRosterInvalidation } from '../../functions/src/widgetRosterSync';

const game = (extra: Record<string, unknown> = {}) => ({ players: ['owner', 'p1'],
  participantIds: ['owner', 'p1'], createdBy: 'owner', guests: [], status: 'open', title: 'מחזור', ...extra });
function fixture() {
  const loadUsers = jest.fn(async (ids: string[]) => ids.map(uid => ({ uid, platform: 'android', fcmTokens: ['token-'+uid] })));
  const send = jest.fn(async (_message: any) => ({}));
  return { loadUsers, send };
}
test('roster-only admission sends small owner-bound invalidations without a timer change', async () => {
  const f = fixture();
  await sendWidgetRosterInvalidation('g', game(), game({ players: ['owner', 'p1', 'p2'], participantIds: ['owner', 'p1', 'p2'] }), f);
  expect(f.send).toHaveBeenCalledTimes(3);
  expect(f.send.mock.calls[0][0]).toEqual({ tokens: ['token-owner'],
    data: { type: 'widgetRosterSync', gameId: 'g', viewerId: 'owner' }, android: { priority: 'normal', ttl: 86_400_000 } });
});
test('former participants and creator receive removal and deletion invalidations', async () => {
  const f = fixture();
  await sendWidgetRosterInvalidation('g', game(), game({ players: ['owner'], participantIds: ['owner'] }), f);
  expect(f.loadUsers).toHaveBeenCalledWith(['owner', 'p1']);
  f.loadUsers.mockClear();
  await sendWidgetRosterInvalidation('g', game(), undefined, f);
  expect(f.loadUsers).toHaveBeenCalledWith(['owner', 'p1']);
});
test.each([
  { guests: [{ id: 'guest', name: 'אורח' }] },
  { guests: [{ id: 'guest', name: 'אורח', waitlisted: true }] },
  { title: 'מחזור חדש' }, { maxPlayers: 22 }, { status: 'cancelled' },
  { startsAt: 123 }, { fieldName: 'מגרש' }, { city: 'עיר' },
  { liveMatch: { assignments: { p1: 'teamA' } } },
  { rotation: { playing: [1, 2] } },
  { rotation: { loans: [{ playerId: 'p1', homeTeam: 0, filledTeam: 1 }] } },
  { draftTeams: { teams: [{ index: 0, playerIds: ['p1'] }], leftHome: [{ playerId: 'p2' }] } },
])('visible change %j wakes the roster worker', async change => {
  const f = fixture(); await sendWidgetRosterInvalidation('g', game(), game(change), f);
  expect(f.send).toHaveBeenCalled();
});
test('scores, timer and unrelated bookkeeping do not fan out a roster refresh', async () => {
  const f = fixture();
  await sendWidgetRosterInvalidation('g', game({ liveMatch: { phase: 'live', timerRunning: false } }),
    game({ liveMatch: { phase: 'live', timerRunning: true, scoreA: 1 }, updatedAt: 123 }), f);
  expect(f.loadUsers).not.toHaveBeenCalled();
});
test('large rosters never overflow the data-message limit or leak names into the message', async () => {
  const f = fixture();
  const guests = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), name: 'שם פרטי '.repeat(50) }));
  await sendWidgetRosterInvalidation('g', game(), game({ guests }), f);
  for (const [message] of f.send.mock.calls) {
    expect(Buffer.byteLength(JSON.stringify(message.data))).toBeLessThan(300);
    expect(JSON.stringify(message)).not.toContain('שם פרטי');
  }
});
test('only Android audience tokens are sent and duplicate tokens are not repeated', async () => {
  const f = fixture(); f.loadUsers.mockResolvedValue([
    { uid: 'owner', platform: 'android', fcmTokens: ['t', 't'] },
    { uid: 'p1', platform: 'ios', fcmTokens: ['ios'] },
    { uid: 'other', platform: 'android', fcmTokens: ['wrong-owner'] },
  ]);
  await sendWidgetRosterInvalidation('g', game(), game({ guests: [{ name: 'אורח' }] }), f);
  expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0][0].tokens).toEqual(['t']);
});
test('token batches obey the messaging service limit', async () => {
  const f = fixture(); f.loadUsers.mockResolvedValue([{ uid: 'owner', platform: 'android', fcmTokens: Array.from({ length: 1001 }, (_, n) => 't'+n) }]);
  await sendWidgetRosterInvalidation('g', game(), game({ title: 'עודכן' }), f);
  expect(f.send.mock.calls.map(([message]) => message.tokens.length)).toEqual([500, 500, 1]);
});
test('send failure remains a trigger failure', async () => {
  const f = fixture(); f.send.mockRejectedValueOnce(new Error('offline'));
  await expect(sendWidgetRosterInvalidation('g', game(), game({ title: 'עודכן' }), f)).rejects.toThrow('offline');
});
test('the real trigger passes before/after and messaging adapters to the helper', async () => {
  const source = fs.readFileSync('functions/src/index.ts', 'utf8');
  const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  let handler = '';
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'onGameWidgetRosterChanged') {
      const call = node.initializer as ts.CallExpression;
      expect(call.arguments[0].getText(ast)).toBe("'games/{id}'");
      handler = call.arguments[1].getText(ast);
    }
    ts.forEachChild(node, walk);
  }; walk(ast);
  const helper = jest.fn(async (..._args: any[]) => undefined), loadUsers = jest.fn(), send = jest.fn();
  const run = vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { sendWidgetRosterInvalidation: helper, loadUsers, messaging: { sendEachForMulticast: send } });
  const before = game(), after = game({ title: 'חדש' });
  await run({ params: { id: 'document-id' }, data: { before: { data: () => before }, after: { data: () => after } } });
  expect(helper).toHaveBeenCalledWith('document-id', before, after, expect.objectContaining({ loadUsers }));
});

test('prebuild exposes the existing background scheduler dependency exactly once', () => {
  const source = fs.readFileSync('plugins/withWearApp.js', 'utf8');
  const ast = ts.createSourceFile('plugin.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let code = '';
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'addWearableDep') code = statement.getText(ast);
  }
  const add = vm.runInNewContext(`(${code})`, { WEAR_DEP: 'com.google.android.gms:play-services-wearable:18.2.0',
    withAppBuildGradle: (config: any, action: (config: any) => any) => action(config) });
  const config = { modResults: { contents: 'dependencies {\n}\n' } };
  add(config); const first = config.modResults.contents; add(config);
  expect(config.modResults.contents).toBe(first);
  expect(first.match(/androidx.work:work-runtime:2.7.0/g)).toHaveLength(1);
  expect(first).not.toMatch(/uses-permission|android:permission/);
});

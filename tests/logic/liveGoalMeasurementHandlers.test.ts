import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Execute the real source callbacks. The database boundary and native dialog
// are controlled so acknowledgement, failure and cancellation can be ordered.
const file = ts.createSourceFile('LiveScoreboardCard.tsx',
  fs.readFileSync('src/components/match/LiveScoreboardCard.tsx', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name: string) {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error('Missing source handler ' + name);
  return found;
}
function attribute(tag: string, name: string) {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (!found && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === tag) {
      const attr = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === name) as ts.JsxAttribute | undefined;
      if (attr?.initializer && ts.isJsxExpression(attr.initializer)) found = attr.initializer.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error('Missing source callback ' + tag + '.' + name);
  return found;
}
function fixture() {
  const context: any = {
    canEdit: true, busyRef: { current: false }, setBusy: jest.fn(),
    gameId: 'round', minute: 7, rotation: {}, roundCommitKey: () => 'mini-game',
    gameService: { recordGoal: jest.fn().mockResolvedValue(true), removeGoal: jest.fn().mockResolvedValue(undefined) },
    logEvent: jest.fn(), AnalyticsEvent: {
      LiveGoalRecorded: 'live_goal_recorded', TeamScoreChanged: 'team_score_changed',
      GoalWizardOpened: 'goal_wizard_opened', GoalWizardCancelled: 'goal_wizard_cancelled',
      GoalDeletePrompted: 'goal_delete_prompted',
    },
    goalSide: null, setGoalSide: jest.fn((side: string | null) => { context.goalSide = side; }),
    appAlert: jest.fn(), toast: { error: jest.fn() }, he: { goalSaveFailed: 'שמירת השער נכשלה' },
    observeCaughtError: jest.fn(),
  };
  const compile = (value: ts.Expression) => vm.runInNewContext(
    ts.transpileModule('(' + value.getText(file) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    context,
  );
  for (const name of ['addGoal', 'undo', 'doUndo']) context[name] = compile(expression(name));
  const names = () => context.logEvent.mock.calls.map((args: unknown[]) => args[0]);
  return { context, names, open: compile(attribute('ScoreSide', 'onAdd')),
    close: compile(attribute('GoalEntryModal', 'onClose')), save: compile(attribute('GoalEntryModal', 'onSave')) };
}

test('opening the real goal wizard and cancelling creates no goal or success event', () => {
  const f = fixture();
  f.open(); f.close(false);
  expect(f.names()).toEqual(['goal_wizard_opened', 'goal_wizard_cancelled']);
  expect(f.context.gameService.recordGoal).not.toHaveBeenCalled();
  expect(f.context.goalSide).toBeNull();
});

test('two newly saved goals emit two successes and an acknowledged retry emits none', async () => {
  const f = fixture();
  f.context.gameService.recordGoal.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const entry = { id: 'first', team: 'A', scorerId: 'player', assistStatus: 'none' };
  await f.save(entry); await f.save(entry); await f.save({ ...entry, id: 'second' });
  expect(f.names().filter((name: string) => name === 'live_goal_recorded')).toHaveLength(2);
  expect(f.names().filter((name: string) => name === 'team_score_changed')).toHaveLength(2);
  expect(f.context.gameService.recordGoal).toHaveBeenCalledTimes(3);
});

test('failed goal save emits no success, releases the busy gate and allows a successful retry', async () => {
  const f = fixture(), failure = new Error('offline');
  f.context.gameService.recordGoal.mockRejectedValueOnce(failure).mockResolvedValueOnce(true);
  const entry = { id: 'retry', team: 'A', scorerId: 'player' };
  await expect(f.save(entry)).rejects.toBe(failure);
  expect(f.names()).toEqual([]);
  expect(f.context.busyRef.current).toBe(false);
  expect(f.context.toast.error).toHaveBeenCalledTimes(1);
  await f.save(entry); f.close(true);
  expect(f.names()).toEqual(['live_goal_recorded', 'team_score_changed']);
});

test('deleting a saved goal uses the confirmed remove callback without adding a goal-success event', async () => {
  const f = fixture();
  await f.save({ id: 'saved', team: 'A', scorerId: 'player' });
  f.context.undo('saved');
  const buttons = f.context.appAlert.mock.calls[0][2];
  expect(f.context.gameService.removeGoal).not.toHaveBeenCalled();
  expect(buttons[0].style).toBe('cancel');
  await buttons[1].onPress();
  expect(f.context.gameService.removeGoal).toHaveBeenCalledWith('round', 'saved');
  expect(f.names().filter((name: string) => name === 'live_goal_recorded')).toHaveLength(1);
  expect(f.context.logEvent).toHaveBeenLastCalledWith('team_score_changed', { gameId: 'round', delta: -1, kind: 'undo' });
});

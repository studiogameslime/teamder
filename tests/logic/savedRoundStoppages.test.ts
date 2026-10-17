import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { he } from '../../src/i18n/he';
import { savedRoundLive } from '../../src/utils/savedRoundView';

const file = path.resolve(__dirname, '../../src/screens/AdvancedLiveMatchScreen.tsx');
const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name: string) {
  let result = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer!.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!result) throw Error(name);
  return result;
}
function execute(text: string, context: any) {
  vm.runInNewContext(ts.transpileModule('module.exports=' + text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.module.exports;
}
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['buildStoppages', 'formatTime'].includes(node.name?.text ?? '')).map(node => node.getText(ast)).join('\n');
const events = [{ type: 'start', at: 1000 }, { type: 'pause', at: 5000 }, { type: 'resume', at: 8000 }, { type: 'pause', at: 10000 }];
function context(overrides: any = {}) {
  const scope: any = { module: { exports: {} }, he, savedRoundLive,
    gameId: 'evening', currentRoundKey: 'round-1', pendingSavedRound: false,
    live: { scoreA: 1, scoreB: 1, timerRunning: false, timerEvents: events }, timerRunning: false,
    nowTick: 20000, savedRoundView: null, savedResultLoadFailed: false, ...overrides };
  vm.runInNewContext(ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  return scope;
}
function view(scope: any) {
  for (const key of ['savedRoundEndedAt', 'stoppages', 'totalStoppedMs', 'stoppagesUnavailableText', 'stoppagesText', 'showOngoingStoppage', 'ongoingStoppageText']) scope[key] = execute(initializer(key), scope);
  return scope;
}
function readEffect(scope: any) {
  let callback = '';
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('gameService.getRoundHistory(gameId)')) callback = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!callback) throw Error('saved history effect');
  return execute(callback, scope)();
}
const history = { roundId: 'round-1', at: 12000, teamA: [], teamB: [], goals: [], scoreA: 1, scoreB: 1 };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('an active paused game keeps counting its current stoppage', () => {
  const scope = context();
  expect(view(scope).totalStoppedMs).toBe(13000);
  scope.nowTick += 600000;
  expect(view(scope).totalStoppedMs).toBe(613000);
  expect(scope.ongoingStoppageText).toContain('כעת');
});

test('a confirmed pending game freezes for ten minutes and uses the final listener pause rather than the earlier capture', () => {
  const scope = context({ pendingSavedRound: true, savedRoundView: { gameId: 'evening', key: 'round-1', endedAt: 12000, capturedAt: 9000, live: { timerEvents: events.slice(0, 3) } } });
  expect(view(scope).totalStoppedMs).toBe(5000);
  expect(scope.stoppages.stopCount).toBe(2);
  expect(scope.stoppages.ongoingStoppedMs).toBe(2000);
  scope.nowTick += 600000;
  expect(view(scope).totalStoppedMs).toBe(5000);
  expect(scope.ongoingStoppageText).toBe('העצירה האחרונה · 00:02');
  expect(scope.ongoingStoppageText).not.toContain('כעת');
});

test('cold entry gets the same cutoff from the acknowledged history, without a local capture', async () => {
  const scope = context({ pendingSavedRound: true, gameService: { getRoundHistory: jest.fn().mockResolvedValue([history]) },
    setSavedResultLoadFailed: jest.fn(), logError: jest.fn() });
  scope.setSavedRoundView = (update: any) => { scope.savedRoundView = update(scope.savedRoundView); };
  expect(view(scope).totalStoppedMs).toBeNull();
  readEffect(scope); await settle();
  expect(scope.savedRoundView.endedAt).toBe(12000);
  expect(view(scope).totalStoppedMs).toBe(5000);
  expect(scope.gameService.getRoundHistory).toHaveBeenCalledWith('evening');
});

test('an optimistic capture is context only; an unavailable history shows no fabricated total or ongoing row and can recover', async () => {
  const scope = context({ pendingSavedRound: true, rotation: {}, roundLive: { scoreA: 1, scoreB: 1 },
    roundCommitKey: () => 'round-1', serverNow: () => 11000, savedRoundViewRef: { current: null },
    gameService: { getRoundHistory: jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([history]) }, logError: jest.fn() });
  scope.setSavedRoundView = (value: any) => { scope.savedRoundView = typeof value === 'function' ? value(scope.savedRoundView) : value; };
  scope.setSavedResultLoadFailed = (value: boolean) => { scope.savedResultLoadFailed = value; };
  execute(initializer('captureRoundForResult'), scope)();
  expect(scope.savedRoundView.capturedAt).toBe(11000);
  expect(scope.savedRoundView.endedAt).toBeUndefined();
  expect(view(scope).totalStoppedMs).toBeNull();
  expect(scope.showOngoingStoppage).toBe(false);
  expect(scope.stoppagesText).toContain('טוענים');
  readEffect(scope); await settle();
  expect(view(scope).totalStoppedMs).toBeNull();
  expect(scope.stoppagesText).toContain('לא נטען');
  readEffect(scope); await settle();
  expect(view(scope).totalStoppedMs).toBe(5000);
  expect(scope.savedRoundView.capturedAt).toBe(11000);
});

test.each([{ gameId: 'other-evening', key: 'round-1', endedAt: 12000 }, { gameId: 'evening', key: 'round-0', endedAt: 12000 },
  { gameId: 'evening', key: 'round-1', endedAt: 0 }, { gameId: 'evening', key: 'round-1', endedAt: NaN }])('a foreign or invalid cutoff never becomes a saved total: %j', savedRoundView => {
  const scope = view(context({ pendingSavedRound: true, savedRoundView }));
  expect(scope.totalStoppedMs).toBeNull();
  expect(scope.showOngoingStoppage).toBe(false);
});

test('a late history response after cleanup cannot attach the old cutoff to a new round', async () => {
  let resolve: (value: any) => void = () => {};
  const scope = context({ pendingSavedRound: true, gameService: { getRoundHistory: () => new Promise(done => { resolve = done; }) },
    setSavedResultLoadFailed: jest.fn(), setSavedRoundView: jest.fn(), logError: jest.fn() });
  const cleanup = readEffect(scope);
  cleanup(); scope.currentRoundKey = 'round-2'; resolve([history]); await settle();
  expect(scope.setSavedRoundView).not.toHaveBeenCalled();
});

test('preparing the next game releases the old cutoff and normal pauses grow again', () => {
  const scope = context({ pendingSavedRound: true, savedRoundView: { gameId: 'evening', key: 'round-1', endedAt: 12000 } });
  expect(view(scope).totalStoppedMs).toBe(5000);
  scope.pendingSavedRound = false; scope.currentRoundKey = 'round-2'; scope.nowTick = 30000;
  scope.live = { timerEvents: [{ type: 'start', at: 25000 }, { type: 'pause', at: 28000 }] };
  expect(view(scope).totalStoppedMs).toBe(2000);
  scope.nowTick += 1000;
  expect(view(scope).totalStoppedMs).toBe(3000);
  expect(scope.ongoingStoppageText).toContain('כעת');
});

test.each([{ width: 320, fontScale: 1.4 }, { width: 390, fontScale: 1 }])('the pending continue action reserves room for its icon and wraps its complete label at %j', dimensions => {
  let button = '';
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Pressable'
      && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'onPress'
        && attribute.initializer?.getText(ast) === '{continuePendingRound}')) button = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(button).not.toBe('');
  const styleCall = ts.createSourceFile('styles.ts', initializer('styles'), ts.ScriptTarget.Latest, true);
  const object = (styleCall.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
  const wanted = ['timerBtn', 'timerBtnText', 'timerBtnBusy', 'pendingContinueText', 'compactPendingContinueText'];
  const properties = (object.arguments[0] as ts.ObjectLiteralExpression).properties.filter(property => wanted.includes(property.name!.getText(styleCall)));
  const styles = execute('({' + properties.map(property => property.getText(styleCall)).join(',') + '})', { module: { exports: {} } });
  const onContinue = jest.fn();
  const scope: any = { module: { exports: {} }, styles, roundBusy: false, compactControls: dimensions.width < 360 || dimensions.fontScale > 1.2,
    continuePendingRound: onContinue, Pressable: 'Button', Text: 'Text', Ionicons: 'Icon', ActivityIndicator: 'Spinner',
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) } };
  vm.runInNewContext(ts.transpileModule('module.exports=(' + button + ')', { fileName: 'button.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, scope);
  const rendered = scope.module.exports, text = rendered.props.children[0], icon = rendered.props.children[1];
  const flatten = (style: any[]) => Object.assign({}, ...style.filter(Boolean));
  const buttonStyle = flatten(rendered.props.style), textStyle = flatten(text.props.style);
  const innerWidth = dimensions.width - 24 - buttonStyle.paddingHorizontal * 2;
  const textBudget = innerWidth - icon.props.size - buttonStyle.gap;
  expect(textBudget).toBeGreaterThan(200);
  expect(textStyle).toMatchObject({ flex: 1, flexShrink: 1, minWidth: 0, fontSize: scope.compactControls ? 17 : 19 });
  expect(text.props).toMatchObject({ numberOfLines: 2, adjustsFontSizeToFit: true, minimumFontScale: 0.85, maxFontSizeMultiplier: 1.2 });
  expect(buttonStyle.height).toBeUndefined();
  expect(buttonStyle.minHeight).toBeGreaterThanOrEqual(64);
  expect(text.props.children).toEqual(['המשך להכנת המשחק הבא']);
  expect(rendered.props.accessibilityLabel).toBe('המשך להכנת המשחק הבא');
  rendered.props.onPress(); expect(onContinue).toHaveBeenCalledTimes(1);
});

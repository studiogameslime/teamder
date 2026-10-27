import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers';

const file = ts.createSourceFile('card.tsx', fs.readFileSync('src/components/profile/OwnPlayerCard.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function evaluate(node: ts.Node, context: any) {
  vm.runInNewContext(ts.transpileModule(`globalThis.run = ${node.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.run;
}
function find(predicate: (node: ts.Node) => boolean) {
  let result!: ts.Node;
  function visit(node: ts.Node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(file); if (!result) throw new Error('Source node missing'); return result;
}
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test.each([true, false])('personal card shares the resolved short link only while its account is current: %s', async stillCurrent => {
  const link = deferred();
  let active = true;
  const context: any = { preview: undefined, current: () => active, user: { id:'me' },
    sharingRef: { current:false }, setSharing:jest.fn(),
    createShortInviteUrl:jest.fn(() => link.promise), buildAppInviteUrl:jest.fn(() => 'long'),
    Share:{share:jest.fn()}, observeCaughtError:jest.fn(), toast:{error:jest.fn()} };
  const node = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'share') as ts.VariableDeclaration;
  const run = evaluate(node.initializer!, context);
  const pending = run('invite');
  await run('invite');
  expect(context.createShortInviteUrl).toHaveBeenCalledTimes(1);
  expect(context.createShortInviteUrl).toHaveBeenCalledWith({type:'app',invitedBy:'me',fallbackLong:'long'});
  expect(context.Share.share).not.toHaveBeenCalled();
  active = stillCurrent;
  link.resolve('https://teamder.co.il/i/Ab123xy'); await pending;
  if (stillCurrent) expect(context.Share.share).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('https://teamder.co.il/i/Ab123xy')}));
  else expect(context.Share.share).not.toHaveBeenCalled();
  expect(context.sharingRef.current).toBe(false);
});

function fixture() {
  const data = deferred(), clubs = deferred(), referrals = deferred(), stats = deferred();
  const owner = { id: 'me' };
  const context: any = { preview: undefined, user: { id: 'me' }, generation: { current: 0 },
    useUserStore: { getState: () => ({ currentUser: owner }) }, observeCaughtError: jest.fn(),
    ownPlayerCardService: { load: jest.fn(() => data.promise), lastStats: jest.fn(() => stats.promise) },
    groupService: { listForUser: jest.fn(() => clubs.promise) }, userService: { getInvitedUsersCount: jest.fn(() => referrals.promise) } };
  for (const name of ['setData', 'setClubs', 'setReferrals', 'setLastStats']) context[name] = jest.fn();
  const call = find(n => ts.isCallExpression(n) && n.expression.getText(file) === 'useFocusEffect') as ts.CallExpression;
  const callback = (call.arguments[0] as ts.CallExpression).arguments[0];
  return { context, data, clubs, referrals, stats, owner, start: () => evaluate(callback, context)() };
}

test('sections load independently and last-round stats cannot block the main profile', async () => {
  const f = fixture(); f.start();
  f.clubs.resolve([{ id: 'club' }]); f.referrals.resolve(0); await flush();
  expect(f.context.setClubs).toHaveBeenLastCalledWith({ value: [{ id: 'club' }] });
  expect(f.context.setReferrals).toHaveBeenLastCalledWith({ value: 0 });
  f.data.resolve({ last: { id: 'full-id' }, attendedCount: 75 }); await flush();
  expect(f.context.setData).toHaveBeenLastCalledWith({ value: { last: { id: 'full-id' }, attendedCount: 75 } });
  expect(f.context.ownPlayerCardService.lastStats).toHaveBeenCalledWith('me', 'full-id');
  f.stats.reject(new Error('offline')); await flush();
  expect(f.context.setLastStats).toHaveBeenLastCalledWith({ failed: true });
});

test.each(['blur', 'new request', 'account'])('old profile responses are discarded after %s', async change => {
  const f = fixture(), stop = f.start();
  if (change === 'blur') stop();
  if (change === 'new request') f.context.generation.current++;
  if (change === 'account') f.owner.id = 'someone-else';
  f.data.resolve({ last: { id: 'old' } }); f.clubs.resolve([]); f.referrals.resolve(99); await flush();
  for (const name of ['setData', 'setClubs', 'setReferrals']) expect(f.context[name]).toHaveBeenCalledTimes(1);
  expect(f.context.ownPlayerCardService.lastStats).not.toHaveBeenCalled();
});

test('failed primary data never becomes a zero-history success', async () => {
  const f = fixture(); f.start(); f.data.reject(new Error('offline')); await flush();
  expect(f.context.setData).toHaveBeenLastCalledWith({ failed: true });
});

test.each(['ProfileEdit', 'SocialPrivacy', 'Referrals'])('%s opens across every hosting tab without an unregistered local navigation', screen => {
  const node = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'go') as ts.VariableDeclaration;
  const navigate = jest.fn();
  const go = evaluate(node.initializer!, { preview: undefined, nav: { navigate, getState: () => ({ routeNames: ['PlayerCard', 'Statistics', 'MatchDetails', 'EveningSummary'] }) } });
  go(screen);
  expect(navigate).toHaveBeenCalledWith('ProfileTab', { screen, params: undefined, initial: false });
});

test.each(['ProfileStack', 'CommunitiesStack', 'GameStack', 'ChatStack'])('cabinet back restores the originating card in %s, even after an earlier cabinet visit', host => {
  const stack = fs.readFileSync(`src/navigation/${host}.tsx`, 'utf8');
  expect(stack).toMatch(/name="Achievements"\s+component=\{AchievementsScreen\}/);
  const routeNames = [...stack.matchAll(/<Stack\.Screen\b[\s\S]*?\bname="([^"]+)"/g)].map(match => match[1]);
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  const node = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'go') as ts.VariableDeclaration;
  for (const visitedBefore of [false, true]) {
    const router = StackRouter({ initialRouteName: visitedBefore ? 'Achievements' : 'PlayerCard' });
    let state: any = router.getInitialState(options);
    if (visitedBefore) state = router.getStateForAction(state, StackActions.push('PlayerCard', { userId: 'owner' }), options)!;
    const origin = state.routes[state.index];
    const push = jest.fn((name, params) => {
      state = router.getStateForAction(state, StackActions.push(name, params), options)!;
    });
    const navigate = jest.fn();
    evaluate(node.initializer!, { preview: undefined, nav: { push, navigate, getState: () => state } })('Achievements');
    expect(state.routes[state.index].name).toBe('Achievements');
    expect(navigate).not.toHaveBeenCalled();
    state = router.getStateForAction(state, CommonActions.goBack(), options)!;
    expect(state.routes[state.index]).toEqual(origin);
    expect(state.routes[state.index].name).toBe('PlayerCard');
  }
});

test('last-round summary opens that round in the statistics tab across every player-card host', () => {
  const link = find(n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(file) === 'Link' &&
    n.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(file) === 'title' &&
      a.initializer?.getText(file) === '"לסיכום המחזור שלי"')) as ts.JsxSelfClosingElement;
  const press = link.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(file) === 'onPress') as ts.JsxAttribute;
  const goNode = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'go') as ts.VariableDeclaration;
  for (const host of ['ProfileStack', 'CommunitiesStack', 'GameStack', 'ChatStack']) {
    const stack = fs.readFileSync(`src/navigation/${host}.tsx`, 'utf8');
    expect(stack).toMatch(/name="MatchDetails"\s+component=\{MatchDetailsScreen\}/);
    const navigate = jest.fn();
    const go = evaluate(goNode.initializer!, { preview: undefined, nav: { navigate } });
    evaluate((press.initializer as ts.JsxExpression).expression!, { go, last: { id: 'last-round-full-id' } })();
    expect(navigate).toHaveBeenCalledWith('MatchDetails', { gameId: 'last-round-full-id', initialTab: 'stats' });
  }
});

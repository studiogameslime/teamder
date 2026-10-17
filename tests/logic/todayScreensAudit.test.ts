import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function handler(file: string, name: string, context: any) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = '';
  function walk(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name) {
      const init = n.initializer!;
      body = (ts.isCallExpression(init) && init.expression.getText(source) === 'useCallback' ? init.arguments[0] : init).getText(source);
    }
    ts.forEachChild(n, walk);
  }
  walk(source);
  if (!body) throw Error(`Missing ${name}`);
  return vm.runInNewContext(ts.transpileModule(`(${body})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const emailFile = 'src/screens/auth/EmailAuthScreen.tsx';
const clubFile = 'src/screens/communities/CommunityDetailsPublicScreen.tsx';
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('password reset shares the auth lock, sends one trimmed address and unlocks after failure', async () => {
  const request = deferred();
  const c = { inFlight: {current: false}, emailOk: true, email: ' test@example.com ',
    setBusy: jest.fn(), setResetting: jest.fn(), sendPasswordReset: jest.fn(() => request.promise),
    appAlert: jest.fn(), logEvent: jest.fn(), AnalyticsEvent: {}, he: { emailAuthResetSentBody: (s: string) => s } };
  const reset = handler(emailFile, 'onForgotPassword', c);
  const first = reset(); await reset();
  expect(c.sendPasswordReset).toHaveBeenCalledTimes(1);
  expect(c.sendPasswordReset).toHaveBeenCalledWith('test@example.com');
  expect(c.inFlight.current).toBe(true);
  request.resolve(undefined); await first;
  expect(c.inFlight.current).toBe(false);
  c.sendPasswordReset.mockImplementation(() => Promise.reject({code:'auth/network-request-failed'}));
  await reset();
  expect(c.inFlight.current).toBe(false);
  expect(c.setBusy).toHaveBeenLastCalledWith(false);
  expect(c.setResetting).toHaveBeenLastCalledWith(false);
});

test('late club response cannot overwrite the newly opened club or release its loading state', async () => {
  const old = deferred(); const fresh = deferred();
  const c = { loadGeneration: {current: 0}, groupId: 'old',
    setLoadFailed: jest.fn(), setLoading: jest.fn(), setGroup: jest.fn(), setUpcomingGames: jest.fn(),
    groupService: {getPublic: jest.fn((id:string) => id === 'old' ? old.promise : fresh.promise)},
    gameService: {getUpcomingPublicGamesForGroup: jest.fn().mockResolvedValue([])}, logError: jest.fn(), __DEV__: false };
  const first = handler(clubFile, 'reload', c)();
  const nextContext = {...c, groupId:'new'};
  const second = handler(clubFile, 'reload', nextContext)();
  old.resolve({id:'old'}); await first;
  expect(c.setGroup).not.toHaveBeenCalled();
  expect(c.setLoading).not.toHaveBeenCalledWith(false);
  fresh.resolve({id:'new'}); await second;
  expect(c.setGroup).toHaveBeenCalledWith({id:'new'});
  expect(c.setLoading).toHaveBeenLastCalledWith(false);
});

test('leaving club screen invalidates a pending response', async () => {
  const request=deferred();
  const c={loadGeneration:{current:0},groupId:'g',setLoadFailed:jest.fn(),setLoading:jest.fn(),setGroup:jest.fn(),setUpcomingGames:jest.fn(),groupService:{getPublic:()=>request.promise},gameService:{getUpcomingPublicGamesForGroup:async()=>[]},logError:jest.fn(),__DEV__:false};
  const pending=handler(clubFile,'reload',c)(); c.loadGeneration.current++;
  request.resolve({id:'g'}); await pending;
  expect(c.setGroup).not.toHaveBeenCalled();
  expect(c.setLoading).not.toHaveBeenCalledWith(false);
});

test('club load failure exposes retry and a successful retry clears the failure', async () => {
  const c={loadGeneration:{current:0},groupId:'g',setLoadFailed:jest.fn(),setLoading:jest.fn(),setGroup:jest.fn(),setUpcomingGames:jest.fn(),groupService:{getPublic:jest.fn().mockRejectedValue(Error('offline'))},gameService:{getUpcomingPublicGamesForGroup:async()=>[]},logError:jest.fn(),__DEV__:false};
  const reload=handler(clubFile,'reload',c);
  await reload();
  expect(c.setLoadFailed).toHaveBeenLastCalledWith(true);
  expect(c.setLoading).toHaveBeenLastCalledWith(false);
  c.groupService.getPublic.mockResolvedValue({id:'g'});
  await reload();
  expect(c.setLoadFailed).toHaveBeenLastCalledWith(false);
  expect(c.setGroup).toHaveBeenCalledWith({id:'g'});
});

test('rapid join presses send one request and cannot race cancellation', async () => {
  const request=deferred();
  const c={joinInFlight:{current:false},isGuest:false,me:{id:'u'},isPending:false,fromInvitation:false,group:{id:'g'},setBusyJoin:jest.fn(),requestJoinById:jest.fn(()=>request.promise),cancelJoinById:jest.fn(),useUserStore:{getState:()=>({currentUser:{id:'u'}})},logEvent:jest.fn(),AnalyticsEvent:{},toast:{info:jest.fn()},he:{},openMemberView:jest.fn()};
  const join=handler(clubFile,'handleJoin',c);
  const first=join(); await join(); await handler(clubFile,'handleCancelRequest',c)();
  expect(c.requestJoinById).toHaveBeenCalledTimes(1);expect(c.cancelJoinById).not.toHaveBeenCalled();
  request.resolve('already_member');await first;
  expect(c.openMemberView).toHaveBeenCalledTimes(1);expect(c.joinInFlight.current).toBe(false);
});

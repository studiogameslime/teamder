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

const file = 'src/screens/games/AvailablePlayersScreen.tsx';
function context() {
  return { game: {id:'round'}, me:{id:'manager'}, preview:false, inviteLock:{current:false}, invitedIds:new Set<string>(),
    setInvitingId:jest.fn(), setInvitedIds:jest.fn(), notificationsService:{inviteToGame:jest.fn()},
    logEvent:jest.fn(), AnalyticsEvent:{AvailablePlayerInvited:'invite'}, logError:jest.fn(),
    toast:{success:jest.fn(),error:jest.fn()}, he:{playerCardInviteSentToast:'נשלחה אל {name}',inviteNotAllowed:'אין הרשאה'} };
}
test('available player invite locks immediately and only marks sent after success',async()=>{
  let resolve!:()=>void;
  const c=context(); c.notificationsService.inviteToGame.mockReturnValue(new Promise<void>(r=>{resolve=r;}));
  const invite=handler(file,'invite',c), player={id:'target',name:'דני'};
  const first=invite(player); await invite(player);
  expect(c.notificationsService.inviteToGame).toHaveBeenCalledTimes(1);
  expect(c.setInvitedIds).not.toHaveBeenCalled();
  resolve(); await first;
  expect([...c.setInvitedIds.mock.calls[0][0](new Set())]).toEqual(['target']);
  expect(c.inviteLock.current).toBe(false);
});
test('failed invite remains retryable and already invited player is not resent',async()=>{
  const c=context(); c.notificationsService.inviteToGame.mockRejectedValue({code:'permission-denied'});
  const invite=handler(file,'invite',c), player={id:'target',name:'דני'};
  await invite(player); expect(c.setInvitedIds).not.toHaveBeenCalled();expect(c.inviteLock.current).toBe(false);
  expect(c.toast.error).toHaveBeenCalledWith('אין הרשאה');
  c.invitedIds.add('target');await invite(player);expect(c.notificationsService.inviteToGame).toHaveBeenCalledTimes(1);
});
test('QA preview invitation never calls the notification service or analytics',async()=>{
  const c=context();c.preview=true;
  await handler(file,'invite',c)({id:'target',name:'דני'});
  expect(c.notificationsService.inviteToGame).not.toHaveBeenCalled();expect(c.logEvent).not.toHaveBeenCalled();
  expect(c.setInvitedIds).toHaveBeenCalledTimes(1);
});

import path from 'path';
import { transformFileSync, transformSync } from '@babel/core';
import { describeControl, inheritControl, trackControl } from '@/services/controlActivity';
import { attachProductCollector, captureProductActor, recordProductAction } from '@/services/productActor';

const mockLog = jest.fn(async () => {});
jest.mock('@react-native-firebase/analytics', () => ({ __esModule:true, default:() => ({ logEvent:mockLog }) }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA:false }));
beforeEach(() => mockLog.mockClear());

test('forwarding a gesture across components counts the caller once and never sends entered data', () => {
  const callback = jest.fn(function (this: unknown, _text: string) { return this; });
  const caller = trackControl('ui_caller','submit',callback);
  const forward = trackControl('ui_button','press',(value:string) => caller.call('expected',value));
  expect(forward('private text')).toBe('expected');
  expect(callback).toHaveBeenCalledWith('private text');
  expect(mockLog.mock.calls).toEqual([['teamder_ui_action',{content_id:'ui_caller',content_type:'submit'}]]);
  expect(trackControl('ui_caller','submit',callback)).toBe(caller);
  expect(trackControl('ui_disabled','press',undefined)).toBeUndefined();
});
test('two separate presses are counted even when the first callback throws', () => {
  const action = trackControl('ui_press','press',() => { throw Error('action failed'); });
  expect(action).toThrow('action failed');
  expect(action).toThrow('action failed');
  expect(mockLog).toHaveBeenCalledTimes(2);
});
test('a deferred menu choice keeps the option ID and counts once; programmatic callbacks are quiet', async () => {
  const callback = jest.fn();
  const option = describeControl('edit_profile','press',callback);
  const other = describeControl('show_history','press',callback);
  const row = (chosen: () => void) => trackControl('menu_row','press',inheritControl(chosen,async () => {
    await Promise.resolve();
    chosen();
  }));
  await row(option)();
  await row(other)();
  other();
  expect(callback).toHaveBeenCalledTimes(3);
  expect(mockLog.mock.calls).toEqual(['edit_profile','show_history'].map(content_id=>['teamder_ui_action',{content_id,content_type:'press'}]));
});
test('a completion and a tap started under the previous account do not enter the new account history', () => {
  let current = 'first';
  const record = jest.fn();
  const detach = attachProductCollector({actor:() => current,record});
  try {
    const first = captureProductActor();
    trackControl('ui_signout','press',()=>{current='second';})();
    recordProductAction('live_goal_recorded',first);
    expect(record).not.toHaveBeenCalled();
    recordProductAction('player_comparison_viewed',captureProductActor());
    expect(record.mock.calls).toEqual([['player_comparison_viewed','second']]);
  } finally { detach(); }
});
test('the production Expo transform binds the helper in every branch of the support overlay', () => {
  const caller = { name:'metro', platform:'android' };
  const result = transformFileSync(path.resolve('src/components/support/SupportChatHost.tsx'),{
    caller,envName:'production',ast:true,
  });
  expect(result?.code).toContain('ui_');
  const missing: string[] = [];
  require('@babel/traverse').default(result!.ast,{ReferencedIdentifier(p:any) {
    if (/^_(trackControl|controlActivity)\d*$/.test(p.node.name) && !p.scope.hasBinding(p.node.name)) missing.push(p.node.name);
  }});
  expect(missing).toEqual([]);
});
test('bundler instruments caller, switch, confirmation dialog and submit, not typing; IDs survive line movement', () => {
  const code = `function Example(){ appAlert('x','y',[{text:'כן',onPress:confirm}]); return <View><Button onPress={busy ? undefined : go}/><Switch onValueChange={toggle}/><TextInput onChangeText={setPassword} onSubmitEditing={submit}/></View> }`;
  function compile(source: string) {
    return transformSync(source,{filename:path.resolve('src/screens/Example.tsx'),configFile:false,babelrc:false,
      parserOpts:{plugins:['typescript','jsx']},plugins:[require('../../scripts/analytics/control-plugin.cjs')]})!.code!;
  }
  const transformed = compile(code), ids = (s:string) => s.match(/ui_[a-f0-9]{18}/g);
  expect(ids(transformed)).toHaveLength(4);
  expect(ids(compile('\n\n'+code))).toEqual(ids(transformed));
  expect(transformed).toContain('onChangeText={setPassword}');
  expect(transformed).toContain('../services/controlActivity');
});

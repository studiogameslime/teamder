import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

function callback(nav: any) {
  const source = ts.createSourceFile('screen.tsx', fs.readFileSync('src/screens/games/MatchDetailsScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = '';
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === 'goBackSafe' && n.initializer && ts.isCallExpression(n.initializer)) body = n.initializer.arguments[0].getText(source);
    ts.forEachChild(n, visit);
  }
  visit(source);
  return vm.runInNewContext(ts.transpileModule(`(${body})`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{nav}) as ()=>void;
}

test.each(['GameStack','CommunitiesStack','ProfileStack','ChatStack'])('no-history fallback is registered in %s', stack => {
  const source=fs.readFileSync(`src/navigation/${stack}.tsx`,'utf8');
  const routeNames=[...source.matchAll(/<Stack.Screen\s+name="([^"]+)"/g)].map(m=>m[1]);
  const nav={canGoBack:()=>false,getParent:()=>undefined,getState:()=>({routeNames}),navigate:jest.fn()};
  callback(nav)();
  expect(nav.navigate).toHaveBeenCalledTimes(1);
  expect(routeNames).toContain(nav.navigate.mock.calls[0][0]);
  expect(nav.navigate.mock.calls[0][0]).not.toBe('MatchDetails');
});

test('existing local history takes priority over a fallback',()=>{
  const nav={canGoBack:()=>true,goBack:jest.fn(),navigate:jest.fn()};callback(nav)();
  expect(nav.goBack).toHaveBeenCalledTimes(1);expect(nav.navigate).not.toHaveBeenCalled();
});
test('parent history remains preferred when local history is absent',()=>{
  const parent={canGoBack:()=>true,goBack:jest.fn()};
  const nav={canGoBack:()=>false,getParent:()=>parent,navigate:jest.fn()};callback(nav)();
  expect(parent.goBack).toHaveBeenCalledTimes(1);expect(nav.navigate).not.toHaveBeenCalled();
});

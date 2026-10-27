import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { roundCommitKey } from '../../src/services/rotationEngine';

test('real deserializer preserves the durable command key without inventing one', () => {
  const source=fs.readFileSync('src/firebase/firestore.ts','utf8');
  const ast=ts.createSourceFile('firestore.ts',source,ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='readLiveMatch')!;
  const body=fn.getText(ast).replace(/^export\s+/,'');
  const constants=ast.statements.filter(ts.isVariableStatement).filter(node=>node.declarationList.declarations.some(d=>['VALID_PHASES','VALID_ZONES'].includes(d.name.getText(ast)))).map(node=>node.getText(ast)).join('\n');
  const read=vm.runInNewContext(ts.transpileModule(`${constants}\n(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{});
  expect(read({phase:'live',lastWidgetCommandId:'a-command'}).lastWidgetCommandId).toBe('a-command');
  expect(read({phase:'live'}).lastWidgetCommandId).toBeUndefined();
});

test.each([{roundInstanceId:'stable',round:4,updatedAt:12},{round:4,updatedAt:12},{round:1}])('native fallback identity matches the phone contract: %j', rotation=>{
  const nativeKey=rotation.roundInstanceId??`${rotation.round??'r'}:${rotation.updatedAt??0}`;
  expect(roundCommitKey(rotation)).toBe(nativeKey);
});

import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
function submitFixture(dirty:boolean) {
  const text=fs.readFileSync('src/screens/communities/CommunityEditScreen.tsx','utf8');
  const source=ts.createSourceFile('screen.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration:ts.VariableDeclaration|undefined;
  const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='submit')declaration=n;ts.forEachChild(n,visit);};visit(source);
  if(!declaration)throw Error('Missing submit handler');
  const code=ts.transpileModule('const '+declaration.getText(source)+'; globalThis.submit=submit;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const update=jest.fn().mockResolvedValue(undefined),alert=jest.fn(),replace=jest.fn();
  const context:any={seasonsDirty:dirty,appAlert:alert,groupService:{updateGroupMetadata:update},original:{id:'club'},me:{id:'owner'},logEvent:jest.fn(),AnalyticsEvent:{},reloadGroups:jest.fn().mockResolvedValue(undefined),nav:{replace},observeCaughtError:jest.fn()};
  vm.runInNewContext(code,context);
  return {submit:context.submit,update,alert,replace};
}
const form={name:'מועדון',description:'',rules:'',city:'',contactPhone:'',isOpen:true,internalRating:false,hideInternalRating:false,cardsEnabled:false,yellowCardValidityDays:'',redCardValidityDays:''};
test('dirty season settings block the real metadata submit before any write or navigation',async()=>{
  const f=submitFixture(true);await f.submit(form);
  expect(f.update).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();
  expect(f.alert.mock.calls[0][1]).toContain('שמור הגדרות עונה');
  expect(f.alert.mock.calls[0][3]).toMatchObject({football:true,tone:'warning'});
});
test('unchanged or separately saved season settings allow the real metadata submit',async()=>{
  const f=submitFixture(false);await f.submit(form);
  expect(f.update).toHaveBeenCalledTimes(1);expect(f.replace).toHaveBeenCalledWith('CommunityDetails',{groupId:'club'});
});

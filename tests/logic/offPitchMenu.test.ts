import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { he } from '@/i18n/he';

const file=ts.createSourceFile('rotation.tsx',fs.readFileSync('src/components/match/RotationPanel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function evaluate(source:string,context:object){return vm.runInNewContext(ts.transpileModule(`(${source})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);}
let menuSource='';const handlers:string[]=[];
function walk(node:ts.Node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='menuItems')menuSource=node.initializer!.getText(file);
 if(ts.isJsxAttribute(node)&&node.name.getText(file)==='onOffPitchPlayerPress')handlers.push(((node.initializer as ts.JsxExpression).expression!).getText(file));
 ts.forEachChild(node,walk);
}walk(file);

test('both team columns open the same anchored off-pitch menu without navigating immediately',()=>{
 const openMenu=jest.fn(),onPlayerCard=jest.fn(),player={id:'off',name:'שחקן מחוץ למגרש'},anchor={x:240,y:400,width:80,height:60};
 expect(handlers).toHaveLength(2);
 handlers.forEach(source=>evaluate(source,{openMenu,onPlayerCard,isAdmin:true,isRegistered:()=>true})(player,anchor));
 expect(openMenu.mock.calls).toEqual([[player,anchor,'offPitch'],[player,anchor,'offPitch']]);
 expect(onPlayerCard).not.toHaveBeenCalled();
});

test.each([true,false])('off-pitch menu preserves profile/departure actions and excludes swaps; can mark home %s',canMarkHome=>{
 const onPlayerCard=jest.fn(),onPlayerWentHome=jest.fn();
 const items=evaluate(menuSource,{menu:{kind:'offPitch',player:{id:'off',name:'שחקן'}},isRegistered:()=>true,
   isAdmin:true,canMarkHome,onPlayerCard,onPlayerWentHome,onSwapPlayers:jest.fn(),he,colors:{primary:'blue',danger:'red'}});
 expect(items.map((item:any)=>item.key)).toEqual(['card','home']);
 expect(items[1].disabled).toBe(!canMarkHome);
 items[0].onPress();expect(onPlayerCard).toHaveBeenCalledWith('off');
 expect(onPlayerWentHome).not.toHaveBeenCalled();
});

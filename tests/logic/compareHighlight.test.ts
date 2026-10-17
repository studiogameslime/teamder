import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const files=['src/screens/players/PlayerCompareScreen.tsx','src/components/compare/PlayerCompareCard.tsx'];
function highlights(file:string,row:object){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CompareBar')!;
 const style=new Proxy({},{get:(_,key)=>key});
 const context:any={module:{exports:{}},React:{createElement:(type:any,props:any,...children:any[])=>({type,props,children}),Fragment:'fragment'},View:'view',Text:'text',styles:style,s:style,RED_SOFT:'red',BLUE:'blue',fmt:(x:any)=>x};
 vm.runInNewContext(ts.transpileModule('module.exports='+fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,context);
 const nodes:any[]=[];const walk=(n:any)=>{if(!n||typeof n!=='object')return;nodes.push(n);n.children?.flat(Infinity).forEach(walk);};walk(context.module.exports({row}));
 return {a:nodes.some(n=>n.type==='text'&&n.props.style?.includes('cmpValueA')&&n.props.style.includes('cmpWin')),b:nodes.some(n=>n.type==='text'&&n.props.style?.includes('cmpValueB')&&n.props.style.includes('cmpWin'))};
}
describe.each(files)('%s',file=>{
 test.each([
  [{key:'losses',a:25,b:28,winner:'a'},{a:true,b:false}],
  [{key:'losses',a:28,b:25,winner:'b'},{a:false,b:true}],
  [{key:'losses',a:0,b:3,winner:'a'},{a:true,b:false}],
  [{key:'goals',a:3,b:7,winner:'b'},{a:false,b:true}],
  [{key:'losses',a:25,b:25,winner:'tie'},{a:false,b:false}],
  [{key:'losses',a:null,b:25,winner:'tie'},{a:false,b:false}],
  [{key:'losses',a:25,b:28,winner:'a',unscored:true},{a:false,b:false}],
 ])('renders service verdict without inferring that larger is better: %j',(row,expected)=>expect(highlights(file,row)).toEqual(expected));
});

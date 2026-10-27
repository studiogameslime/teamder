import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';
const source=fs.readFileSync('src/screens/communities/CommunityStatsScreen.tsx','utf8');
const tree=ts.createSourceFile('club.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let component='',rows='';
function visit(n:ts.Node){
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='FunDonutRow')component=n.getText(tree);
 if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='rows'&&n.initializer?.getText(tree).includes("key: 'inPlayPenalties'"))rows=n.initializer!.getText(tree);
 ts.forEachChild(n,visit);
}visit(tree);
const text=(n:any):string=>n==null||typeof n==='boolean'?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const he={funRateUnknown:'האחוז יחושב כשייאסף מדגם מלא',funScorelessCount:(v:number)=>`${v} משחקים`,funAssistedGoals:'בישולים',funScoreless:'ללא שערים',funPenaltyRate:'הבקעות'};
test.each([undefined,0,6])('club count %s is visible only for a recorded positive count',count=>{
 const value=vm.runInNewContext(compile(`(${rows})`),{derived:{inPlayPenalties:count??0,totalGoals:0,totalAssists:0,countedRounds:0,scorelessRounds:0,penTakenTotal:0},sampled:false,clubAccent:{blue:'blue',green:'green',purple:'purple'},he});
 expect(value.some((r:any)=>r.key==='inPlayPenalties')).toBe((count??0)>0);
});
test('a standalone club count shows a count and label once, without a promised percentage',()=>{
 const render=vm.runInNewContext(compile(`${component};FunDonutRow;`),{React,View:'View',Text:'Text',FootballStatGlyph:'Glyph',styles:new Proxy({},{get:()=>({})}),he});
 const rendered=render({pct:null,count:6,countText:()=> 'פנדלים במהלך משחק',text:'פנדלים במהלך משחק',standaloneCount:true,icon:'penalty',tint:'blue'});
 expect(text(rendered)).toBe('6פנדלים במהלך משחק');expect(text(rendered)).not.toContain(he.funRateUnknown);
});

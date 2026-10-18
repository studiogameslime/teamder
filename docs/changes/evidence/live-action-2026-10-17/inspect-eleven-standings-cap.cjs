// Local-only: actual product readers/expressions with captured documents.
const fs = require('fs'), ts = require('typescript'), vm = require('vm'), crypto = require('crypto');
async function main() {
 const doc = JSON.parse(fs.readFileSync('tmp/live-action-production/data-eleven-sealed-proof.json','utf8'));
 const row=doc.games.find(r=>r.game.format==='11v11'),game=row.game;
 const names={[doc.account.id]:doc.account.name,...Object.fromEntries(game.guests.map(g=>['guest:'+g.id,g.name]))};
 const ast=file=>ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function core(file,requireLocal=()=>{throw Error('Unexpected import')}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:module.exports,module,require:requireLocal});
  return module.exports;
 }
 const championship=core('src/utils/championship.ts'),scores=core('src/utils/eveningScoreColumn.ts',()=>championship);
 const tab=ast('src/components/match/tabs/MatchStatsTab.tsx');let attendeeExpr;
 function findTab(n) {if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(tab)==='GameChampionship')attendeeExpr=n.attributes.properties.find(a=>a.name?.getText(tab)==='attendedUids').initializer.expression.getText(tab);ts.forEachChild(n,findTab)}findTab(tab);
 const ctx={module:{exports:{}},game};
 vm.runInNewContext(ts.transpileModule('module.exports='+attendeeExpr,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 const attended=ctx.module.exports;
 const service=ast('src/services/gameService.ts');let method;
 function findMethod(n) {if(ts.isMethodDeclaration(n)&&n.name.getText(service)==='getGameChampionship')method=n.getText(service);ts.forEachChild(n,findMethod)}findMethod(service);
 const scope={module:{exports:{}},...championship,USE_MOCK_DATA:false,getFirebase:()=>({db:{}}),getDocs:async()=>({docs:row.playerStats.map(data=>({data:()=>data}))}),query:()=>{},collection:()=>{},where:()=>{},isGuestId:id=>id.startsWith('guest:'),logError:()=>{},__DEV__:false};
 vm.runInNewContext(ts.transpileModule('module.exports=({'+method+'}).getGameChampionship',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const players=(await scope.module.exports(game.id,attended)).players;
 const table=ast('src/components/community/CommunityStatsTable.tsx');
 const fn=table.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CommunityStatsTable');
 const cap=Number(fn.parameters[0].name.elements.find(e=>e.name.getText(table)==='limit').initializer.getText(table));let sortCallback;
 function findRows(n) {if(ts.isVariableDeclaration(n)&&n.name.getText(table)==='rows')sortCallback=n.initializer.arguments[0].getText(table);ts.forEachChild(n,findRows)}findRows(table);
 const sortScope={module:{exports:{}},effPlayers:players,mode:'cumulative',sortKey:'eveningScore',eveningScores:{[doc.account.id]:row.finishProof.qaEveningStanding.score},limit:cap,...scores,...championship};
 vm.runInNewContext(ts.transpileModule('module.exports=('+sortCallback+')()',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,sortScope);
 const shown=sortScope.module.exports;
 const codeFiles=['src/services/gameService.ts','src/components/match/tabs/MatchStatsTab.tsx','src/components/match/GameChampionship.tsx','src/components/community/CommunityStatsTable.tsx','src/utils/championship.ts','src/utils/eveningScoreColumn.ts'];
 const output={gameId:game.id,source:'data-eleven-sealed-proof.json',generatedAtUtc:new Date().toISOString(),codeSources:codeFiles.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),actualServiceRows:players.length,actualAttendeeExpressionCount:attended.length,storedStats:row.playerStats.length,defaultDisplayLimit:cap,shownCount:shown.length,hidden:players.filter(r=>!shown.some(s=>s.uid===r.uid)).map(r=>({id:r.uid,name:names[r.uid],rounds:r.rounds})),zeroRow:shown.map((r,i)=>({rank:i+1,...r,name:names[r.uid]})).filter(r=>r.rounds===0)};
 fs.writeFileSync('tmp/live-action-production/eleven-standings-cap-read-proof.json',JSON.stringify(output,null,2)+'\n');
 process.stdout.write(JSON.stringify(output,null,2));
}
main().catch(error=>{process.stderr.write(String(error.stack||error));process.exitCode=1});

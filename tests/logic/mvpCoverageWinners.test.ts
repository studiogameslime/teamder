import fs from 'fs';
import ts from 'typescript';
import { readSeasonCoverage } from '@/utils/seasonCoverage';
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
function writer(counts:number[]) {
  const source=fs.readFileSync('functions/src/seasonRollover.ts','utf8');
  const start=source.indexOf('  const mvpCoverage ='),end=source.indexOf('\n  /**',start);
  const players=Object.fromEntries(counts.map((c,i)=>[String(i),{eveningScoreCount:c}]));
  const awards={mvp:{winners:Object.keys(players),value:8}};
  return new Function('awards','players','args','num',compile(source.slice(start,end))+'\nreturn {coverage:mvpCoverage,coverageByWinner:mvpCoverageByWinner};')(awards,players,{completedRounds:10},(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0);
}
test('tied scores do not give a smaller sample the largest shared coverage',()=>{
  const award=writer([3,8]);expect(award.coverage).toBeUndefined();
  expect(readSeasonCoverage(award,'0')).toEqual({rated:3,of:10});
  expect(readSeasonCoverage(award,'1')).toEqual({rated:8,of:10});
  expect(readSeasonCoverage(award)).toBeUndefined();
});
test('equal partial samples still support an honest shared note',()=>{
  const award=writer([3,3]);expect(readSeasonCoverage(award)).toEqual({rated:3,of:10});
});
test('full coverage omits the personal caveat and unknown/invalid rows claim nothing',()=>{
  const award=writer([3,10]);expect(readSeasonCoverage(award,'1')).toBeUndefined();
  expect(readSeasonCoverage({...award,coverage:{rated:8,of:10}},'missing')).toBeUndefined();
  expect(readSeasonCoverage(writer([0,NaN]),'0')).toBeUndefined();
  expect(readSeasonCoverage({coverage:{rated:8,of:10},coverageByWinner:'invalid'},'0')).toBeUndefined();
  expect(readSeasonCoverage({coverage:{rated:8,of:10}},'legacy')).toEqual({rated:8,of:10});
});
test('personal title reader selects the holder-specific sample',()=>{
  const source=ts.createSourceFile('summary.ts',fs.readFileSync('src/services/seasonSummaryService.ts','utf8'),ts.ScriptTarget.Latest,true);
  const node=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='titlesFor')!;
  const read=new Function('SEASON_TITLE_KEYS','num','readSeasonCoverage',compile(node.getText(source))+'\nreturn titlesFor;')(['mvp'],Number,readSeasonCoverage);
  const data=writer([3,8]);const awards={mvp:{winners:['0','1'],value:8,...data}};
  expect(read(awards,'0')[0].coverage).toEqual({rated:3,of:10});expect(read(awards,'1')[0].coverage).toEqual({rated:8,of:10});
});
test('resuming a close uses only frozen coverage, never the half-wiped live sample',()=>{
  const source=ts.createSourceFile('rollover.ts',fs.readFileSync('functions/src/seasonRollover.ts','utf8'),ts.ScriptTarget.Latest,true);
  let argument:ts.Expression|undefined;
  function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='cardWinners.push')argument=node.arguments[0];ts.forEachChild(node,visit);}
  visit(source);expect(argument).toBeDefined();
  const card=new Function('key','award','resumedPlayers','players','resuming','resumedAwards','mvpCoverage',compile('return '+argument!.getText(source)));
  expect(card('mvp',{winners:['a'],value:8},{},{},true,{mvp:{coverageByWinner:{a:{rated:3,of:10}}}},{rated:2,of:10}).coverage).toBeUndefined();
  expect(card('mvp',{winners:['a'],value:8},{},{},true,{mvp:{coverage:{rated:3,of:10}}},{rated:2,of:10}).coverage).toEqual({rated:3,of:10});
});

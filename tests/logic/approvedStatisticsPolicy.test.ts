import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { isCalendarDate } from '@/utils/seasonDates';
import { isSeasonReactivation, planActivation } from '@/utils/seasonActivation';
import { buildScopeOptions, hasArchivedStats } from '@/utils/statsScope';
import { mergeAllTime } from '@/utils/allTimeTable';
import { penaltyKing } from '@/utils/penaltyStats';
import { computeSeasonAwards } from '@/utils/seasonAwards';

test('a short disabled first season is reactivation, not a first activation',()=>{
  expect(isSeasonReactivation(undefined)).toBe(false);
  expect(isSeasonReactivation({count:0})).toBe(false);
  expect(isSeasonReactivation({count:0,disabledAt:123})).toBe(true);
  expect(planActivation({cadence:'rounds',choice:'continue',playedHistory:0,targetRounds:2,today:'2026-10-13',hasHistory:true})).toMatchObject({ok:true,startsAtRounds:0,roundsRemaining:2});
});

test('the actual Firestore converter preserves noncompetitive history before season one closes',()=>{
  const source=ts.createSourceFile('f.ts',fs.readFileSync('src/firebase/firestore.ts','utf8'),ts.ScriptTarget.Latest,true);
  const fn=source.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='readGroupSeasons')!;
  const ctx:any={exports:{},isCalendarDate};
  vm.runInNewContext(ts.transpileModule(fn.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
  const seasons=ctx.exports.readGroupSeasons({currentId:'s1',currentNo:1,enabled:true,count:0,disabledAt:123,hasArchivedPeriods:true,cadence:{type:'rounds',targetRounds:2}});
  expect(seasons.hasArchivedPeriods).toBe(true);expect(hasArchivedStats(seasons)).toBe(true);
  const choices=buildScopeOptions(seasons,[{seasonId:'off_0_123',no:0,nonSeason:true}],{k:'all'});
  expect(choices.map(x=>x.key)).toEqual(['current','all']);
  const base={totalGoals:0,totalRounds:0,tiedRounds:0,shootoutRounds:0,scorelessRounds:0,countedRounds:0,guestGoals:0,ownGoals:0,players:[]};
  expect(mergeAllTime([base,{...base,totalGoals:13}]).totalGoals).toBe(13);
});

test('actual round writer separates credited goals from exact scores for members and guests',()=>{
  const source=fs.readFileSync('functions/src/index.ts','utf8');
  const scoring=source.slice(source.indexOf('    const creditedForSide ='),source.indexOf('    // Build the round-history doc',source.indexOf('    const creditedForSide =')));
  const realWriteStart=source.indexOf('      const onA = A.includes(uid);',source.indexOf('// Per-GAME rounds +'));
  const realWrite=source.slice(realWriteStart,source.indexOf('      // Lifetime tally',realWriteStart));
  const guestStart=source.indexOf('    const guestsOnA = fullA.filter');
  const guestWrite=source.slice(guestStart,source.indexOf('    // 1d) mini-games WON',guestStart));
  expect(scoring.length).toBeGreaterThan(300);expect(realWrite.length).toBeGreaterThan(100);expect(guestWrite.length).toBeGreaterThan(300);
  const records:any[]=[];
  const ctx:any={A:['a'],B:['b'],fullA:['a','guest:one'],fullB:['b'],uid:'a',clean:false,cleanA:false,cleanB:false,gameId:'g',now:1,winnerSide:'A',
    byScorer:{a:1},onField:new Set(['a','b']),isReal:(id:string)=>!id.startsWith('guest:'),
    cappedGoals:[{scorerId:'a',team:'A'},{scorerId:'guest:one',team:'A'},{scorerId:'b',team:'A',ownGoal:true}],
    gpsRef:(uid:string)=>uid,sb:{bump:(ref:string,_meta:unknown,delta:unknown)=>records.push({ref,delta})}};
  vm.runInNewContext(ts.transpileModule(scoring+'\n'+realWrite+'\n'+guestWrite,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
  expect(records.find(x=>x.ref==='a').delta).toMatchObject({teamGoalsFor:1,actualTeamGoalsFor:3,actualTeamGoalsAgainst:0,teamScoreRounds:1});
  expect(records.find(x=>x.ref==='guest:one').delta).toMatchObject({teamGoalsFor:1,actualTeamGoalsFor:3,actualTeamGoalsAgainst:0,teamScoreRounds:1});
});

test('club penalty excellence and season count titles intentionally keep their different winners',()=>{
  const rows=[{userId:'accurate',penScored:8,penTaken:10},{userId:'volume',penScored:10,penTaken:30}];
  expect(penaltyKing(rows)?.userId).toBe('accurate');
  const players=rows.map(p=>({uid:p.userId,games:10,rounds:20,goals:0,assists:0,wins:0,cleanSheets:0,mvpAvg:0,penTaken:p.penTaken,penScored:p.penScored,penFaced:0,penSaved:0}));
  expect(computeSeasonAwards(players,[],10).penaltyKing?.winners).toEqual(['volume']);
});

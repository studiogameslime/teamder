import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { rotationWriteSource } from '../../src/services/rotationWriteSource';

test.each(['balanced',undefined])('opening lineups keep their source snapshot valid and never start a timer before approval (%s)',async completionMode=>{
 const source=ts.createSourceFile('AdvancedLiveMatchScreen.tsx',fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body='';const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='onStartRound')body=node.initializer!.getText(source);ts.forEachChild(node,visit);};visit(source);
 const game:any={status:'open',players:['a','b'],draftTeams:{teams:[{index:0,playerIds:['a']},{index:1,playerIds:['b']}],completionMode},liveMatch:{timerRunning:false}};
 const baseline=rotationWriteSource(game),markGameStarted=jest.fn(async()=>{game.status='active';}),startTimer=jest.fn(async()=>{game.liveMatch.timerRunning=true;});
 const beginFillFlow=jest.fn((skeleton)=>{if(rotationWriteSource(game)!==skeleton.source)throw Error('source invalidated by own start');});
 const context:any={module:{exports:{}},gameId:'g',me:{id:'admin'},startingRef:{current:false},committingRef:{current:false},effectiveStartOrder:[],openingPlan:null,openingSource:baseline,
   gameService:{prepareStartRotation:async()=>({draft:game.draftTeams,skeleton:{source:baseline},baseTeams:[]}),markGameStarted,startTimer},beginFillFlow,logError:jest.fn(),toast:{error:jest.fn()},appAlert:jest.fn(),he:{},logEvent:jest.fn(),AnalyticsEvent:{},draftTeams:game.draftTeams,rotation:null,perTeam:1,__DEV__:false};
 vm.runInNewContext(ts.transpileModule('module.exports='+body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 await context.module.exports();expect(beginFillFlow).toHaveBeenCalledTimes(1);expect(context.logError).not.toHaveBeenCalled();expect(markGameStarted).not.toHaveBeenCalled();expect(startTimer).not.toHaveBeenCalled();expect(rotationWriteSource(game)).toBe(baseline);
});

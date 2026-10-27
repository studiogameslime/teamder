import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { isAttendedGame } from '@/utils/playedGames';

const file=ts.createSourceFile('achievementsService.ts',fs.readFileSync('src/services/achievementsService.ts','utf8'),ts.ScriptTarget.Latest,true);
const functions=file.statements.filter(s=>ts.isFunctionDeclaration(s)&&s.name&&['readAchievementSource','loadParticipatedGames'].includes(s.name.text));
const object=file.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).find(d=>d.name.getText(file)==='achievementsService')!.initializer as ts.ObjectLiteralExpression;
const derive=object.properties.find(p=>ts.isMethodDeclaration(p)&&p.name.getText(file)==='deriveCounters')!;
function deferred(){let resolve!:(value:any)=>void,reject!:(error:Error)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(){
 const reads=new Map<string,ReturnType<typeof deferred>>(),logError=jest.fn();
 const request=(key:string)=>{const r=deferred();reads.set(key,r);return r.promise;};
 const ctx:any={module:{exports:{}},Date,USE_MOCK_DATA:false,isAttendedGame,logError,observeCaughtError:jest.fn(),
  getDocs:(q:any)=>request(q.collection==='games'?'games':q.field),query:(collection:string,filter:any)=>({collection,...filter}),where:(field:string)=>({field}),
  col:{games:()=> 'games',pairStats:()=> 'pairs'},require:()=>({userService:{getInvitedUsersCount:()=>request('invites')}})};
 const code=functions.map(s=>s.getText(file)).join('\n')+`;module.exports={${derive.getText(file)}};`;
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 const resolve=(key:string,rows:any[]=[])=>reads.get(key)!.resolve({docs:rows.map(row=>({data:()=>row}))});
 return {service:ctx.module.exports,reads,resolve,logError};
}
const flush=()=>new Promise(setImmediate);

test('games, both pair directions and referrals start without waiting for one another; metrics keep their meanings',async()=>{
 const f=fixture();
 const pending=f.service.deriveCounters('u',{groups:[{id:'a',creatorId:'u',adminIds:['u'],playerIds:['u','p']},{id:'b',creatorId:'other',adminIds:[],playerIds:['u']}],friendsCount:3,goals:4,assists:2,wins:7,cleanSheets:1});
 await flush();expect([...f.reads.keys()]).toEqual(['games','a','b','invites']);
 f.resolve('games',[{status:'finished',endedBy:'admin',startsAt:1,players:['u','p']},{status:'finished',endedBy:'admin',startsAt:2,players:['u','p','q'],arrivals:{q:'no_show'}},{status:'finished',endedBy:'admin',startsAt:3,players:['u','r'],arrivals:{u:'no_show'}}]);
 f.resolve('a',[{winsTogether:5}]);f.resolve('b',[{winsTogether:6}]);f.reads.get('invites')!.resolve(9);
 expect(await pending).toMatchObject({gamesJoined:2,teamsJoined:2,teamsCreated:1,playersCoached:1,friendsCount:3,goals:4,assists:2,wins:7,cleanSheets:1,invitesSent:9,maxGamesWithPlayer:2,maxWinsWithPlayer:6,distinctPlayers:1});
});

test.each(['games','a','b','invites'])('failure of %s rejects promptly, preserving its operation instead of producing zero counters',async key=>{
 const f=fixture(),pending=f.service.deriveCounters('u'),error=Error('offline');
 await flush();f.reads.get(key)!.reject(error);
 await expect(pending).rejects.toBe(error);
 expect(f.logError).toHaveBeenCalledWith(key==='games'?'deriveGamesJoined':key==='invites'?'deriveInvitesSent':'deriveMaxWinsWithPlayer',error,{userId:'u'});
});

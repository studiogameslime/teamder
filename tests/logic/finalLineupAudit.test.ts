import {liveLineupFingerprint} from '@/utils/liveLineupFingerprint';
import {liveLineupFingerprint as serverFingerprint,matchesLiveRound} from '../../functions/src/liveRoundCommit';
import {roundDecisionContext,matchesRoundDecision} from '@/utils/roundDecision';

function board(size:number):any {
  return {id:'evening',status:'active',players:['a','b'],guests:[{id:'dedicated'}],
    draftTeams:{teams:[0,1,2].map(index=>({index,colorKey:['red','blue','green'][index],captainId:`${index}:0`,playerIds:Array.from({length:size},(_,i)=>i===1?'guest:dedicated':`${index}:${i}`)})),leftHome:[{playerId:'z',homeTeam:2,at:1},{playerId:'y',homeTeam:1,at:2}]},
    rotation:{playing:[2,1],waiting:[0],roundInstanceId:'one',updatedAt:1,loans:[{playerId:'a',homeTeam:0,filledTeam:2,swapId:'pair'}]},
    liveMatch:{scoreA:1,scoreB:0,goals:[{id:'g',team:'A',scorerId:'a',assisterId:null,assistStatus:'none'}],timerRunning:false,timerAccumulatedMs:0,shootout:{firstTeam:'A',kicks:[]}}};
}

test.each([4,7,11])('client and server bind the same %s-player board including guests, colors and temporary exchanges',size=>{
  const g=board(size);expect(liveLineupFingerprint(g)).toBe(serverFingerprint(g));
  expect(matchesLiveRound(g,'one',['g'],{rotationUpdatedAt:1,penalties:[],lineupFingerprint:liveLineupFingerprint(g)})).toBe(true);
  // Firestore does not preserve object field order; absent/null optional
  // presentation values must not make a valid allocation uncommittable.
  const reordered=JSON.parse(JSON.stringify(g));
  reordered.draftTeams.teams=reordered.draftTeams.teams.map((t:any)=>({playerIds:t.playerIds,colorKey:t.colorKey,index:t.index}));
  reordered.draftTeams.leftHome.reverse();
  expect(serverFingerprint(reordered)).toBe(liveLineupFingerprint(g));
});

test.each(['roster','side','color','loan','departure'])('a %s change after the client read rejects the result without relying on rotation timestamps',kind=>{
  const g=board(4),before=liveLineupFingerprint(g);
  if(kind==='roster')g.draftTeams.teams[0].playerIds.push('late');
  if(kind==='side')g.rotation.playing=[1,2];
  if(kind==='color')g.draftTeams.teams[1].colorKey='white';
  if(kind==='loan')g.rotation.loans[0].filledTeam=1;
  if(kind==='departure')g.draftTeams.leftHome.push({playerId:'a',homeTeam:0});
  expect(matchesLiveRound(g,'one',['g'],{rotationUpdatedAt:1,penalties:[],lineupFingerprint:before})).toBe(false);
});

test('old clients retain the previous protocol and malformed supplied identity never matches',()=>{
  const g=board(4);expect(matchesLiveRound(g,'one',['g'],{rotationUpdatedAt:1,penalties:[]})).toBe(true);
  for(const invalid of [null,7,{},''])expect(matchesLiveRound(g,'one',['g'],{rotationUpdatedAt:1,penalties:[],lineupFingerprint:invalid})).toBe(false);
});

test('clock controls preserve a manager decision but a corrected scorer or assister invalidates it',()=>{
  const g=board(4),decision=roundDecisionContext(g)!;
  g.liveMatch.timerRunning=true;g.liveMatch.timerAccumulatedMs=12;g.liveMatch.timerLastStartedAt=999;
  expect(matchesRoundDecision(g,decision)).toBe(true);
  g.liveMatch.goals[0].scorerId='different';expect(matchesRoundDecision(g,decision)).toBe(false);
});

test('starting the optional clock may activate an open evening without invalidating its board',()=>{
  const g=board(4);g.status='open';const decision=roundDecisionContext(g)!;
  g.status='active';g.liveMatch.timerRunning=true;g.liveMatch.timerLastStartedAt=999;
  expect(matchesRoundDecision(g,decision)).toBe(true);
  for(const status of ['finished','cancelled']){
    g.status=status;expect(matchesRoundDecision(g,decision)).toBe(false);
  }
});

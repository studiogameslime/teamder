import { acceptsReorder, applyChosenFill, recordWinnerSkeleton, rosterOf, roundCommitKey } from '@/services/rotationEngine';
import { liveTeamsChanged, liveTeamsEditContext, liveTeamsEditSkeleton, resetLiveForTeamChange, validateLiveTeamsFill } from '@/utils/liveTeamsEdit';
import { liveTeamsFixture, liveTeamsWorld } from '../helpers/liveTeamsWorld';
import { readRotation } from '@/firebase/firestore';
import type { LiveTeamsPlan } from '@/utils/liveTeamsEdit';

const actor={userId:'owner',userName:'מנהל'};
const plan:LiveTeamsPlan={playing:[0,2],waiting:[3,1]};
function* permutations(values:number[]):Generator<number[]>{if(!values.length){yield [];return;}for(const first of values)for(const rest of permutations(values.filter(i=>i!==first)))yield [first,...rest];}

describe.each(['temporary','permanent','balanced'] as const)('exhaustive rotation plans: %s',mode=>{
  test.each([2,3,4,5,6,7])('every ordered pair and waiting order is valid with %s teams',count=>{
    const game=liveTeamsFixture(count,4);game.draftTeams!.fillMode=mode==='permanent'?'permanent':'temporary';if(mode==='balanced')game.draftTeams!.completionMode='balanced';
    const before=JSON.stringify(game);
    let checked=0;
    for(const order of permutations(Array.from({length:count},(_,i)=>i))){
      const selected:LiveTeamsPlan={playing:[order[0],order[1]],waiting:order.slice(2)};
      const skeleton=liveTeamsEditSkeleton(game,selected,4,mode==='permanent'?'permanent':'temporary');
      expect(skeleton.rotation.playing).toEqual(selected.playing);expect(skeleton.rotation.waiting).toEqual(selected.waiting);
      expect(skeleton.rotation.round).toBe(2);expect(skeleton.rotation.wins).toEqual({0:1});
      expect(new Set(skeleton.playing.flatMap(i=>rosterOf(i,skeleton.teams,skeleton.rotation.loans))).size).toBe(8);
      expect(validateLiveTeamsFill(skeleton).teams).toEqual(skeleton.teams);checked++;
    }
    const factorial=(n:number):number=>n<2?1:n*factorial(n-1);
    expect(checked).toBe(factorial(count));expect(JSON.stringify(game)).toBe(before);
  });
});

describe.each([false,true])('complete service lifecycle, mock=%s',mock=>{
  test.each([3,4,5,6,7,8,9,10,11])('replacement then goals, timer, penalties and next rotation with %s-a-side',async size=>{
    const h=liveTeamsWorld(mock,liveTeamsFixture(4,size));
    await h.service.saveLiveTeamsEdit('audit',plan,liveTeamsEditContext(h.read()),actor);
    const key=roundCommitKey(h.state.rotation!);
    const opts={team:'B',scorerId:'t2-p0',assisterId:'t2-p1',minute:0,expectedRoundId:key,id:'new-goal'};
    await h.service.recordGoal('audit',opts);expect(h.state.liveMatch!.scoreB).toBe(1);
    expect(h.state.liveMatch!.goalTally).toEqual({'t0-p0':2,'t2-p0':1});
    await h.service.startTimer('audit','owner','מנהל',key);expect(h.state.liveMatch!.timerRunning).toBe(true);
    h.clock(9000);await h.service.pauseTimer('audit','owner','מנהל',key);expect(h.state.liveMatch!.timerAccumulatedMs).toBe(4000);
    await h.service.removeGoal('audit','new-goal');expect(h.state.liveMatch!.scoreB).toBe(0);expect(h.state.liveMatch!.goals).toHaveLength(0);
    await h.service.startShootout('audit','B',key);
    await h.service.recordShootoutKick('audit',{id:'new-kick',team:'B',kickerId:'t2-p0',keeperId:'t0-p0',scored:true,outcome:'goal',expectedKickCount:0,expectedRoundId:key});
    expect(h.state.liveMatch!.shootout!.kicks).toHaveLength(1);expect(h.state.liveMatch!.shootout!.kicks[0].kickerId).toBe('t2-p0');
    const next=recordWinnerSkeleton(2,h.state.draftTeams!.teams,h.state.rotation!,size,'temporary');
    expect(next.rotation.playing).toEqual([3,2]);expect(next.rotation.waiting).toEqual([1,0]);expect(next.rotation.round).toBe(3);
    expect(h.callable).not.toHaveBeenCalled();expect(h.committedHistory).toHaveLength(0);
  });

  test.each(['goal','timer-start','timer-pause','shootout-start','shootout-kick','keeper','round-ready'])('a stale %s action cannot alter the replacement',async action=>{
    const h=liveTeamsWorld(mock),old=roundCommitKey(h.state.rotation!);
    await h.service.saveLiveTeamsEdit('audit',plan,liveTeamsEditContext(h.read()),actor);
    const before=structuredClone(h.state);
    const request=()=>{
      if(action==='goal')return h.service.recordGoal('audit',{team:'A',scorerId:'t0-p0',minute:0,expectedRoundId:old});
      if(action==='timer-start')return h.service.startTimer('audit','owner','מנהל',old);
      if(action==='timer-pause')return h.service.pauseTimer('audit','owner','מנהל',old);
      if(action==='shootout-start')return h.service.startShootout('audit','A',old);
      if(action==='keeper')return h.service.setShootoutKeeper('audit','A','t0-p0',old);
      if(action==='round-ready')return h.service.ensureRoundReady('audit',old);
      return h.service.recordShootoutKick('audit',{id:'stale',team:'A',kickerId:'t0-p0',keeperId:'t2-p0',scored:true,expectedKickCount:0,expectedRoundId:old});
    };
    await expect(request()).rejects.toThrow();expect(h.state).toEqual(before);
  });

  test('a stale outgoing player cannot score even with the new round identity',async()=>{
    const h=liveTeamsWorld(mock);await h.service.saveLiveTeamsEdit('audit',plan,liveTeamsEditContext(h.read()),actor);
    const before=structuredClone(h.state),key=roundCommitKey(h.state.rotation!);
    await expect(h.service.recordGoal('audit',{team:'B',scorerId:'t1-p0',minute:0,expectedRoundId:key})).rejects.toThrow();
    expect(h.state).toEqual(before);
  });

  test('repeated replacements keep the visible number, prior credits and all wins',async()=>{
    const h=liveTeamsWorld(mock);let prior=roundCommitKey(h.state.rotation!);
    for(const next of [plan,{playing:[3,2],waiting:[1,0]},{playing:[3,1],waiting:[0,2]}] as LiveTeamsPlan[]){
      await h.service.saveLiveTeamsEdit('audit',next,liveTeamsEditContext(h.read()),actor);
      expect(roundCommitKey(h.state.rotation!)).not.toBe(prior);prior=roundCommitKey(h.state.rotation!);
      expect(h.state.liveMatch!.goalTally).toEqual({'t0-p0':2});expect(h.state.rotation!.round).toBe(2);expect(h.state.rotation!.wins).toEqual({0:1});
    }
  });
});

test.each(['goal','kick','roster','clock','committed','replaced'])('a transaction retry after concurrent %s rejects without partial reset',async change=>{
  const h=liveTeamsWorld();
  const expected=liveTeamsEditContext(h.read());
  h.beforeCommit(()=>h.mutate(g=>{
    if(change==='goal'){g.liveMatch!.scoreB=1;g.liveMatch!.goals!.push({id:'other',team:'B',scorerId:'t1-p0',minute:2,at:2000});}
    if(change==='kick')g.liveMatch!.shootout={firstTeam:'A',kicks:[{id:'other',team:'A',kickerId:'t0-p0',keeperId:'t1-p0',scored:false,at:2000}]};
    if(change==='roster')g.draftTeams!.teams[0].playerIds.pop();
    if(change==='clock')g.liveMatch!.timerRunning=true;
    if(change==='committed')g.lastCommittedRoundId=roundCommitKey(g.rotation!);
    if(change==='replaced'){g.rotation!.playing=[0,3];g.rotation!.waiting=[1,2];g.rotation!.roundInstanceId='someone-else';}
  }));
  await expect(h.service.saveLiveTeamsEdit('audit',plan,expected,actor)).rejects.toMatchObject({code:'LIVE_TEAMS_CHANGED'});
  expect(h.attempts()).toBe(2);expect(h.writes).toHaveLength(0);expect(h.events).toHaveLength(0);
  expect(h.state.liveMatch!.timerAccumulatedMs).toBe(90000);
});

test('an unrelated concurrent title edit can retry and is preserved',async()=>{
  const h=liveTeamsWorld();h.beforeCommit(()=>h.mutate(g=>{g.title='שם מעודכן';}));
  await h.service.saveLiveTeamsEdit('audit',plan,liveTeamsEditContext(h.read()),actor);
  expect(h.attempts()).toBe(2);expect(h.state.title).toBe('שם מעודכן');expect(h.writes).toHaveLength(1);
});

test('two managers replacing the same game allow only one transaction to commit',async()=>{
  const h=liveTeamsWorld(),expected=liveTeamsEditContext(h.read());
  const result=await Promise.allSettled([h.service.saveLiveTeamsEdit('audit',plan,expected,actor),h.service.saveLiveTeamsEdit('audit',{playing:[3,1],waiting:[0,2]},expected,actor)]);
  expect(result.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);expect(h.writes).toHaveLength(1);
  expect(h.events).toHaveLength(1);expect(h.events[0].liveMatch.scoreA).toBe(0);expect(h.events[0].rotation.round).toBe(2);
});

test('transport failure preserves the complete old game; retry after reconnection succeeds once',async()=>{
  const h=liveTeamsWorld(),before=structuredClone(h.state),expected=liveTeamsEditContext(h.read());h.fail();
  await expect(h.service.saveLiveTeamsEdit('audit',plan,expected,actor)).rejects.toThrow('UNAVAILABLE');expect(h.state).toEqual(before);expect(h.events).toHaveLength(0);
  h.recover();await h.service.saveLiveTeamsEdit('audit',plan,expected,actor);expect(h.writes).toHaveLength(1);
});

test('a lost acknowledgement cannot reset a subsequent goal on retry',async()=>{
  const h=liveTeamsWorld(),expected=liveTeamsEditContext(h.read());h.loseAck();
  await expect(h.service.saveLiveTeamsEdit('audit',plan,expected,actor)).rejects.toThrow('ACK_LOST');
  h.recover();await h.service.recordGoal('audit',{team:'B',scorerId:'t2-p0',minute:0,expectedRoundId:roundCommitKey(h.state.rotation!)});
  const before=structuredClone(h.state);
  await expect(h.service.saveLiveTeamsEdit('audit',plan,expected,actor)).rejects.toMatchObject({code:'LIVE_TEAMS_CHANGED'});expect(h.state).toEqual(before);
});

test('a deleted game cannot be created by the edit transaction',async()=>{
  const h=liveTeamsWorld(),expected=liveTeamsEditContext(h.read());h.remove();
  await expect(h.service.saveLiveTeamsEdit('audit',plan,expected,actor)).rejects.toThrow();expect(h.writes).toHaveLength(0);
});

test.each([3,4,5,6,7,8,9,10,11])('permanent completion of two short teams supports reverse picker order (%s)',size=>{
  const g=liveTeamsFixture(4,size);g.draftTeams!.teams[0].playerIds.pop();g.draftTeams!.teams[2].playerIds.pop();
  const skeleton=liveTeamsEditSkeleton(g,plan,size,'permanent');
  let filled=applyChosenFill(skeleton.teams,skeleton.rotation.loans,2,['t1-p0'],'permanent');filled=applyChosenFill(filled.teams,filled.loans,0,['t1-p1'],'permanent');
  const saved=validateLiveTeamsFill(skeleton,filled);
  expect(rosterOf(0,saved.teams,saved.loans)).toHaveLength(size);expect(rosterOf(2,saved.teams,saved.loans)).toHaveLength(size);
});

test('guests remain eligible while waitlisted and departed guests are excluded',async()=>{
  const g=liveTeamsFixture();g.guests=[{id:'guest',name:'אורח'},{id:'waiting',name:'ממתין',waitlisted:true}] as any;
  g.draftTeams!.teams[2].playerIds=['guest:guest','guest:waiting'];
  const h=liveTeamsWorld(false,g);await h.service.saveLiveTeamsEdit('audit',plan,liveTeamsEditContext(h.read()),actor);
  expect(h.state.draftTeams!.teams[2].playerIds).toEqual(['guest:guest']);
  await h.service.recordGoal('audit',{team:'B',scorerId:'guest:guest',minute:0,expectedRoundId:roundCommitKey(h.state.rotation!)});
  expect(h.state.liveMatch!.goalTally!['guest:guest']).toBe(1);
});

test.each(['absent-live','null-live','untimed-zero','running-zero','negative-tally'])('reset handles legacy state %s',mode=>{
  const g=liveTeamsFixture();
  if(mode==='absent-live')delete g.liveMatch;
  if(mode==='null-live')g.liveMatch=null as any;
  if(mode==='untimed-zero')Object.assign(g.liveMatch!,{scoreA:0,scoreB:0,goals:[],timerAccumulatedMs:0});
  if(mode==='running-zero')Object.assign(g.liveMatch!,{scoreA:0,scoreB:0,goals:[],timerAccumulatedMs:0,timerRunning:true,timerLastStartedAt:1000});
  if(mode==='negative-tally')g.liveMatch!.goalTally={'t0-p0':0};
  const reset=resetLiveForTeamChange(g.liveMatch,'owner','מנהל',5000);
  expect(reset.scoreA).toBe(0);expect(reset.scoreB).toBe(0);expect(reset.timerRunning).toBe(false);expect(reset.goals).toEqual([]);
  expect(Object.values(reset.goalTally!)).not.toContain(-1);
});

test('queue-only edits do not clear a complete penalty series or change a legacy key',async()=>{
  const g=liveTeamsFixture();delete g.rotation!.roundInstanceId;delete g.rotation!.roundInstanceRound;
  g.liveMatch!.shootout={firstTeam:'B',keeperA:'t0-p0',keeperB:'t1-p0',kicks:[{id:'kick',team:'B',kickerId:'t1-p0',keeperId:'t0-p0',scored:false,outcome:'save',at:1}]};
  const h=liveTeamsWorld(false,g),before=structuredClone(h.state.liveMatch),key=roundCommitKey(h.state.rotation!);
  await h.service.saveLiveTeamsEdit('audit',{playing:[0,1],waiting:[3,2]},liveTeamsEditContext(h.read()),actor);
  expect(h.state.liveMatch).toEqual(before);expect(roundCommitKey(readRotation(h.state.rotation)!)).toBe(key);
  await h.service.startTimer('audit','owner','מנהל',key);expect(h.state.liveMatch!.timerRunning).toBe(true);
});

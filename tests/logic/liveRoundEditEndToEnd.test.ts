import {liveTeamsEndToEndWorld} from '../helpers/liveTeamsEndToEndWorld';
import {generateLiveRoundTeams,initialLiveRoundPlan,liveRoundEditContext,prepareLiveRoundEdit,type LiveRoundEditRequest} from '@/utils/liveRoundEdit';
import {applyChosenFill,rosterOf,roundCommitKey} from '@/services/rotationEngine';

const actor={userId:'owner',userName:'מנהל'};
type World=ReturnType<typeof liveTeamsEndToEndWorld>;
async function savedFour(w:World){
  const g=w.state();g.advancedMode=true;g.numberOfTeams=3;g.maxPlayers=15;
  g.players=g.players.slice(0,15);g.draftTeams.teams=g.draftTeams.teams.slice(0,3);
  g.draftTeams.originalTeams=g.draftTeams.originalTeams.slice(0,3);g.draftTeams.numTeams=3;g.rotation.waiting=[2];
  for(let i=0;i<4;i++){
    if(i){const current=w.read(),id=rosterOf(current.rotation!.playing[0],current.draftTeams!.teams,current.rotation!.loans)[0];
      await w.service.recordGoal('audit',{team:'A',scorerId:id,minute:1,expectedRoundId:roundCommitKey(current.rotation!)});}
    const prepared=await w.service.prepareRoundResult('audit','owner');
    await w.service.commitFilledRotation('audit',prepared.draft,{rotation:prepared.skeleton.rotation,teams:prepared.skeleton.teams},undefined,actor,prepared.skeleton.source);
  }
}
const allStats=(w:World)=>Object.fromEntries([...w.documents].filter(([key])=>key!=='games/audit').sort(([a],[b])=>a.localeCompare(b)));

test.each(['temporary','permanent','balanced'] as const)('four saved games survive edit, and the restarted fifth uses the unchanged server statistics path (%s)',async mode=>{
  const w=liveTeamsEndToEndWorld(5);await savedFour(w);
  w.state().advancedFillMode=mode==='permanent'?'permanent':'temporary';
  if(mode==='balanced')w.state().draftTeams.completionMode='balanced';
  const oldKey=roundCommitKey(w.read().rotation!),scorer=rosterOf(w.read().rotation!.playing[0],w.read().draftTeams!.teams,[])[0];
  await w.service.recordGoal('audit',{team:'A',scorerId:scorer,minute:1,expectedRoundId:oldKey});
  w.state().liveMatch.timerAccumulatedMs=402000;
  const beforeStats=structuredClone(allStats(w)),beforeHistory=structuredClone(w.history()),g=w.read();
  const plan={...initialLiveRoundPlan(g),activeIds:g.players.slice(0,12),method:'rating' as const};
  plan.teams=generateLiveRoundTeams(g,plan,Object.fromEntries(g.players.map((id:string,i:number)=>[id,i%9+1])));
  const request:LiveRoundEditRequest={plan,expected:liveRoundEditContext(g)!,operationId:'new-fifth',resetConfirmed:true};
  const {skeleton}=prepareLiveRoundEdit(g,request);let filled={teams:skeleton.teams,loans:skeleton.rotation.loans};
  for(const team of skeleton.playing){const donor=filled.teams.filter(t=>!skeleton.playing.includes(t.index)).flatMap(t=>rosterOf(t.index,filled.teams,filled.loans))[0];filled=applyChosenFill(filled.teams,filled.loans,team,[donor],skeleton.fillMode);}
  const payloadCount=w.payloads.length;
  await w.service.saveLiveRoundEdit('audit',request,actor,filled);
  expect(allStats(w)).toEqual(beforeStats);expect(w.history()).toEqual(beforeHistory);expect(w.payloads).toHaveLength(payloadCount);
  expect(w.read().rotation!.round).toBe(5);expect(w.read().liveMatch!.timerAccumulatedMs).toBe(0);
  await expect(w.service.recordGoal('audit',{team:'A',scorerId:scorer,minute:1,expectedRoundId:oldKey})).rejects.toThrow();
  // Compare the same subsequent saved match with/without operational edit metadata.
  const control=liveTeamsEndToEndWorld(5);control.documents.clear();
  for(const [key,value]of w.documents)control.documents.set(key,structuredClone(value));
  delete control.state().liveRoundEdits;
  for(const world of [w,control]){
    const current=world.read(),side=rosterOf(current.rotation!.playing[0],current.draftTeams!.teams,current.rotation!.loans);
    await world.service.recordGoal('audit',{team:'A',scorerId:side[0],assisterId:side[1],minute:2,expectedRoundId:roundCommitKey(current.rotation!)});
    await world.service.endEvening('audit');await world.finishStages();
  }
  // Timestamps are transport metadata, not score/statistical values.
  const stable=(value:unknown)=>JSON.parse(JSON.stringify(value, (key,v)=>['updatedAt','at','endedAt','createdAt','lastSeenAt','sealedAt','committedAt','lastRoundAt','now','generatedAt'].includes(key)?undefined:v));
  expect(stable(allStats(w))).toEqual(stable(allStats(control)));
  expect(w.history()).toHaveLength(5);expect(w.history().slice(0,4)).toEqual(beforeHistory);
  expect(w.documents.has(`games/audit/roundHistory/${oldKey}`)).toBe(false);
  for(const id of g.players.slice(12))expect(w.documents.get(`gamePlayerStats/audit__${id}`)).toEqual(beforeStats[`gamePlayerStats/audit__${id}`]);
  expect(w.documents.get('communityStats/club').rounds).toBe(5);
});

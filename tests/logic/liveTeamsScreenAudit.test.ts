import { liveTeamsFixture } from '../helpers/liveTeamsWorld';
import { liveTeamsScreenWorld } from '../helpers/liveTeamsScreenWorld';
const plan={playing:[0,2],waiting:[3,1]};

test.each(['isAdmin','rotation','draftTeams','pendingSavedRound','roundBusy','ending','winnerOpen','decisionOpen','shootoutOpen','swapOpen','endRoundPrompt','endOpen'])('%s prevents opening an inappropriate editor',name=>{
  const h=liveTeamsScreenWorld();h.context[name]=['isAdmin','rotation','draftTeams'].includes(name)?false:true;
  expect(h.context.checkPermission()).toBe(false);
});
test.each(['finalizingRef','committingRef','fillFlowRef','startingRef','homeActionRef'])('%s prevents opening during an in-flight action',name=>{
  const h=liveTeamsScreenWorld();h.context[name].current=true;expect(h.context.checkPermission()).toBe(false);
});
test.each(['finished','cancelled'])('a %s round cannot open the editor',status=>{
  const h=liveTeamsScreenWorld();h.context.game.status=status;expect(h.context.checkPermission()).toBe(false);
});
test('rapid duplicate queue confirmations are latched to one save',async()=>{
  const h=liveTeamsScreenWorld();
  await Promise.all([h.context.saveLiveTeamsEditor({playing:[0,1],waiting:[3,2]}),h.context.saveLiveTeamsEditor({playing:[0,1],waiting:[3,2]})]);
  expect(h.service.saveLiveTeamsEdit).toHaveBeenCalledTimes(1);expect(h.world.writes).toHaveLength(1);expect(h.queueEvents()).toHaveLength(1);expect(h.context.busyCount).toBe(0);
});
test('a permission refusal cannot prepare or save',async()=>{
  const h=liveTeamsScreenWorld();h.context.canEditLiveTeams=false;await h.context.saveLiveTeamsEditor(plan);
  expect(h.service.prepareLiveTeamsEdit).not.toHaveBeenCalled();expect(h.service.saveLiveTeamsEdit).not.toHaveBeenCalled();
});
test('a stale preflight preserves the editor and reports a useful error',async()=>{
  const h=liveTeamsScreenWorld();h.world.mutate(g=>{g.liveMatch!.scoreA=2;});
  await h.context.saveLiveTeamsEditor(plan);
  expect(h.context.teamsEditor).not.toBeNull();expect(h.context.teamsEditError).toContain('השתנו');expect(h.world.writes).toHaveLength(0);expect(h.context.busyCount).toBe(0);
});
test('cancelling the filler selection records neither a save nor a queue-reordered success',async()=>{
  const game=liveTeamsFixture();game.draftTeams!.teams[2].playerIds.pop();
  const h=liveTeamsScreenWorld(game),before=structuredClone(h.world.state);
  await h.context.saveLiveTeamsEditor(plan);
  expect(h.context.fillFlowRef.current).not.toBeNull();expect(h.context.fillFlowRef.current.savedResult).toBeUndefined();
  h.context.onFillCancel();expect(h.context.fillFlowRef.current).toBeNull();expect(h.world.state).toEqual(before);
  expect(h.queueEvents()).toHaveLength(0);expect(h.context.toast.success).not.toHaveBeenCalled();
});
test.each(['temporary','permanent','balanced'])('screen picker through service preserves modes and resets only at commit (%s)',async mode=>{
  const game=liveTeamsFixture();game.draftTeams!.teams[0].playerIds.pop();game.draftTeams!.teams[2].playerIds.pop();
  game.advancedMode=true;game.advancedFillMode=mode==='permanent'?'permanent':'temporary';
  if(mode==='balanced')game.draftTeams!.completionMode='balanced';
  const h=liveTeamsScreenWorld(game),before=structuredClone(h.world.state);
  await h.context.saveLiveTeamsEditor(plan);expect(h.world.state).toEqual(before);expect(h.world.writes).toHaveLength(0);
  if(mode==='balanced')h.context.onBalancedConfirm([['t1-p0'],['t1-p1']]);
  else{
    expect(h.context.balancedRequest.editableSide).toBe(0);h.context.onBalancedConfirm([['t1-p0'],[]]);
    expect(h.context.balancedRequest.editableSide).toBe(1);h.context.onBalancedConfirm([[],['t1-p1']]);
  }
  await h.settle();
  expect(h.world.writes).toHaveLength(1);expect(h.world.state.liveMatch!.scoreA).toBe(0);expect(h.world.state.rotation!.round).toBe(2);
  expect(h.world.state.rotation!.playing).toEqual([0,2]);expect(h.context.busyCount).toBe(0);expect(h.context.committingRef.current).toBe(false);
  expect(h.context.toast.success).toHaveBeenCalledTimes(1);expect(h.queueEvents()).toHaveLength(1);
  if(mode==='permanent'){expect(h.world.state.draftTeams!.teams[0].playerIds).toContain('t1-p0');expect(h.world.state.rotation!.loans).toEqual([]);}
  else expect(h.world.state.rotation!.loans).toHaveLength(2);
});
test('a changed board during fillers is refused without a misleading success event',async()=>{
  const game=liveTeamsFixture();game.draftTeams!.teams[2].playerIds.pop();
  const h=liveTeamsScreenWorld(game);await h.context.saveLiveTeamsEditor(plan);
  h.world.mutate(g=>{g.liveMatch!.scoreA=2;});h.context.onBalancedConfirm([[],['t1-p0']]);await h.settle();
  expect(h.world.writes).toHaveLength(0);expect(h.world.state.liveMatch!.scoreA).toBe(2);expect(h.context.toast.error).toHaveBeenCalledTimes(1);
  expect(h.context.busyCount).toBe(0);expect(h.queueEvents()).toHaveLength(0);
});
test('no donors lets both short sides play short without getting stuck in a picker',async()=>{
  const game=liveTeamsFixture();game.draftTeams!.teams[0].playerIds.splice(2);game.draftTeams!.teams[2].playerIds.splice(2);
  game.draftTeams!.teams[1].playerIds=[];game.draftTeams!.teams[3].playerIds=[];
  const h=liveTeamsScreenWorld(game);await h.context.saveLiveTeamsEditor(plan);await h.settle();
  expect(h.world.writes).toHaveLength(1);expect(h.context.balancedRequest).toBeNull();expect(h.context.busyCount).toBe(0);
});

import { generateLiveRoundTeams, hasCurrentMatchData, initialLiveRoundPlan, liveCaptainTurn, liveRoundEditContext, liveRoundEditPatch, liveRoundTeamSlots, prepareLiveRoundEdit, type LiveRoundEditRequest } from '@/utils/liveRoundEdit';
import { applyChosenFill, rosterOf, roundCommitKey } from '@/services/rotationEngine';
import { readLiveRoundEdits } from '@/firebase/firestore';
import { liveTeamsFixture, liveTeamsWorld } from '../helpers/liveTeamsWorld';
import { liveTeamsScreenWorld } from '../helpers/liveTeamsScreenWorld';

const actor = { userId: 'owner', userName: 'מנהל' };
function scenario(mode: 'temporary' | 'permanent' | 'balanced' = 'temporary') {
  const game = liveTeamsFixture(3, 5); game.advancedMode = true;
  game.advancedFillMode = mode === 'permanent' ? 'permanent' : 'temporary';
  if (mode === 'balanced') game.draftTeams!.completionMode = 'balanced';
  const plan = { ...initialLiveRoundPlan(game), activeIds: game.players.slice(0, 12), method: 'random' as const };
  plan.teams = generateLiveRoundTeams(game, plan, {});
  const request: LiveRoundEditRequest = { plan, expected: liveRoundEditContext(game)!, operationId: 'edit-1', resetConfirmed: true };
  const { skeleton } = prepareLiveRoundEdit(game, request);
  let filled = { teams: skeleton.teams, loans: skeleton.rotation.loans };
  for (const side of skeleton.playing) {
    const donor = filled.teams.filter(t => !skeleton.playing.includes(t.index)).flatMap(t => rosterOf(t.index, filled.teams, filled.loans))[0];
    filled = applyChosenFill(filled.teams, filled.loans, side, [donor], skeleton.fillMode);
  }
  return { game, request, filled };
}

test.each(['temporary','permanent','balanced'] as const)('15 to 12, three fours still play five a side, preserving %s policy and all prior fields', mode => {
  const { game, request, filled } = scenario(mode), before = structuredClone(game);
  const patch = liveRoundEditPatch(game, request, actor, 9000, filled), after = { ...game, ...patch };
  expect(game).toEqual(before);
  expect(after.format).toBe('5v5'); expect(after.numberOfTeams).toBe(3);
  expect(after.rotation!.baseTeams!.map(t => t.playerIds.length)).toEqual([4,4,4]);
  const sides = after.rotation!.playing.map(i => rosterOf(i, after.draftTeams!.teams, after.rotation!.loans));
  expect(sides.map(ids => ids.length)).toEqual([5,5]); expect(new Set(sides.flat()).size).toBe(10);
  expect(after.draftTeams!.leftHome!.map(l => l.playerId)).toEqual(game.players.slice(12));
  expect(after.players).toEqual(before.players); expect(after.guests).toEqual(before.guests); expect(after.maxPlayers).toBe(15);
  expect(after.rotation).toMatchObject({ round: 2, wins: before.rotation!.wins, fillUsage: before.rotation!.fillUsage });
  expect(roundCommitKey(after.rotation!)).toBe('edit-1'); expect(after.lastCommittedRoundId).toBe(before.lastCommittedRoundId);
  expect(after.liveMatch).toMatchObject({ scoreA: 0, scoreB: 0, goals: [], inPlayPenalties: [], timerAccumulatedMs: 0, timerRunning: false, goalTally: { 't0-p0': 2 } });
  expect(after.liveMatch!.shootout).toBeUndefined(); expect(after.liveMatch!.startedAt).toBe(before.liveMatch!.startedAt);
  expect(after.advancedFillMode).toBe(before.advancedFillMode); expect(after.draftTeams!.completionMode).toBe(before.draftTeams!.completionMode);
  expect(Object.keys(patch).sort()).toEqual(['draftTeams','format','liveMatch','liveRoundEdits','matchDurationMinutes','numberOfTeams','rotation','ruleTags','teamsEditedManually','updatedAt'].sort());
});

test.each(['rating','random','regular','snake','manual'] as const)('all methods allocate 12 and 13 exactly once in balanced base sizes: %s', method => {
  for (const n of [12,13]) {
    const { game, request } = scenario(); const plan = { ...request.plan, method, activeIds: game.players.slice(0,n) };
    if (method === 'rating' || method === 'random') plan.teams = generateLiveRoundTeams(game, plan, Object.fromEntries(game.players.map((id,i) => [id, 1 + i % 9])));
    else {
      plan.teams = liveRoundTeamSlots(game,3).map((t,i) => ({ ...t, captainId: plan.activeIds[i], playerIds: [plan.activeIds[i]] }));
      for (const id of plan.activeIds.slice(3)) {
        const turn = liveCaptainTurn(plan.teams,n,method === 'snake' ? 'snake' : 'regular')!;
        plan.teams[turn].playerIds.push(id);
      }
    }
    expect(plan.teams.map(t => t.playerIds.length).sort()).toEqual(n === 12 ? [4,4,4] : [4,4,5]);
    expect(new Set(plan.teams.flatMap(t => t.playerIds)).size).toBe(n);
    expect(() => prepareLiveRoundEdit(game,{ ...request,plan })).not.toThrow();
  }
});

test.each([false,true])('production transaction and mock agree; acknowledgement retry never resets twice (%s)', async mock => {
  const { game,request,filled } = scenario(), w = liveTeamsWorld(mock,game);
  request.expected = liveRoundEditContext(w.read())!;
  await w.service.saveLiveRoundEdit(game.id,request,actor,filled);
  w.mutate(g => { g.liveMatch!.scoreA = 3; });
  await w.service.saveLiveRoundEdit(game.id,request,actor,filled);
  expect(w.read().liveMatch!.scoreA).toBe(3); expect(w.read().liveRoundEdits).toHaveLength(1);
  if (!mock) expect(w.writes).toHaveLength(1);
  expect(w.callable).not.toHaveBeenCalled(); expect(w.committedHistory).toEqual([]);
});

test('lost acknowledgement is verified from the operation receipt', async () => {
  const { game,request,filled } = scenario(), w=liveTeamsWorld(false,game); w.loseAck();
  request.expected = liveRoundEditContext(w.read())!;
  await w.service.saveLiveRoundEdit(game.id,request,actor,filled);
  expect(w.writes).toHaveLength(1); expect(w.read().liveRoundEdits).toHaveLength(1);
});

test('offline failure has no partial reset, attendance or allocation write', async () => {
  const {game,request,filled}=scenario(),w=liveTeamsWorld(false,game),before=w.read();w.fail();
  request.expected = liveRoundEditContext(w.read())!;
  await expect(w.service.saveLiveRoundEdit(game.id,request,actor,filled)).rejects.toThrow('UNAVAILABLE');
  expect(w.read()).toEqual(before);expect(w.writes).toEqual([]);
});

test.each(['score','clock','penalty','roster','duration','format','rules','saved','newAttempt','finished','queue'] as const)('a concurrent %s invalidates the reviewed board, even on transaction retry', async mutation => {
  const {game,request,filled}=scenario(),w=liveTeamsWorld(false,game);
  request.expected = liveRoundEditContext(w.read())!;
  w.beforeCommit(() => w.mutate(g => {
    if(mutation==='score')g.liveMatch!.scoreB++;
    if(mutation==='clock')g.liveMatch!.timerAccumulatedMs!+=1000;
    if(mutation==='penalty')g.liveMatch!.inPlayPenalties=[{id:'p',team:'A',kickerId:g.players[0],keeperId:null,outcome:'miss',minute:0,at:1}];
    if(mutation==='roster')g.players.pop();
    if(mutation==='duration')g.matchDurationMinutes=19;
    if(mutation==='format')g.format='6v6';
    if(mutation==='rules')g.ruleTags=['חדש'];
    if(mutation==='saved')g.lastCommittedRoundId=roundCommitKey(g.rotation!);
    if(mutation==='newAttempt')g.rotation!.roundInstanceId='another';
    if(mutation==='finished')g.status='finished';
    if(mutation==='queue')g.rotation!.playing=[1,0];
  }));
  await expect(w.service.saveLiveRoundEdit(game.id,request,actor,filled)).rejects.toThrow();
  expect(w.writes).toEqual([]);expect(w.read().liveMatch!.scoreA).toBe(1);
});

test.each(['time','goal','penalty','shootout','running','timerEvents'] as const)('%s requires explicit confirmation even with a zero score', field => {
  const { game,request } = scenario();
  game.liveMatch = {phase:'roundReady',scoreA:0,scoreB:0,assignments:{},benchOrder:[],timerAccumulatedMs:0};
  if(field==='time')game.liveMatch.timerAccumulatedMs=1;
  if(field==='goal')game.liveMatch.goals=[{id:'own',team:'A',scorerId:null,minute:0,at:0}];
  if(field==='penalty')game.liveMatch.inPlayPenalties=[{id:'p',team:'A',kickerId:'p',keeperId:null,outcome:'miss',minute:0,at:0}];
  if(field==='shootout')game.liveMatch.shootout={firstTeam:'A',kicks:[]};
  if(field==='running')game.liveMatch.timerRunning=true;
  if(field==='timerEvents')game.liveMatch.timerEvents=[{type:'start',at:1,byName:'מנהל'}];
  expect(hasCurrentMatchData(game.liveMatch)).toBe(true);
  expect(() => prepareLiveRoundEdit(game,{...request,expected:liveRoundEditContext(game)!,resetConfirmed:false})).toThrow('אישור');
});

test('an empty current attempt can apply without a destructive confirmation; evening evidence alone is not current data', () => {
  const {game,request}=scenario();game.liveMatch={phase:'roundReady',scoreA:0,scoreB:0,assignments:{},benchOrder:[],startedAt:1,goalTally:{old:9},activeIntervals:[{s:1,e:5}]};
  expect(hasCurrentMatchData(game.liveMatch)).toBe(false);
  expect(() => prepareLiveRoundEdit(game,{...request,expected:liveRoundEditContext(game)!,resetConfirmed:false})).not.toThrow();
});

test('waitlisted guests, duplicate players, unsupported fields and unfilled sides cannot slip into a save', () => {
  const {game,request,filled}=scenario();game.guests=[{id:'wait',name:'ממתין',waitlisted:true}] as any;
  const expected=liveRoundEditContext(game)!;
  expect(() => liveRoundEditPatch(game,{...request,expected},actor,1)).toThrow('להשלים');
  expect(() => prepareLiveRoundEdit(game,{...request,expected,plan:{...request.plan,activeIds:[...request.plan.activeIds,'guest:wait']}})).toThrow();
  expect(() => prepareLiveRoundEdit(game,{...request,expected,plan:{...request.plan,activeIds:[...request.plan.activeIds,request.plan.activeIds[0]]}})).toThrow();
  const patch=liveRoundEditPatch(game,{...request,expected,plan:{...request.plan,maxPlayers:99,groupId:'bad'} as any},actor,1,filled);
  expect(patch.maxPlayers).toBeUndefined();expect(patch.groupId).toBeUndefined();
});

test('allocation revisions survive the real reader and retired identities are never recycled', () => {
  const {game,request,filled}=scenario();const after={...game,...liveRoundEditPatch(game,request,actor,1,filled)};
  after.liveRoundEdits=readLiveRoundEdits(after.liveRoundEdits);
  expect(after.liveRoundEdits![0].before.teams.map(t=>t.playerIds.length)).toEqual([5,5,5]);
  expect(after.liveRoundEdits![0].after.teams.map(t=>t.playerIds.length)).toEqual([4,4,4]);
  expect(liveRoundEditPatch(after,request,actor,2,filled)).toEqual({});
  after.draftTeams!.teams=after.draftTeams!.teams.slice(0,2);
  expect(liveRoundTeamSlots(after,3).map(t=>t.index)).toEqual([0,1,3]);
});

test('settings-only edits preserve effective lineup, original allocation and all historical counters', () => {
  const {game,request,filled}=scenario();const after={...game,...liveRoundEditPatch(game,request,actor,1,filled)};
  const plan={...initialLiveRoundPlan(after),matchDurationMinutes:8,ruleTags:['ללא החלקות']};
  const patch=liveRoundEditPatch(after,{plan,expected:liveRoundEditContext(after)!,operationId:'edit-2',resetConfirmed:false},actor,2);
  expect(patch.draftTeams!.originalTeams).toEqual(after.draftTeams!.originalTeams);
  expect(patch.rotation!.baseTeams).toEqual(after.rotation!.baseTeams);expect(patch.rotation!.loans).toEqual(after.rotation!.loans);
  expect(patch.rotation!.round).toBe(2);expect(patch.rotation!.wins).toEqual(after.rotation!.wins);
});

test('returning registered players retain their identity and history, while a waitlisted guest stays excluded', () => {
  const {game,request,filled}=scenario(),after={...game,...liveRoundEditPatch(game,request,actor,1,filled)};
  const plan={...initialLiveRoundPlan(after),activeIds:game.players.slice(0,13),method:'random' as const};
  plan.teams=generateLiveRoundTeams(after,plan,{});
  const prepared=prepareLiveRoundEdit(after,{plan,expected:liveRoundEditContext(after)!,operationId:'return',resetConfirmed:false});
  expect(prepared.draft.leftHome!.map(l=>l.playerId)).toEqual(game.players.slice(13));
  expect(prepared.draft.teams.flatMap(t=>t.playerIds).filter(id=>id===game.players[12])).toHaveLength(1);
  expect(after.players).toEqual(game.players);expect(prepared.skeleton.rotation.wins).toEqual(game.rotation!.wins);
});

test('new teams preserve existing custom colours and receive an unused identity',()=>{
  const game=liveTeamsFixture(2,5);game.draftTeams!.teams[0].colorKey='green';game.draftTeams!.teams[1].colorKey='yellow';
  const slots=liveRoundTeamSlots(game,3);
  expect(slots.map(t=>t.index)).toEqual([0,1,2]);expect(slots.map(t=>t.colorKey)).toEqual(['green','yellow','red']);
});

test.each([false,true])('cancelling the edit filler picker never traps a concurrently saved result (%s)', pendingSavedRound => {
  const h=liveTeamsScreenWorld(),before=h.world.read();
  h.context.pendingSavedRound=pendingSavedRound;
  h.context.fillFlowRef.current={roundEdit:{operationId:'unsaved-edit'}};
  h.context.fillRequest={};h.context.balancedRequest={};
  h.context.onFillCancel();
  expect(h.context.fillFlowRef.current).toBeNull();expect(h.context.balancedRequest).toBeNull();
  expect(h.context.fillRequest).toBeNull();expect(h.context.fillDeferred).toBe(false);
  expect(h.world.read()).toEqual(before);expect(h.world.writes).toEqual([]);
});

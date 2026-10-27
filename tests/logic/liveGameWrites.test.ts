import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { matchesLiveRound } from '../../functions/src/liveRoundCommit';
import { exchangeLivePlayers, moveLivePlayer } from '@/utils/liveSubstitution';
import { roundCommitKey } from '@/services/rotationEngine';
import * as rotationEngine from '@/services/rotationEngine';
import { rotationWriteSource } from '@/services/rotationWriteSource';
import { saveMockRoundHistory } from '@/utils/mockRoundHistory';
import { roundParticipantSides } from '@/utils/roundParticipants';
import { buildShootoutPenaltyPayload } from '@/utils/penaltyStats';
import { shootoutFingerprint } from '@/utils/shootoutDecision';
import {liveLineupFingerprint} from '@/utils/liveLineupFingerprint';
import {matchesRoundDecision} from '@/utils/roundDecision';

function serviceFixture(mock = false) {
  const history:Record<string, any[]> = {};
  const state: any = { id: 'g', status: 'active',
    draftTeams: { teams: [{index:0,playerIds:['a','a2','a-keeper']},{index:1,playerIds:['b','b2','b-keeper']}] },
    rotation: { roundInstanceId: 'round-one',playing:[0,1],loans:[] },
    liveMatch: { scoreA: 0, scoreB: 0, goals: [], shootout: { firstTeam: 'A', keeperA: 'a-keeper', keeperB: 'b-keeper', kicks: [] } } };
  const update = jest.fn((_ref: unknown, patch: Record<string, any>) => {
    for (const [key, value] of Object.entries(patch)) {
      const path = key.split('.'); let target = state;
      for (const part of path.slice(0, -1)) target = target[part] ??= {};
      const name = path[path.length - 1];
      if (value?.union) target[name] = [...(target[name] ?? []), ...value.union];
      else if (value?.increment !== undefined) target[name] = (target[name] ?? 0) + value.increment;
      else if (value?.deleted) delete target[name];
      else target[name] = value;
    }
  });
  const io = { getDoc: jest.fn(async (_ref: unknown) => ({ exists: () => true, data: () => state })), runTransaction: async (_db: unknown, fn: any) => fn({ get: async () => ({ exists: () => true, data: () => state }), update }), doc: () => 'g', arrayUnion: (...union: any[]) => ({ union }), increment: (increment: number) => ({ increment }), deleteField:()=>({deleted:true}) };
  const deps: Record<string, any> = {
    'firebase/firestore': io, '@/firebase/config': { USE_MOCK_DATA: mock, getFirebase: () => ({ db: {} }) },
    '@/data/mockData': { mockGamesV2: [state], mockGame: { id: 'other' }, mockRoundHistory:history },
    '@/firebase/firestore': { col: { games: () => 'games' }, docs: { game: () => 'g' } },
    '@/services/rotationEngine': rotationEngine, '@/services/serverClock': { serverNow: () => 100 },
    '@/types': {teamSizeFromFormat:()=>5}, '@/services/rotationWriteSource':{rotationWriteSource},
    '@/utils/mockRoundHistory':{saveMockRoundHistory}, '@/utils/penaltyStats':{buildShootoutPenaltyPayload},
    '@/utils/roundParticipants':{roundParticipantSides},
    '@/utils/shootoutDecision':{shootoutFingerprint},
    '@/utils/liveLineupFingerprint':{liveLineupFingerprint},
    '@/utils/roundDecision':{matchesRoundDecision},
    '@/utils/liveSubstitution': { exchangeLivePlayers, moveLivePlayer },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/gameService.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (id: string) => {if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';return deps[id] ?? {};}, __DEV__: false, Date, console, setTimeout, clearTimeout });
  return { state, history, update, getDoc: io.getDoc, service: exports.gameService };
}

function untimedFixture(mock:boolean) {
  const x=serviceFixture(mock);delete x.state.liveMatch;x.state.status='open';
  x.state.format='5v5';
  x.state.rotation={round:1,roundInstanceId:'round-one',playing:[0,1],waiting:[2],loans:[],wins:{},updatedAt:1};
  x.state.draftTeams={fillMode:'temporary',teams:[0,1,2].map(index=>({index,captainId:`p${index}0`,playerIds:Array.from({length:5},(_,j)=>`p${index}${j}`)}))};
  x.service.getGameById=jest.fn(async()=>structuredClone(x.state));
  return x;
}

test.each([false,true])('discarding shootout kicks validates their snapshot and is retryable without touching goals (mock: %s)',async mock=>{
  const x=serviceFixture(mock);
  x.state.liveMatch.goals=[{id:'goal',team:'A',scorerId:'a'}];x.state.liveMatch.scoreA=1;x.state.liveMatch.scoreB=1;
  x.state.liveMatch.shootout.kicks=[{id:'kick',team:'A',kickerId:'a',keeperId:'b-keeper',scored:true,outcome:'goal',at:1}];
  const decision={gameId:'g',roundId:'round-one',playing:'0:1',fingerprint:shootoutFingerprint(x.state.liveMatch.shootout)};
  const original=structuredClone(x.state.liveMatch);
  x.state.liveMatch.shootout.kicks[0].outcome='miss';
  await expect(x.service.clearShootout('g',decision)).rejects.toThrow();expect(x.update).not.toHaveBeenCalled();
  x.state.liveMatch=structuredClone(original);
  await x.service.clearShootout('g',decision);await x.service.clearShootout('g',decision);
  expect(x.state.liveMatch.shootout).toBeUndefined();expect(x.state.liveMatch.goals).toEqual(original.goals);
  expect(x.state.liveMatch.scoreA).toBe(1);expect(x.state.liveMatch.scoreB).toBe(1);
});

test.each([false,true])('discard refuses another game, round or lineup (mock: %s)',async mock=>{
  for(const change of ['game','round','playing','score']){
    const x=serviceFixture(mock);const before=structuredClone(x.state.liveMatch.shootout);
    const decision={gameId:'g',roundId:'round-one',playing:'0:1',fingerprint:shootoutFingerprint(before)};
    if(change==='game')decision.gameId='different';
    if(change==='round')x.state.rotation.roundInstanceId='new-round';
    if(change==='playing')x.state.rotation.playing=[1,0];
    if(change==='score')x.state.liveMatch.scoreA=1;
    await expect(x.service.clearShootout('g',decision)).rejects.toThrow();
    expect(x.state.liveMatch.shootout).toEqual(before);expect(x.update).not.toHaveBeenCalled();
  }
});

test.each(['manual','bothOut'])('confirmed %s resolution excludes discarded penalties from saved history',async mode=>{
  const x=untimedFixture(true);await x.service.startShootout('g','A','round-one');
  await x.service.recordShootoutKick('g',{id:'discarded-kick',team:'A',kickerId:'p00',keeperId:'p10',scored:true,outcome:'goal',expectedRoundId:'round-one',expectedKickCount:0});
  if(mode==='bothOut'){x.state.draftTeams.teams.push({index:3,playerIds:['extra']});x.state.rotation.waiting.push(3);}
  const decision={gameId:'g',roundId:'round-one',playing:'0:1',fingerprint:shootoutFingerprint(x.state.liveMatch.shootout)};
  await x.service.clearShootout('g',decision);
  const result=await x.service.prepareRoundResult('g','admin',mode==='manual'?'A':undefined,mode==='bothOut'?'bothOut':undefined,false,decision);
  expect(x.service.getGameById).toHaveBeenCalledWith('g',{source:'server'});
  expect(result.outcome).toBe(mode==='manual'?'A':'tie');expect(x.history.g).toHaveLength(1);expect(x.history.g[0].penalties).toEqual([]);
});

test.each([false,true])('a shootout restarted after discard blocks the alternate commit (mock: %s)',async mock=>{
  const x=untimedFixture(mock);await x.service.startShootout('g','A','round-one');
  const decision={gameId:'g',roundId:'round-one',playing:'0:1',fingerprint:shootoutFingerprint(x.state.liveMatch.shootout)};
  await x.service.clearShootout('g',decision);await x.service.startShootout('g','B','round-one');
  x.service._commitRoundStatsAndClear=jest.fn();
  await expect(x.service.prepareRoundResult('g','admin','A',undefined,false,decision)).rejects.toThrow();
  expect(x.service._commitRoundStatsAndClear).not.toHaveBeenCalled();expect(x.state.liveMatch.shootout.firstTeam).toBe('B');
});

test.each([false,true])('an approved untimed 0:0 opens a tie decision without recording a start (mock: %s)',async mock=>{
  const x=untimedFixture(mock);
  expect(await x.service.prepareRoundResult('g','admin')).toEqual({outcome:null});
  expect(x.state.liveMatch).toMatchObject({phase:'roundReady',scoreA:0,scoreB:0,timerRunning:false,timerAccumulatedMs:0,timerEvents:[]});
  expect(x.state.liveMatch.startedAt).toBeUndefined();expect(x.state.status).toBe('open');
  expect(x.history.g).toBeUndefined();expect(x.state.lastCommittedRoundId).toBeUndefined();
});

test.each(['manual','bothOut','penalties'])('an untimed round can be committed through %s exactly once',async mode=>{
  const x=untimedFixture(true);
  if(mode==='bothOut'){
    x.state.draftTeams.teams.push({index:3,playerIds:Array.from({length:5},(_,j)=>`p3${j}`)});
    x.state.rotation.waiting.push(3);
  }
  if(mode==='penalties'){
    await x.service.startShootout('g','A','round-one');
    await x.service.setShootoutKeeper('g','B','p10','round-one');
    await x.service.recordShootoutKick('g',{id:'untimed-kick',team:'A',kickerId:'p00',keeperId:'p10',scored:true,outcome:'goal',expectedRoundId:'round-one',expectedKickCount:0});
  }
  const finish=()=>x.service.prepareRoundResult('g','admin',mode==='bothOut'?undefined:'A',mode==='bothOut'?'bothOut':undefined);
  const result=await finish();await finish();
  expect(result.outcome).toBe(mode==='bothOut'?'tie':'A');
  expect(result.skeleton.rotation.round).toBe(2);
  expect(x.history.g).toHaveLength(1);expect(x.history.g[0]).toMatchObject({scoreA:0,scoreB:0,winnerSide:mode==='bothOut'?'tie':'A'});
  if(mode==='penalties')expect(x.history.g[0].penalties).toHaveLength(1);
  expect(x.state.liveMatch.timerRunning).toBe(false);expect(x.state.liveMatch.timerAccumulatedMs).toBe(0);
  expect(x.state.liveMatch.startedAt).toBeUndefined();
});

test.each([false,true])('ready initialization preserves existing activity and rejects stale, saved or closed rounds (mock: %s)',async mock=>{
  const x=untimedFixture(mock);
  await x.service.recordGoal('g',{id:'earlier-goal',team:'A',scorerId:'p00',minute:1,expectedRoundId:'round-one'});
  const before=structuredClone(x.state.liveMatch);
  await x.service.ensureRoundReady('g','round-one');expect(x.state.liveMatch).toEqual(before);
  for(const patch of [{rotation:{...x.state.rotation,roundInstanceId:'next'}},{lastCommittedRoundId:'round-one'},{status:'finished'},{status:'cancelled'},{draftTeams:undefined}]){
    const fresh=untimedFixture(mock);Object.assign(fresh.state,patch);
    await expect(fresh.service.ensureRoundReady('g','round-one')).rejects.toThrow();
    expect(fresh.state.liveMatch).toBeUndefined();
  }
});

test.each([false,true])('a shootout can start directly from a missing clock state and retries preserve its keeper (mock: %s)',async mock=>{
  const x=untimedFixture(mock);
  await x.service.startShootout('g','B','round-one');
  await x.service.setShootoutKeeper('g','A','p00','round-one');
  await x.service.startShootout('g','A','round-one');
  expect(x.state.liveMatch.shootout).toMatchObject({firstTeam:'B',keeperA:'p00',kicks:[]});
  expect(x.state.liveMatch).toMatchObject({timerRunning:false,timerAccumulatedMs:0,timerEvents:[]});
  expect(x.state.liveMatch.startedAt).toBeUndefined();
});

test.each([false, true])('the first goal before clock creation stays ready, retries once and survives starting the match (mock: %s)', async mock => {
  const x = serviceFixture(mock);
  x.state.status = 'open'; delete x.state.liveMatch;
  const goal = { id: 'before-clock', team: 'B', scorerId: 'b', assisterId: 'b2', assistStatus: 'player', minute: 1, expectedRoundId: 'round-one' };
  await x.service.recordGoal('g', goal); await x.service.recordGoal('g', goal);
  expect(x.state.status).toBe('open');
  expect(x.state.liveMatch).toMatchObject({ phase: 'roundReady', scoreA: 0, scoreB: 1, timerRunning: false, timerAccumulatedMs: 0, timerEvents: [], goalTally: { b: 1 } });
  expect(x.state.liveMatch.goals).toHaveLength(1);
  expect(x.state.liveMatch.goals[0]).toMatchObject({ assisterId: 'b2', assistStatus: 'player' });
  expect(x.state.liveMatch.startedAt).toBeUndefined();
  expect(x.state.updatedAt).toEqual(expect.any(Number));
  await x.service.markGameStarted('g');
  expect(x.state.status).toBe('active');
  expect(x.state.liveMatch.scoreB).toBe(1);
  expect(x.state.liveMatch.goals).toHaveLength(1);
  expect(x.state.liveMatch.timerRunning).toBe(false);
});

test('a first timer start rechecks a goal arriving after its initial empty snapshot', async () => {
  const x = serviceFixture(); x.state.status = 'open'; delete x.state.liveMatch;
  x.getDoc.mockImplementationOnce(async () => {
    const stale = { ...x.state };
    await x.service.recordGoal('g', { id: 'concurrent-first-goal', team: 'A', scorerId: 'a', minute: 1, expectedRoundId: 'round-one' });
    return { exists: () => true, data: () => stale };
  });
  await x.service.markGameStarted('g');
  expect(x.state.liveMatch.scoreA).toBe(1);
  expect(x.state.liveMatch.goals.map((g: any) => g.id)).toEqual(['concurrent-first-goal']);
  expect(x.update.mock.calls[1][1]).not.toHaveProperty('liveMatch');
  expect(x.update.mock.calls[1][1]['liveMatch.phase']).toBe('roundRunning');
});

test.each([false, true])('a missing live state cannot be created for an unprepared, stale, closed or saved round (mock: %s)', async mock => {
  for (const kind of ['unprepared', 'stale', 'closed', 'saved']) {
    const x = serviceFixture(mock); delete x.state.liveMatch;
    if (kind === 'unprepared') delete x.state.rotation;
    if (kind === 'stale') x.state.rotation.roundInstanceId = 'new-round';
    if (kind === 'closed') x.state.status = 'finished';
    if (kind === 'saved') x.state.lastCommittedRoundId = 'round-one';
    await expect(x.service.recordGoal('g', { id: kind, team: 'A', scorerId: 'a', minute: 1, expectedRoundId: 'round-one' })).rejects.toThrow();
    expect(x.state.liveMatch).toBeUndefined(); expect(x.update).not.toHaveBeenCalled();
  }
  const legacy = serviceFixture(mock); delete legacy.state.liveMatch;
  await legacy.service.recordGoal('g', { team: 'A', scorerId: 'a', minute: 1 });
  expect(legacy.state.liveMatch).toBeUndefined();
});

test('a lost response retry acknowledges the same kick without appending twice', async () => {
  const x = serviceFixture();
  const shot = { id: 'same-attempt', team: 'A', kickerId: 'a', keeperId: 'b-keeper', scored: false, outcome: 'miss', expectedKickCount: 0, expectedRoundId: 'round-one' };
  await x.service.recordShootoutKick('g', shot);
  await x.service.recordShootoutKick('g', shot);
  expect(x.state.liveMatch.shootout.kicks).toHaveLength(1);
  expect(x.state.liveMatch.shootout.kicks[0].outcome).toBe('miss');
  expect(x.update).toHaveBeenCalledTimes(1);
});

test.each(['temporary','permanent'])('the actual transaction honours the game setting (%s) over an old draft setting', async mode => {
 const x=serviceFixture();x.state.advancedMode=true;x.state.advancedFillMode=mode;
 x.state.rotation={...x.state.rotation,playing:[0,1],waiting:[2],loans:[]};
 x.state.draftTeams={fillMode:mode==='temporary'?'permanent':'temporary',teams:[{index:0,captainId:'a',playerIds:['a','a2']},{index:1,captainId:'b',playerIds:['b','b2']},{index:2,captainId:'c',playerIds:['c','c2']}]};
 await x.service.swapPlayers('g','a','b','round-one');
 expect(x.state.draftTeams.teams[0].playerIds).toEqual(mode==='temporary'?['a','a2']:['a2','b']);
 expect(x.state.rotation.loans).toHaveLength(mode==='temporary'?2:0);
 expect(x.state.rotation.roundInstanceId).toBe('round-one');
 expect(x.state.liveMatch.scoreA).toBe(0);
 await expect(x.service.swapPlayers('g','a','b','old')).rejects.toThrow();
 expect(x.update).toHaveBeenCalledTimes(1);
});
test('a stale turn, wrong side or changed game cannot append a kick', async () => {
  const x = serviceFixture();
  const shot = { id: 'bad', team: 'A', kickerId: 'a', keeperId: 'b-keeper', scored: true, outcome: 'goal', expectedKickCount: 0, expectedRoundId: 'round-one' };
  await expect(x.service.recordShootoutKick('g', { ...shot, team: 'B' })).rejects.toThrow('SHOOTOUT_CHANGED');
  await expect(x.service.recordShootoutKick('g', { ...shot, expectedRoundId: 'older' })).rejects.toThrow('SHOOTOUT_CHANGED');
  x.state.liveMatch.shootout.kicks.push({ id: 'other-admin', team: 'A' });
  await expect(x.service.recordShootoutKick('g', shot)).rejects.toThrow('SHOOTOUT_CHANGED');
  expect(x.update).not.toHaveBeenCalled();
});
test('editing the last kick changes its attribution and result, never its turn or id', async () => {
  const x = serviceFixture();
  const original = { id: 'last', team: 'A', kickerId: 'a', keeperId: 'b-keeper', scored: false, outcome: 'miss', at: 100 };
  x.state.liveMatch.shootout.kicks = [original];
  await x.service.updateLastShootoutKick('g', 'last', { kickerId: 'a2', keeperId: 'b2', outcome: 'save' }, 'round-one');
  expect(x.state.liveMatch.shootout.kicks).toEqual([{ ...original, kickerId: 'a2', keeperId: 'b2', outcome: 'save' }]);
  x.state.liveMatch.shootout.kicks.push({ id: 'newer', team: 'B' });
  await expect(x.service.updateLastShootoutKick('g', 'last', { kickerId: 'a', keeperId: 'b', outcome: 'goal' }, 'round-one')).rejects.toThrow('SHOOTOUT_CHANGED');
  expect(x.update).toHaveBeenCalledTimes(1);
});
test('a goal retry keeps one score increment and preserves unknown versus no assist', async () => {
  const x = serviceFixture();
  const goal = { id: 'goal-retry', team: 'A', scorerId: 'a', assisterId: null, assistStatus: 'unknown', minute: 3, expectedRoundId: 'round-one' };
  await x.service.recordGoal('g', goal); await x.service.recordGoal('g', goal);
  expect(x.state.liveMatch.scoreA).toBe(1); expect(x.state.liveMatch.goals).toHaveLength(1);
  expect(x.state.liveMatch.goals[0].assistStatus).toBe('unknown');
  await expect(x.service.recordGoal('g', { ...goal, id: 'new-goal', expectedRoundId: 'old' })).rejects.toThrow();
});

function kickAction(context: Record<string, any>) {
  const source = fs.readFileSync('src/components/match/ShootoutWizard.tsx', 'utf8');
  const tree = ts.createSourceFile('ShootoutWizard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'record') expression = node.initializer!.getText(tree); ts.forEachChild(node, visit); };
  visit(tree);
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { ...context, Date, Math });
}
test('the wizard waits for acknowledgement and retries exactly the failed outcome', async () => {
  let reject!: (error: Error) => void;
  const write = jest.fn().mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r; })).mockResolvedValue(undefined);
  const ctx: any = { writing: { current: false }, attempt: { current: null }, attemptPeople: { current: null }, uiEpoch: { current: 1 }, visibleRef: { current: true }, kicker: { id: 'a' }, keeper: { id: 'b' }, kickingTeam: 'A', roundId: 'round-one', kicks: [], signature: '[]', gameId: 'g', gameService: { recordShootoutKick: write }, setBusy: jest.fn(), setReselectAllowed: jest.fn(), setSaveErrorMessage: jest.fn(), logError: jest.fn(), setSaveError: jest.fn(), setShadow: jest.fn(), setKickerId: jest.fn(), setScreen: jest.fn(), setSelectedKeeperId: jest.fn(), setCompleted: jest.fn(), contentScroll: { current: null }, rosterOf: (side: string) => [{ id: side === 'A' ? 'a' : 'b' }], logEvent: jest.fn(), AnalyticsEvent: {} };
  const record = kickAction(ctx);
  const first = record('save'); await record('goal');
  expect(write).toHaveBeenCalledTimes(1); expect(ctx.setScreen).not.toHaveBeenCalled();
  reject(Error('offline')); await first;
  expect(ctx.setSaveError).toHaveBeenLastCalledWith(true); expect(ctx.setScreen).not.toHaveBeenCalled();
  await record();
  expect(write.mock.calls[0][1]).toEqual(write.mock.calls[1][1]);
  expect(write.mock.calls[1][1].outcome).toBe('save');
  expect(ctx.setScreen).toHaveBeenLastCalledWith('kicker');
  expect(ctx.setCompleted).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'save' }));
});

 test('the server rejects reclassifying a saved miss as a save at round commit', () => {
   const kick = { kickerId: 'a', keeperId: 'b', scored: false, outcome: 'miss' };
   const game = { rotation: { roundInstanceId: 'r', updatedAt: 1 }, liveMatch: { goals: [], shootout: { kicks: [kick] } } };
   expect(matchesLiveRound(game, 'r', [], { rotationUpdatedAt: 1, penalties: [kick] })).toBe(true);
   expect(matchesLiveRound(game, 'r', [], { rotationUpdatedAt: 1, penalties: [{ ...kick, outcome: 'save' }] })).toBe(false);
 });
 test('missing and closed games never acknowledge a new kick or goal', async () => {
   const x = serviceFixture(); x.state.liveMatch.shootout = undefined;
   await expect(x.service.recordShootoutKick('g', { id:'missing',team:'A',kickerId:'a',keeperId:'b',scored:false,outcome:'miss',expectedRoundId:'round-one' })).rejects.toThrow('SHOOTOUT_CLOSED');
   x.state.status = 'finished';
   await expect(x.service.recordGoal('g', { id:'closed',team:'A',scorerId:'a',minute:1,expectedRoundId:'round-one' })).rejects.toThrow();
   expect(x.update).not.toHaveBeenCalled();
 });

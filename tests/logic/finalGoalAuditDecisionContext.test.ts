import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { rotationWriteSource } from '@/services/rotationWriteSource';
import {roundDecisionContext,matchesRoundDecision} from '@/utils/roundDecision';

// Execute the screen callback together with the real result-preparation method.
// Only the database read and final result write are isolated; no Firebase runs.
const screenText = fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx', 'utf8');
const screenFile = ts.createSourceFile('AdvancedLiveMatchScreen.tsx', screenText, ts.ScriptTarget.Latest, true);
const serviceText = fs.readFileSync('src/services/gameService.ts', 'utf8');
const serviceFile = ts.createSourceFile('gameService.ts', serviceText, ts.ScriptTarget.Latest, true);
function find(root: ts.Node, accept: (n: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => { if (accept(n)) found = n; if (!found) ts.forEachChild(n, visit); };
  visit(root); if (!found) throw Error('Source node not found'); return found;
}
const prepare = find(serviceFile, n => ts.isMethodDeclaration(n) && n.name.getText(serviceFile) === 'prepareRoundResult').getText(serviceFile);
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const clone = <T,>(x: T): T => structuredClone(x);

function world(callback: 'onShootoutDecided' | 'onTieWinner') {
  const original = { id:'audit-evening',status: 'active', format: '4v4', updatedAt: 1,
    rotation: { round: 1, roundInstanceId: 'old-round', playing: [0, 1], waiting: [2], loans: [], updatedAt: 1 },
    draftTeams: { teams: [0, 1, 2].map(index => ({ index, playerIds: [`p${index}`] })) },
    liveMatch: { scoreA: 0, scoreB: 0, goals: [], timerRunning: false, timerAccumulatedMs: 0 },
  } as any;
  let state = clone(original); let deliver!: () => void;
  const ready = new Promise<void>(resolve => { deliver = resolve; }); let reads = 0;
  const commits = jest.fn(async (_gameId, _live, rotation, _draft, winnerSide) => {
    state.lastCommittedRoundId = rotation.roundInstanceId;
    return { winnerSide, tieResolution: undefined };
  });
  const context: any = { module: { exports: {} }, roundCommitKey: (r: any) => r.roundInstanceId,
    rotationWriteSource, matchesRoundDecision, playersPerTeamFor: () => 4, effFillMode: () => 'off',
    recordWinnerSkeleton: (winner: number) => ({ winner }),
  };
  vm.runInNewContext(compile(`module.exports={${prepare}};`), context);
  const service = context.module.exports;
  service._commitRoundStatsAndClear = commits;
  service.getGameById = async () => { if (++reads === 1) await ready; return clone(state); };
  const scope: any = { module: { exports: {} }, gameId: 'audit-evening', me: { id: 'manager' },
    game:{...original,id:'audit-evening'},roundDecisionContext,
    rotation: original.rotation, draftTeams: original.draftTeams, live: original.liveMatch,
    currentRoundKey: 'old-round', currentPlayingKey: '0:1', pendingSavedRound: false, shootoutDecision: null,
    finalizingRef: { current: false }, committingRef: { current: false }, fillFlowRef: { current: null },
    markBusy: jest.fn(), gameService: service, captureRoundForResult: jest.fn(), beginFillFlow: jest.fn(),
    setShootoutOpen: jest.fn(), setWinnerOpen: jest.fn(), setDecisionOpen: jest.fn(),
    logEvent: jest.fn(), AnalyticsEvent: {}, logError: jest.fn(), toast: { error: jest.fn() },
    roundSaveError: (_: any, text: string) => text, he: { roundFinalizeFailed: 'השמירה נכשלה' }, __DEV__: false,
  };
  const arrow = find(screenFile, n => ts.isVariableDeclaration(n) && n.name.getText(screenFile) === callback) as ts.VariableDeclaration;
  vm.runInNewContext(compile(`module.exports=${arrow.initializer!.getText(screenFile)};`), scope);
  return { commits, invoke: scope.module.exports, advance: (kind='round') => {
    if(kind==='round')state.rotation = { ...state.rotation, round: 2, roundInstanceId: 'new-round', playing: [1, 2], updatedAt: 2 };
    if(kind==='lineup')state.draftTeams.teams[0].playerIds=['different-player'];
    if(kind==='kick')state.liveMatch.shootout={firstTeam:'A',kicks:[{id:'new-kick',team:'A',scored:true}]};
    if(kind==='goal')state.liveMatch={...state.liveMatch,scoreA:1,goals:[{id:'new-goal',team:'A'}]};
    if(kind==='clock')state.liveMatch={...state.liveMatch,timerRunning:false,timerAccumulatedMs:987};
    deliver();
  }, read: () => clone(state) };
}

test.each(['onShootoutDecided', 'onTieWinner'] as const)('%s cannot commit a different round that became current during the initial read', async callback => {
  const w = world(callback);
  const pending = w.invoke(callback === 'onTieWinner' ? 0 : 'A');
  w.advance();
  await Promise.resolve(pending).catch(() => undefined);
  expect(w.commits).not.toHaveBeenCalled();
  expect(w.read().lastCommittedRoundId).toBeUndefined();
});

test.each(['onShootoutDecided','onTieWinner'] as const)('%s accepts the same board after a clock-only pause',async callback=>{
  const w=world(callback);const pending=w.invoke(callback==='onTieWinner'?0:'A');w.advance('clock');
  await pending;expect(w.commits).toHaveBeenCalledTimes(1);expect(w.commits.mock.calls[0][2].roundInstanceId).toBe('old-round');
});

test.each(['lineup','kick','goal'])('a changed %s in the same round invalidates the stale decision before any write',async kind=>{
  const w=world('onShootoutDecided');const pending=w.invoke('A');w.advance(kind);
  await expect(pending).rejects.toThrow();expect(w.commits).not.toHaveBeenCalled();
});

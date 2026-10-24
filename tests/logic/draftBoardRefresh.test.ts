import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import {draftColorTeams} from '@/utils/draftColors';

const file = ts.createSourceFile('DraftBoardScreen.tsx', fs.readFileSync('src/screens/games/DraftBoardScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loader = '';
function visit(n: ts.Node) {
  if (ts.isCallExpression(n) && n.expression.getText(file) === 'useCallback' && n.arguments[0].getText(file).includes("logError('draftBoardLoad'")) loader = n.arguments[0].getText(file);
  ts.forEachChild(n, visit);
} visit(file);

const flush = () => new Promise<void>(done => setImmediate(done));
function setup() {
  const state: any = { loading: false, failed: false, game: { id: 'round', revision: 'old' } };
  const context: any = { module: { exports: {} }, AbortController, gameId: 'round', readOnly: true, resume: false,
    ownerKey: 'current', currentOwner: { current: 'current' }, expectedDraftCreatedAt: undefined, setRequestOwner: jest.fn(),
    currentUser: { id: 'owner' }, myCommunities: [], captainIds: [],
    gameService: { getGameById: jest.fn() },
    setLoading: (v: boolean) => state.loading = v, setLoadFailed: (v: boolean) => state.failed = v,
    setGame: (v: any) => state.game = v, logError: jest.fn(), logEvent: jest.fn(), AnalyticsEvent: {},
    hydratePlayers: jest.fn(), isGuestId: () => false, draftColorTeams, setTeamColors: jest.fn(),
  };
  vm.runInNewContext(ts.transpileModule(`module.exports=${loader}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { state, context, focus: context.module.exports };
}

test('returning to a reused board hides the old split until the current split is loaded', async () => {
  const { state, context, focus } = setup();
  let resolve: (g: any) => void = () => {};
  context.gameService.getGameById.mockReturnValue(new Promise(done => resolve = done));
  focus(); expect(state.loading).toBe(true);
  const latest = { id: 'round', revision: 'new', createdBy: 'owner', players: [], draftTeams: { teams: [] } };
  resolve(latest); await flush();
  expect(state.loading).toBe(false); expect(state.failed).toBe(false); expect(state.game).toBe(latest);
});

test('a failed refresh stays in an explicit failure state instead of claiming the old split is current', async () => {
  const { state, context, focus } = setup();
  context.gameService.getGameById.mockRejectedValue(new Error('offline'));
  focus(); await flush();
  expect(state.failed).toBe(true); expect(state.loading).toBe(false); expect(state.game.revision).toBe('old');
});

test('a response from a blurred board cannot replace the newer focused read', async () => {
  const { state, context, focus } = setup();
  let resolveOld: (g: any) => void = () => {};
  context.gameService.getGameById.mockReturnValueOnce(new Promise(done => resolveOld = done)).mockResolvedValueOnce({ id: 'round', revision: 'new', createdBy: 'owner', players: [] });
  const blur = focus(); blur(); focus(); await flush();
  resolveOld({ id: 'round', revision: 'old response', createdBy: 'owner', players: [] }); await flush();
  expect(state.game.revision).toBe('new'); expect(state.loading).toBe(false);
});

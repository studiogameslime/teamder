import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { rankChampionshipRows } from '../../src/utils/championship';

function expression(file: string, name: string) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = '';
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(tree) === name) text = node.getText(tree);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(tree).replace(/^export\s+/, '');
    ts.forEachChild(node, visit);
  }
  visit(tree); if (!text) throw Error(`Missing source ${name}`);
  return text;
}
function compile(text: string, context: Record<string, unknown>) {
  return vm.runInNewContext(ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
}

function serviceWorld(options: { fail?: 'totals' | 'rows'; missing?: boolean } = {}) {
  const error = Object.assign(Error('read unavailable'), { code: 'unavailable' });
  const service = compile(`{${expression('src/services/gameService.ts', 'getCommunityTotals')},${expression('src/services/gameService.ts', 'getCommunityChampionship')}}`, {
    USE_MOCK_DATA: false, __DEV__: false, getFirebase: () => ({ db: {} }), logError() {},
    doc: (_db: unknown, kind: string, id: string) => ({ kind, id }),
    collection: (_db: unknown, kind: string) => ({ kind }), where: () => ({}), query: (value: unknown) => value,
    getDoc: async () => { if (options.fail === 'totals') throw error; return { exists: () => !options.missing, data: () => ({ goals: 9, rounds: 4 }) }; },
    getDocs: async () => { if (options.fail === 'rows') throw error; return { docs: options.missing ? [] : [{ data: () => ({ userId: 'a', goals: 9, rounds: 4 }) }] }; },
    rankChampionshipRows,
  });
  return { service, error };
}

test('the actual totals service throws the original failure instead of a successful zero', async () => {
  const x = serviceWorld({ fail: 'totals' });
  await expect(x.service.getCommunityTotals('club')).rejects.toBe(x.error);
});
test.each([false, true])('the actual championship propagates a failed totals read with strict=%s', async strict => {
  const x = serviceWorld({ fail: 'totals' });
  await expect(x.service.getCommunityChampionship('club', undefined, strict)).rejects.toBe(x.error);
});
test.each([false, true])('the actual championship propagates a failed player query with strict=%s', async strict => {
  const x = serviceWorld({ fail: 'rows' });
  await expect(x.service.getCommunityChampionship('club', undefined, strict)).rejects.toBe(x.error);
});
test('a successful missing totals document remains zero and a successfully empty table remains empty', async () => {
  const x = serviceWorld({ missing: true });
  await expect(x.service.getCommunityTotals('club')).resolves.toEqual({ goals: 0, rounds: 0 });
  await expect(x.service.getCommunityChampionship('club')).resolves.toMatchObject({ totalGoals: 0, totalRounds: 0, players: [] });
});
test('normal service values still use the club counters and real player rows', async () => {
  const x = serviceWorld();
  await expect(x.service.getCommunityTotals('club')).resolves.toEqual({ goals: 9, rounds: 4 });
  await expect(x.service.getCommunityChampionship('club')).resolves.toMatchObject({ totalGoals: 9, totalRounds: 4, players: [{ uid: 'a', goals: 9 }] });
});

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function hookWorld() {
  const slots: any[] = []; let cursor = 0; const effects: { run: () => (() => void) | void; deps: unknown[]; index: number }[] = [];
  const totals = jest.fn(), archives = jest.fn(); let viewer = 'viewer';
  const depsEqual = (a: unknown[], b: unknown[]) => a?.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hook = compile(expression('src/screens/communities/CommunityDetailsScreen.tsx', 'useCommunityLifetimeTotals'), {
    useRef: (initial: unknown) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useEffect: (run: any, deps: unknown[]) => { const index = cursor++; if (!slots[index] || !depsEqual(slots[index].deps, deps)) {
      // React commits only the latest render's effect, not every render that
      // happened before the commit. Preserve that rule in this hook adapter.
      const pending = effects.findIndex(effect => effect.index === index);
      if (pending >= 0) effects.splice(pending, 1);
      effects.push({ run, deps, index });
    } },
    gameService: { getCommunityTotals: totals }, seasonHistoryService: { list: archives },
    useUserStore: { getState: () => ({ currentUser: viewer ? { id: viewer } : null }) },
  });
  const input = { groupId: 'club', viewerId: 'viewer', enabled: true, archivesNeeded: false, archiveVersion: 0, reloadTick: 0 };
  const render = (patch: Partial<typeof input> = {}) => { Object.assign(input, patch); cursor = 0; return hook(input); };
  const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  const flush = async () => { for (const effect of effects.splice(0)) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { deps: effect.deps, cleanup: effect.run() }; }
    await settle(); };
  const unmount = () => { for (const slot of slots) slot?.cleanup?.(); };
  return { render, flush, settle, totals, archives, unmount, setViewer: (value: string) => { viewer = value; } };
}

test('initial failure stays unknown, retry can load a real zero and never invents an empty success', async () => {
  const x = hookWorld(); x.totals.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ goals: 0, rounds: 0 });
  expect(x.render()).toEqual({ data: null, failed: false }); await x.flush();
  expect(x.render()).toEqual({ data: null, failed: true });
  x.render({ reloadTick: 1 }); await x.flush(); expect(x.render()).toEqual({ data: { goals: 0, rounds: 0 }, failed: false });
});
test('refresh failure keeps the last complete lifetime total and retry updates it', async () => {
  const x = hookWorld(); x.totals.mockResolvedValueOnce({ goals: 10, rounds: 4 }).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ goals: 12, rounds: 5 });
  x.archives.mockResolvedValue([{ totals: { goals: 7, rounds: 3 } }]);
  x.render({ archivesNeeded: true, archiveVersion: 1 }); await x.flush(); expect(x.render().data).toEqual({ goals: 17, rounds: 7 });
  x.render({ reloadTick: 1 }); await x.flush(); expect(x.render()).toEqual({ data: { goals: 17, rounds: 7 }, failed: true });
  x.render({ reloadTick: 2 }); await x.flush(); expect(x.render()).toEqual({ data: { goals: 19, rounds: 8 }, failed: false });
});
test('an unavailable archive never publishes a partial lifetime count or overwrites a known total', async () => {
  const x = hookWorld(); x.totals.mockResolvedValue({ goals: 10, rounds: 4 });
  x.archives.mockResolvedValueOnce('error').mockResolvedValueOnce([{ totals: { goals: 7, rounds: 3 } }]).mockResolvedValueOnce('error');
  x.render({ archivesNeeded: true }); await x.flush(); expect(x.render()).toEqual({ data: null, failed: true });
  x.render({ reloadTick: 1 }); await x.flush(); expect(x.render().data).toEqual({ goals: 17, rounds: 7 });
  x.render({ reloadTick: 2 }); await x.flush(); expect(x.render()).toEqual({ data: { goals: 17, rounds: 7 }, failed: true });
});
test('changing club hides old totals before effects and ignores a late previous-club response', async () => {
  const x = hookWorld(), old = deferred<{ goals: number; rounds: number }>();
  x.totals.mockResolvedValueOnce({ goals: 10, rounds: 4 }).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ goals: 99, rounds: 30 });
  x.render(); await x.flush(); x.render({ reloadTick: 1 }); await x.flush();
  expect(x.render({ groupId: 'other' }).data).toBeNull(); await x.flush(); old.resolve({ goals: 1, rounds: 1 }); await x.flush();
  expect(x.render().data).toEqual({ goals: 99, rounds: 30 });
});
test('a new refresh invalidates a late response even before the previous effect cleanup executes', async () => {
  const x = hookWorld(), pending = deferred<{ goals: number; rounds: number }>();
  x.totals.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ goals: 22, rounds: 6 });
  x.render(); await x.flush(); x.render({ reloadTick: 1 });
  pending.resolve({ goals: 10, rounds: 4 }); await x.settle();
  expect(x.render().data).toBeNull();
  await x.flush(); expect(x.render().data).toEqual({ goals: 22, rounds: 6 });
});
test('switching viewer invalidates totals and prevents a pending result from a previous session', async () => {
  const x = hookWorld(), pending = deferred<{ goals: number; rounds: number }>(); x.totals.mockReturnValueOnce(pending.promise);
  x.render(); await x.flush(); x.setViewer('new-viewer'); pending.resolve({ goals: 10, rounds: 4 }); await x.flush();
  expect(x.render().data).toBeNull();
  x.totals.mockResolvedValueOnce({ goals: 22, rounds: 6 }); x.render({ viewerId: 'new-viewer' }); await x.flush();
  expect(x.render().data).toEqual({ goals: 22, rounds: 6 });
});
test('a disabled non-member does not query counters and cannot see an earlier answer', async () => {
  const x = hookWorld(); x.totals.mockResolvedValue({ goals: 10, rounds: 4 });
  expect(x.render({ enabled: false }).data).toBeNull(); await x.flush(); expect(x.totals).not.toHaveBeenCalled();
  x.render({ enabled: true }); await x.flush(); expect(x.render().data).toEqual({ goals: 10, rounds: 4 });
  expect(x.render({ enabled: false }).data).toBeNull(); await x.flush();
});
test('unmount ignores a pending successful read', async () => {
  const x = hookWorld(), pending = deferred<{ goals: number; rounds: number }>(); x.totals.mockReturnValueOnce(pending.promise);
  x.render(); await x.flush(); x.unmount(); pending.resolve({ goals: 5, rounds: 2 }); await x.flush();
  expect(x.render().data).toBeNull();
});

test('the actual stats section shows unknown counters as dashes, a true zero as zero and a real retry action', () => {
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  const component = compile(expression('src/screens/communities/CommunityDetailsScreen.tsx', 'CommunityStatsSection'), {
    React: react, View: 'View', Text: 'Text', Button: 'Button', StatCell: 'StatCell',
    statsSectionStyles: {}, clubAccent: {}, colors: {}, spacing: {}, RTL_LABEL_ALIGN: 'left',
    he: { communityStatsTitle: 'נתוני מועדון', retry: 'נסו שוב' },
  });
  const flatten = (value: any): any[] => Array.isArray(value) ? value.flatMap(flatten) : value?.props ? [value, ...flatten(value.props.children)] : [];
  const retry = jest.fn(); const props = { stats: { totalFinished: 2, totalCancelled: 0 }, memberCount: 5, goals: null, miniGames: null, readFailed: true, onRetry: retry };
  const missing = flatten(component(props));
  expect(missing.filter(node => node.type === 'StatCell').map(node => node.props.value)).toEqual(['5', '—', '2', '—']);
  missing.find(node => node.type === 'Button').props.onPress(); expect(retry).toHaveBeenCalledTimes(1);
  const zero = flatten(component({ ...props, goals: 0, miniGames: 0, readFailed: false }));
  expect(zero.filter(node => node.type === 'StatCell').map(node => node.props.value)).toEqual(['5', '0', '2', '0']);
  expect(zero.some(node => node.type === 'Button')).toBe(false);
});

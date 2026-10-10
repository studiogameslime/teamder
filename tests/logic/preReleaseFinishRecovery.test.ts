import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { eveningScoreServer } from '../../functions/src/eveningScoreCore';
import { computeMovement } from '../../functions/src/eveningMovement';
import { assertSeasonOpenForGame } from '../../functions/src/seasonLock';

const file = path.resolve(__dirname, '../../functions/src/index.ts');
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
let finish: ts.IfStatement;
let pairsFunction: ts.FunctionDeclaration;
let summaryFunction: ts.FunctionDeclaration;
let seasonGuard: ts.FunctionDeclaration;
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source).includes('!wasHappened') && node.expression.getText(source).includes('isHappened')) finish = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'rollUpClubPairs') pairsFunction = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'sealRoundSummary') summaryFunction = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'guardFinishSeasonBatch') seasonGuard = node;
  ts.forEachChild(node, visit);
}
visit(source);
const compile = (body: string) => ts.transpileModule(body, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const copy = (value: any) => JSON.parse(JSON.stringify(value));
function store() {
  const data = new Map<string, any>();
  let failure: ((paths: string[]) => boolean) | undefined;
  const snapshot = (key: string) => ({ exists: data.has(key), id: key.split('/').pop(), ref: ref(key), data: () => copy(data.get(key) ?? {}), get: (field: string) => data.get(key)?.[field] });
  const merge = (target: any, patch: any): any => {
    const next = { ...target };
    for (const [key, value] of Object.entries(patch) as [string, any][]) {
      if (value?.increment !== undefined) next[key] = (next[key] ?? 0) + value.increment;
      else if (value && typeof value === 'object' && !Array.isArray(value)) next[key] = merge(next[key] ?? {}, value);
      else next[key] = value;
    }
    return next;
  };
  function ref(key: string, filters: [string, unknown][] = []): any {
    return { path: key,
      collection: (name: string) => ref(key + '/' + name), doc: (id: string) => ref(key + '/' + id),
      where: (field: string, _: string, value: unknown) => ref(key, [...filters, [field, value]]),
      get: async () => {
        if (key.split('/').length % 2 === 0) return snapshot(key);
        const rows = [...data.keys()].filter(path => path.startsWith(key + '/') && path.split('/').length === key.split('/').length + 1 && filters.every(([field, value]) => data.get(path)?.[field] === value));
        return { docs: rows.map(snapshot) };
      },
      create: async (value: any) => { if (data.has(key)) throw { code: 6 }; data.set(key, copy(value)); },
      set: async (value: any) => data.set(key, merge(data.get(key), value)),
    };
  }
  const db = { collection: ref, getAll: async (...refs: any[]) => Promise.all(refs.map(ref => ref.get())), batch: () => {
    const ops: { type: string; path: string; value: any }[] = [];
    return { create: (ref: any, value: any) => ops.push({ type: 'create', path: ref.path, value }),
      set: (ref: any, value: any) => ops.push({ type: 'set', path: ref.path, value }),
      commit: async () => {
        if (failure?.(ops.map(op => op.path))) throw new Error('injected batch failure');
        if (ops.some(op => op.type === 'create' && data.has(op.path))) throw { code: 6 };
        // All validation happens first, matching an atomic Firestore batch.
        for (const op of ops) data.set(op.path, op.type === 'create' ? copy(op.value) : merge(data.get(op.path), op.value));
      },
    };
  } };
  return { db, data, ref, fail: (fn?: typeof failure) => { failure = fn; } };
}
const admin = { firestore: { FieldValue: { increment: (increment: number) => ({ increment }) } } };
function finishWorld(stage: 'attendance' | 'standings' | 'summary' | 'pairs' | undefined) {
  const w = store();
  w.data.set('gamePlayerStats/g__a', { userId: 'a', gameId: 'g', goals: 1, assists: 0, wins: 1, rounds: 1 });
  w.data.set('communityPlayerStats/club__a', { groupId: 'club', userId: 'a', goals: 1, assists: 0, wins: 1 });
  const calls = { summary: 0, pairs: 0 };
  let failed = false;
  if (stage === 'attendance' || stage === 'standings') w.fail(paths => {
    const target = stage === 'attendance' ? 'games/g/finishCredited/once' : 'games/g/finishStages/standings';
    if (!failed && paths.includes(target)) { failed = true; return true; }
    return false;
  });
  const context: any = { module: { exports: {} }, db: w.db, admin, eveningScoreServer, computeMovement,
    wasHappened: false, isHappened: true,
    after: { groupId: 'club', players: ['a'], startsAt: 100, status: 'finished' },
    event: { params: { gameId: 'g' }, data: { after: { ref: w.ref('games/g') } } },
    groupOnce: async () => ({ data: () => ({}) }), stampedSeasonId: '', assertSeasonOpenForGame: () => {},
    guardFinishSeasonBatch: async () => {},
    sealRoundSummary: async () => { calls.summary++; if (stage === 'summary' && !failed) { failed = true; throw new Error('injected summary failure'); } },
    rollUpClubPairs: async () => { calls.pairs++; if (stage === 'pairs' && !failed) { failed = true; throw new Error('injected pairs failure'); } },
    createNotificationOnce: async () => {}, console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  vm.runInNewContext(compile('module.exports = async function(){' + finish.getText(source) + '}'), context);
  return { ...w, context, calls, run: () => context.module.exports() };
}

describe('the actual finished-evening trigger resumes individual stages', () => {
  it.each(['attendance', 'standings', 'summary', 'pairs'] as const)('recovers a failure in %s without double counts', async stage => {
    const w = finishWorld(stage);
    await expect(w.run()).rejects.toThrow('injected');
    await w.run(); await w.run();
    expect(w.data.get('communityPlayerStats/club__a').games).toBe(1);
    expect(w.data.get('communityPlayerStats/club__a').eveningScoreCount).toBe(1);
    expect(w.data.get('communityStats/club').kingGoalsCount).toBe(1);
    expect(w.data.has('games/g/finishStages/complete')).toBe(true);
    w.context.wasHappened = true;
    const before = copy([...w.data.entries()]); await w.run(); expect([...w.data.entries()]).toEqual(before);
  });
  it('preserves the original score delta when recovery occurs after standings', async () => {
    const w = finishWorld('summary');
    await expect(w.run()).rejects.toThrow();
    const original = copy(w.data.get('eveningStandings/g__a'));
    await w.run(); expect(w.data.get('eveningStandings/g__a')).toEqual(original);
  });
  it('recognises old atomic standings rows that predate the new stage marker', async () => {
    const w = finishWorld(undefined); await w.run();
    w.data.delete('games/g/finishStages/standings'); w.data.delete('games/g/finishStages/complete');
    await w.run(); expect(w.data.get('communityPlayerStats/club__a').eveningScoreCount).toBe(1);
    expect(w.data.get('games/g/finishStages/standings').legacy).toBe(true);
  });
  it('refuses a new credit to a closed season before changing attendance', async () => {
    const w = finishWorld(undefined); w.context.assertSeasonOpenForGame = () => { throw new Error('closedSeasonGame'); };
    await expect(w.run()).rejects.toThrow('closedSeasonGame');
    expect(w.data.get('communityPlayerStats/club__a').games).toBeUndefined();
  });
});

describe('real chunked chemistry rollup recovery', () => {
  it('a second-chunk failure resumes without incrementing the first 450 pairs twice', async () => {
    const w = store();
    const entries = Object.fromEntries(Array.from({ length: 451 }, (_, i) => ['a' + i + '__b', { sameTeam: 1, winsTogether: 1, lossesTogether: 0, cleanSheetsTogether: 0, against: 0, winsA: 0, winsB: 0, assistsAToB: 0, assistsBToA: 0 }]));
    let failed = false;
    w.fail(paths => { if (!failed && paths.includes('communityPairRollups/club__g/chunks/1')) { failed = true; return true; } return false; });
    const context: any = { module: { exports: {} }, db: w.db, admin,
      guardFinishSeasonBatch: async () => {},
      isPersonalGroup: async () => false, pairsFromRounds: () => entries, pairMembers: (key: string) => key.split('__'),
      console: { log: () => {} },
    };
    vm.runInNewContext(compile(pairsFunction.getText(source) + '; module.exports = rollUpClubPairs;'), context);
    const args = { gameId: 'g', groupId: 'club', at: 100, rounds: [{}] };
    await expect(context.module.exports(args)).rejects.toThrow('injected');
    expect(w.data.has('communityPairRollups/club__g')).toBe(false);
    await context.module.exports(args); await context.module.exports(args);
    const pairRows = [...w.data.entries()].filter(([key]) => key.startsWith('communityPairStats/'));
    expect(pairRows).toHaveLength(451); expect(pairRows.every(([, row]) => row.sameTeam === 1)).toBe(true);
    expect(w.data.has('communityPairRollups/club__g')).toBe(true);
  });
});

describe('summary and baseline use the actual atomic write body', () => {
  it('a failed summary batch writes no summary or counter, then retries once', async () => {
    const w = store();
    const statements = summaryFunction.body!.statements;
    const start = statements.findIndex(statement => statement.getText(source).startsWith('const next = nextRecordBaseline'));
    const end = statements.findIndex(statement => statement.getText(source).startsWith('console.log('));
    const body = statements.slice(start, end).map(statement => statement.getText(source)).join('\n');
    expect(body).toContain('batch.create(summaryRef'); expect(body).not.toContain('summaryRef.create(');
    let failed = false; w.fail(() => { if (!failed) { failed = true; return true; } return false; });
    const context: any = { module: { exports: {} }, db: w.db, admin, gameId: 'g', groupId: 'club',
      summaryRef: w.ref('roundSummaries/g'), summary: { stats: { rounds: 1 } }, lateConfirmation: false,
      nextRecordBaseline: () => ({}), baseline: {}, players: [], rec: {}, args: { at: 100 },
      num: (v: any) => typeof v === 'number' ? v : 0, seasonRoundsAtStart: 0, personalBests: {},
      guardFinishSeasonBatch: async () => {},
    };
    vm.runInNewContext(compile('module.exports = async function(){' + body + '}'), context);
    await expect(context.module.exports()).rejects.toThrow('injected');
    expect(w.data.has('roundSummaries/g')).toBe(false); expect(w.data.has('clubRecords/club')).toBe(false);
    await context.module.exports(); await context.module.exports();
    expect(w.data.get('clubRecords/club').eveningsSealed).toBe(1);
    expect(w.data.get('groups/club').seasons.playedRounds).toBe(1);
  });
});


describe('actual season-version guard on every additive finish stage', () => {
  function guardWorld(current = 's1') {
    const updates: any[] = [];
    const snapshot = { exists: true, updateTime: 7, data: () => ({ seasons: { enabled: true, currentNo: 2, currentId: current } }) };
    const ref = { get: async () => snapshot };
    const context: any = { module: { exports: {} }, db: { collection: () => ({ doc: () => ref }) }, assertSeasonOpenForGame };
    vm.runInNewContext(compile(seasonGuard.getText(source) + '; module.exports = guardFinishSeasonBatch;'), context);
    return { updates, run: () => context.module.exports({ update: (...args: any[]) => updates.push(args) }, 'club', 's1') };
  }
  it('closed season refuses the pending stage before it queues any write', async () => {
    const w = guardWorld('s2'); await expect(w.run()).rejects.toThrow('closedSeasonGame'); expect(w.updates).toHaveLength(0);
  });
  it('binds the batch to the group version so a concurrent season close rejects it atomically', async () => {
    const w = guardWorld(); await w.run(); expect(w.updates).toHaveLength(1);
    expect(w.updates[0][2]).toEqual({ lastUpdateTime: 7 });
  });
});

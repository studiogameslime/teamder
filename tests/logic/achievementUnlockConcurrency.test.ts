import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { ACHIEVEMENTS, resolveTier, TIER_META } from '@/data/achievements';
import { defaultAchievementState } from '@/types';

// Run the actual persistence/diff functions with a local optimistic transaction
// boundary, without importing native/storage services or contacting Firebase.
function fixture(initial: any[] = [], exists = true) {
  const source = ts.createSourceFile('achievements.ts', fs.readFileSync('src/services/achievementsService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['readState', 'diffUnlocks', 'persistFirebase']);
  const functions = source.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.name && names.has(s.name.text));
  expect(functions).toHaveLength(3);
  let stored = initial, version = 0, reads = 0;
  const writes: any[][] = [];
  let releaseReads!: () => void;
  const bothReads = new Promise<void>(r => { releaseReads = r; });
  let releaseGold!: () => void;
  const goldWritten = new Promise<void>(r => { releaseGold = r; });
  let concurrent = false;
  const runTransaction = jest.fn(async (_db, work) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      let readVersion = version, pending: any[] | undefined;
      const result = await work({
        get: async () => {
          readVersion = version;
          const snapshot = { achievements: { unlocked: [...stored] } };
          reads++;
          if (concurrent && reads <= 2) {
            if (reads === 2) releaseReads();
            await bothReads;
          }
          return { exists: () => exists, data: () => snapshot };
        },
        update: (_ref: unknown, patch: any) => { pending = patch['achievements.unlocked']; },
      });
      if (concurrent && attempt === 0 && pending?.some(u => u.id === 'goals' && u.tier === 'bronze')) await goldWritten;
      if (readVersion !== version) continue;
      if (pending) { stored = pending; version++; writes.push(pending); releaseGold(); }
      return result;
    }
    throw Error('Transaction did not converge');
  });
  const logNewlyUnlocked = jest.fn();
  const context: any = { exports: {}, ACHIEVEMENTS, resolveTier, TIER_META, defaultAchievementState,
    runTransaction, getFirebase: () => ({ db: {} }), docs: { user: (id: string) => id }, logNewlyUnlocked };
  const text = functions.map(f => f.getText(source)).join('\n') + '\nexports.persist = persistFirebase;';
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { persist: context.exports.persist, writes, logNewlyUnlocked,
    concurrent: () => { concurrent = true; }, stored: () => stored, reads: () => reads };
}

test('a concurrent stale bronze sync cannot overwrite a committed gold badge', async () => {
  const f = fixture(); f.concurrent();
  const [gold, bronze] = await Promise.all([f.persist('player', { goals: 100 }), f.persist('player', { goals: 5 })]);
  expect(f.stored()).toEqual([expect.objectContaining({ id: 'goals', tier: 'gold' })]);
  expect(f.reads()).toBe(3); // loser retries against the committed gold
  expect(f.writes).toHaveLength(1);
  expect(gold).toEqual([expect.objectContaining({ tier: 'gold' })]);
  expect(bronze).toEqual([]);
  expect(f.logNewlyUnlocked).toHaveBeenCalledTimes(1);
});

test('an already-earned tier and its timestamp survive a lower derived count', async () => {
  const earned = { id: 'goals', tier: 'gold', unlockedAt: 123 };
  const f = fixture([earned]);
  expect(await f.persist('player', { goals: 0 })).toEqual([]);
  expect(f.stored()).toEqual([earned]);
  expect(f.writes).toEqual([]);
  expect(f.logNewlyUnlocked).not.toHaveBeenCalled();
});

test('missing users do not get created while reconciling achievements', async () => {
  const f = fixture([], false);
  expect(await f.persist('missing', { goals: 100 })).toEqual([]);
  expect(f.writes).toEqual([]);
});

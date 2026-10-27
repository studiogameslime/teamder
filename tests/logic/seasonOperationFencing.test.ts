import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as policy from '../../functions/src/seasonPolicy';
import * as dates from '../../functions/src/seasonDates';

/** Actual manager methods; the transaction adapter retries when its read changes. */
function fixture(enabled = true) {
  let club: any = { name: 'club', adminIds: ['admin'], seasons: { enabled, currentId: 's3', currentNo: 3,
    count: 2, revision: 4, startedAt: 1000, playedRounds: 2, cadence: { type: 'rounds', targetRounds: 24 } } };
  const clone = (value: any) => JSON.parse(JSON.stringify(value));
  const deleted = { delete: true };
  const merge = (target: any, input: any) => {
    for (const [key, value] of Object.entries(input) as Array<[string, any]>) {
      if (value === deleted || value?.delete === true) delete target[key];
      else if (value?.union) target[key] = [...(target[key] ?? []), value.union];
      else if (value && typeof value === 'object' && !Array.isArray(value)) merge(target[key] ??= {}, value);
      else target[key] = value;
    }
  };
  let takeover: ((patch: any) => boolean) | undefined;
  const replace = (patch: any) => {
    if (!takeover?.(patch)) return;
    takeover = undefined;
    club.seasons = { ...club.seasons, currentId: 's4', currentNo: 4, revision: 9,
      cadence: { type: 'rounds', targetRounds: 30 }, operation: { token: 'new-token', phase: true } };
  };
  const snapshot = () => { const captured = clone(club); return { exists: true, data: () => captured,
    get: (key: string) => key.split('.').reduce((v, part) => v?.[part], captured) }; };
  const ref: any = { id: 'club', get: async () => snapshot(),
    set: jest.fn(async (patch: any) => { replace(patch); merge(club, patch); }),
    update: jest.fn(async (patch: any) => {
      replace(patch);
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.'); let at = club;
        for (const part of parts.slice(0, -1)) at = at[part] ??= {};
        at[parts.at(-1)!] = value;
      }
    }) };
  const db = { collection: (name: string) => ({ doc: () => name === 'groups' ? ref : { get: async () => ({ get: () => 0 }) } }),
    runTransaction: async (callback: any) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = JSON.stringify(club), writes: any[] = [];
        const result = await callback({ get: async () => snapshot(), set: (_ref: any, patch: any) => writes.push(patch) });
        for (const patch of writes) replace(patch);
        if (JSON.stringify(club) !== before) continue;
        for (const patch of writes) merge(club, patch);
        return result;
      }
      throw new Error('retry budget exhausted');
    } };
  const finish = jest.fn(async () => {});
  const acquire = jest.fn(async () => {
    club.seasons.operation = { token: 'old-token', phase: false };
    return { token: 'old-token', markMutating: jest.fn(async () => {}), finish };
  });
  class Refused extends Error { constructor(public code: string, message: string) { super(message); } }
  const imports: any = { './serverErrorLog': { observeCaughtError: jest.fn() },
    'firebase-admin': { firestore: { FieldValue: { delete: () => deleted, arrayUnion: (value: any) => ({ union: value }) } } },
    'firebase-functions/v2/https': { HttpsError: Refused }, './seasonOperation': { acquireSeasonOperation: acquire },
    './seasonPolicy': policy, './seasonDates': dates, './seasonLock': { assertSeasonTargetEditable: () => {} },
    './seasonPublication': { publishSeason: jest.fn(async () => {}) },
    './seasonUnassigned': { restoreUnassignedPeriods: jest.fn(async () => {}), unassignedSeasonActivity: async () => ({ games: [], periods: [] }) },
    './seasonRollover': { closeSeason: jest.fn(async () => {}) }, './eveningPlayed': {} };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('functions/src/seasonManager.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: (id: string) => imports[id], Date, console });
  const manager = new module.exports.SeasonManager({ db, now: () => 10000 });
  manager.refresh = jest.fn(async () => {});
  manager.preview = jest.fn(async () => ({ played: 0, startsAt: 1000, unverified: 0 }));
  manager.games = jest.fn(async () => []);
  const target = (scope: 'current' | 'next' = 'current') => manager.updateTarget({ groupId: 'club', policyVersion: 2, cadenceType: 'rounds', targetRounds: 10, scope }, 'admin');
  const enable = () => manager.enable({ groupId: 'club', policyVersion: 2, historyChoice: 'fresh', cadenceType: 'rounds', targetRounds: 10 }, 'admin');
  return { target, enable, finish, state: () => clone(club), loseOwnershipOn: (predicate: (patch: any) => boolean) => { takeover = predicate; } };
}

test.each(['current', 'next'] as const)('a stale %s target writer cannot change the next operation or season', async scope => {
  const f = fixture(); f.loseOwnershipOn(patch => !!patch.seasons);
  await expect(f.target(scope)).rejects.toThrow('season-operation:stale');
  expect(f.state().seasons).toMatchObject({ currentId: 's4', revision: 9, cadence: { targetRounds: 30 }, operation: { token: 'new-token', phase: true } });
  expect(f.state().seasons.nextCadence).toBeUndefined();
  expect(f.finish).toHaveBeenCalledWith(false);
});

test('activation cannot replace a newer season after its final write loses ownership', async () => {
  const f = fixture(false); f.loseOwnershipOn(patch => patch.seasons?.enabled === true);
  await expect(f.enable()).rejects.toThrow('season-operation:stale');
  expect(f.state().seasons).toMatchObject({ currentId: 's4', revision: 9, operation: { token: 'new-token', phase: true } });
  expect(f.finish).toHaveBeenCalledWith(false);
});

test('activation cannot attach its recovery context to another operation', async () => {
  const f = fixture(false);
  f.loseOwnershipOn(patch => !!patch['seasons.operation.context'] || !!patch.seasons?.operation?.context);
  await expect(f.enable()).rejects.toThrow('season-operation:stale');
  expect(f.state().seasons.operation).toEqual({ token: 'new-token', phase: true });
});

test.each(['target', 'enable'] as const)('the current operation can still apply %s', async action => {
  const f = fixture(action !== 'enable');
  await expect(action === 'target' ? f.target() : f.enable()).resolves.toMatchObject({ ok: true });
  expect(f.state().seasons.cadence.targetRounds).toBe(10);
  expect(f.finish).toHaveBeenCalledWith(true);
});

import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('functions/src/clubDeletion.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture(initial: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(initial));
  let version = 0;
  let beforeCommit: (() => void) | undefined;
  const writes: string[] = [];
  const put = (path: string, data: any) => { store.set(path, data); version++; writes.push(path); };
  const remove = (path: string) => { store.delete(path); version++; writes.push(path); };
  const ref = (path: string): any => ({ path, id: path.split('/').pop(), get: async () => snapshot(path), delete: async () => remove(path) });
  const snapshot = (path: string): any => {
    const data = store.has(path) ? JSON.parse(JSON.stringify(store.get(path))) : undefined;
    return { id: path.split('/').pop(), ref: ref(path), exists: data !== undefined, data: () => data };
  };
  const update = (path: string, patch: any) => {
    if (!store.has(path)) throw Error('not found');
    const next = { ...store.get(path), ...patch };
    for (const [key, value] of Object.entries(patch) as any) if (value?.removeValue) next[key] = (store.get(path)[key] ?? []).filter((id: string) => id !== value.removeValue);
    put(path, next);
  };
  const query = (collection: string, filters: any[] = [], size = Infinity, cursor = ''): any => ({
    where: (field: string, op: string, value: any) => query(collection, [...filters, { field, op, value }], size, cursor),
    limit: (limit: number) => query(collection, filters, limit, cursor),
    orderBy: () => query(collection, filters, size, cursor),
    startAfter: (document: any) => query(collection, filters, size, document.ref.path),
    doc: (id: string) => ref(`${collection}/${id}`),
    get: async () => {
      const docs = [...store.keys()].sort().filter(path => path.startsWith(collection + '/') && path.split('/').length === collection.split('/').length + 1 && path > cursor)
        .filter(path => filters.every(f => f.op === 'array-contains' ? (store.get(path)[f.field] ?? []).includes(f.value) : store.get(path)[f.field] === f.value))
        .slice(0, size).map(snapshot);
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  const db: any = {
    doc: ref, collection: query,
    batch: () => {
      const pending: Array<() => void> = [];
      return { update: (document: any, patch: any) => pending.push(() => update(document.path, patch)), commit: async () => pending.forEach(write => write()) };
    },
    runTransaction: async (callback: any) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const start = version;
        const pending: Array<() => void> = [];
        const result = await callback({
          get: async (document: any) => { if (pending.length) throw Error('read after write'); return document.get(); },
          update: (document: any, patch: any) => pending.push(() => update(document.path, patch)),
          create: (document: any, data: any) => pending.push(() => { if (store.has(document.path)) throw Error('exists'); put(document.path, data); }),
        });
        const hook = beforeCommit; beforeCommit = undefined; hook?.();
        if (start !== version) continue;
        pending.forEach(write => write());
        return result;
      }
      throw Error('transaction contention');
    },
  };
  const exports: any = {};
  vm.runInNewContext(source, { exports, require: (name: string) => {
    if (name === 'firebase-admin/firestore') return { FieldValue: { arrayRemove: (value: string) => ({ removeValue: value }) } };
    throw Error(name);
  } });
  return { db, store, writes, ref, api: exports, beforeCommit: (hook: () => void) => { beforeCommit = hook; }, remove };
}

test('deleted club cancels unfinished rounds, stops every series and clears only its active subscriptions and requests', async () => {
  const world = fixture({
    'games/open': { groupId: 'gone', status: 'open', players: ['owner'], recurring: true },
    'games/finished': { groupId: 'gone', status: 'finished', recurring: true, score: 3 },
    'games/other': { groupId: 'live', status: 'open' },
    'gameSeries/other': { groupId: 'live', active: true },
    'groupJoinRequests/pending': { groupId: 'gone', status: 'pending' },
    'groupJoinRequests/approved': { groupId: 'gone', status: 'approved' },
    'users/owner': { name: 'אלירן', newGameSubscriptions: ['gone', 'live'], stats: { goals: 9 } },
    'communityShowcase/gone': { name: 'תצוגה ציבורית ישנה' },
    'seasonSummary/archive': { groupId: 'gone', goals: 9 },
    'users/owner/seasonTitles/award': { groupId: 'gone' },
  });
  for (let i = 0; i < 405; i++) {
    world.store.set(`gameSeries/${i}`, { groupId: 'gone', active: true });
    world.store.set(`games/page-${i}`, { groupId: 'gone', status: 'scheduled' });
  }
  await world.api.cancelDeletedClubActivity(world.db, 'gone', 100);
  expect(world.store.get('games/open')).toMatchObject({ status: 'cancelled', recurring: false, players: ['owner'] });
  expect(world.store.get('games/finished')).toEqual({ groupId: 'gone', status: 'finished', recurring: false, score: 3, updatedAt: 100 });
  expect([...world.store.entries()].filter(([key, data]) => key.startsWith('gameSeries/') && data.active)).toEqual([['gameSeries/other', { groupId: 'live', active: true }]]);
  expect([...world.store.values()].filter(data => data.groupId === 'gone' && data.status === 'scheduled')).toHaveLength(0);
  expect(world.store.get('games/other').status).toBe('open');
  expect(world.store.get('groupJoinRequests/pending')).toMatchObject({ status: 'rejected', decidedBy: 'system:club-deleted' });
  expect(world.store.get('groupJoinRequests/approved').status).toBe('approved');
  expect(world.store.get('users/owner')).toEqual({ name: 'אלירן', newGameSubscriptions: ['live'], stats: { goals: 9 } });
  expect(world.store.has('communityShowcase/gone')).toBe(false);
  expect(world.store.has('seasonSummary/archive')).toBe(true);
  expect(world.store.has('users/owner/seasonTitles/award')).toBe(true);
  const previous = JSON.stringify([...world.store]);
  await world.api.cancelDeletedClubActivity(world.db, 'gone', 200);
  expect(JSON.stringify([...world.store])).toBe(previous);
});

test('cleanup refuses an existing club and propagates failures without retiring the retryable series', async () => {
  const world = fixture({ 'groups/live': {}, 'gameSeries/series': { groupId: 'gone', active: true } });
  await expect(world.api.cancelDeletedClubActivity(world.db, 'live', 100)).rejects.toThrow('CLUB_DELETE_TARGET_EXISTS');
  const collection = world.db.collection;
  world.db.collection = (name: string) => { if (name === 'games') throw Error('network'); return collection(name); };
  await expect(world.api.stopOrphanSeries(world.db, world.ref('gameSeries/series'), 'gone', 100)).rejects.toThrow('network');
  expect(world.store.get('gameSeries/series').active).toBe(true);
});

test('future orphan anchors are stopped now; an intact club is untouched', async () => {
  const world = fixture({ 'gameSeries/s': { groupId: 'gone', active: true, lastOccurrenceAt: 9999999999999 }, 'groups/live': {} });
  expect(await world.api.stopOrphanSeries(world.db, world.ref('gameSeries/s'), 'gone', 100)).toBe(true);
  expect(world.store.get('gameSeries/s').active).toBe(false);
  expect(await world.api.stopOrphanSeries(world.db, world.ref('gameSeries/s'), 'live', 100)).toBe(false);
});

const game = { groupId: 'club', seriesId: 'series', startsAt: 1000, status: 'open' };
test('series creates once with concurrent workers and recognises historical random IDs', async () => {
  const world = fixture({ 'groups/club': {}, 'gameSeries/series': { groupId: 'club', active: true, lastOccurrenceAt: 1 } });
  const run = () => world.api.createSeriesOccurrence(world.db, world.ref('gameSeries/series'), game, 100, 1);
  expect((await Promise.all([run(), run()])).sort()).toEqual([false, true]);
  expect([...world.store.keys()].filter(path => path.startsWith('games/'))).toHaveLength(1);
  world.store.delete('games/series_1000'); world.store.set('games/old-random-id', game);
  expect(await run()).toBe(false);
  expect(world.store.get('gameSeries/series').lastOccurrenceAt).toBe(1000);
});

test.each(['deleted', 'soft-deleted', 'stopped'])('series creation blocks a %s club or series during transaction retry', async kind => {
  const world = fixture({ 'groups/club': {}, 'gameSeries/series': { groupId: 'club', active: true } });
  if (kind === 'deleted') world.beforeCommit(() => world.remove('groups/club'));
  if (kind === 'soft-deleted') world.store.set('groups/club', { deletedAt: 10 });
  if (kind === 'stopped') world.store.set('gameSeries/series', { groupId: 'club', active: false });
  expect(await world.api.createSeriesOccurrence(world.db, world.ref('gameSeries/series'), game, 100)).toBe(false);
  expect(world.store.has('games/series_1000')).toBe(false);
});

test('legacy cloning stops for a missing club, a vanished source or an already cancelled source', async () => {
  const world = fixture({ 'games/old': { recurring: true, status: 'open' } });
  const run = () => world.api.createLegacyOccurrence(world.db, world.ref('games/old'), world.ref('games/next'), game, 100);
  expect(await run()).toBe('stopped');
  expect(world.store.get('games/old').recurring).toBe(false);
  world.store.set('groups/club', {}); world.store.set('games/old', { recurring: true, status: 'cancelled' });
  expect(await run()).toBe('stopped');
  world.remove('games/old'); expect(await run()).toBe('stopped');
  expect(world.store.has('games/next')).toBe(false);
});

test('legacy creation and latch are atomic; deletion racing the commit prevents the clone', async () => {
  const world = fixture({ 'groups/club': {}, 'games/old': { recurring: true, status: 'open' } });
  const run = () => world.api.createLegacyOccurrence(world.db, world.ref('games/old'), world.ref('games/next'), game, 100);
  expect(await run()).toBe('created');
  expect(await run()).toBe('exists');
  expect(world.store.get('games/old').recurringNextCreatedAt).toBe(100);
  world.store.delete('games/next'); world.store.set('games/old', { recurring: true, status: 'open' });
  world.beforeCommit(() => world.remove('groups/club'));
  expect(await run()).toBe('stopped');
  expect(world.store.has('games/next')).toBe(false);
});

test('real deletion entry point retries server cleanup and both schedulers call the guarded writers', () => {
  const index = fs.readFileSync('functions/src/index.ts', 'utf8');
  expect(index).toContain('await stopOrphanSeries(db, doc.ref, sdoc.groupId, now)');
  expect(index).toContain('await createSeriesOccurrence(db, doc.ref, game, now, last)');
  expect(index).toContain('await createLegacyOccurrence(db, doc.ref, ref, { ...next, id: cloneId }, now)');
  const trigger = fs.readFileSync('functions/src/clubDeletedNotice.ts', 'utf8');
  expect(trigger).toContain('retry: true');
  expect(trigger).toContain('await cancelDeletedClubActivity(db, event.params.groupId, Date.parse(event.time))');
});

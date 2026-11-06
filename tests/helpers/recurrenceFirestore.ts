import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

export function loadRecurrenceModule(filename = 'clubDeletion.ts'): any {
  const file = path.resolve('functions/src', filename);
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => {
    if (name === 'firebase-admin/firestore') return { FieldValue: { arrayRemove: (value: string) => ({ removeValue: value }) } };
    if (name.startsWith('./')) return loadRecurrenceModule(name.slice(2) + '.ts');
    throw Error(name);
  } });
  return exports;
}

/** In-memory transaction retry and query ordering, exercising the server code. */
export function recurrenceFixture(initial: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(initial));
  let version = 0;
  let beforeCommit: (() => void) | undefined;
  const writes: string[] = [];
  const put = (key: string, data: any) => { store.set(key, data); version++; writes.push(key); };
  const remove = (key: string) => { store.delete(key); version++; writes.push(key); };
  const ref = (key: string): any => ({ path: key, id: key.split('/').pop(), get: async () => snapshot(key), delete: async () => remove(key) });
  const snapshot = (key: string): any => {
    const data = store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : undefined;
    return { id: key.split('/').pop(), ref: ref(key), exists: data !== undefined, data: () => data };
  };
  const update = (key: string, patch: any) => {
    if (!store.has(key)) throw Error('not found');
    const next = { ...store.get(key), ...patch };
    for (const [field, value] of Object.entries(patch) as any) if (value?.removeValue) next[field] = (store.get(key)[field] ?? []).filter((id: string) => id !== value.removeValue);
    put(key, next);
  };
  const query = (collection: string, filters: any[] = [], size = Infinity, cursor = '', ordering = '__name__', direction = 'asc'): any => ({
    where: (field: string, op: string, value: any) => query(collection, [...filters, { field, op, value }], size, cursor, ordering, direction),
    limit: (limit: number) => query(collection, filters, limit, cursor, ordering, direction),
    orderBy: (field: string, dir = 'asc') => query(collection, filters, size, cursor, field, dir),
    startAfter: (document: any) => query(collection, filters, size, document.ref.path, ordering, direction),
    doc: (id: string) => ref(`${collection}/${id}`),
    get: async () => {
      const docs = [...store.keys()].filter(key => key.startsWith(collection + '/') && key.split('/').length === collection.split('/').length + 1 && key > cursor)
        .filter(key => filters.every(f => {
          const value = store.get(key)[f.field];
          if (f.op === 'array-contains') return (value ?? []).includes(f.value);
          if (f.op === '<=') return value !== undefined && value <= f.value;
          return value === f.value;
        })).sort((a, b) => {
          const av = ordering === '__name__' ? a : store.get(a)[ordering];
          const bv = ordering === '__name__' ? b : store.get(b)[ordering];
          return (av < bv ? -1 : av > bv ? 1 : a.localeCompare(b)) * (direction === 'desc' ? -1 : 1);
        }).slice(0, size).map(snapshot);
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
          delete: (document: any) => pending.push(() => remove(document.path)),
        });
        const hook = beforeCommit; beforeCommit = undefined; hook?.();
        if (start !== version) continue;
        pending.forEach(write => write());
        return result;
      }
      throw Error('transaction contention');
    },
  };
  return { db, store, writes, ref, api: loadRecurrenceModule(), activity: loadRecurrenceModule('recurrenceActivity.ts'),
    beforeCommit: (hook: () => void) => { beforeCommit = hook; }, remove, put };
}

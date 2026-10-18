import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const source = ts.createSourceFile('seriesService.ts', fs.readFileSync('src/services/seriesService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let method = '';
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'ensureForGame') method = node.getText(source);
  ts.forEachChild(node, visit);
} visit(source);
function setup() {
  type Ref = { path: string; id: string };
  type Data = Record<string, any>;
  const documents = new Map<string, Data>([['games/first', { groupId: 'club', createdBy: 'owner', status: 'open', players: ['registered'] }]]);
  let serial = 0, queue = Promise.resolve(), fail = false, loseAck = false;
  const reads: string[] = [];
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: false, assertCreationOwner: () => {},
    getFirebase: () => ({ db: {} }), COL: 'gameSeries', Date,
    collection: (_: unknown, name: string) => name,
    doc: (...args: unknown[]): Ref => {
      const path = args.length === 1 ? `${args[0]}/new-series-${++serial}` : `${args[1]}/${args[2]}`;
      return { path, id: path.split('/')[1] };
    },
    runTransaction: (_: unknown, work: (tx: any) => Promise<string>) => {
      const next = queue.then(async () => {
        const writes: Array<{ ref: Ref; data: Data; update: boolean }> = [];
        const result = await work({
          get: async (ref: Ref) => {
            reads.push(ref.path);
            if (ref.path.startsWith('gameSeries/')) throw Error('nonexistent series read denied by rules');
            return { exists: () => documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) };
          },
          set: (ref: Ref, data: Data) => writes.push({ ref, data, update: false }),
          update: (ref: Ref, data: Data) => writes.push({ ref, data, update: true }),
        });
        if (fail) throw Error('offline before commit');
        writes.forEach(({ ref, data, update }) => documents.set(ref.path, { ...(update ? documents.get(ref.path) : {}), ...structuredClone(data) }));
        if (loseAck) { loseAck = false; throw Error('ACK lost after series linked'); }
        return result;
      });
      queue = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ({${method}}).ensureForGame`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const invoke = () => context.module.exports('first', { groupId: 'club', createdBy: 'owner', firstOccurrenceAt: 123,
    settings: { title: 'מחזור קבוע', fieldName: 'מגרש', maxPlayers: 10, visibility: 'community' } }) as Promise<string>;
  return { documents, reads, invoke, fail: (value: boolean) => { fail = value; }, loseAck: () => { loseAck = true; } };
}
test('series and first occurrence link are absent together on failure before commit, exact retry succeeds', async () => {
  const s = setup(); s.fail(true);
  await expect(s.invoke()).rejects.toThrow('offline before commit');
  expect(s.documents.size).toBe(1);
  expect(s.documents.get('games/first')?.seriesId).toBeUndefined();
  s.fail(false); const id = await s.invoke();
  expect(s.documents.get('games/first')).toMatchObject({ seriesId: id, players: ['registered'] });
  expect(s.documents.get(`gameSeries/${id}`)).toMatchObject({ groupId: 'club', lastOccurrenceAt: 123 });
});
test('lost ACK after atomic series commit retries via game link without another series or a missing-series read', async () => {
  const s = setup(); s.loseAck();
  await expect(s.invoke()).rejects.toThrow('ACK lost after series linked');
  const id = s.documents.get('games/first')!.seriesId;
  expect(await s.invoke()).toBe(id);
  expect(s.documents.size).toBe(2);
  expect(s.reads).toEqual(['games/first', 'games/first']);
});
test('concurrent attempts finish with one series linked to the same occurrence', async () => {
  const s = setup(); const ids = await Promise.all([s.invoke(), s.invoke(), s.invoke()]);
  expect(new Set(ids).size).toBe(1);
  expect(s.documents.size).toBe(2);
});

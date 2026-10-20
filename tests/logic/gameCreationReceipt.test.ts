import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { createHash } from 'crypto';
import { creationPayload } from '@/services/creationAttempt';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
const source = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let method = '';
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'createGameV2') method = node.getText(source);
  ts.forEachChild(node, visit);
} visit(source);

function setup() {
  type Data = Record<string, any>;
  const documents = new Map<string, Data>();
  const charges = jest.fn(async () => {}), overlap = jest.fn(async () => null);
  const dispatch = jest.fn();
  const ensureSeries = jest.fn(async (id: string) => {
    const game = documents.get(id)!;
    const seriesId = game.seriesId ?? `series-${id}`;
    documents.set(id, { ...game, seriesId });
    return seriesId;
  });
  let loseAck = false, fail = false, queue = Promise.resolve();
  const snapshot = (id: string) => ({ exists: () => documents.has(id), data: () => structuredClone(documents.get(id)) });
  const getServer = jest.fn(async (id: string) => snapshot(id));
  const runTransaction = (_: unknown, work: (tx: any) => Promise<any>) => {
    const next = queue.then(async () => {
      let write: [string, Data] | undefined;
      const result = await work({ get: async (id: string) => snapshot(id), set: (id: string, data: Data) => { write = [id, data]; } });
      if (fail) throw Error('offline');
      if (write) documents.set(write[0], structuredClone(write[1]));
      if (loseAck) { loseAck = false; throw Error('ACK lost'); }
      return result;
    });
    queue = next.then(() => undefined, () => undefined);
    return next;
  };
  const context: any = { module: { exports: {} }, clearMyGamesCache: () => {}, creationPayload,
    require: () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_: string, text: string) => createHash('sha256').update(text).digest('hex') }),
    requireString: (_: string, value: string) => value.trim(), optionalString: (_: string, value: string) => value?.trim(),
    requireInt: (_: string, value: number) => value,
    failValidation: (_: string, text: string) => { throw Object.assign(Error(text), { code: 'VALIDATION_ERROR' }); },
    ensureSeasonSchedule: async () => {}, // Receipt fixtures have no season window; policy is exercised separately.
    enforceRateLimit: charges, findOverlappingGameInGroup: overlap, USE_MOCK_DATA: false, __DEV__: false,
    getDocFromServer: getServer, docs: { game: (id: string) => id }, getFirebase: () => ({ db: {} }), runTransaction,
    notificationsService: { dispatch }, logError: () => {}, logUnexpected: () => {}, logEvent: () => {},
    AnalyticsEvent: new Proxy({}, { get: (_t, key) => String(key) }), Date,
    seriesService: { ensureForGame: ensureSeries }, settingsFromGame: (input: unknown) => input,
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ({${method}}).createGameV2`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { invoke: context.module.exports as (input: Data) => Promise<Data>, documents, charges, overlap, dispatch,
    loseAck: () => { loseAck = true; }, fail: (value: boolean) => { fail = value; }, getServer, ensureSeries };
}
const input = (over: Record<string, unknown> = {}) => ({
  creationAttemptId: 'stable-attempt-token-1', createdBy: 'owner', groupId: 'club', title: 'ערב בדיקה',
  startsAt: 123456789, fieldName: 'מגרש', maxPlayers: 10, visibility: 'community', requiresApproval: false,
  bringBall: false, bringShirts: false, fieldLat: 1, fieldLng: 2, ...over,
});

test('lost ACK after actual service transaction is reconciled before overlap/rate and never resets the saved game', async () => {
  const s = setup(); s.loseAck();
  await expect(s.invoke(input())).rejects.toThrow('ACK lost');
  const [id, saved] = [...s.documents][0];
  s.documents.set(id, { ...saved, players: ['later-player'], status: 'active', liveMatch: { scoreA: 4 } });
  s.overlap.mockImplementation(async () => { throw Error('overlap should not run'); });
  const result = await s.invoke(input());
  expect(result).toMatchObject({ id, players: ['later-player'], status: 'active', liveMatch: { scoreA: 4 } });
  expect(s.documents.size).toBe(1);
  expect(s.charges).toHaveBeenCalledTimes(1);
  expect(s.dispatch).not.toHaveBeenCalled(); // recovery never emits a second creation notification
});

test('parallel same-attempt writes create exactly one document and dispatch once', async () => {
  const s = setup();
  const result = await Promise.all([s.invoke(input()), s.invoke(input())]);
  expect(result[0].id).toBe(result[1].id);
  expect(s.documents.size).toBe(1);
  expect(s.dispatch).toHaveBeenCalledTimes(1);
});

test('same token with different creation content cannot overwrite or return another payload', async () => {
  const s = setup(); await s.invoke(input());
  const before = structuredClone([...s.documents]);
  await expect(s.invoke(input({ maxPlayers: 22 }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect([...s.documents]).toEqual(before);
  expect(s.charges).toHaveBeenCalledTimes(1);
});

test('same token for another user produces an independent user-scoped target', async () => {
  const s = setup(); const first = await s.invoke(input());
  const next = await s.invoke(input({ createdBy: 'other' }));
  expect(next.id).not.toBe(first.id);
  expect(s.documents.size).toBe(2);
});

test('failure before transaction commit leaves no document; exact retry creates one', async () => {
  const s = setup(); s.fail(true);
  await expect(s.invoke(input())).rejects.toThrow('offline');
  expect(s.documents.size).toBe(0);
  s.fail(false); await s.invoke(input());
  expect(s.documents.size).toBe(1);
});

test('existing recurring game after lost creation ACK reconciles the missing series before returning', async () => {
  const s = setup(); s.loseAck();
  await expect(s.invoke(input({ recurring: true }))).rejects.toThrow('ACK lost');
  expect(s.ensureSeries).not.toHaveBeenCalled();
  const recovered = await s.invoke(input({ recurring: true }));
  expect(recovered.seriesId).toBe(`series-${recovered.id}`);
  expect(s.documents.size).toBe(1);
  expect(s.ensureSeries).toHaveBeenCalledTimes(1);
  const again = await s.invoke(input({ recurring: true }));
  expect(again.seriesId).toBe(recovered.seriesId);
});

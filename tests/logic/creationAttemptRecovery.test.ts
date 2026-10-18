import { createHash } from 'crypto';

const mockRecords = new Map<string, string>();
let mockSerial = 0;
const mockSet = jest.fn(async (key: string, value: string) => { mockRecords.set(key, value); });
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: async (key: string) => mockRecords.get(key) ?? null,
    setItem: (...args: [string, string]) => mockSet(...args) },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_: string, value: string) => createHash('sha256').update(value).digest('hex'),
  randomUUID: () => `attempt-token-${++mockSerial}`,
}));
const load = () => require('@/services/creationAttempt') as typeof import('@/services/creationAttempt');
const context = { kind: 'game' as const, uid: 'owner', draftId: 'draft-1', values: { title: 'ערב', startsAt: 123 } };
beforeEach(() => { mockRecords.clear(); mockSet.mockClear(); mockSerial = 0; jest.resetModules(); });

test('ACK lost after remote commit: restart retries with identical token and frozen preparation', async () => {
  const remote = new Map<string, { id: string }>();
  const prepare = jest.fn(async () => ({ groupId: 'personal', cover: 'first-only' }));
  const seen: string[] = [];
  let loseAck = true;
  const create = async (_: unknown, token?: string) => {
    expect([...mockRecords.keys()].filter(key => key.startsWith('footy.creation.'))).toHaveLength(1);
    expect(await load().hasDraftCreationAttempt('game', 'owner', 'draft-1')).toBe(true);
    seen.push(token!);
    if (!remote.has(token!)) remote.set(token!, { id: 'created-on-server' });
    if (loseAck) { loseAck = false; throw Error('ACK lost'); }
    return remote.get(token!)!;
  };
  await expect(load().runCreationAttempt(context, prepare, create)).rejects.toThrow('ACK lost');
  jest.resetModules(); // only durable storage and the server survive process death
  expect(await load().runCreationAttempt(context, prepare, create)).toEqual({ id: 'created-on-server' });
  expect(new Set(seen).size).toBe(1);
  expect(remote.size).toBe(1);
  expect(prepare).toHaveBeenCalledTimes(1);
  // A second resume after success returns the durable receipt, without side effects.
  expect(await load().runCreationAttempt(context, prepare, create)).toEqual({ id: 'created-on-server' });
  expect(seen).toHaveLength(2);
});

test('content, user and new-draft boundaries never reuse another creation token', async () => {
  const tokens: string[] = [];
  const create = async (_: unknown, token?: string) => { tokens.push(token!); return { id: token }; };
  const prepare = async () => ({ value: 1 });
  await load().runCreationAttempt(context, prepare, create);
  await load().runCreationAttempt({ ...context, uid: 'another-owner' }, prepare, create);
  await load().runCreationAttempt({ ...context, draftId: 'draft-2' }, prepare, create);
  await load().runCreationAttempt({ ...context, values: { title: 'ערב אחר' } }, prepare, create);
  expect(new Set(tokens).size).toBe(4);
  await load().runCreationAttempt({ ...context, values: { startsAt: 123, title: 'ערב', absent: undefined } }, prepare, create);
  expect(tokens).toHaveLength(4); // key order and omitted fields cannot fork an attempt
});

test('failure persisting the attempt prevents any remote creation', async () => {
  mockSet.mockRejectedValueOnce(Error('disk full'));
  const create = jest.fn();
  await expect(load().runCreationAttempt(context, async () => ({ payload: true }), create)).rejects.toThrow('disk full');
  expect(create).not.toHaveBeenCalled();
});

test('corrupt durable state fails closed rather than silently allocating another token', async () => {
  const create = jest.fn(async () => ({ id: 'one' }));
  await load().runCreationAttempt(context, async () => ({ payload: true }), create);
  const key = [...mockRecords.keys()][0]; mockRecords.set(key, '{}');
  jest.resetModules();
  await expect(load().runCreationAttempt(context, async () => ({ payload: true }), create)).rejects.toThrow('לא ניתן לשחזר');
  expect(create).toHaveBeenCalledTimes(1);
});

test('parallel submits share the token even when preparation is asynchronous', async () => {
  const prepare = jest.fn(async () => ({ value: 'frozen' }));
  const tokens = new Set<string>();
  const create = async (_: unknown, id?: string) => { tokens.add(id!); return { id }; };
  await Promise.all([load().runCreationAttempt(context, prepare, create), load().runCreationAttempt(context, prepare, create)]);
  expect(tokens.size).toBe(1);
  expect(prepare).toHaveBeenCalledTimes(1);
});

test('completed receipts retain only hashed content and result, not frozen contact data', async () => {
  const values = { email: 'private@example.test', fcmToken: 'private-device-token', phone: '0501234567' };
  await load().runCreationAttempt({ ...context, values }, async () => values, async () => ({ id: 'created' }));
  const raw = [...mockRecords.values()][0];
  expect(raw).not.toContain(values.email);
  expect(raw).not.toContain(values.fcmToken);
  expect(raw).not.toContain(values.phone);
  const receipt = JSON.parse(raw);
  expect(receipt.prepared).toBeUndefined();
  expect(receipt.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  jest.resetModules();
  expect(await load().runCreationAttempt({ ...context, values }, jest.fn(), jest.fn())).toEqual({ id: 'created' });
});

test('switching account during preparation prevents sending old-account content', async () => {
  let owner = 'owner';
  const assertOwner = () => { if (owner !== context.uid) throw Object.assign(Error('stale'), { name: 'StaleSessionError' }); };
  const create = jest.fn();
  await expect(load().runCreationAttempt({ ...context, assertOwner }, async () => {
    owner = 'new-account'; return { privateClubName: 'הטיוטה המקורית' };
  }, create)).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(create).not.toHaveBeenCalled();
});

test('account switch after ACK cannot consume or return another accounts completed result', async () => {
  let owner = 'owner';
  const assertOwner = () => { if (owner !== context.uid) throw Object.assign(Error('stale'), { name: 'StaleSessionError' }); };
  await expect(load().runCreationAttempt({ ...context, assertOwner }, async () => ({ value: 1 }), async () => {
    owner = 'new-account'; return { id: 'server-created' };
  })).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect([...mockRecords.values()][0]).not.toContain('completed');
  owner = 'owner';
  await load().runCreationAttempt({ ...context, assertOwner }, async () => ({ value: 1 }), async () => ({ id: 'server-created' }));
  owner = 'new-account';
  await expect(load().runCreationAttempt({ ...context, assertOwner }, async () => ({ value: 1 }), jest.fn()))
    .rejects.toMatchObject({ name: 'StaleSessionError' });
});

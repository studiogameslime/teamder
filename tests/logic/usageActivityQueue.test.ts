import fs from 'fs';
import { UsageActivityQueue, USAGE_QUEUE_KEY } from '../../src/services/usageActivityQueue';
import { usageContext, usageScreenKey, validUsageEvent } from '../../src/utils/usageActivity';

function fixture() {
  let now = 1_800_000_000_000, uid: string | null = 'alice', id = 0;
  const disk = new Map<string, string>(), diagnostics: string[] = [];
  const storage = { getItem: jest.fn(async (key: string) => disk.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { disk.set(key, value); }) };
  const send = jest.fn(async (_uid: string, events: any[]) => ({ acknowledged: events.map(e => e.eventId) }));
  const create = () => new UsageActivityQueue({ storage, now: () => now, identity: () => uid, uuid: () => `visit-00000-${++id}`, platform: 'android', appVersion: '1.2.3', diagnostic: reason => diagnostics.push(reason), send });
  const queue = create();
  return { queue, create, disk, storage, send, diagnostics, setUid: (value: string | null) => { uid = value; }, advance: (ms: number) => { now += ms; }, rows: () => JSON.parse(disk.get(USAGE_QUEUE_KEY) ?? '[]') };
}

test('closed catalogs agree across all three processes and strip unrelated text', () => {
  const source = fs.readFileSync('src/utils/usageActivity.ts', 'utf8').replace(/\r/g, '');
  for (const file of ['functions/src/usageActivityCatalog.ts', 'pulse/src/services/usageActivityCatalog.ts']) expect(fs.readFileSync(file, 'utf8').replace(/\r/g, '')).toBe(source);
  expect(usageContext('MatchDetails', { gameId: 'game-a', query: 'private', name: 'private' })).toEqual({ screen: 'MatchDetails', gameId: 'game-a', section: 'info' });
  expect(usageContext('UnlistedScreen', { gameId: 'game-a' })).toEqual({});
  expect(usageScreenKey(usageContext('MatchDetails', { gameId: 'a', name: 'old' }))).toBe(usageScreenKey(usageContext('MatchDetails', { gameId: 'a', name: 'new' })));
});

test('re-render is ignored, context changes and real returns remain separate visits to a screen', async () => {
  const f = fixture(); f.queue.start();
  f.queue.screen(usageContext('MatchDetails', { gameId: 'a' }));
  f.queue.screen(usageContext('MatchDetails', { gameId: 'a', name: 'changed' }));
  f.queue.screen(usageContext('MatchDetails', { gameId: 'b' }));
  f.queue.screen(usageContext('MatchDetails', { gameId: 'a' }));
  f.queue.screen(usageContext('MatchDetails', { gameId: 'a', section: 'stats' }));
  await f.queue.persist();
  expect(f.rows().map((e: any) => e.action)).toEqual(['app_opened', ...Array(4).fill('screen_view')]);
  expect(new Set(f.rows().map((e: any) => e.eventId)).size).toBe(5);
});

test('inactive system overlays do not open visits, short and long background boundaries are explicit', async () => {
  const f = fixture(); f.queue.start(); f.queue.appState('inactive'); f.advance(60_000); f.queue.appState('active');
  f.queue.appState('background'); f.advance(29_999); f.queue.appState('active');
  f.queue.appState('background'); f.advance(30_000); f.queue.appState('active');
  f.queue.appState('background'); f.advance(30 * 60_000); f.queue.appState('active');
  await f.queue.persist(); const rows = f.rows();
  expect(rows.map((e: any) => e.action)).toEqual(['app_opened', 'app_returned', 'app_opened']);
  expect(rows[0].visitId).toBe(rows[1].visitId); expect(rows[2].visitId).not.toBe(rows[1].visitId); expect(rows[2].sequence).toBe(1);
});
test('a process mounted in the background records no opening or screen until foreground', async () => {
  const f = fixture(); f.queue.appState('background'); f.queue.screen(usageContext('Profile')); await f.queue.persist();
  expect(f.rows()).toEqual([]); f.advance(31 * 60_000); f.queue.appState('active'); f.queue.screen(usageContext('Profile')); await f.queue.persist();
  expect(f.rows().map((e: any) => e.action)).toEqual(['app_opened', 'screen_view']);
});

test('network failure replays stable ids and original occurrence time, partial ack removes only accepted ids', async () => {
  const f = fixture(); f.queue.start(); f.queue.screen(usageContext('Profile'));
  f.send.mockRejectedValueOnce(new Error('offline')); await f.queue.flush(); const saved = f.rows();
  f.advance(60_000); f.send.mockImplementationOnce(async (_uid, events) => ({ acknowledged: [events[0].eventId, 'foreign-id'] }));
  await f.queue.flush(); expect(f.send.mock.calls[1][1]).toEqual(saved.map(({ ownerUid, ...e }: any) => e));
  expect(f.rows()).toHaveLength(1); await f.queue.flush(); expect(f.rows()).toEqual([]);
});

test('account changes isolate events including async outcomes; same-uid upgrades keep the visit', async () => {
  const f = fixture(); f.queue.start(); const finish = f.queue.beginRegistration('game-a', 'operation-a');
  f.queue.syncIdentity(); f.setUid('bob'); f.queue.syncIdentity(); f.queue.record('app_opened');
  finish('players'); await f.queue.flush();
  expect(f.send.mock.calls[0][0]).toBe('bob'); expect(f.send.mock.calls[0][1].every(e => e.action === 'app_opened')).toBe(true);
  const alice = f.rows(); expect(alice.every((e: any) => e.ownerUid === 'alice')).toBe(true);
  expect(alice.find((e: any) => e.action === 'registration_result').visitId).toBe(alice[0].visitId);
  f.setUid('alice'); await f.queue.flush(); expect(f.rows()).toEqual([]);
});

test('current pre-auth events can bind once; unowned events from a previous process never bind', async () => {
  const f = fixture(); f.setUid(null); f.queue.start(); await f.queue.persist();
  const previous = f.rows(); f.setUid('alice'); f.queue.syncIdentity(); await f.queue.flush(); expect(f.send).toHaveBeenCalledTimes(1);
  f.disk.set(USAGE_QUEUE_KEY, JSON.stringify(previous)); const next = f.create(); next.start(); await next.flush();
  expect(f.send.mock.calls[1][1].every(e => e.visitId !== previous[0].visitId)).toBe(true);
});

test('process restart creates another visit; storage failure keeps pending events in memory for retry', async () => {
  const f = fixture(); f.storage.setItem.mockRejectedValueOnce(new Error('disk')); f.queue.start(); await f.queue.persist(); await f.queue.persist();
  expect(f.rows()).toHaveLength(1); const old = f.rows()[0].visitId;
  const next = f.create(); next.start(); await next.persist(); expect(new Set(f.rows().map((e: any) => e.visitId)).size).toBe(2);
  expect(f.rows().some((e: any) => e.visitId === old)).toBe(true);
});

test('overflow removes old views, keeps bounded queue, and explicitly marks the affected visit partial', async () => {
  const f = fixture(); f.queue.start();
  for (let i = 0; i < 520; i++) f.queue.screen(usageContext('MatchDetails', { gameId: `g-${i}` }));
  await f.queue.persist(); expect(f.rows().length).toBeLessThanOrEqual(500);
  expect(f.rows().some((e: any) => e.action === 'coverage_gap')).toBe(true);
  expect(f.rows().every(validUsageEvent)).toBe(true);
});

test('quota response pauses retries and does not remove unacknowledged events', async () => {
  const f = fixture(); f.queue.start(); f.send.mockResolvedValueOnce({ acknowledged: [], retryAfterMs: 60_000 } as any);
  await f.queue.flush(); await f.queue.flush(); expect(f.send).toHaveBeenCalledTimes(1); expect(f.rows()).toHaveLength(1);
  f.advance(60_000); await f.queue.flush(); expect(f.send).toHaveBeenCalledTimes(2); expect(f.rows()).toEqual([]);
});

test('age expiry is a separate gap path rather than a delivery acknowledgement', async () => {
  const f = fixture(); f.queue.start(); await f.queue.persist(); f.advance(8 * 86400000); await f.queue.persist();
  expect(f.rows().map((e: any) => e.action)).toEqual(['coverage_gap']);
  expect(f.send).not.toHaveBeenCalled();
});
test('account deletion clears its disk/memory copy and blocks a late outcome while preserving another owner', async () => {
  const f = fixture(); f.queue.start(); const finish = f.queue.beginRegistration('a', 'operation-a'); await f.queue.persist();
  f.setUid('bob'); f.queue.syncIdentity(); f.queue.record('app_opened'); await f.queue.persist();
  await f.queue.forgetOwner('alice'); finish('players'); await f.queue.persist();
  expect(f.rows()).toHaveLength(1); expect(f.rows()[0].ownerUid).toBe('bob');
  f.setUid('alice'); f.queue.record('app_opened'); await f.queue.persist(); expect(f.rows()).toHaveLength(1);
});

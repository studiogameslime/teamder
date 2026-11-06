import fs from 'fs';
import { recurrenceFixture } from '../helpers/recurrenceFirestore';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const GRACE = 3 * 60 * 60 * 1000;
const first = Date.UTC(2026, 10, 5, 18);
const game = (startsAt: number, extra: any = {}) => ({ groupId: 'club', seriesId: 'series', startsAt, status: 'open', players: [], guests: [], ...extra });
const world = (extra: Record<string, any> = {}) => recurrenceFixture({
  'groups/club': {}, 'gameSeries/series': { groupId: 'club', active: true, lastOccurrenceAt: first }, ...extra,
});
const create = (w: ReturnType<typeof world>, at: number) => w.api.createSeriesOccurrence(w.db, w.ref('gameSeries/series'), game(at + WEEK), at + GRACE + 1, at);
const clean = (w: ReturnType<typeof world>, id: string, now: number) => w.activity.deleteEmptyGameWithRecurrence(w.db, w.ref(`games/${id}`), [], now);

test.each(['before', 'after'])('three empty occurrences stop before a fourth, with cleanup %s creation', async order => {
  const w = world({ 'games/initial': game(first) });
  let id = 'initial';
  for (let week = 0; week < 3; week++) {
    const at = first + WEEK * week;
    if (order === 'before') expect(await clean(w, id, at + GRACE + 1)).toBe(true);
    expect(await create(w, at)).toBe(week < 2);
    if (order === 'after') expect(await clean(w, id, at + GRACE + 1)).toBe(true);
    if (week < 2) id = `series_${at + WEEK}`;
  }
  expect(w.store.get('gameSeries/series')).toMatchObject({ active: false, stoppedReason: 'inactive-occurrences', lastOccurrenceAt: first + 2 * WEEK });
  expect(w.store.get('gameSeries/series').recurrenceActivity).toHaveLength(3);
  expect([...w.store.keys()].filter(key => key.startsWith('games/'))).toHaveLength(0);
  expect(await create(w, first + 2 * WEEK)).toBe(false);
});

test('existing past failures are considered without counting a future empty occurrence', async () => {
  const at = first + 2 * WEEK;
  const w = world({
    'gameSeries/series': { groupId: 'club', active: true, lastOccurrenceAt: at },
    'games/1': game(first, { status: 'cancelled', players: ['p'] }),
    'games/2': game(first + WEEK, { status: 'finished', playVerified: false, players: ['p'] }),
    'games/3': game(at),
    'games/future-other-series': game(at + WEEK, { seriesId: 'other' }),
  });
  expect(await create(w, at)).toBe(false);
  expect(w.store.get('gameSeries/series').active).toBe(false);
  expect(w.store.get('games/1').players).toEqual(['p']);
  expect(w.store.get('games/2').status).toBe('finished');
  expect(w.store.has('games/future-other-series')).toBe(true);
});

test.each([
  { status: 'finished', endedBy: 'admin' },
  { status: 'finished' },
  { status: 'finished', endedBy: 'auto', playVerified: true },
  { status: 'active', liveMatch: { timerAccumulatedMs: 1 } },
  { status: 'finished', endedBy: 'auto', committedRoundCount: 1 },
  { status: 'finished', endedBy: 'auto', players: ['offline-player'] },
  { players: ['registered-player'] },
  { guests: [{ id: 'guest', waitlisted: false }] },
  { guests: [{ id: 'guest', waitlisted: true }] },
  { waitlist: ['waiting-player'] },
  { pending: ['pending-player'] },
])('a played, registered or undecided occurrence breaks the streak: %j', async protectedGame => {
  const at = first + 2 * WEEK;
  const w = world({
    'gameSeries/series': { groupId: 'club', active: true, lastOccurrenceAt: at },
    'games/1': game(first), 'games/2': game(first + WEEK, protectedGame), 'games/3': game(at),
  });
  expect(await create(w, at)).toBe(true);
  expect(w.store.get('gameSeries/series').active).toBe(true);
});

test('one actual occurrence cannot become three failures through repeated/concurrent runs or an outage', async () => {
  const w = world({ 'games/only': game(first) });
  const run = () => w.api.createSeriesOccurrence(w.db, w.ref('gameSeries/series'), game(first + 10 * WEEK), first + 9 * WEEK, first);
  expect((await Promise.all([run(), run(), run()])).filter(Boolean)).toHaveLength(1);
  expect(w.store.get('gameSeries/series').recurrenceActivity).toHaveLength(1);
  expect(w.store.get('gameSeries/series').active).toBe(true);
});

test('future games, grace period and duplicate kickoff documents do not count as extra failures', () => {
  const w = world();
  const docs = [first, first, first + WEEK, first + 2 * WEEK, first + 3 * WEEK]
    .map((at, i) => ({ id: String(i), data: () => game(at) }));
  const history = w.activity.recurrenceActivity(undefined, docs, first + WEEK + GRACE - 1);
  expect(history).toHaveLength(1);
  expect(w.activity.recurrenceShouldStop(history)).toBe(false);
});

test('a current administrator decision replaces a saved undecided result', async () => {
  const at = first + 2 * WEEK;
  const w = world({
    'gameSeries/series': { groupId: 'club', active: true, lastOccurrenceAt: at, recurrenceActivity: [
      { gameId: '1', startsAt: first, inactive: true },
      { gameId: '2', startsAt: first + WEEK, inactive: false },
    ] },
    'games/2': game(first + WEEK, { status: 'finished', endedBy: 'auto', players: ['p'], playVerified: false }),
    'games/3': game(at),
  });
  expect(await create(w, at)).toBe(false);
});

test.each(['registration', 'confirmation'])('a concurrent %s prevents empty cleanup and a mistaken stop', async change => {
  const at = first + 2 * WEEK;
  const w = world({
    'gameSeries/series': { groupId: 'club', active: true, lastOccurrenceAt: at, recurrenceActivity: [
      { gameId: '1', startsAt: first, inactive: true }, { gameId: '2', startsAt: first + WEEK, inactive: true },
    ] }, 'games/current': game(at),
  });
  w.beforeCommit(() => w.put('games/current', game(at, change === 'registration' ? { players: ['p'] } : { status: 'finished', endedBy: 'admin' })));
  expect(await clean(w, 'current', at + GRACE + 1)).toBe(false);
  expect(w.store.has('games/current')).toBe(true);
  expect(w.store.get('gameSeries/series').active).toBe(true);
  expect(await create(w, at)).toBe(true);
});

test('a read failure preserves the empty game and does not disable the series', async () => {
  const w = world({ 'games/current': game(first) });
  const collection = w.db.collection;
  w.db.collection = (name: string) => { if (name === 'games') throw Error('offline'); return collection(name); };
  await expect(clean(w, 'current', first + GRACE + 1)).rejects.toThrow('offline');
  expect(w.store.has('games/current')).toBe(true);
  expect(w.store.get('gameSeries/series').active).toBe(true);
  expect(w.writes).toHaveLength(0);
});

test('an orphan or disabled series is never recreated by remembering an empty week', async () => {
  const w = world({ 'gameSeries/series': { groupId: 'club', active: false }, 'games/current': game(first) });
  expect(await clean(w, 'current', first + GRACE + 1)).toBe(true);
  expect(w.store.get('gameSeries/series')).toEqual({ groupId: 'club', active: false });
  w.remove('gameSeries/series'); w.put('games/current', game(first));
  expect(await clean(w, 'current', first + GRACE + 1)).toBe(true);
  expect(w.store.has('gameSeries/series')).toBe(false);
});

test('legacy clones get two chances then stop atomically, even if cleanup runs first', async () => {
  const w = world({ 'games/legacy': game(first, { seriesId: undefined, recurring: true }) });
  w.remove('gameSeries/series');
  let id = 'legacy';
  for (let week = 0; week < 3; week++) {
    const at = first + week * WEEK, now = at + GRACE + 1, next = `next-${week}`;
    expect(await clean(w, id, now)).toBe(false);
    const run = () => w.api.createLegacyOccurrence(w.db, w.ref(`games/${id}`), w.ref(`games/${next}`), game(at + WEEK, { seriesId: undefined, recurring: true }), now);
    expect(await run()).toBe(week < 2 ? 'created' : 'stopped');
    expect(await run()).toBe(week < 2 ? 'exists' : 'stopped');
    expect(await clean(w, id, now)).toBe(true);
    if (week < 2) id = next;
  }
  expect([...w.store.keys()].filter(key => key.startsWith('games/'))).toHaveLength(0);
});

test('the scheduled cleanup uses the transactional history writer and cloning has no one-empty-week bailout', () => {
  const source = fs.readFileSync('functions/src/index.ts', 'utf8');
  expect(source).toContain('await deleteEmptyGameWithRecurrence(db, gameDoc.ref, rounds.docs.map(r => r.ref), Date.now())');
  expect(source).not.toContain('[cloneRecurringGames] skip empty (dead fixture)');
});

test('activity resets a two-week streak, then three fresh failures stop the series', async () => {
  const w = world({ 'games/initial': game(first) });
  let id = 'initial';
  for (let week = 0; week < 6; week++) {
    const at = first + week * WEEK;
    if (week === 2) w.put(`games/${id}`, game(at, { status: 'finished', endedBy: 'admin', players: ['p'] }));
    expect(await create(w, at)).toBe(week < 5);
    if (week !== 2) expect(await clean(w, id, at + GRACE + 1)).toBe(true);
    if (week < 5) id = `series_${at + WEEK}`;
  }
  expect(w.store.get('gameSeries/series').active).toBe(false);
  expect(w.store.get(`games/series_${first + 2 * WEEK}`).endedBy).toBe('admin');
});

test('an administrator confirming play during the stop transaction prevents stopping', async () => {
  const at = first + 2 * WEEK;
  const w = world({
    'gameSeries/series': { groupId: 'club', active: true, lastOccurrenceAt: at },
    'games/1': game(first), 'games/2': game(first + WEEK), 'games/3': game(at),
  });
  w.beforeCommit(() => w.put('games/3', game(at, { status: 'finished', endedBy: 'admin' })));
  expect(await create(w, at)).toBe(true);
  expect(w.store.get('gameSeries/series').active).toBe(true);
});

test('cleanup preserves legacy history until a successful clone and deletes only the given round documents', async () => {
  const w = world({ 'games/plain': game(first, { seriesId: undefined }), 'rounds/owned': { gameId: 'plain' }, 'rounds/other': { gameId: 'other' } });
  expect(await w.activity.deleteEmptyGameWithRecurrence(w.db, w.ref('games/plain'), [w.ref('rounds/owned')], first + GRACE + 1)).toBe(true);
  expect(w.store.has('rounds/owned')).toBe(false);
  expect(w.store.has('rounds/other')).toBe(true);
});

test.each([true, false])('legacy sources cannot restart a migrated club when its series active=%s', async active => {
  const w = world({ 'gameSeries/series': { groupId: 'club', active }, 'games/old-source': game(first, { seriesId: undefined, recurring: true }) });
  expect(await w.api.createLegacyOccurrence(w.db, w.ref('games/old-source'), w.ref('games/next'), game(first + WEEK, { seriesId: undefined, recurring: true }), first + GRACE + 1)).toBe('stopped');
  expect(w.store.has('games/next')).toBe(false);
  expect(w.store.get('games/old-source').recurring).toBe(false);
});

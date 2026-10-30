import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import vm from 'vm';
import { canOfferFiller, hasFillerRegistrationConflict, FILLER_REG_CONFLICT_WINDOW_MS as WINDOW } from '../../functions/src/fillerRules';

const now = Date.UTC(2026, 9, 28, 8);
const target = { id: 'target', startsAt: now + 6 * 3600000 };
const registration = { id: 'other', startsAt: target.startsAt, status: 'open', players: ['me'] };

test.each([[0,15,false],[10,15,false],[11,15,true],[14,15,true],[15,15,false],[6,10,false],[7,10,true],[8,10,true],[9,10,true],[10,10,false],[0,0,false]])(
  '%i of %i places: eligible = %s', (taken, maxPlayers, expected) => {
    expect(canOfferFiller({ players: Array(taken).fill('p'), maxPlayers })).toBe(expected);
  });
test('guests occupy places, including rounds with no account registrations', () => {
  expect(canOfferFiller({ guests: Array(7).fill({}), maxPlayers: 10 })).toBe(true);
  expect(canOfferFiller({ players: ['p'], guests: Array(9).fill({}), maxPlayers: 10 })).toBe(false);
});
test.each([-WINDOW, 0, WINDOW])('confirmed registration blocks at offset %i', offset => {
  expect(hasFillerRegistrationConflict('me', target, [{ ...registration, startsAt: target.startsAt + offset }], now)).toBe(true);
});
test.each(['open', 'locked', 'active'])('%s confirmed registration blocks', status => {
  expect(hasFillerRegistrationConflict('me', target, [{ ...registration, status }], now)).toBe(true);
});
test('unrelated, terminal, waitlisted, pending and distant rounds do not block', () => {
  for (const g of [
    { ...registration, id: target.id }, { ...registration, status: 'scheduled' }, { ...registration, status: 'finished' },
    { ...registration, status: 'cancelled' }, { ...registration, players: [] },
    { ...registration, startsAt: target.startsAt + WINDOW + 1 },
    { ...registration, startsAt: target.startsAt - WINDOW - 1 },
    { ...registration, status: 'active', startsAt: now - 12 * 3600000 },
  ]) expect(hasFillerRegistrationConflict('me', target, [g], now)).toBe(false);
});

// Execute the real query adapter and delivery functions with isolated IO.
const source = fs.readFileSync(path.resolve(__dirname, '../../functions/src/index.ts'), 'utf8');
const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
function load(name: string, context: Record<string, unknown>) {
  const node = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!node) throw new Error(name);
  const js = ts.transpileModule(node.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return vm.runInNewContext(js + '\n' + name, context);
}
test('query checks confirmed players on fresh reads, carries IDs, and propagates failure', async () => {
  const get = jest.fn().mockResolvedValue({ docs: [{ id: 'other', data: () => registration }] });
  const where = jest.fn().mockReturnValue({ get });
  const check = load('hasFillerConflict', { db: { collection: () => ({ where }) }, hasFillerRegistrationConflict, Date: { now: () => now } });
  expect(await check('me', target.id, target.startsAt)).toBe(true);
  expect(where).toHaveBeenCalledWith('players', 'array-contains', 'me');
  get.mockRejectedValueOnce(new Error('offline'));
  await expect(check('me', target.id, target.startsAt)).rejects.toThrow('offline');
});
test.each(['runFindFillerCandidates', 'runFillerPulseBatch'])('%s skips a round below 70 percent before loading candidates', async name => {
  const game = { ...target, acceptsFillers: true, status: 'open', players: Array(10).fill('p'), maxPlayers: 15 };
  const get = jest.fn().mockResolvedValue({ docs: [{ id: target.id, data: () => game }], size: 1, exists: true, data: () => game });
  const query: any = { get, where: () => query, doc: () => query };
  const pool = jest.fn(() => { throw new Error('should not load candidates'); });
  const run = load(name, {
    db: { collection: () => query }, Date: { now: () => now }, console: { log: jest.fn() },
    inFillerQuietHours: () => false, occupancyOf: (g: any) => g.players.length,
    canOfferFiller, getFillerCandidatePool: pool,
    FILLER_WINDOW_EARLIEST_HOURS: 3, FILLER_WINDOW_LATEST_HOURS: 12, FILLER_HOUR_MS: 3600000,
    PULSE_STOP_BEFORE_MS: 1800000, PULSE_MAX_LEAD_MS: 12 * 3600000,
  });
  await run(target.id);
  expect(pool).not.toHaveBeenCalled();
});
test.each(['runFindFillerCandidates', 'runFillerPulseBatch'])('%s checks commitments before reserving push capacity', name => {
  const node = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  const body = node.getText(parsed);
  expect(body.indexOf('await hasFillerConflict(')).toBeGreaterThan(0);
  expect(body.indexOf('await hasFillerConflict(')).toBeLessThan(body.indexOf('await reserveFillerPush('));
});

test.each(['runFindFillerCandidates', 'runFillerPulseBatch'])('%s only delivers to uncommitted players', async name => {
  for (const conflicting of [true, false]) {
    const game = { ...target, city: 'city', acceptsFillers: true, status: 'open', players: Array(7).fill('p'), maxPlayers: 10 };
    const set = jest.fn();
    const get = jest.fn().mockResolvedValue({ docs: [{ id: target.id, data: () => game, ref: { set } }], size: 1, exists: true, data: () => game });
    const query: any = { get, set, where: () => query, doc: () => query };
    const reserve = jest.fn().mockResolvedValue(true);
    const notify = jest.fn();
    const check = jest.fn().mockResolvedValue(conflicting);
    const run = load(name, {
      db: { collection: () => query }, Date: { now: () => now }, console: { log: jest.fn() },
      inFillerQuietHours: () => false, occupancyOf: (g: any) => g.players.length,
      canOfferFiller, hasFillerConflict: check,
      getFillerCandidatePool: async () => [{ id: 'me', data: () => ({ availability: { homeCity: 'city' } }) }],
      getCityCoords: async () => null, israelParts: () => ({ weekday: 3, hour: 20 }), hourToAvailWindow: () => 'evening',
      fillerDayKey: () => '20261028', availabilityCovers: () => true, normaliseCityKey: (s: string) => s,
      reserveFillerPush: reserve, createNotificationOnce: notify, shuffleInPlace: () => {},
      admin: { firestore: { FieldValue: { arrayUnion: (...ids: string[]) => ids } } },
      DEFAULT_AVAIL_RADIUS_KM: 20, FILLER_DAILY_CAP: 3, FILLER_PUSH_LIMIT_PER_GAME: 10,
      FILLER_WINDOW_EARLIEST_HOURS: 3, FILLER_WINDOW_LATEST_HOURS: 12, FILLER_HOUR_MS: 3600000,
      PULSE_STOP_BEFORE_MS: 1800000, PULSE_MAX_LEAD_MS: 12 * 3600000, PULSE_BATCH: 10, PULSE_INTERVAL_MS: 120000,
    });
    await run(target.id);
    expect(check).toHaveBeenCalledWith('me', target.id, target.startsAt);
    expect(reserve).toHaveBeenCalledTimes(conflicting ? 0 : 1);
    expect(notify).toHaveBeenCalledTimes(conflicting ? 0 : 1);
    if (!conflicting) expect(notify).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ shortBy: 3 }) }));
  }
});

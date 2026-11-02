jest.mock('../../pulse/src/services/firestoreRest', () => ({ queryDocumentPage: jest.fn(), getDoc: jest.fn(), patchDoc: jest.fn(), createDocOnly: jest.fn() }));
jest.mock('../../pulse/src/services/cache', () => ({ cached: (_key: string, fn: () => unknown) => fn(), invalidate: jest.fn() }));
jest.mock('../../pulse/src/services/firebase', () => ({ isTestAccount: (email?: string) => !!email?.endsWith('@cloudtestlabaccounts.com') }));
jest.mock('../../pulse/src/services/errorObservation', () => ({ observeSettledErrors: (results: unknown) => results }));

import { clubOrganizer, fetchHomeDashboard, homeClubRows, homeDayStart, homePeopleCount, homeRoundTotals, setClubContact, setClubFollowUp } from '../../pulse/src/services/homeDashboard';
import { createDocOnly, getDoc, patchDoc, queryDocumentPage } from '../../pulse/src/services/firestoreRest';

const now = Date.parse('2026-11-01T10:00:00Z');
const hour = 3600000;
const group = { id: 'club-from-query', name: 'מועדון חדש', createdAt: now - hour, creatorId: 'organizer', adminIds: ['organizer'], playerIds: ['organizer', 'member'] };
const club = () => homeClubRows([group], [], now).rows[0];

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { jest.restoreAllMocks(); });

test.each([
  ['2026-11-01T10:00:00Z', '2026-10-31T22:00:00Z'],
  ['2026-06-01T10:00:00Z', '2026-05-31T21:00:00Z'],
  ['2026-03-27T10:00:00Z', '2026-03-26T22:00:00Z'],
  ['2026-10-25T10:00:00Z', '2026-10-24T21:00:00Z'],
  ['2026-11-01T22:01:00Z', '2026-11-01T22:00:00Z'],
])('Israel midnight including DST: %s', (input, expected) => {
  expect(new Date(homeDayStart(Date.parse(input))).toISOString()).toBe(new Date(expected).toISOString());
});

test('registered rounds include future open/scheduled/locked rounds and paused active rounds', () => {
  const make = (id: string, status: string, startsAt = now - hour) => ({ id, status, startsAt, players: ['a', 'a', { userId: 'b' }], waitlist: ['c'], pending: ['d'], guests: ['e'], committedRoundCount: 30 });
  expect(homeRoundTotals([make('one', 'active'), { ...make('paused', 'active'), liveMatch: { timerRunning: false } }, make('future', 'open', now + 7 * 24 * hour), make('scheduled', 'scheduled', now + 24 * hour), make('locked', 'locked', now + hour), make('old', 'active', now - 9 * hour), make('done', 'finished'), make('cancelled', 'cancelled', now + hour), { ...make('empty', 'open', now + hour), players: [], waitlist: ['c'], pending: ['d'] }], now)).toEqual({ withRegistrations: 5, registered: 10, at: now });
});

test('one registered player qualifies even before play; waitlisted, pending and guests alone do not', () => {
  const future = { id: 'future', status: 'open', startsAt: now + hour, players: ['one'] };
  expect(homeRoundTotals([future, { ...future, id: 'no-roster', players: undefined, waitlist: ['a'], pending: ['b'], guests: ['c'] }], now)).toEqual({ withRegistrations: 1, registered: 1, at: now });
});

test('server query has no future cutoff and totals registrations across all returned pages', async () => {
  const cursor = { values: [{ integerValue: String(now) }, { referenceValue: 'games/last' }] };
  (queryDocumentPage as jest.Mock).mockImplementation(async (collection, options) => {
    if (collection !== 'games') return { rows: [] };
    expect(options.where).toEqual({ fieldFilter: { field: { fieldPath: 'startsAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(now - 8 * hour) } } });
    return options.cursor ? { rows: [{ id: 'last', status: 'scheduled', startsAt: now + 24 * hour, players: ['a', 'b'] }] }
      : { rows: Array.from({ length: 100 }, (_, i) => ({ id: `future${i}`, status: 'open', startsAt: now + 7 * 24 * hour, players: ['a'] })), next: cursor };
  });
  expect((await fetchHomeDashboard()).rounds).toEqual({ withRegistrations: 101, registered: 102, at: now });
});

test('daily people are unique and exclude QA, deleted, future and pre-midnight records', () => {
  const rows = [{ id: 'same', lastSeenAt: now }, { id: 'same', lastSeenAt: now - 1 }, { id: 'qa', qa: true, lastSeenAt: now }, { id: 'robot', email: 'a@cloudtestlabaccounts.com', lastSeenAt: now }, { id: 'deleted', name: 'משתמש שהוסר', lastSeenAt: now }, { id: 'old', lastSeenAt: homeDayStart(now) - 1 }, { id: 'future', lastSeenAt: now + 1 }, { id: 'missing' }];
  expect(homePeopleCount(rows, 'lastSeenAt', now).count).toBe(1);
});

test('only clubs from owner-selected launch day enter; pending clubs remain after aging and organizer changes', () => {
  const old = { ...group, id: 'old', createdAt: now - 100 * 86400000 };
  const contacts = [{ id: 'saved', kind: 'pulseClubContact', groupId: group.id, organizerId: 'previous-manager', contactedAt: now - 1 }];
  const rows = homeClubRows([group, old, { ...group, id: 'personal', isPersonal: true }, { ...group, id: 'future', createdAt: now + 1 }], contacts, now).rows;
  expect(rows.map(r => r.id)).toEqual([group.id]);
  expect(homeClubRows([group], [], now + 100 * 86400000).rows.map(r => r.id)).toEqual([group.id]);
  expect(rows[0]).toMatchObject({ members: 2, contactedAt: null });
  expect(clubOrganizer({ ...group, adminIds: ['new-admin'] })).toBe('new-admin');
  expect(clubOrganizer({ id: 'unknown' })).toBeNull();
});

test('verified contact is matched to its exact club and current organizer', () => {
  const contact = { id: 'saved', kind: 'pulseClubContact', groupId: group.id, organizerId: 'organizer', contactedAt: now - 1 };
  expect(homeClubRows([group], [contact], now).rows[0].contactedAt).toBe(now - 1);
  expect(homeClubRows([group], [{ ...contact, contactedAt: null }], now).rows[0].contactedAt).toBeNull();
});

test('full daily totals continue through all pages and section failures stay unknown', async () => {
  const cursor = { values: [{ integerValue: '10' }, { referenceValue: 'users/last' }] };
  (queryDocumentPage as jest.Mock).mockImplementation(async (collection, options) => {
    if (collection === 'games') throw new Error('offline');
    if (collection === 'groups') return { rows: [group] };
    if (collection === 'adminConfig') return { rows: [] };
    if (options.orderField === 'lastSeenAt') return { rows: [{ id: 'present', lastSeenAt: now }] };
    return options.cursor ? { rows: [{ id: 'last', createdAt: now }] } : { rows: Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, createdAt: now })), next: cursor };
  });
  const result = await fetchHomeDashboard();
  expect(result).toMatchObject({ rounds: null, failed: ['rounds'], signups: { count: 101 }, people: { count: 1 }, clubs: { rows: [expect.objectContaining({ id: group.id })] } });
  expect((queryDocumentPage as jest.Mock).mock.calls.some(([, opts]) => opts.cursor === cursor)).toBe(true);
});

test('contact source failure does not label clubs as uncontacted', async () => {
  (queryDocumentPage as jest.Mock).mockImplementation(async (collection) => { if (collection === 'adminConfig') throw new Error('denied'); return { rows: collection === 'groups' ? [group] : [] }; });
  const result = await fetchHomeDashboard();
  expect(result.clubs).toBeNull();
  expect(result.failed).toEqual(['clubs']);
});

test('contact writes use the queried id, existing-only updates, and read back the actual result', async () => {
  (getDoc as jest.Mock).mockResolvedValueOnce(group).mockResolvedValueOnce({ id: 'contact', kind: 'pulseClubContact', groupId: group.id, organizerId: 'organizer', contactedAt: now, lastFollowUpAt: null });
  (createDocOnly as jest.Mock).mockResolvedValue('conflict');
  (patchDoc as jest.Mock).mockResolvedValue(true);
  await expect(setClubContact(club(), true)).resolves.toEqual({ organizerId: 'organizer', contactedAt: now, lastFollowUpAt: null });
  expect(patchDoc).toHaveBeenCalledWith(`adminConfig/pulseClubContact_${group.id}`, expect.objectContaining({ groupId: group.id, contactedAt: now }), { mustExist: true });
});

test('changed organizers and read-back mismatches cannot claim success', async () => {
  (getDoc as jest.Mock).mockResolvedValueOnce({ ...group, adminIds: ['replacement'] });
  await expect(setClubContact(club(), true)).rejects.toThrow('PULSE_HOME_ORGANIZER_CHANGED');
  expect(createDocOnly).not.toHaveBeenCalled();
  (getDoc as jest.Mock).mockResolvedValueOnce(group).mockResolvedValueOnce({ kind: 'pulseClubContact', groupId: group.id, organizerId: 'organizer', contactedAt: null, lastFollowUpAt: null });
  (createDocOnly as jest.Mock).mockResolvedValue('created');
  await expect(setClubContact(club(), true)).rejects.toThrow('PULSE_HOME_CONTACT_VERIFY');
});

test('undo persists null and also needs verification', async () => {
  (getDoc as jest.Mock).mockResolvedValueOnce(group).mockResolvedValueOnce({ kind: 'pulseClubContact', groupId: group.id, organizerId: 'organizer', contactedAt: null, lastFollowUpAt: null });
  (createDocOnly as jest.Mock).mockResolvedValue('conflict');
  (patchDoc as jest.Mock).mockResolvedValue(true);
  await expect(setClubContact({ ...club(), contactedAt: now - 1 }, false)).resolves.toMatchObject({ contactedAt: null });
});

test('follow-up is a verified existing-only update and does not rewrite the original outreach date', async () => {
  const before = { kind: 'pulseClubContact', groupId: group.id, organizerId: 'organizer', contactedAt: now - hour };
  (getDoc as jest.Mock).mockResolvedValueOnce(group).mockResolvedValueOnce(before).mockResolvedValueOnce({ ...before, lastFollowUpAt: now });
  (patchDoc as jest.Mock).mockResolvedValue(true);
  await expect(setClubFollowUp({ ...club(), contactedAt: now - hour })).resolves.toEqual({ organizerId: 'organizer', contactedAt: now - hour, lastFollowUpAt: now });
  expect(patchDoc).toHaveBeenCalledWith(`adminConfig/pulseClubContact_${group.id}`, { lastFollowUpAt: now, updatedAt: now }, { mustExist: true });
  expect(createDocOnly).not.toHaveBeenCalled();
});

test('follow-up cannot invent a prior contact and read-back mismatch cannot claim success', async () => {
  (getDoc as jest.Mock).mockResolvedValueOnce(group).mockResolvedValueOnce(null);
  await expect(setClubFollowUp(club())).rejects.toThrow('PULSE_HOME_NO_CONTACT');
  expect(patchDoc).not.toHaveBeenCalled();
  const before = { kind: 'pulseClubContact', groupId: group.id, organizerId: 'organizer', contactedAt: now - hour };
  (getDoc as jest.Mock).mockResolvedValueOnce(group).mockResolvedValueOnce(before).mockResolvedValueOnce(before);
  (patchDoc as jest.Mock).mockResolvedValue(true);
  await expect(setClubFollowUp(club())).rejects.toThrow('PULSE_HOME_FOLLOW_UP_VERIFY');
});

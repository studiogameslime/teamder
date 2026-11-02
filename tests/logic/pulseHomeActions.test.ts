jest.mock('../../pulse/src/services/firestoreRest', () => ({ queryDocumentPage: jest.fn(), queryCollectionRecent: jest.fn(), getDoc: jest.fn(), patchDoc: jest.fn(), createDocOnly: jest.fn() }));
jest.mock('../../pulse/src/services/cache', () => ({ cached: (_key: string, fn: () => unknown) => fn(), invalidate: jest.fn() }));
jest.mock('../../pulse/src/services/firebase', () => ({ isTestAccount: () => false }));
jest.mock('../../pulse/src/capabilities', () => ({ has: { firebase: () => true } }));
jest.mock('../../pulse/src/services/errorObservation', () => ({ observeCaughtError: jest.fn(), observeSettledErrors: (results: unknown) => results }));

import { fetchHomeActions, homeFollowUps, pendingClubRequests, shortageRounds, soloOrganizerClubs, supportWaitingRow } from '../../pulse/src/services/homeActions';
import { homeClubRows } from '../../pulse/src/services/homeDashboard';
import { queryCollectionRecent, queryDocumentPage } from '../../pulse/src/services/firestoreRest';
import { convIdFor } from '../../pulse/src/services/teamderChatService';

const now = Date.parse('2026-11-05T10:00:00Z'), day = 86400000;
const group = { id: 'club', name: 'מועדון', createdAt: now - 4 * day, creatorId: 'organizer', playerIds: ['organizer'], adminIds: ['organizer'], pendingPlayerIds: [] };
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now); (queryCollectionRecent as jest.Mock).mockResolvedValue([]); });
afterEach(() => jest.restoreAllMocks());

test('solo onboarding is only for new clubs with a known roster consisting of their actual organizer', () => {
  expect(soloOrganizerClubs([group, { ...group, id: 'personal', isPersonal: true }, { ...group, id: 'old', createdAt: Date.parse('2026-10-01') }, { ...group, id: 'joined', playerIds: ['organizer', 'new'] }, { ...group, id: 'unknown', playerIds: undefined }], now).map(c => c.id)).toEqual(['club']);
});

test('follow-ups retain first contact time, wait three days, and disappear after a recent check', () => {
  const contact = { id: 'saved', kind: 'pulseClubContact', groupId: group.id, organizerId: 'organizer', contactedAt: now - 3 * day };
  const rows = homeClubRows([group], [contact], now).rows;
  expect(homeFollowUps(rows, now)).toHaveLength(1);
  expect(homeFollowUps(rows, now - 1)).toHaveLength(0);
  expect(homeFollowUps(homeClubRows([group], [{ ...contact, lastFollowUpAt: now - day }], now).rows, now)).toHaveLength(0);
  expect(homeFollowUps(homeClubRows([group], [{ ...contact, organizerId: 'old-organizer' }], now).rows, now)).toHaveLength(0);
});

test('pending requests count memberships, remove duplicates/current members and exclude personal clubs', () => {
  const result = pendingClubRequests([{ ...group, pendingPlayerIds: ['organizer', 'new', 'new'] }, { ...group, id: 'another', pendingPlayerIds: ['new'] }, { ...group, id: 'personal', isPersonal: true, pendingPlayerIds: ['hidden'] }]);
  expect(result.map(r => [r.groupId, r.userId])).toEqual([['club', 'new'], ['another', 'new']]);
});

test('nearby capacity includes active guests/reservations, not waitlisted guests or repeated players', () => {
  const game = { id: 'round', status: 'open', startsAt: now + day, maxPlayers: 5, players: ['a', 'a', 'b'], guests: [{ id: 'g' }, { id: 'waiting', waitlisted: true }], pendingPromotion: { uid: 'c' } };
  const result = shortageRounds([game, { ...game, id: 'full', maxPlayers: 4 }, { ...game, id: 'ended', status: 'finished' }, { ...game, id: 'cancelled', status: 'cancelled' }, { ...game, id: 'later', startsAt: now + 4 * day }, { ...game, id: 'past', startsAt: now - 1 }, { ...game, id: 'unknown', maxPlayers: undefined }], now);
  expect(result.rows).toEqual([expect.objectContaining({ id: 'round', registered: 2, guests: 1, reserved: 1, remaining: 1 })]);
  expect(result.unknown).toBe(1);
});

test('support uses the same exact-message resolution boundary and validates canonical official threads', () => {
  const conversation = { id: convIdFor('user'), participants: ['teamder', 'user'] };
  const last = { id: 'm', senderId: 'user', createdAt: now, text: 'צריך עזרה' };
  expect(supportWaitingRow(conversation, last)).toMatchObject({ userId: 'user', messageId: 'm' });
  expect(supportWaitingRow({ ...conversation, supportResolvedMessageId: 'm', supportResolvedMessageAt: now }, last)).toBeNull();
  expect(supportWaitingRow({ ...conversation, supportResolvedMessageId: 'older', supportResolvedMessageAt: now }, last)).not.toBeNull();
  expect(supportWaitingRow(conversation, { ...last, senderId: 'teamder' })).toBeNull();
  expect(supportWaitingRow({ ...conversation, id: 'not-canonical' }, last)).toBeNull();
});

test('first-round existence includes cancelled/future history; a failed check stays unknown', async () => {
  (queryDocumentPage as jest.Mock).mockImplementation(async (collection, options) => {
    if (collection === 'groups') { expect(options.direction).toBe('ASCENDING'); return { rows: [group, { ...group, id: 'never' }, { ...group, id: 'failure' }] }; }
    if (collection === 'games' && options.where?.fieldFilter?.field?.fieldPath === 'groupId') {
      expect(options.limit).toBe(1);
      expect(options.direction).toBe('ASCENDING');
      const id = options.where.fieldFilter.value.stringValue;
      if (id === 'failure') throw Error('offline');
      return { rows: id === 'club' ? [{ id: 'cancelled-game', status: 'cancelled', startsAt: now + day }] : [] };
    }
    return { rows: [] };
  });
  const data = await fetchHomeActions();
  expect(data.noFirstRound?.map(c => c.id)).toEqual(['never']);
  expect(data.firstRoundUnknown).toBe(1);
});

test('support reads all pages, including legacy fallback, and does not truncate at one hundred', async () => {
  const cursor = { values: [{ referenceValue: 'dmConversations/last' }] };
  (queryDocumentPage as jest.Mock).mockImplementation(async (collection, options) => {
    if (collection !== 'dmConversations') return { rows: [] };
    const make = (i: number) => ({ id: convIdFor('u' + i), participants: ['teamder', 'u' + i], supportLastMessageId: 'm' + i, supportLastSenderId: 'u' + i, supportLastMessageAt: now - i });
    return options.cursor ? { rows: [{ id: convIdFor('legacy'), participants: ['teamder', 'legacy'] }] } : { rows: Array.from({ length: 100 }, (_, i) => make(i)), next: cursor };
  });
  (queryCollectionRecent as jest.Mock).mockResolvedValue([{ id: 'legacy-message', senderId: 'legacy', createdAt: now - day, text: 'ישן' }]);
  const data = await fetchHomeActions();
  expect(data.support).toHaveLength(101);
  expect(data.support?.[0].userId).toBe('legacy');
});

test('a failed legacy read does not become a zero support count and other sections remain usable', async () => {
  (queryDocumentPage as jest.Mock).mockImplementation(async collection => ({ rows: collection === 'groups' ? [group] : collection === 'dmConversations' ? [{ id: convIdFor('legacy'), participants: ['teamder', 'legacy'] }] : [] }));
  (queryCollectionRecent as jest.Mock).mockRejectedValue(Error('offline'));
  const data = await fetchHomeActions();
  expect(data.support).toBeNull();
  expect(data.failed).toEqual(['support']);
  expect(data.solo).toHaveLength(1);
});

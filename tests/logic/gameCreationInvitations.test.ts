import type { GameFormValues } from '@/screens/games/GameWizardForm';
import type { PendingAction } from '@/services/pendingAction';

const mockDisk = new Map<string, string>();
const mockResumers = new Map<string, (action: PendingAction) => Promise<unknown>>();
const mockCreateGame = jest.fn();
const mockInvite = jest.fn();
const mockLogEvent = jest.fn();
const mockNotice = jest.fn();
const mockNavigate = jest.fn();
let mockToken = 0;
let mockCurrentUser: { id: string; isGuest?: boolean } | null = { id: 'owner' };
let mockDraft: { id: string; values: Record<string, unknown> } | null = null;

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: async (key: string) => mockDisk.get(key) ?? null,
  setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
} }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_: string, value: string) => require('crypto').createHash('sha256').update(value).digest('hex'),
  randomUUID: () => `invitation-attempt-${++mockToken}`,
}));
jest.mock('@/services/gameService', () => ({ gameService: {
  createGameV2: (...args: unknown[]) => mockCreateGame(...args),
} }));
jest.mock('@/services/notificationsService', () => ({ notificationsService: {
  inviteToGame: (...args: unknown[]) => mockInvite(...args),
} }));
jest.mock('@/services/groupService', () => ({ groupService: {
  ensurePersonalGroupId: async () => 'personal-club',
  get: async () => ({ id: 'club', name: 'המועדון', adminIds: ['owner'] }),
} }));
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_target, name) => String(name) }),
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}));
jest.mock('@/services/creationOwner', () => ({ assertCreationOwner: (uid: string) => {
  if (mockCurrentUser?.id !== uid) throw Object.assign(new Error('session changed'), { name: 'StaleSessionError' });
} }));
jest.mock('@/types', () => ({ teamSizeFromFormat: () => 5 }));
jest.mock('@/services/actionCoordinator', () => ({
  registerResumer: (kind: string, resume: (action: PendingAction) => Promise<unknown>) => mockResumers.set(kind, resume),
}));
jest.mock('@/services/draftStore', () => ({ draftStore: {
  read: async () => mockDraft,
  restoreGameValues: (values: unknown) => ({ values, needsAttention: [] }),
} }));
jest.mock('@/services/availabilitySave', () => ({ persistAvailability: jest.fn() }));
jest.mock('@/services/clubCreation', () => ({ createClubFromValues: jest.fn() }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/screens/groups/GroupWizardForm', () => ({ EMPTY_GROUP_FORM_VALUES: {} }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: () => ({ currentUser: mockCurrentUser }) } }));
jest.mock('@/store/groupStore', () => ({ useGroupStore: { getState: () => ({ groups: [] }) } }));
jest.mock('@/navigation/navigationRef', () => ({ navigateAfterCreate: (...args: unknown[]) => mockNavigate(...args) }));
jest.mock('@/components/Toast', () => ({ toast: { info: (...args: unknown[]) => mockNotice(...args) } }));

import { createGameFromValues } from '@/services/gameCreation';
import '@/services/actionResumers';

function values(inviteFriendIds: string[] = []): GameFormValues {
  return {
    title: 'מחזור בדיקה', startsAt: Date.now() + 86400_000, fieldName: 'המגרש',
    city: '', fieldAddress: '', notes: '', format: '5v5', numberOfTeams: 2,
    matchDurationMinutes: '12', cancelDeadlineHours: 6, fieldType: 'grass',
    visibility: 'community', requiresApproval: false, waitlistApprovalRequired: true,
    waitlistApprovalTimeout: '20', bringBall: false, bringShirts: false, ruleTags: [],
    scheduledRegEnabled: false, registrationOpensAt: 0, publicOpenAt: 0, guestsOpenAt: 0,
    autoTeamsAt: 0, autoTeamsMethod: 'rating', acceptsFillers: false, fillerMinTrust: 0,
    advancedMode: false, advancedFillMode: 'temporary', advancedTieMode: 'bothOut',
    recurringGameEnabled: false, inviteFriendIds,
  } as unknown as GameFormValues;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDisk.clear();
  mockCurrentUser = { id: 'owner' };
  mockDraft = null;
  mockCreateGame.mockResolvedValue({ id: 'created-game' });
  mockInvite.mockResolvedValue({ invited: true });
  mockNavigate.mockReturnValue(true);
});

test('partial invitation failure preserves the game and reports confirmed, existing and failed invitations separately', async () => {
  mockInvite.mockImplementation(async ({ recipientId }: { recipientId: string }) => {
    if (recipientId === 'failed') throw new Error('offline');
    if (recipientId === 'existing') return { invited: false, reason: 'already_invited' };
    return { invited: true };
  });

  const result = await createGameFromValues({
    values: values(['sent', 'existing', 'failed']), uid: 'owner', groupId: 'club',
  });

  expect(result).toMatchObject({
    gameId: 'created-game', isOrphan: false,
    invitations: { requested: 3, sent: 1, existing: 1, failed: 1 },
  });
  expect(mockCreateGame).toHaveBeenCalledTimes(1);
  expect(mockLogEvent).toHaveBeenCalledWith('FriendsInvitedToGame', expect.objectContaining({ count: 1 }));
});

test('all invitation failures leave a usable created game and report zero confirmed invitations', async () => {
  mockInvite.mockRejectedValue(new Error('offline'));
  const result = await createGameFromValues({ values: values(['a', 'b']), uid: 'owner', groupId: 'club' });
  expect(result).toMatchObject({
    gameId: 'created-game', invitations: { requested: 2, sent: 0, existing: 0, failed: 2 },
  });
  expect(mockLogEvent).toHaveBeenCalledWith('FriendsInvitedToGame', expect.objectContaining({ count: 0 }));
});

test('already invited and already registered recipients are not counted as newly sent or failed', async () => {
  mockInvite.mockResolvedValueOnce({ invited: false, reason: 'already_invited' })
    .mockResolvedValueOnce({ invited: false, reason: 'already_registered' });
  const result = await createGameFromValues({ values: values(['a', 'b']), uid: 'owner', groupId: 'club' });
  expect(result).toMatchObject({ invitations: { requested: 2, sent: 0, existing: 2, failed: 0 } });
});

test('an unconfirmed or refused invitation response cannot be counted as a sent invitation', async () => {
  mockInvite.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ invited: false, reason: 'unavailable' });
  const result = await createGameFromValues({ values: values(['a', 'b']), uid: 'owner', groupId: 'club' });
  expect(result).toMatchObject({ invitations: { requested: 2, sent: 0, existing: 0, failed: 2 } });
});

test('each selected recipient is invited once and only confirmed invitations count in analytics', async () => {
  const result = await createGameFromValues({ values: values(['a', 'a', 'b']), uid: 'owner', groupId: 'club' });
  expect(result).toMatchObject({ invitations: { requested: 2, sent: 2, existing: 0, failed: 0 } });
  expect(mockInvite).toHaveBeenCalledTimes(2);
  expect(mockLogEvent).toHaveBeenCalledWith('FriendsInvitedToGame', {
    gameId: 'created-game', count: 2, requestedCount: 2, existingCount: 0, failedCount: 0,
  });
});

test('a persisted completion returns the same partial result without another creation, invitation or analytics event', async () => {
  mockInvite.mockRejectedValue(new Error('offline'));
  const context = { values: values(['a']), uid: 'owner', groupId: 'club', draftId: 'same-draft' };
  const first = await createGameFromValues(context);
  const second = await createGameFromValues(context);
  expect(second).toEqual(first);
  expect(second).toMatchObject({ invitations: { failed: 1 } });
  expect(mockCreateGame).toHaveBeenCalledTimes(1);
  expect(mockInvite).toHaveBeenCalledTimes(1);
  expect(mockLogEvent.mock.calls.filter(call => call[0] === 'FriendsInvitedToGame')).toHaveLength(1);
});

test('no selected invitations preserves the existing result contract', async () => {
  const result = await createGameFromValues({ values: values(), uid: 'owner', groupId: 'club' });
  expect(result).toEqual({ gameId: 'created-game', isOrphan: false });
  expect(mockInvite).not.toHaveBeenCalled();
  expect(mockLogEvent.mock.calls.filter(call => call[0] === 'FriendsInvitedToGame')).toHaveLength(0);
});

test('resuming creation remains terminal and opens the saved game while announcing partial invitation failure once', async () => {
  mockInvite.mockRejectedValue(new Error('offline'));
  mockDraft = { id: 'resume-draft', values: values(['a']) as unknown as Record<string, unknown> };
  const result = await mockResumers.get('create_game')!({ kind: 'create_game', draftId: 'resume-draft', targetId: 'club' } as PendingAction);
  expect(result).toEqual({ outcome: 'created', terminal: true });
  expect(mockNavigate).toHaveBeenCalledWith({ type: 'game', id: 'created-game' });
  expect(mockNotice).toHaveBeenCalledTimes(1);
  expect(mockNotice.mock.calls[0][0]).toContain('לא כל ההזמנות נשלחו');
});

test('resumed creation with all invitations confirmed does not add another success notice', async () => {
  mockDraft = { id: 'resume-draft', values: values(['a']) as unknown as Record<string, unknown> };
  const result = await mockResumers.get('create_game')!({ kind: 'create_game', draftId: 'resume-draft', targetId: 'club' } as PendingAction);
  expect(result).toEqual({ outcome: 'created', terminal: true });
  expect(mockNotice).not.toHaveBeenCalled();
});

test('a failed feedback presentation cannot turn resumed creation into another creation attempt', async () => {
  mockInvite.mockRejectedValue(new Error('offline'));
  mockNotice.mockImplementationOnce(() => { throw new Error('notice unavailable'); });
  mockDraft = { id: 'resume-draft', values: values(['a']) as unknown as Record<string, unknown> };
  await expect(mockResumers.get('create_game')!({ kind: 'create_game', draftId: 'resume-draft', targetId: 'club' } as PendingAction))
    .resolves.toEqual({ outcome: 'created', terminal: true });
  expect(mockCreateGame).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith({ type: 'game', id: 'created-game' });
});

test('account replacement during invitation delivery prevents a stale success result and analytics', async () => {
  mockInvite.mockImplementation(async () => {
    mockCurrentUser = { id: 'another-account' };
    return { invited: true };
  });
  await expect(createGameFromValues({ values: values(['a']), uid: 'owner', groupId: 'club' }))
    .rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(mockLogEvent.mock.calls.filter(call => call[0] === 'FriendsInvitedToGame')).toHaveLength(0);
});

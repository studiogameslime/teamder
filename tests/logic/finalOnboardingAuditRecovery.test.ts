const mockDisk = new Map<string, string>();
let mockReadHook: ((key: string) => Promise<void>) | undefined;
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: async (key: string) => { await mockReadHook?.(key); return mockDisk.get(key) ?? null; },
  setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  removeItem: async (key: string) => { mockDisk.delete(key); },
}}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: 'audit' } } }), { virtual: true });
jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_, key) => key }), logEvent: jest.fn(),
}));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/services/actionOfferBridge', () => ({ announceOfferFor: jest.fn() }));
let mockUser: { id: string; isGuest?: boolean; onboardingCompleted?: boolean } | null;
let mockGroups: Array<{ id: string; name: string; adminIds: string[] }> = [];
const mockGetGroup = jest.fn();
const mockJoinGame = jest.fn();
const mockJoinClub = jest.fn();
const mockCreateClub = jest.fn();
const mockCreateGame = jest.fn();
jest.mock('@/services/creationAttempt', () => ({ hasDraftCreationAttempt: async () => false }));
const mockSaveAvailability = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: () => ({ currentUser: mockUser }) } }));
jest.mock('@/store/groupStore', () => ({ useGroupStore: { getState: () => ({ groups: mockGroups, hydrated: false }) } }));
jest.mock('@/services/gameService', () => ({ gameService: { requestJoinGame: (...args: unknown[]) => mockJoinGame(...args) } }));
jest.mock('@/services/groupService', () => ({ groupService: {
  get: (...args: unknown[]) => mockGetGroup(...args),
  requestJoinById: (...args: unknown[]) => mockJoinClub(...args),
} }));
jest.mock('@/services/clubCreation', () => ({ createClubFromValues: (...args: unknown[]) => mockCreateClub(...args) }));
jest.mock('@/services/gameCreation', () => ({ createGameFromValues: (...args: unknown[]) => mockCreateGame(...args) }));
jest.mock('@/services/availabilitySave', () => ({ persistAvailability: (...args: unknown[]) => mockSaveAvailability(...args) }));
jest.mock('@/navigation/navigationRef', () => ({ navigateAfterCreate: (...args: unknown[]) => mockNavigate(...args) }));
jest.mock('@/screens/groups/GroupWizardForm', () => ({ EMPTY_GROUP_FORM_VALUES: { name: '', city: '', description: '' } }));
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import '@/services/actionResumers';
import { resumePendingAction, __resetCoordinatorForTests } from '@/services/actionCoordinator';
import { consumePendingAction, readPendingAction, writePendingAction } from '@/services/pendingAction';
import { draftStore, type DraftKind } from '@/services/draftStore';

const values = { name: 'עבודה חדשה', startsAt: Date.now() + 86400000,
  availability: { preferredDays: [2] }, coords: null };
async function park(kind: 'create_club' | 'create_game' | 'save_availability', draftId: string, targetId?: string) {
  await writePendingAction({ version: 2, kind, draftId, targetId, createdAt: Date.now(), origin: 'in_app' });
}
beforeEach(() => {
  mockDisk.clear(); jest.clearAllMocks(); __resetCoordinatorForTests(); mockReadHook = undefined;
  mockUser = { id: 'owner', onboardingCompleted: true }; mockGroups = [];
  mockGetGroup.mockReset().mockResolvedValue({ id: 'club', name: 'המועדון', adminIds: ['owner'] });
  mockCreateGame.mockResolvedValue({ gameId: 'created', isOrphan: false });
  mockCreateClub.mockResolvedValue({ groupId: 'created' });
  mockJoinGame.mockResolvedValue({ bucket: 'players' });
});

test('navigation consume grants the same persisted intent to exactly one concurrent caller', async () => {
  await writePendingAction({ version: 2, kind: 'open_game', targetId: 'fixture', createdAt: Date.now(), origin: 'deep_link' });
  const results = await Promise.all([consumePendingAction(), consumePendingAction(), consumePendingAction()]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await readPendingAction()).toBeNull();
});

test.each([
  ['create_club', 'club'], ['create_game', 'game'], ['save_availability', 'availability'],
] as const)('%s never submits or consumes a newer draft through an old pointer', async (kind, slot: DraftKind) => {
  await draftStore.write(slot, 'new-draft', values);
  await park(kind, 'old-draft');
  expect(await resumePendingAction()).toMatchObject({ status: 'ran', result: { terminal: true, reason: 'draft_expired' } });
  expect(mockCreateClub).not.toHaveBeenCalled(); expect(mockCreateGame).not.toHaveBeenCalled();
  expect(mockSaveAvailability).not.toHaveBeenCalled(); expect(mockNavigate).not.toHaveBeenCalled();
  expect(await draftStore.read(slot)).toMatchObject({ id: 'new-draft', values });
  expect(await readPendingAction()).toBeNull();
});

test('a club-game intent reads its actual club before a still-empty membership cache can erase it', async () => {
  await draftStore.write('game', 'draft', values); await park('create_game', 'draft', 'club');
  await resumePendingAction();
  expect(mockGetGroup).toHaveBeenCalledWith('club');
  expect(mockCreateGame).toHaveBeenCalledWith(expect.objectContaining({ uid: 'owner', groupId: 'club', groupName: 'המועדון' }));
  expect(await readPendingAction()).toBeNull();
});

test('a failed fresh club read retains the original intent and draft for a real retry', async () => {
  await draftStore.write('game', 'draft', values); await park('create_game', 'draft', 'club');
  mockGetGroup.mockRejectedValueOnce(Object.assign(Error('offline'), { code: 'unavailable' }));
  expect(await resumePendingAction()).toMatchObject({ result: { terminal: false, reason: 'network_unavailable' } });
  expect(mockCreateGame).not.toHaveBeenCalled();
  expect(await readPendingAction()).toMatchObject({ draftId: 'draft', targetId: 'club' });
  expect(await draftStore.read('game')).toMatchObject({ id: 'draft' });
  await resumePendingAction();
  expect(mockCreateGame).toHaveBeenCalledTimes(1);
});

test.each([null, { id: 'club', name: 'המועדון', adminIds: ['different-owner'] }])('a successful fresh read can terminally reject absent club/admin while keeping typed work: %p', async club => {
  await draftStore.write('game', 'draft', values); await park('create_game', 'draft', 'club');
  mockGetGroup.mockResolvedValue(club);
  expect(await resumePendingAction()).toMatchObject({ result: { terminal: true, reason: club ? 'game_join_rejected' : 'target_deleted' } });
  expect(mockCreateGame).not.toHaveBeenCalled(); expect(await readPendingAction()).toBeNull();
});

test('profile completion is a gate for a parked business action, including an existing incomplete account', async () => {
  mockUser = { id: 'owner', onboardingCompleted: false };
  await writePendingAction({ version: 2, kind: 'join_game', targetId: 'fixture', createdAt: Date.now(), origin: 'in_app' });
  expect(await resumePendingAction()).toEqual({ status: 'held' });
  expect(mockJoinGame).not.toHaveBeenCalled();
  expect(await readPendingAction()).toMatchObject({ targetId: 'fixture' });
  mockUser.onboardingCompleted = true;
  expect(await resumePendingAction()).toMatchObject({ status: 'ran', result: { outcome: 'joined' } });
  expect(mockJoinGame).toHaveBeenCalledTimes(1);
});

test('an account switch while the coordinator reads a draft cannot resume its action under the new account', async () => {
  await draftStore.write('club', 'draft', values); await park('create_club', 'draft');
  let switched = false;
  mockReadHook = async key => {
    if (!switched && key === 'footy.draft.club') { switched = true; mockUser = { id: 'other', onboardingCompleted: true }; }
  };
  const result = await resumePendingAction();
  expect(result.status).toBe('held');
  expect(mockCreateClub).not.toHaveBeenCalled(); expect(mockNavigate).not.toHaveBeenCalled();
  expect(await readPendingAction()).not.toBeNull();
});

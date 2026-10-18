import { createHash } from 'crypto';
import type { GroupFormValues } from '@/screens/groups/GroupWizardForm';
import type { User } from '@/types';

const mockRecords = new Map<string, string>();
const mockCreate = jest.fn<Promise<{ id: string }>, [unknown]>();
const mockEnable = jest.fn();
const mockAssertOwner = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: async (key: string) => mockRecords.get(key) ?? null,
  setItem: async (key: string, value: string) => { mockRecords.set(key, value); },
} }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_: string, value: string) => createHash('sha256').update(value).digest('hex'),
  randomUUID: () => 'stable-privacy-attempt-token',
}));
jest.mock('@/services/groupService', () => ({ groupService: { createGroup: (...args: [unknown]) => mockCreate(...args) } }));
jest.mock('@/services/seasonService', () => ({ seasonService: { enable: (...args: unknown[]) => mockEnable(...args) },
  SeasonRefusedError: class SeasonRefusedError extends Error { constructor(public reason: string) { super(reason); } },
}));
jest.mock('@/services/creationOwner', () => ({ assertCreationOwner: (...args: unknown[]) => mockAssertOwner(...args) }));
jest.mock('@/services/analyticsService', () => ({ AnalyticsEvent: {}, logEvent: jest.fn() }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/data/coverImages', () => ({ pickRandomCoverId: () => 'one-cover' }));
import { createClubFromValues } from '@/services/clubCreation';
import { SeasonRefusedError } from '@/services/seasonService';

beforeEach(() => {
  mockRecords.clear(); mockCreate.mockReset(); mockEnable.mockReset(); mockAssertOwner.mockReset();
  mockCreate.mockRejectedValue(Error('ACK lost'));
});

test('the real club mapping freezes only creator.id, never the full account profile in pending storage', async () => {
  const user: User = { id: 'owner', name: 'private name', email: 'private@example.test', createdAt: 1,
    fcmTokens: ['private-push-token'],
    availability: { preferredDays: [4], timeFrom: '21:37', isAvailableForInvites: false } };
  const form: GroupFormValues = { name: 'מועדון', description: '', city: '', contactPhone: '', maxMembers: '40',
    rules: '', isOpen: false, internalRating: false, hideInternalRating: false, cardsEnabled: false,
    yellowCardValidityDays: '', redCardValidityDays: '',
    seasons: { enabled: false, cadenceType: 'rounds', targetRounds: 10, months: 3 } };
  await expect(createClubFromValues(form, user, 'draft-id')).rejects.toThrow('ACK lost');
  const raw = [...mockRecords.values()][0];
  expect(raw).not.toContain(user.email);
  expect(raw).not.toContain('private-push-token');
  expect(raw).not.toContain(user.name);
  expect(raw).not.toContain('preferredDays');
  expect(raw).not.toContain('21:37');
  expect(JSON.parse(raw).prepared.creator).toEqual({ id: 'owner' });
  expect(mockCreate.mock.calls[0][0]).toMatchObject({ creator: { id: 'owner' } });
});

const seasonsForm: GroupFormValues = { name: 'מועדון', description: '', city: '', contactPhone: '', maxMembers: '40',
  rules: '', isOpen: false, internalRating: false, hideInternalRating: false, cardsEnabled: false,
  yellowCardValidityDays: '', redCardValidityDays: '',
  seasons: { enabled: true, cadenceType: 'rounds', targetRounds: 10, months: 3 } };
const founder: User = { id: 'owner', name: 'מנהל', createdAt: 1 };
test('a server refusal that seasons are already enabled counts as success on club creation recovery', async () => {
  mockCreate.mockResolvedValue({ id: 'same-club' });
  mockEnable.mockRejectedValue(new SeasonRefusedError('seasonsAlreadyOn'));
  expect(await createClubFromValues(seasonsForm, founder, 'seasons-draft')).toEqual({ groupId: 'same-club', seasonsFailed: false });
});
test('an actual season network failure still reports the partial failure', async () => {
  mockCreate.mockResolvedValue({ id: 'same-club' });
  mockEnable.mockRejectedValue(Object.assign(Error('offline'), { code: 'unavailable' }));
  expect(await createClubFromValues(seasonsForm, founder, 'seasons-draft')).toEqual({ groupId: 'same-club', seasonsFailed: true });
});
test('a changed identity during season enable is not swallowed as an already-enabled success', async () => {
  mockCreate.mockResolvedValue({ id: 'same-club' });
  mockEnable.mockImplementation(async () => {
    mockAssertOwner.mockImplementation(() => { throw Object.assign(Error('stale'), { name: 'StaleSessionError' }); });
    throw new SeasonRefusedError('seasonsAlreadyOn');
  });
  await expect(createClubFromValues(seasonsForm, founder, 'seasons-draft')).rejects.toMatchObject({ name: 'StaleSessionError' });
});

/**
 * Making a game without a screen — and which uid owns the group it goes into.
 *
 * The property this file exists for: a standalone game's hidden personal group
 * must be provisioned under the FULL account, never under the anonymous session
 * that was browsing. `GameCreateScreen` used to provision it in a mount effect,
 * which for a guest meant a real group document written server-side before
 * anybody had typed a character — and then, if they signed into an existing
 * account, the game would have been created inside a group belonging to a
 * session that no longer existed.
 *
 * Everything else here is the argument mapping, asserted because it was MOVED
 * rather than rewritten and a silent drift would be invisible.
 */

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

const logEvent = jest.fn();
const createGameV2 = jest.fn();
const inviteToGame = jest.fn();
const ensurePersonalGroupId = jest.fn();
const mockCreationDisk = new Map<string, string>();
let mockCreationToken = 0;
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: async (key: string) => mockCreationDisk.get(key) ?? null,
  setItem: async (key: string, value: string) => { mockCreationDisk.set(key, value); },
} }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_: string, value: string) => require('crypto').createHash('sha256').update(value).digest('hex'),
  randomUUID: () => `stable-game-attempt-${++mockCreationToken}`,
}));

jest.mock('@/services/gameService', () => ({
  gameService: { createGameV2: (...a: unknown[]) => createGameV2(...a) },
}));
jest.mock('@/services/notificationsService', () => ({
  notificationsService: { inviteToGame: (...a: unknown[]) => inviteToGame(...a) },
}));
jest.mock('@/services/groupService', () => ({
  groupService: { ensurePersonalGroupId: (...a: unknown[]) => ensurePersonalGroupId(...a) },
}));
jest.mock('@/types', () => ({ teamSizeFromFormat: () => 5 }));
jest.mock('@/services/creationOwner', () => ({ assertCreationOwner: jest.fn() }));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import { createGameFromValues } from '@/services/gameCreation';

const START = Date.now() + 7 * 24 * 3600_000;

/** Only the fields the mapping reads. The wizard's type has many more; passing
 *  a partial keeps the test about behaviour rather than about the form. */
const values = (over: Record<string, unknown> = {}) =>
  ({
    title: '',
    startsAt: START,
    fieldName: ' אצטדיון ',
    city: ' חולון ',
    fieldAddress: '',
    notes: '',
    format: '5v5',
    numberOfTeams: 2,
    matchDurationMinutes: '12',
    cancelDeadlineHours: 6,
    fieldType: 'grass',
    visibility: 'community',
    requiresApproval: false,
    waitlistApprovalRequired: true,
    waitlistApprovalTimeout: '20',
    bringBall: false,
    bringShirts: false,
    ruleTags: [],
    scheduledRegEnabled: false,
    registrationOpensAt: 0,
    publicOpenAt: 0,
    guestsOpenAt: 0,
    autoTeamsAt: 0,
    autoTeamsMethod: 'balanced',
    acceptsFillers: false,
    fillerMinTrust: 0,
    advancedMode: false,
    advancedFillMode: 'permanent',
    advancedTieMode: 'bothOut',
    recurringGameEnabled: false,
    inviteFriendIds: [],
    ...over,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreationDisk.clear();
  createGameV2.mockImplementation(async (input) => ({ id: 'g1', ...(input.recurring ? { seriesId: 'series-g1' } : {}) }));
  ensurePersonalGroupId.mockResolvedValue('personal-of-u1');
});

test('lost ACK then restart after kickoff and club rename reuses the frozen request and attempt', async () => {
  const originalStartsAt = Date.now() + 60_000;
  const original = values({ title: '', startsAt: originalStartsAt,
    registrationOpensAt: Date.now() - 1000, publicOpenAt: 0, guestsOpenAt: 0, autoTeamsAt: 0 });
  createGameV2.mockRejectedValueOnce(Error('ACK lost'));
  await expect(createGameFromValues({ values: original, uid: 'u1', groupId: 'c1', groupName: 'שם קודם', draftId: 'sent-draft' }))
    .rejects.toThrow('ACK lost');
  const first = createGameV2.mock.calls[0][0];
  const now = jest.spyOn(Date, 'now').mockReturnValue(originalStartsAt + 60_000);
  try {
    jest.resetModules();
    const restarted = require('@/services/gameCreation') as typeof import('@/services/gameCreation');
    await restarted.createGameFromValues({ values: original, uid: 'u1', groupId: 'c1', groupName: 'שם חדש', draftId: 'sent-draft' });
    const retry = createGameV2.mock.calls[1][0];
    expect(retry).toEqual(first);
    expect(retry.title).toBe('שם קודם');
    expect(retry.startsAt).toBe(originalStartsAt);
  } finally { now.mockRestore(); }
});

test('series failure after game creation stays retryable and pending; retry completes same game and series', async () => {
  const form = values({ recurringGameEnabled: true });
  createGameV2.mockResolvedValueOnce({ id: 'same-game' });
  await expect(createGameFromValues({ values: form, uid: 'u1', groupId: 'c1', draftId: 'recurring-draft' }))
    .rejects.toMatchObject({ code: 'unavailable', creationSaved: true, message: expect.stringContaining('המחזור נוצר') });
  const pending = [...mockCreationDisk.values()].map(raw => JSON.parse(raw)).find(item => item.id);
  expect(pending.completed).toBeUndefined();
  createGameV2.mockResolvedValueOnce({ id: 'same-game', seriesId: 'same-series' });
  expect(await createGameFromValues({ values: form, uid: 'u1', groupId: 'c1', draftId: 'recurring-draft' }))
    .toEqual({ gameId: 'same-game', isOrphan: false });
  expect(createGameV2.mock.calls[1][0].creationAttemptId).toBe(createGameV2.mock.calls[0][0].creationAttemptId);
});

const arg = () => createGameV2.mock.calls[0][0];

// ─── which group, and whose ───────────────────────────────────────────────

describe('a standalone game', () => {
  it('provisions the personal group at creation time, not before', async () => {
    await createGameFromValues({ values: values(), uid: 'u1', groupId: null });

    expect(ensurePersonalGroupId).toHaveBeenCalledTimes(1);
    expect(arg().groupId).toBe('personal-of-u1');
    // `createdBy` is the identity that will own it.
    expect(arg().createdBy).toBe('u1');
    expect(arg().isOrphanContext).toBe(true);
  });

  it('titles itself, because the synthesised group has no name to borrow', async () => {
    await createGameFromValues({ values: values({ title: '' }), uid: 'u1', groupId: null });
    expect(arg().title).toBe('מחזור חד־פעמי');
  });

  it('a typed title still wins', async () => {
    await createGameFromValues({
      values: values({ title: 'ערב שלישי' }),
      uid: 'u1',
      groupId: null,
    });
    expect(arg().title).toBe('ערב שלישי');
  });

  // Recurring and the community scheduling knobs are meaningless without a club.
  it('never marks a standalone game recurring', async () => {
    await createGameFromValues({
      values: values({ recurringGameEnabled: true, publicOpenAt: START }),
      uid: 'u1',
      groupId: null,
    });
    expect(arg().recurring).toBe(false);
    expect(arg().publicOpenAt).toBeUndefined();
  });

  it('reports the quick-game create', async () => {
    await createGameFromValues({ values: values(), uid: 'u1', groupId: null });
    expect(logEvent.mock.calls.filter((c) => c[0] === 'QuickGameCreated')).toHaveLength(1);
  });
});

describe('a club game', () => {
  it('uses the club and provisions nothing', async () => {
    await createGameFromValues({
      values: values(),
      uid: 'u1',
      groupId: 'c1',
      groupName: 'שכונה',
    });
    expect(ensurePersonalGroupId).not.toHaveBeenCalled();
    expect(arg().groupId).toBe('c1');
    expect(arg().isOrphanContext).toBe(false);
  });

  it('falls back to the club name for an untyped title', async () => {
    await createGameFromValues({
      values: values({ title: '' }),
      uid: 'u1',
      groupId: 'c1',
      groupName: 'שכונה',
    });
    expect(arg().title).toBe('שכונה');
  });

  it('honours recurring and the community scheduling knobs', async () => {
    await createGameFromValues({
      values: values({ recurringGameEnabled: true, publicOpenAt: START, guestsOpenAt: START }),
      uid: 'u1',
      groupId: 'c1',
      groupName: 'שכונה',
    });
    expect(arg().recurring).toBe(true);
    expect(arg().publicOpenAt).toBe(START);
    expect(arg().guestsOpenAt).toBe(START);
  });

  it('does not report a quick-game create', async () => {
    await createGameFromValues({ values: values(), uid: 'u1', groupId: 'c1' });
    expect(logEvent.mock.calls.filter((c) => c[0] === 'QuickGameCreated')).toHaveLength(0);
  });
});

// ─── the mapping ──────────────────────────────────────────────────────────

describe('the argument mapping, moved not rewritten', () => {
  it('trims the free text and drops what is empty', async () => {
    await createGameFromValues({ values: values(), uid: 'u1', groupId: 'c1' });
    expect(arg().fieldName).toBe('אצטדיון');
    expect(arg().city).toBe('חולון');
    expect(arg().notes).toBeUndefined();
    expect(arg().fieldAddress).toBeUndefined();
  });

  it('derives maxPlayers from the format and the team count', async () => {
    await createGameFromValues({
      values: values({ numberOfTeams: 3 }),
      uid: 'u1',
      groupId: 'c1',
    });
    expect(arg().maxPlayers).toBe(15); // 5 per team × 3
  });

  it('clamps the waitlist confirmation window', async () => {
    for (const [given, want] of [
      ['1', 2],
      ['500', 120],
      ['45', 45],
      ['nonsense', 20],
    ] as const) {
      createGameV2.mockClear();
      await createGameFromValues({
        values: values({ waitlistApprovalTimeout: given }),
        uid: 'u1',
        groupId: 'c1',
      });
      expect(createGameV2.mock.calls[0][0].waitlistApprovalTimeoutMinutes).toBe(want);
    }
  });

  it('omits a non-numeric duration rather than sending NaN', async () => {
    await createGameFromValues({
      values: values({ matchDurationMinutes: '' }),
      uid: 'u1',
      groupId: 'c1',
    });
    expect(arg().matchDurationMinutes).toBeUndefined();
  });

  it('only sends registrationOpensAt when scheduling is on AND set', async () => {
    await createGameFromValues({
      values: values({ scheduledRegEnabled: false, registrationOpensAt: START }),
      uid: 'u1',
      groupId: 'c1',
    });
    expect(arg().registrationOpensAt).toBeUndefined();

    createGameV2.mockClear();
    await createGameFromValues({
      values: values({ scheduledRegEnabled: true, registrationOpensAt: START }),
      uid: 'u1',
      groupId: 'c1',
    });
    expect(arg().registrationOpensAt).toBe(START);
  });

  it('only sends a filler trust floor when fillers are accepted', async () => {
    await createGameFromValues({
      values: values({ acceptsFillers: false, fillerMinTrust: 3 }),
      uid: 'u1',
      groupId: 'c1',
    });
    expect(arg().fillerMinTrust).toBeUndefined();
  });
});

// ─── the aftermath ────────────────────────────────────────────────────────

describe('after the game exists', () => {
  it('sends the friend invites the organiser picked', async () => {
    inviteToGame.mockResolvedValue(undefined);
    await createGameFromValues({
      values: values({ inviteFriendIds: ['f1', 'f2'] }),
      uid: 'u1',
      groupId: 'c1',
    });
    expect(inviteToGame).toHaveBeenCalledTimes(2);
    expect(logEvent.mock.calls.filter((c) => c[0] === 'FriendsInvitedToGame')).toHaveLength(1);
  });

  // Best-effort: a failed invite must never fail the creation the person asked
  // for. The game exists either way.
  it('survives an invite that fails', async () => {
    inviteToGame.mockRejectedValue(new Error('offline'));
    const out = await createGameFromValues({
      values: values({ inviteFriendIds: ['f1'] }),
      uid: 'u1',
      groupId: 'c1',
    });
    expect(out.gameId).toBe('g1');
  });

  it('reports scheduled auto-teams with the lead time', async () => {
    await createGameFromValues({
      values: values({ autoTeamsAt: START - 3600_000 }),
      uid: 'u1',
      groupId: 'c1',
    });
    const call = logEvent.mock.calls.find((c) => c[0] === 'AutoTeamsScheduled');
    expect(call?.[1]).toMatchObject({ gameId: 'g1', leadMinutes: 60, source: 'create' });
  });
});

// ─── failure ──────────────────────────────────────────────────────────────

describe('failure', () => {
  // Thrown, not swallowed: the caller classifies it. The screen renders the
  // overlap conflict, and the resumer decides retry vs discard.
  it('propagates so the caller can classify it', async () => {
    createGameV2.mockRejectedValue(Object.assign(new Error('x'), { code: 'GAME_OVERLAP' }));
    await expect(
      createGameFromValues({ values: values(), uid: 'u1', groupId: 'c1' }),
    ).rejects.toMatchObject({ code: 'GAME_OVERLAP' });
  });

  it('a failed group provisioning stops the creation', async () => {
    ensurePersonalGroupId.mockRejectedValue(new Error('callable down'));
    await expect(
      createGameFromValues({ values: values(), uid: 'u1', groupId: null }),
    ).rejects.toThrow();
    expect(createGameV2).not.toHaveBeenCalled();
  });
});

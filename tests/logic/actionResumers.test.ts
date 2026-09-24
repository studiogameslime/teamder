/**
 * What each action does when it resumes — and, mostly, what counts as success.
 *
 * The single most important property here: the resumer asks the SERVER again.
 * The world moved while the person was in Google's sheet. The last seat can be
 * gone, the game can have started, an admin can have approved them already. A
 * resumer that replayed a snapshot taken before authentication would join them
 * to a game that no longer has room, or report a failure for a club they are
 * already in.
 *
 * The second: a waitlist place and a pending approval are RESULTS. Somebody who
 * just got in line has had their request completed; telling them the app failed
 * is worse than telling them nothing.
 */

const mem = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (k: string) => Promise.resolve(mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => {
      mem.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      mem.delete(k);
      return Promise.resolve();
    },
  },
}));
jest.mock(
  'expo-constants',
  () => ({ __esModule: true, default: { expoConfig: { version: '1.1.14' } } }),
  { virtual: true },
);
jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: jest.fn(),
}));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));

const requestJoinGame = jest.fn();
const requestJoinById = jest.fn();
jest.mock('@/services/gameService', () => ({
  gameService: { requestJoinGame: (...a: unknown[]) => requestJoinGame(...a) },
}));
jest.mock('@/services/groupService', () => ({
  groupService: { requestJoinById: (...a: unknown[]) => requestJoinById(...a) },
}));

let currentUser: { id: string; isGuest?: boolean } | null = { id: 'u1' };
let myGroups: Array<{ id: string; name?: string; adminIds?: string[] }> = [];
jest.mock('@/store/userStore', () => ({
  useUserStore: { getState: () => ({ currentUser }) },
}));
jest.mock('@/store/groupStore', () => ({
  useGroupStore: { getState: () => ({ groups: myGroups }) },
}));

const createClubFromValues = jest.fn();
const createGameFromValues = jest.fn();
const persistAvailability = jest.fn();
const navigateAfterCreate = jest.fn();
jest.mock('@/services/clubCreation', () => ({
  createClubFromValues: (...a: unknown[]) => createClubFromValues(...a),
}));
jest.mock('@/services/gameCreation', () => ({
  createGameFromValues: (...a: unknown[]) => createGameFromValues(...a),
}));
jest.mock('@/services/availabilitySave', () => ({
  persistAvailability: (...a: unknown[]) => persistAvailability(...a),
}));
jest.mock('@/navigation/navigationRef', () => ({
  navigateAfterCreate: (...a: unknown[]) => navigateAfterCreate(...a),
}));
jest.mock('@/screens/groups/GroupWizardForm', () => ({
  EMPTY_GROUP_FORM_VALUES: { name: '', city: '', description: '' },
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import '@/services/actionResumers';
import {
  resumePendingAction,
  __resetCoordinatorForTests,
} from '@/services/actionCoordinator';
import { readPendingAction } from '@/services/pendingAction';
import { draftStore } from '@/services/draftStore';

const err = (code: string) => Object.assign(new Error(code), { code });

/** Park an action straight onto disk — the coordinator's own path is covered by
 *  actionCoordinator.test.ts; here the interest is what the resumer does. */
function park(kind: string, targetId?: string, draftId?: string) {
  mem.set(
    'footy.pending.action',
    JSON.stringify({
      version: 2,
      createdAt: Date.now() - 1000,
      origin: 'in_app',
      kind,
      ...(targetId ? { targetId } : {}),
      ...(draftId ? { draftId } : {}),
    }),
  );
}

beforeEach(() => {
  mem.clear();
  jest.clearAllMocks();
  __resetCoordinatorForTests();
  currentUser = { id: 'u1' };
  myGroups = [];
});

// ─── join_game ────────────────────────────────────────────────────────────

describe('resuming a game join', () => {
  it('asks the server, and a seat is a success', async () => {
    park('join_game', 'g1');
    requestJoinGame.mockResolvedValue({ bucket: 'players' });

    const out = await resumePendingAction();
    expect(requestJoinGame).toHaveBeenCalledWith('g1', 'u1', 'deep_link');
    expect(out).toMatchObject({ status: 'ran', result: { outcome: 'joined', terminal: true } });
    expect(await readPendingAction()).toBeNull();
  });

  // The case the design called out: the last place went while they were
  // authenticating. The answer is the CURRENT one, and it is not an error.
  it('a seat taken during auth becomes a waitlist place, terminally', async () => {
    park('join_game', 'g1');
    requestJoinGame.mockResolvedValue({ bucket: 'waitlist' });

    const out = await resumePendingAction();
    expect(out).toMatchObject({
      status: 'ran',
      result: { outcome: 'waitlisted', terminal: true },
    });
    expect(await readPendingAction()).toBeNull();
  });

  it('a club that needs approval becomes approval_pending, terminally', async () => {
    park('join_game', 'g1');
    requestJoinGame.mockResolvedValue({ bucket: 'pending' });

    const out = await resumePendingAction();
    expect(out).toMatchObject({
      status: 'ran',
      result: { outcome: 'approval_pending', terminal: true },
    });
  });

  it('a deleted game is terminal, not retried forever', async () => {
    park('join_game', 'g1');
    requestJoinGame.mockRejectedValue(err('GAME_NOT_OPEN'));

    const out = await resumePendingAction();
    expect(out).toMatchObject({ status: 'ran', result: { terminal: true } });
    expect(await readPendingAction()).toBeNull();
  });

  it('a game that started while they authenticated is terminal', async () => {
    park('join_game', 'g1');
    requestJoinGame.mockRejectedValue(err('GAME_STARTED'));
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'game_started' } });
  });

  // The only class worth keeping the stash for.
  it('a network failure keeps the action for a retry', async () => {
    park('join_game', 'g1');
    requestJoinGame.mockRejectedValue(err('unavailable'));

    const out = await resumePendingAction();
    expect(out).toMatchObject({
      result: { terminal: false, reason: 'network_unavailable' },
    });
    expect(await readPendingAction()).not.toBeNull();
  });

  it('a rate limit does too', async () => {
    park('join_game', 'g1');
    requestJoinGame.mockRejectedValue(err('resource-exhausted'));
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: false, reason: 'rate_limited' } });
    expect(await readPendingAction()).not.toBeNull();
  });

  // A stash with no target never reaches a resumer at all: `parsePendingAction`
  // requires `targetId` on a targeted kind and drops the blob, so the malformed
  // value is gone before anything can act on half of it. The resumer's own
  // missing-target branch is defence in depth behind that.
  it('a stash with no target is rejected at parse, not half-executed', async () => {
    park('join_game');
    const out = await resumePendingAction();
    expect(out).toEqual({ status: 'none' });
    expect(requestJoinGame).not.toHaveBeenCalled();
  });
});

// ─── join_club ────────────────────────────────────────────────────────────

describe('resuming a club join', () => {
  it('requests membership and reports pending as a completed request', async () => {
    park('join_club', 'c1');
    requestJoinById.mockResolvedValue({ status: 'pending' });

    const out = await resumePendingAction();
    expect(requestJoinById).toHaveBeenCalledWith('c1', 'u1');
    expect(out).toMatchObject({ result: { outcome: 'approval_pending', terminal: true } });
  });

  it('an open club joins outright', async () => {
    park('join_club', 'c1');
    requestJoinById.mockResolvedValue({ status: 'joined' });
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { outcome: 'joined', terminal: true } });
  });

  // Signing into an account that is ALREADY in the club is an ordinary thing to
  // do, and it is not a failure. This is the §24 case.
  it('an account that was already a member is a success with no request', async () => {
    park('join_club', 'c1');
    myGroups = [{ id: 'c1' }];

    const out = await resumePendingAction();
    expect(requestJoinById).not.toHaveBeenCalled();
    expect(out).toMatchObject({ result: { outcome: 'joined', terminal: true } });
    expect(await readPendingAction()).toBeNull();
  });

  it('and the server saying already_member is the same answer', async () => {
    park('join_club', 'c1');
    requestJoinById.mockResolvedValue({ status: 'already_member' });
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { outcome: 'joined', terminal: true } });
  });

  it('a club that no longer exists is terminal', async () => {
    park('join_club', 'c1');
    requestJoinById.mockResolvedValue({ status: 'not_found' });
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'target_deleted' } });
  });

  it('a network failure keeps it', async () => {
    park('join_club', 'c1');
    requestJoinById.mockRejectedValue(err('deadline-exceeded'));
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: false } });
    expect(await readPendingAction()).not.toBeNull();
  });
});

// ─── create_club ──────────────────────────────────────────────────────────

describe('resuming a club creation', () => {
  it('creates the club from the draft, with no screen involved', async () => {
    await draftStore.write('club', 'd1', { name: 'שכונת שושי', city: 'חולון' });
    park('create_club', undefined, 'd1');
    createClubFromValues.mockResolvedValue({ groupId: 'newClub', seasonsFailed: false });

    const out = await resumePendingAction();
    // The values reach it merged onto the CURRENT defaults, not raw.
    expect(createClubFromValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'שכונת שושי', city: 'חולון' }),
      expect.objectContaining({ id: 'u1' }),
    );
    expect(out).toMatchObject({ result: { outcome: 'created', terminal: true } });
    expect(await readPendingAction()).toBeNull();
    expect(await draftStore.read('club')).toBeNull();
  });

  // The whole reason the creation moved out of the screen. Both resume paths
  // unmount it, so a screen-registered handler was null exactly when needed.
  it('needs no mounted screen — it navigates through the ref', async () => {
    await draftStore.write('club', 'd1', { name: 'x' });
    park('create_club', undefined, 'd1');
    createClubFromValues.mockResolvedValue({ groupId: 'c9', seasonsFailed: false });

    await resumePendingAction();
    expect(navigateAfterCreate).toHaveBeenCalledWith({ type: 'club', id: 'c9' });
  });

  it('a creation failure keeps both the draft and the intent', async () => {
    await draftStore.write('club', 'd1', { name: 'x' });
    park('create_club', undefined, 'd1');
    createClubFromValues.mockRejectedValue(err('unavailable'));

    await resumePendingAction();
    expect(await draftStore.read('club')).not.toBeNull();
    expect(await readPendingAction()).not.toBeNull();
  });

  // An expired draft has nothing left to create, so holding the action would
  // keep offering a club nobody typed.
  it('an expired draft is terminal', async () => {
    park('create_club', undefined, 'd1');

    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'draft_expired' } });
    expect(await readPendingAction()).toBeNull();
    expect(createClubFromValues).not.toHaveBeenCalled();
  });
});

// ─── create_game ──────────────────────────────────────────────────────────

describe('resuming a game creation', () => {
  const future = Date.now() + 7 * 24 * 3600_000;

  it('creates a STANDALONE game with no group on the action', async () => {
    await draftStore.write('game', 'd1', { title: 'ערב שלישי', startsAt: future });
    park('create_game', undefined, 'd1');
    createGameFromValues.mockResolvedValue({ gameId: 'g9', isOrphan: true });

    const out = await resumePendingAction();
    // groupId null is the signal to provision the personal group — and that
    // provisioning now happens inside createGameFromValues, under THIS uid.
    expect(createGameFromValues).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'u1', groupId: null }),
    );
    expect(out).toMatchObject({ result: { outcome: 'created', terminal: true } });
    expect(await readPendingAction()).toBeNull();
    expect(await draftStore.read('game')).toBeNull();
  });

  it('creates a CLUB game with the group context the action carried', async () => {
    myGroups = [{ id: 'c1', name: 'שכונה', adminIds: ['u1'] }];
    await draftStore.write('game', 'd1', { title: '', startsAt: future });
    park('create_game', 'c1', 'd1');
    createGameFromValues.mockResolvedValue({ gameId: 'g9', isOrphan: false });

    await resumePendingAction();
    expect(createGameFromValues).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'u1', groupId: 'c1', groupName: 'שכונה' }),
    );
  });

  it('navigates to the new game through the ref, with no screen mounted', async () => {
    await draftStore.write('game', 'd1', { startsAt: future });
    park('create_game', undefined, 'd1');
    createGameFromValues.mockResolvedValue({ gameId: 'g9', isOrphan: true });

    await resumePendingAction();
    expect(navigateAfterCreate).toHaveBeenCalledWith({ type: 'game', id: 'g9' });
  });

  // Authorisation can lapse while somebody is authenticating. Checked before
  // creating rather than discovered as a rules denial.
  it('refuses when the club is gone', async () => {
    myGroups = [];
    await draftStore.write('game', 'd1', { startsAt: future });
    park('create_game', 'c1', 'd1');

    const out = await resumePendingAction();
    expect(createGameFromValues).not.toHaveBeenCalled();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'target_deleted' } });
  });

  it('refuses when this account does not administer the club', async () => {
    myGroups = [{ id: 'c1', name: 'שכונה', adminIds: ['someoneElse'] }];
    await draftStore.write('game', 'd1', { startsAt: future });
    park('create_game', 'c1', 'd1');

    const out = await resumePendingAction();
    expect(createGameFromValues).not.toHaveBeenCalled();
    expect(out).toMatchObject({ result: { terminal: true } });
  });

  // NEEDS CORRECTION, not failure. A game must never be created for a moment
  // that has already passed, and a replacement date must never be invented —
  // so the intent AND the draft both survive and the form reopens filled in.
  it('refuses a kick-off that passed, and keeps everything', async () => {
    await draftStore.write('game', 'd1', { startsAt: Date.now() - 60_000 });
    park('create_game', undefined, 'd1');

    const out = await resumePendingAction();
    expect(createGameFromValues).not.toHaveBeenCalled();
    expect(out).toMatchObject({ result: { terminal: false } });
    expect(await readPendingAction()).not.toBeNull();
    expect(await draftStore.read('game')).not.toBeNull();
  });

  it('a network failure keeps both', async () => {
    await draftStore.write('game', 'd1', { startsAt: future });
    park('create_game', undefined, 'd1');
    createGameFromValues.mockRejectedValue(err('unavailable'));

    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: false, reason: 'network_unavailable' } });
    expect(await readPendingAction()).not.toBeNull();
    expect(await draftStore.read('game')).not.toBeNull();
  });

  it('an overlap is a permanent answer — terminal', async () => {
    await draftStore.write('game', 'd1', { startsAt: future });
    park('create_game', undefined, 'd1');
    createGameFromValues.mockRejectedValue(err('GAME_OVERLAP'));

    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'game_overlap' } });
  });

  it('an expired draft is terminal', async () => {
    park('create_game', undefined, 'd1');
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'draft_expired' } });
  });
});

// ─── save_availability ────────────────────────────────────────────────────

describe('resuming an availability save', () => {
  const draftValues = {
    availability: { preferredDays: [2, 5], preferredTimes: ['evening'] },
    coords: { lat: 32.0, lng: 34.8 },
  };

  it('writes through the screen’s own persistence, after auth', async () => {
    await draftStore.write('availability', 'd1', draftValues);
    park('save_availability', undefined, 'd1');
    persistAvailability.mockResolvedValue(undefined);

    const out = await resumePendingAction();
    expect(persistAvailability).toHaveBeenCalledWith(
      'u1',
      draftValues.availability,
      draftValues.coords,
    );
    expect(out).toMatchObject({ result: { outcome: 'created', terminal: true } });
    expect(await readPendingAction()).toBeNull();
    expect(await draftStore.read('availability')).toBeNull();
  });

  // The whole reason this was the last one connected: there is no
  // /users/{anonymousUid} to write onto, so a guest's availability is a local
  // draft and nothing reaches Firestore until they are somebody.
  it('never writes while the viewer is a guest', async () => {
    await draftStore.write('availability', 'd1', draftValues);
    park('save_availability', undefined, 'd1');
    currentUser = { id: 'anon1', isGuest: true };

    expect(await resumePendingAction()).toEqual({ status: 'held' });
    expect(persistAvailability).not.toHaveBeenCalled();
    expect(await draftStore.read('availability')).not.toBeNull();
  });

  it('a network failure keeps the draft for a retry', async () => {
    await draftStore.write('availability', 'd1', draftValues);
    park('save_availability', undefined, 'd1');
    persistAvailability.mockRejectedValue(err('unavailable'));

    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: false } });
    expect(await draftStore.read('availability')).not.toBeNull();
  });

  it('and the retry then succeeds and cleans up', async () => {
    await draftStore.write('availability', 'd1', draftValues);
    park('save_availability', undefined, 'd1');
    persistAvailability.mockRejectedValueOnce(err('unavailable'));
    persistAvailability.mockResolvedValue(undefined);

    await resumePendingAction();
    await resumePendingAction();
    expect(persistAvailability).toHaveBeenCalledTimes(2);
    expect(await readPendingAction()).toBeNull();
    expect(await draftStore.read('availability')).toBeNull();
  });

  it('a permission denial is terminal — not retried forever', async () => {
    await draftStore.write('availability', 'd1', draftValues);
    park('save_availability', undefined, 'd1');
    persistAvailability.mockRejectedValue(err('permission-denied'));

    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true } });
  });

  it('an expired draft is terminal', async () => {
    park('save_availability', undefined, 'd1');
    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'draft_expired' } });
    expect(persistAvailability).not.toHaveBeenCalled();
  });
});

// ─── a guest can never resume ─────────────────────────────────────────────

describe('a viewer with no identity', () => {
  it('cannot resume anything', async () => {
    park('join_game', 'g1');
    currentUser = { id: 'anon1', isGuest: true };

    expect(await resumePendingAction()).toEqual({ status: 'held' });
    expect(requestJoinGame).not.toHaveBeenCalled();
    expect(await readPendingAction()).not.toBeNull();
  });
});

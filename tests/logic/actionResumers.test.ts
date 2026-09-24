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
let myGroups: Array<{ id: string }> = [];
jest.mock('@/store/userStore', () => ({
  useUserStore: { getState: () => ({ currentUser }) },
}));
jest.mock('@/store/groupStore', () => ({
  useGroupStore: { getState: () => ({ groups: myGroups }) },
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import '@/services/actionResumers';
import { setCreateClubHandler } from '@/services/actionResumers';
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
  setCreateClubHandler(null);
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
  it('runs the screen’s own creation path with the drafted values', async () => {
    await draftStore.write('club', 'd1', { name: 'שכונת שושי', city: 'חולון' });
    park('create_club', undefined, 'd1');

    const handler = jest.fn(async () => {});
    setCreateClubHandler(handler);

    const out = await resumePendingAction();
    expect(handler).toHaveBeenCalledWith({ name: 'שכונת שושי', city: 'חולון' });
    expect(out).toMatchObject({ result: { outcome: 'created', terminal: true } });
    expect(await readPendingAction()).toBeNull();
    expect(await draftStore.read('club')).toBeNull();
  });

  // The screen has not mounted yet. HELD, not failed — the values are on disk
  // and the next visit finds them. Clearing here would be silent data loss.
  it('holds when no screen has offered a creation path', async () => {
    await draftStore.write('club', 'd1', { name: 'x' });
    park('create_club', undefined, 'd1');

    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: false } });
    expect(await readPendingAction()).not.toBeNull();
    expect(await draftStore.read('club')).not.toBeNull();
  });

  it('a creation failure keeps the draft', async () => {
    await draftStore.write('club', 'd1', { name: 'x' });
    park('create_club', undefined, 'd1');
    setCreateClubHandler(async () => {
      throw err('unavailable');
    });

    await resumePendingAction();
    expect(await draftStore.read('club')).not.toBeNull();
    expect(await readPendingAction()).not.toBeNull();
  });

  // An expired draft has nothing left to create, so holding the action would
  // keep offering a club nobody typed.
  it('an expired draft is terminal', async () => {
    park('create_club', undefined, 'd1');
    setCreateClubHandler(jest.fn(async () => {}));

    const out = await resumePendingAction();
    expect(out).toMatchObject({ result: { terminal: true, reason: 'draft_expired' } });
    expect(await readPendingAction()).toBeNull();
  });
});

// ─── create_game is deliberately unclaimed ────────────────────────────────

describe('a game creation', () => {
  // No resumer is registered this round — the screen provisions a group on
  // mount, and auto-completing against a group made under an abandoned
  // anonymous uid would be worse than asking the person to press save again
  // with their form already filled. See the note in actionResumers.ts.
  it('is HELD with its draft intact, not auto-created', async () => {
    await draftStore.write('game', 'd1', { title: 'ערב שלישי' });
    park('create_game', undefined, 'd1');

    const out = await resumePendingAction();
    expect(out).toEqual({ status: 'held' });
    expect(await readPendingAction()).not.toBeNull();
    expect(await draftStore.read('game')).not.toBeNull();
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

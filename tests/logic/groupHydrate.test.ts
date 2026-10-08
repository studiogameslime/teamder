/**
 * Refreshing the user's clubs must never DESTROY them.
 *
 * `hydrate` wraps each fetch in its own catch so one failure can't leave the
 * splash gate stuck — but the fallback it returned was an empty array, and an
 * empty array is not a neutral value here. It means "you are in no clubs": the
 * store is emptied, and the selected-club logic then finds the selection
 * missing and erases it from disk as well. A blip on a query — the very thing
 * the catch exists to survive — cost the user their clubs screen and their
 * club selection.
 *
 * It also produced a production report. `communityJoinNotReflected` fired for
 * a user who had, in fact, joined: the membership was on the server (club
 * "שישי כדורגל", 17 members, the user among them) and the refresh that ran
 * right after the join was what came back empty.
 */
// The store logs to the console behind `__DEV__`; jest has no RN globals.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const listForUser = jest.fn();
const listPendingForUser = jest.fn();
const getCurrentGroupId = jest.fn();
const setCurrentGroupId = jest.fn();
const requestJoinById = jest.fn();

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/services', () => ({
  groupService: {
    listForUser: (...a: unknown[]) => listForUser(...a),
    listPendingForUser: (...a: unknown[]) => listPendingForUser(...a),
    requestJoinById: (...a: unknown[]) => requestJoinById(...a),
  },
}));
jest.mock('@/services/storage', () => ({
  storage: {
    getCurrentGroupId: (...a: unknown[]) => getCurrentGroupId(...a),
    setCurrentGroupId: (...a: unknown[]) => setCurrentGroupId(...a),
  },
}));
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: jest.fn(),
}));
jest.mock('@/services/achievementsService', () => ({
  achievementsService: { bump: jest.fn() },
}));
jest.mock('@/store/userStore', () => ({
  useUserStore: { getState: () => ({ currentUser: null }) },
}));
// groupStore reaches organiserSignals → joryio, which is untransformed ESM in
// node_modules. Without this the whole suite fails to RUN — which it had been
// doing since 17.09, silently, taking with it the repo's only test of "a failed
// refresh must not destroy what we already had".
jest.mock('@/services/organiserSignals', () => ({
  reportOrganiserState: jest.fn(),
}));
const logError = jest.fn();
jest.mock('@/services/errorLog', () => ({ logError: (...a: unknown[]) => logError(...a) }));

import { useGroupStore } from '@/store/groupStore';

const club = (id: string) => ({
  id,
  name: id,
  adminIds: [],
  playerIds: ['u1'],
  pendingPlayerIds: [],
}) as never;

beforeEach(() => {
  jest.clearAllMocks();
  useGroupStore.getState().reset();
  getCurrentGroupId.mockResolvedValue(null);
  setCurrentGroupId.mockResolvedValue(undefined);
  listPendingForUser.mockResolvedValue([]);
  useGroupStore.setState({
    hydrated: false,
    groups: [],
    pendingGroups: [],
    currentGroupId: null,
  });
});

describe('late responses after an account switch', () => {
  it.each(['success', 'failure', 'stale'])('ignores an old %s response', async (outcome) => {
    let resolve!: (value: never[]) => void;
    let reject!: (reason: Error) => void;
    const old = new Promise<never[]>((r, j) => { resolve = r; reject = j; });
    listForUser.mockImplementation((uid: string) => uid === 'A' ? old : Promise.resolve([club('new')]));
    const pending = useGroupStore.getState().hydrate('A');
    useGroupStore.getState().reset();
    await useGroupStore.getState().hydrate('B');
    setCurrentGroupId.mockClear();
    if (outcome === 'success') resolve([club('old')]);
    else reject(Object.assign(new Error('late'), { name: outcome === 'stale' ? 'StaleSessionError' : 'Error' }));
    await pending;
    expect(useGroupStore.getState().groups.map((g) => g.id)).toEqual(['new']);
    expect(useGroupStore.getState().currentGroupId).toBe('new');
    expect(setCurrentGroupId).not.toHaveBeenCalled();
  });
});

describe('a failed refresh keeps what we already had', () => {
  it('does not empty the clubs list', async () => {
    useGroupStore.setState({ groups: [club('a'), club('b')] });
    listForUser.mockRejectedValue(new Error('unavailable'));

    await useGroupStore.getState().hydrate('u1');

    expect(useGroupStore.getState().groups.map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('does not empty the pending list either', async () => {
    useGroupStore.setState({ pendingGroups: [club('p')] });
    listForUser.mockResolvedValue([]);
    listPendingForUser.mockRejectedValue(new Error('unavailable'));

    await useGroupStore.getState().hydrate('u1');

    expect(useGroupStore.getState().pendingGroups.map((g) => g.id)).toEqual(['p']);
  });

  it('keeps the selected club, and does not erase it from disk', async () => {
    useGroupStore.setState({ groups: [club('a')], currentGroupId: 'a' });
    getCurrentGroupId.mockResolvedValue('a');
    listForUser.mockRejectedValue(new Error('unavailable'));

    await useGroupStore.getState().hydrate('u1');

    expect(useGroupStore.getState().currentGroupId).toBe('a');
    expect(setCurrentGroupId).not.toHaveBeenCalledWith(null);
  });

  it('still flips `hydrated`, so the splash gate can never stick', async () => {
    listForUser.mockRejectedValue(new Error('unavailable'));

    await useGroupStore.getState().hydrate('u1');

    expect(useGroupStore.getState().hydrated).toBe(true);
  });
});

describe('a SUCCESSFUL refresh is still authoritative', () => {
  it('a club the user left really does disappear', async () => {
    useGroupStore.setState({ groups: [club('a'), club('b')], currentGroupId: 'b' });
    getCurrentGroupId.mockResolvedValue('b');
    listForUser.mockResolvedValue([club('a')]);

    await useGroupStore.getState().hydrate('u1');

    expect(useGroupStore.getState().groups.map((g) => g.id)).toEqual(['a']);
    // Selection pointed at the club that is gone — it must move, not linger.
    expect(useGroupStore.getState().currentGroupId).toBe('a');
  });

  it('an empty result from a working query really does mean no clubs', async () => {
    useGroupStore.setState({ groups: [club('a')] });
    listForUser.mockResolvedValue([]);

    await useGroupStore.getState().hydrate('u1');

    expect(useGroupStore.getState().groups).toEqual([]);
  });
});

describe('joining an open club retries the refresh before giving up', () => {
  it('a blip on the first refresh does not leave the club missing', async () => {
    requestJoinById.mockResolvedValue({ group: club('new'), status: 'joined' });
    listForUser
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue([club('new')]);

    const status = await useGroupStore.getState().requestJoinById('new', 'u1');

    expect(status).toBe('joined');
    expect(listForUser).toHaveBeenCalledTimes(2);
    // What the screen's silent-failure guard reads right after this await.
    expect(useGroupStore.getState().groups.some((g) => g.id === 'new')).toBe(true);
  });

  it('one refresh is enough when it works, and there is no second query', async () => {
    requestJoinById.mockResolvedValue({ group: club('new'), status: 'joined' });
    listForUser.mockResolvedValue([club('new')]);

    await useGroupStore.getState().requestJoinById('new', 'u1');

    expect(listForUser).toHaveBeenCalledTimes(1);
  });

  it('a club that stays missing is reported, not retried forever', async () => {
    requestJoinById.mockResolvedValue({ group: club('new'), status: 'joined' });
    listForUser.mockResolvedValue([]);

    await useGroupStore.getState().requestJoinById('new', 'u1');

    expect(listForUser).toHaveBeenCalledTimes(2);
    expect(useGroupStore.getState().groups.some((g) => g.id === 'new')).toBe(false);
  });

  it('a PENDING request does not trigger a refresh at all', async () => {
    requestJoinById.mockResolvedValue({ group: club('new'), status: 'pending' });

    const status = await useGroupStore.getState().requestJoinById('new', 'u1');

    expect(status).toBe('pending');
    expect(listForUser).not.toHaveBeenCalled();
    expect(useGroupStore.getState().pendingGroups.map((g) => g.id)).toEqual(['new']);
  });
});

/**
 * The same defence, against the failure that actually bypassed it.
 *
 * `isCurrentSession` was added on 28.09 to skip a group query whose uid no
 * longer matches the session — but it RETURNED AN EMPTY LIST, which `hydrate`
 * could only read as a successful "you are in no clubs". So the guard against
 * destroying the user's clubs was defeated by the guard against querying for
 * them, and the result reached production twice in one day: a member of five
 * clubs shown the new-user activation checklist after signing back in, and a
 * `resumeJoinClub · permission-denied` raised by someone already inside the
 * club the resume tried to join.
 *
 * It throws now, which lands on the path above — keep what we had — and the
 * throw is not a bug, so it must not be logged either.
 */
describe('a refresh overtaken by a session change', () => {
  class StaleSessionError extends Error {
    constructor() {
      super('stale');
      this.name = 'StaleSessionError';
    }
  }

  it('keeps the clubs and the selection instead of emptying them', async () => {
    useGroupStore.setState({
      groups: [club('a'), club('b')],
      currentGroupId: 'b',
    });
    getCurrentGroupId.mockResolvedValue('b');
    listForUser.mockRejectedValue(new StaleSessionError());

    await useGroupStore.getState().hydrate('guest-uid');

    expect(useGroupStore.getState().groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(useGroupStore.getState().currentGroupId).toBe('b');
    // And the selection is NOT erased from disk — the step that made the
    // damage outlast the session.
    expect(setCurrentGroupId).not.toHaveBeenCalledWith(null);
  });

  it('still releases the splash gate', async () => {
    listForUser.mockRejectedValue(new StaleSessionError());

    await useGroupStore.getState().hydrate('guest-uid');

    expect(useGroupStore.getState().hydrated).toBe(true);
  });

  it('is not written to the error inbox', async () => {
    listForUser.mockRejectedValue(new StaleSessionError());

    await useGroupStore.getState().hydrate('guest-uid');

    expect(logError).not.toHaveBeenCalled();
  });

  it('but an ORDINARY failure still is', async () => {
    listForUser.mockRejectedValue(new Error('unavailable'));

    await useGroupStore.getState().hydrate('u1');

    expect(logError).toHaveBeenCalledWith(
      'groupHydrateListForUser',
      expect.any(Error),
      { userId: 'u1' },
    );
  });
});

/**
 * What the invite landing is allowed to say, and what it must survive.
 *
 * Two properties this file exists for:
 *
 *   • "Eliran is in" has to be TRUE when the screen says it. The only
 *     evidence that counts is `players`; a waitlist place and an unapproved
 *     request are not "in", and a landing that claims otherwise sends
 *     somebody to a match their friend is not playing.
 *
 *   • Nothing here may take the hero down. An inviter with no mirror, a
 *     deleted account, a failed query — all of them are ordinary states with
 *     copy of their own, never a thrown error.
 */

const hydratePublicUsers = jest.fn();
const getPublic = jest.fn();
const getOpenGames = jest.fn();
const logError = jest.fn();

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/services/groupService', () => ({
  groupService: {
    hydratePublicUsers: (...a: unknown[]) => hydratePublicUsers(...a),
    getPublic: (...a: unknown[]) => getPublic(...a),
  },
}));
jest.mock('@/services/gameService', () => ({
  gameService: { getOpenGames: (...a: unknown[]) => getOpenGames(...a) },
}));
jest.mock('@/services/errorLog', () => ({ logError: (...a: unknown[]) => logError(...a) }));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import {
  resolveInviter,
  resolveInviteActivity,
  MAX_GAMES,
  MAX_CLUBS,
} from '@/services/personalInvite';

const ELIRAN = 'u-eliran';

/** Only the fields the resolver reads. */
const game = (over: Record<string, unknown> = {}) =>
  ({
    id: 'g1',
    groupId: 'c1',
    players: [ELIRAN],
    waitlist: [],
    pending: [],
    ...over,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  getOpenGames.mockResolvedValue([]);
  getPublic.mockResolvedValue({ id: 'c1', name: 'שכונה', memberCount: 12 });
});

// ─── who invited you ──────────────────────────────────────────────────────

describe('resolving the inviter', () => {
  it('reads the public mirror, never /users', async () => {
    hydratePublicUsers.mockResolvedValue([{ id: ELIRAN, name: 'אלירן', avatarId: 'a3' }]);
    const { inviter } = await resolveInviter(ELIRAN);

    expect(hydratePublicUsers).toHaveBeenCalledWith([ELIRAN]);
    expect(inviter).toMatchObject({ id: ELIRAN, name: 'אלירן' });
  });

  it('a link with no inviter is not an error', async () => {
    const { inviter, reason } = await resolveInviter(undefined);
    expect(inviter).toBeNull();
    expect(reason).toBe('no_inviter');
    expect(hydratePublicUsers).not.toHaveBeenCalled();
  });

  // Predates the backfill, or the account is gone. Ordinary, not broken.
  it('a missing mirror falls back rather than throwing', async () => {
    hydratePublicUsers.mockResolvedValue([]);
    const { inviter, reason } = await resolveInviter(ELIRAN);
    expect(inviter).toBeNull();
    expect(reason).toBe('no_mirror');
  });

  // The audit found ten blank-name stubs in the mirror, five of them test
  // fixtures. "הגעת דרך " with nothing after it is worse than the generic copy.
  it('a blank-name stub is treated as unresolved', async () => {
    hydratePublicUsers.mockResolvedValue([{ id: ELIRAN, name: '   ' }]);
    const { inviter, reason } = await resolveInviter(ELIRAN);
    expect(inviter).toBeNull();
    expect(reason).toBe('no_mirror');
  });

  it('a failed read is reported and swallowed', async () => {
    hydratePublicUsers.mockRejectedValue(new Error('offline'));
    const { inviter, reason } = await resolveInviter(ELIRAN);
    expect(inviter).toBeNull();
    expect(reason).toBe('read_failed');
    expect(logError).toHaveBeenCalled();
  });
});

// ─── what they play ───────────────────────────────────────────────────────

describe('the inviter\'s matches', () => {
  it('uses the public discovery query and keeps only theirs', async () => {
    getOpenGames.mockResolvedValue([
      game({ id: 'mine', players: [ELIRAN] }),
      game({ id: 'someone-else', players: ['u-other'] }),
    ]);
    const { games } = await resolveInviteActivity(ELIRAN, 'viewer');

    expect(getOpenGames).toHaveBeenCalledWith('viewer', []);
    expect(games.map((g) => g.id)).toEqual(['mine']);
  });

  // The claim on screen is "אלירן בפנים". Sixth in a queue is not in.
  it('does not count a waitlist place as playing', async () => {
    getOpenGames.mockResolvedValue([
      game({ id: 'queued', players: [], waitlist: [ELIRAN] }),
    ]);
    const { games } = await resolveInviteActivity(ELIRAN, 'viewer');
    expect(games).toEqual([]);
  });

  it('does not count an unapproved request as playing', async () => {
    getOpenGames.mockResolvedValue([
      game({ id: 'asked', players: [], pending: [ELIRAN] }),
    ]);
    const { games } = await resolveInviteActivity(ELIRAN, 'viewer');
    expect(games).toEqual([]);
  });

  it('caps what a landing shows', async () => {
    getOpenGames.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => game({ id: `g${i}`, groupId: `c${i}` })),
    );
    const { games } = await resolveInviteActivity(ELIRAN, 'viewer');
    expect(games).toHaveLength(MAX_GAMES);
  });

  it('a failed query remains retryable rather than a false empty result', async () => {
    getOpenGames.mockRejectedValue(new Error('denied'));
    await expect(resolveInviteActivity(ELIRAN, 'viewer')).rejects.toThrow('denied');
    expect(logError).toHaveBeenCalled();
  });

  it('asks for nothing at all without an inviter', async () => {
    const out = await resolveInviteActivity(undefined, 'viewer');
    expect(out).toEqual({ games: [], clubs: [] });
    expect(getOpenGames).not.toHaveBeenCalled();
  });
});

// ─── which clubs ──────────────────────────────────────────────────────────

describe('the clubs behind those matches', () => {
  // Deliberately narrower than "the clubs Eliran is in": there is no public
  // membership index, and a club somebody joined privately is not ours to
  // announce because a friend sent a link.
  it('comes from the public mirror of the matches\' groups', async () => {
    getOpenGames.mockResolvedValue([game({ groupId: 'c1' }), game({ id: 'g2', groupId: 'c2' })]);
    getPublic.mockImplementation(async (id: string) => ({
      id,
      name: id,
      memberCount: 5,
    }));
    const { clubs } = await resolveInviteActivity(ELIRAN, 'viewer');
    expect(clubs.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('deduplicates two matches in the same club', async () => {
    getOpenGames.mockResolvedValue([game({ groupId: 'c1' }), game({ id: 'g2', groupId: 'c1' })]);
    await resolveInviteActivity(ELIRAN, 'viewer');
    expect(getPublic).toHaveBeenCalledTimes(1);
  });

  it('never issues more gets than the cap', async () => {
    getOpenGames.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => game({ id: `g${i}`, groupId: `c${i}` })),
    );
    await resolveInviteActivity(ELIRAN, 'viewer');
    expect(getPublic.mock.calls.length).toBeLessThanOrEqual(MAX_CLUBS);
  });

  // Separate sections on the screen; no reason for one to take the other down.
  it('a club that will not load leaves the matches standing', async () => {
    getOpenGames.mockResolvedValue([game({ groupId: 'c1' })]);
    getPublic.mockRejectedValue(new Error('denied'));
    const { games, clubs } = await resolveInviteActivity(ELIRAN, 'viewer');
    expect(games).toHaveLength(1);
    expect(clubs).toEqual([]);
  });
});

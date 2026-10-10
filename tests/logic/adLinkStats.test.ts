import { calculateLinkStats, accountPercentage } from '../../pulse/src/services/adLinkStats';
import { fetchAcquisitionReport, fetchLinkStats } from '../../pulse/src/services/adLinks';
import { fetchUsers, fetchUsersWithAuth } from '../../pulse/src/services/firebase';
import { listAll } from '../../pulse/src/services/firestoreRest';
import type { AppUser } from '../../pulse/src/types';

jest.mock('../../pulse/src/services/firebase', () => ({ fetchUsers: jest.fn(), fetchUsersWithAuth: jest.fn() }));
jest.mock('../../pulse/src/services/firestoreRest', () => ({ listAll: jest.fn() }));
jest.mock('../../pulse/src/services/cache', () => ({ cached: (_key: string, read: () => unknown) => read(), invalidate: jest.fn() }));

const user = (id: string, patch: Partial<AppUser> = {}): AppUser => ({
  id, name: id, joinedAt: Date.UTC(2026, 5, 5), totalGames: 0, attended: 0,
  cancelled: 0, achievements: 0, yellowCards: 0, redCards: 0, friends: 0,
  gamesJoined: 0, communitiesCreated: 0, invitesSent: 0, hasPush: false,
  isTest: false, deleted: false, ...patch,
});

beforeEach(() => jest.clearAllMocks());

describe('exact per-link account attribution', () => {
  it('regresses the real four-click / eight-legacy-account incident', async () => {
    const legacy = Array.from({ length: 8 }, (_, i) => user(`legacy-${i}`, {
      acquisition: { source: 'facebook', campaign: '2' }, onboardingCompleted: true,
    }));
    jest.mocked(fetchUsersWithAuth).mockResolvedValue(legacy);
    jest.mocked(fetchUsers).mockResolvedValue(legacy);
    jest.mocked(listAll).mockResolvedValue([]);
    const stats = await fetchLinkStats({ id: 'U5tUXbaG', source: 'facebook', clicks: 4, createdAt: Date.UTC(2026, 9, 8) });
    expect(stats).toEqual({ clicks: 4, attributedAccounts: 0, signups: 0, google: 0, apple: 0, joined: 0, created: 0 });
    const report = await fetchAcquisitionReport();
    expect(report.rows).toEqual([{ source: 'facebook', accounts: 8, signups: 8, joined: 0 }]);
  });

  it('never mixes same-source, same-campaign, missing-id or other-link accounts', () => {
    const users = [
      user('exact', { acquisition: { linkId: 'link-A', source: 'other' }, onboardingCompleted: true, attended: 2, provider: 'apple' }),
      user('legacy', { acquisition: { source: 'facebook', campaign: 'one' }, onboardingCompleted: true }),
      user('other', { acquisition: { linkId: 'link-B', source: 'facebook', campaign: 'one' }, onboardingCompleted: true }),
      user('empty', { acquisition: { linkId: '', source: 'facebook' } }),
      user('test', { acquisition: { linkId: 'link-A' }, isTest: true }),
      user('deleted', { acquisition: { linkId: 'link-A' }, deleted: true }),
    ];
    expect(calculateLinkStats({ id: 'link-A', clicks: 0 }, users, new Set(['exact', 'legacy']))).toEqual({
      clicks: 0, attributedAccounts: 1, signups: 1, apple: 1, google: 0, joined: 1, created: 1,
    });
    expect(calculateLinkStats({ id: '' }, users, new Set()).attributedAccounts).toBe(0);
  });

  it('counts current cohort states independently, including incomplete signup', () => {
    const users = [
      user('google', { acquisition: { linkId: 'A' }, onboardingCompleted: true, provider: 'google', attended: 3 }),
      user('apple', { acquisition: { linkId: 'A' }, provider: 'apple' }),
      user('password', { acquisition: { linkId: 'A' }, onboardingCompleted: true, provider: 'password' }),
    ];
    expect(calculateLinkStats({ id: 'A', clicks: 1 }, users, new Set(['apple']))).toEqual({
      clicks: 1, attributedAccounts: 3, signups: 2, google: 1, apple: 1, joined: 1, created: 1,
    });
  });

  it('does not turn unavailable account or game reads into success with zero', async () => {
    jest.mocked(fetchUsersWithAuth).mockRejectedValueOnce(new Error('users unavailable'));
    jest.mocked(listAll).mockResolvedValue([]);
    await expect(fetchLinkStats({ id: 'A' })).rejects.toThrow('users unavailable');
    jest.mocked(fetchUsersWithAuth).mockResolvedValue([]);
    jest.mocked(listAll).mockRejectedValueOnce(new Error('games unavailable'));
    await expect(fetchLinkStats({ id: 'A' })).rejects.toThrow('games unavailable');
  });

  it('keeps no-denominator unknown and never clamps suspicious ratios', () => {
    expect(accountPercentage(0, 0)).toBeNull();
    expect(accountPercentage(2, 0)).toBeNull();
    expect(accountPercentage(0, 4)).toBe('0%');
    expect(accountPercentage(3, 2)).toBe('150%');
  });
});

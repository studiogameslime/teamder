import type { Game } from '@/types';
import { getInboxCount, getInboxRequests } from '@/services/requestsService';
import { actionableFillerIds, pendingFillerIds } from '@/services/fillerReview';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { requestInboxRows } from '@/utils/requestInboxView';

jest.mock('@/services/gameService', () => ({ gameService: { getMyLiveOrUpcomingGames: jest.fn(), getUpcomingGamesForGroup: jest.fn() } }));
jest.mock('@/services/groupService', () => ({ groupService: { listForUser: jest.fn() } }));
jest.mock('@/services/friendsService', () => ({ friendsService: { listIncomingRequests: async () => [] } }));
jest.mock('@/services/userService', () => ({ userService: { getUserById: async (id: string) => ({ id, name: id }) } }));
jest.mock('@/services/diagnosticCallable', () => ({}));
jest.mock('@/services/fillerReview', () => ({ ...jest.requireActual('@/services/fillerReview'), pendingFillerIds: jest.fn() }));

const open = (id: string, createdBy: string, groupId: string) => ({
  id, createdBy, groupId, startsAt: Date.now() + 60000, status: 'open', acceptsFillers: true,
  players: ['registered'], waitlist: ['waiting'], pending: ['ordinary'],
}) as Game;

test('the home badge and scoped inbox agree for creator, club admin and overlapping roles', async () => {
  const both = open('both', 'me', 'managed'), club = open('club', 'other', 'managed'), creator = open('creator', 'me', 'other-club');
  const unrelated = open('unrelated', 'other', 'other-club');
  jest.mocked(groupService.listForUser).mockResolvedValue([{ id: 'managed', adminIds: ['me'] }, { id: 'other-club', adminIds: [] }] as any);
  jest.mocked(gameService.getMyLiveOrUpcomingGames).mockResolvedValue([both, creator, unrelated]);
  jest.mocked(gameService.getUpcomingGamesForGroup).mockResolvedValue([both, club, { ...club, id: 'ended', startsAt: Date.now() - 1 }, { ...club, id: 'off', acceptsFillers: false }]);
  jest.mocked(pendingFillerIds).mockResolvedValue(['registered', 'waiting', 'ordinary', 'guest', 'guest']);
  expect(await getInboxCount('me')).toBe(5);
  const data = await getInboxRequests('me');
  expect(data.total).toBe(5);
  expect(requestInboxRows(data, 'managed').map(r => r.key)).toEqual(['game:both:ordinary', 'filler:both:guest', 'filler:club:guest']);
  expect(requestInboxRows(data, 'other-club').map(r => r.key)).toEqual(['game:creator:ordinary', 'filler:creator:guest']);
  expect(jest.mocked(pendingFillerIds).mock.calls).toEqual([
    ['both', true], ['creator', false], ['club', true], ['both', true], ['creator', false], ['club', true],
  ]);
  club.players.push('guest');
  expect(await getInboxCount('me')).toBe(4);
  expect(requestInboxRows(await getInboxRequests('me')).some(r => r.key === 'filler:club:guest')).toBe(false);
  jest.mocked(pendingFillerIds).mockImplementation(async id => { if (id === 'both') throw new Error('offline'); return ['guest']; });
  await expect(getInboxCount('me')).rejects.toThrow('offline');
  const partial = await getInboxRequests('me');
  expect(partial.partial).toBe(true);
  expect(requestInboxRows(partial).map(r => r.key)).toContain('filler:creator:guest');
});

test('joining the club alone does not resolve the round application; registering does', () => {
  const game = open('round', 'organizer', 'club');
  expect(actionableFillerIds(game, ['guest'])).toEqual(['guest']);
  expect(actionableFillerIds({ ...game, waitlist: ['guest'] }, ['guest'])).toEqual([]);
});

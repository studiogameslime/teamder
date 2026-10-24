import { ownPlayerRounds, publicCardStats, recordedRoundStats } from '@/utils/ownPlayerCard';
import type { Game, User } from '@/types';

const now = Date.now();
const game = (id: string, patch: Partial<Game> = {}) => ({ id, status: 'finished', startsAt: now - 1000, players: ['me'], participantIds: ['me'], arrivals: {}, ...patch }) as Game;

test('last played skips recent no-show, cancelled, waitlist and unverified evenings across clubs', () => {
  const rows = [
    game('old', { startsAt: now - 9000, groupId: 'a' }),
    game('last', { startsAt: now - 8000, groupId: 'b' }),
    game('no-show', { arrivals: { me: 'no_show' } }),
    game('waiting', { players: [], waitlist: ['me'] }),
    game('cancelled', { status: 'cancelled' }),
    game('unverified', { endedBy: 'auto' }),
    game('future', { startsAt: now + 1000 }),
  ];
  expect(ownPlayerRounds(rows, 'me', now)).toMatchObject({ attendedCount: 2, last: { id: 'last' }, next: null });
});

test('lifetime rounds have no 50-row cap and season closure cannot reset them', () => {
  const rows = Array.from({ length: 75 }, (_, i) => game(String(i), { startsAt: now - (i + 1) * 1000 }));
  expect(ownPlayerRounds(rows, 'me', now).attendedCount).toBe(75);
});

test('next registered round ignores creator-only, waitlist, pending and cancelled rounds', () => {
  const rows = [game('organised', { status: 'open', startsAt: now + 1, createdBy: 'me', players: ['other'] }),
    game('waiting', { status: 'open', startsAt: now + 2, players: [], waitlist: ['me'] }),
    game('pending', { status: 'open', startsAt: now + 3, players: [], pending: ['me'] }),
    game('cancelled', { status: 'cancelled', startsAt: now + 4 }),
    game('next', { status: 'locked', startsAt: now + 5 }), game('later', { status: 'scheduled', startsAt: now + 6 })];
  expect(ownPlayerRounds(rows, 'me', now).next?.id).toBe('next');
});

test('live round takes priority, including legacy live status, while stale live rounds are ignored', () => {
  const live = game('live', { status: 'open', liveMatch: { phase: 'live' } as Game['liveMatch'] });
  expect(ownPlayerRounds([game('next', { status: 'open', startsAt: now + 1 }), live], 'me', now).next?.id).toBe('live');
  expect(ownPlayerRounds([game('stale', { status: 'active', startsAt: now - 24 * 3600000 })], 'me', now).next).toBeNull();
});

test.each([undefined, 'friends', 'onlyMe'])('shared public image never includes statistics with %s visibility', statistics => {
  const user = { stats: { goals: 20, assists: 10 }, ...(statistics ? { socialPrivacy: { statistics } } : {}) } as User;
  expect(publicCardStats(user, 75)).toBeNull();
});

test('publicly visible lifetime counters use user totals, with zero as a real value', () => {
  expect(publicCardStats({ socialPrivacy: { statistics: 'everyone' }, stats: { goals: 0, assists: 4 } } as User, 75))
    .toEqual({ rounds: 75, goals: 0, assists: 4 });
});

test('missing last-round row differs from sparse recorded counters and personal games differ from evenings', () => {
  expect(recordedRoundStats()).toEqual({ goals: null, assists: null, games: null });
  expect(recordedRoundStats({ rounds: 4 })).toEqual({ goals: 0, assists: 0, games: 4 });
  expect(recordedRoundStats({ goals: -1, assists: null, rounds: '4' })).toEqual({ goals: null, assists: null, games: null });
});

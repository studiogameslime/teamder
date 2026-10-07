import { communityHistoryFacets } from '@/utils/communityHistory';
import type { Game, MatchRound } from '@/types';

const NOW = 10_000;
const game = (overrides: Partial<Game> = {}): Game => ({
  startsAt: 1_000, status: 'finished', players: ['me', 'other'],
  ...overrides,
} as Game);

describe('community history uses the same attendance definition as personal stats', () => {
  it('credits a finished evening without requiring drawn teams', () => {
    expect(communityHistoryFacets(game(), [], 'me', { goals: 2, assists: 1 }, NOW))
      .toMatchObject({ viewerPlayed: true, viewerGoals: 2, viewerAssists: 1 });
  });
  it.each([
    { players: ['other'], participantIds: ['me', 'other'], waitlist: ['me'] },
    { arrivals: { me: 'no_show' } },
    { status: 'cancelled' },
    { startsAt: NOW + 1 },
    { endedBy: 'auto', playVerified: false },
  ] as Partial<Game>[])('does not mistake registration or a non-played evening for participation: %j', (overrides) => {
    expect(communityHistoryFacets(game(overrides), [], 'me', { goals: 2 }, NOW))
      .toMatchObject({ viewerPlayed: false, viewerGoals: 0, viewerAssists: 0 });
  });
  it('does not turn missing, denied, or malformed scoring into a claimed zero', () => {
    expect(communityHistoryFacets(game(), [], 'me', undefined, NOW))
      .toMatchObject({ viewerPlayed: true, viewerGoals: null, viewerAssists: null });
    expect(communityHistoryFacets(game(), [], 'me', { goals: NaN, assists: -1 }, NOW))
      .toMatchObject({ viewerGoals: null, viewerAssists: null });
    expect(communityHistoryFacets(game(), [], 'me', { goals: 0, assists: 0 }, NOW))
      .toMatchObject({ viewerGoals: 0, viewerAssists: 0 });
    expect(communityHistoryFacets(game(), [], 'me', { rounds: 3 }, NOW))
      .toMatchObject({ viewerGoals: 0, viewerAssists: 0 });
  });
  it('includes active guests, excludes queued guests and no-shows, and deduplicates users', () => {
    const g = game({ players: ['me', 'me', 'other'], arrivals: { other: 'no_show' },
      guests: [{ id: 'a', name: 'a', addedBy: 'me', createdAt: 1 },
        { id: 'b', name: 'b', addedBy: 'me', createdAt: 1, waitlisted: true }] });
    expect(communityHistoryFacets(g, [], 'me', undefined, NOW).playerCount).toBe(2);
  });
  it('counts committed games, not a still-running legacy round or a duplicated count source', () => {
    const rounds = [{ winner: 'tie' }, { endedAt: 3 }, { startedAt: 4 }] as MatchRound[];
    expect(communityHistoryFacets(game(), rounds, 'me', undefined, NOW).matchCount).toBe(2);
    expect(communityHistoryFacets(game({ committedRoundCount: 5, rotation: { round: 4 } as Game['rotation'] }),
      rounds, 'me', undefined, NOW).matchCount).toBe(5);
    expect(communityHistoryFacets(game({ rotation: { round: 7 } as Game['rotation'] }),
      [], 'me', undefined, NOW).matchCount).toBe(6);
  });
});

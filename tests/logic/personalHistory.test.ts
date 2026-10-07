import { isPersonalHistoryGame } from '@/utils/personalHistory';
import { communityHistoryFacets } from '@/utils/communityHistory';
import type { Game } from '@/types';

const game = (overrides: Partial<Game> = {}): Game => ({
  status: 'finished', startsAt: 100, players: ['me'], waitlist: [],
  participantIds: ['me'], ...overrides,
} as Game);

it('keeps registered no-shows and waiting-list members in all, without crediting attendance', () => {
  for (const g of [game({ arrivals: { me: 'no_show' } }),
    game({ players: ['other'], waitlist: ['me'] })]) {
    expect(isPersonalHistoryGame(g, 'me', 1000)).toBe(true);
    expect(communityHistoryFacets(g, [], 'me', undefined, 1000))
      .toMatchObject({ viewerPlayed: false, viewerGoals: 0, viewerAssists: 0 });
  }
});

it('does not include future, cancelled, ongoing or unrelated evenings', () => {
  for (const g of [game({ startsAt: 1000 }), game({ status: 'cancelled' }),
    game({ status: 'open' }), game({ participantIds: ['other'] })]) {
    expect(isPersonalHistoryGame(g, 'me', 1000)).toBe(false);
  }
  expect(isPersonalHistoryGame(game(), '', 1000)).toBe(false);
});

it('supports older mock records without participantIds across clubs', () => {
  expect(isPersonalHistoryGame(game({ participantIds: undefined, groupId: 'another',
    players: [], waitlist: ['me'] }), 'me', 1000)).toBe(true);
});

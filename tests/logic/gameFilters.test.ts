import {
  gameMatchesWhen,
  applyGameFilters,
  isFiltersEmpty,
  activeFiltersCount,
  EMPTY_GAME_FILTERS,
  type GameFilters,
} from '@/utils/gameFilters';

const HOUR = 60 * 60 * 1000;
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime(); // Mon Jun 15 2026 noon
const at = (d: number, h: number) => new Date(2026, 5, d, h, 0, 0).getTime();

describe('gameMatchesWhen', () => {
  it("'any' matches everything, even the past", () => {
    expect(gameMatchesWhen(NOW - 5 * HOUR, 'any', null, NOW)).toBe(true);
    expect(gameMatchesWhen(NOW + 5 * HOUR, 'any', null, NOW)).toBe(true);
  });
  it('past games never match a specific window', () => {
    expect(gameMatchesWhen(NOW - HOUR, 'today', null, NOW)).toBe(false);
    expect(gameMatchesWhen(NOW - HOUR, 'tomorrow', null, NOW)).toBe(false);
  });
  it("'today' = later today only", () => {
    expect(gameMatchesWhen(at(15, 18), 'today', null, NOW)).toBe(true);
    expect(gameMatchesWhen(at(15, 23), 'today', null, NOW)).toBe(true);
    expect(gameMatchesWhen(at(16, 9), 'today', null, NOW)).toBe(false);
  });
  it("'tomorrow' = the next calendar day", () => {
    expect(gameMatchesWhen(at(16, 9), 'tomorrow', null, NOW)).toBe(true);
    expect(gameMatchesWhen(at(16, 23), 'tomorrow', null, NOW)).toBe(true);
    expect(gameMatchesWhen(at(15, 18), 'tomorrow', null, NOW)).toBe(false);
    expect(gameMatchesWhen(at(17, 9), 'tomorrow', null, NOW)).toBe(false);
  });
  it("'day' = next occurrence of a weekday (Jun 15 is Monday=1)", () => {
    // Wednesday = 3 → Jun 17
    expect(gameMatchesWhen(at(17, 20), 'day', 3, NOW)).toBe(true);
    expect(gameMatchesWhen(at(18, 20), 'day', 3, NOW)).toBe(false);
    // Monday = 1 → today (Jun 15) counts as the next occurrence
    expect(gameMatchesWhen(at(15, 20), 'day', 1, NOW)).toBe(true);
  });
});

describe('applyGameFilters', () => {
  const base = {
    startsAt: at(15, 18),
    maxPlayers: 10,
    players: ['a'],
  };
  const games = [
    { ...base, id: 'g1', format: '5v5' as const, visibility: 'public' as const, players: ['a'] },
    { ...base, id: 'g2', format: '7v7' as const, visibility: 'community' as const, players: Array(10).fill('x') },
    { ...base, id: 'g3', format: '5v5' as const, visibility: 'community' as const, fieldLat: 32.08, fieldLng: 34.78, city: 'תל אביב' },
  ];

  it('empty filters pass everything', () => {
    expect(applyGameFilters(games, EMPTY_GAME_FILTERS).map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
  });
  it('format filter', () => {
    const f: GameFilters = { ...EMPTY_GAME_FILTERS, formats: ['5v5'] };
    expect(applyGameFilters(games, f).map((g) => g.id)).toEqual(['g1', 'g3']);
  });
  it('openToAll keeps only public', () => {
    const f: GameFilters = { ...EMPTY_GAME_FILTERS, openToAll: true };
    expect(applyGameFilters(games, f).map((g) => g.id)).toEqual(['g1']);
  });
  it('onlyAvailable drops full games', () => {
    const f: GameFilters = { ...EMPTY_GAME_FILTERS, onlyAvailable: true };
    expect(applyGameFilters(games, f).map((g) => g.id)).toEqual(['g1', 'g3']);
  });
  it('nearby by radius (within / outside)', () => {
    const f: GameFilters = { ...EMPTY_GAME_FILTERS, nearby: true, nearbyRadiusKm: 5 };
    const ctx = { nearbyLatLng: { lat: 32.09, lng: 34.79 } };
    expect(applyGameFilters(games, f, ctx).map((g) => g.id)).toEqual(['g3']);
    const far = { nearbyLatLng: { lat: 31.0, lng: 35.0 } };
    expect(applyGameFilters(games, f, far)).toEqual([]);
  });
  it('nearby by city fallback when no coords', () => {
    const f: GameFilters = { ...EMPTY_GAME_FILTERS, nearby: true };
    const ctx = { nearbyCityFallback: 'תל אביב' };
    expect(applyGameFilters(games, f, ctx).map((g) => g.id)).toEqual(['g3']);
  });
});

describe('filter summary helpers', () => {
  it('isFiltersEmpty', () => {
    expect(isFiltersEmpty(EMPTY_GAME_FILTERS)).toBe(true);
    expect(isFiltersEmpty({ ...EMPTY_GAME_FILTERS, openToAll: true })).toBe(false);
    expect(isFiltersEmpty({ ...EMPTY_GAME_FILTERS, formats: ['5v5'] })).toBe(false);
  });
  it('activeFiltersCount counts active groups', () => {
    expect(activeFiltersCount(EMPTY_GAME_FILTERS)).toBe(0);
    expect(
      activeFiltersCount({
        ...EMPTY_GAME_FILTERS,
        when: 'today',
        formats: ['5v5', '7v7'],
        openToAll: true,
        onlyAvailable: true,
        nearby: true,
      }),
    ).toBe(5);
  });
});

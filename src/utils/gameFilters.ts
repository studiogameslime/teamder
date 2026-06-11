// gameFilters — the pure filtering logic behind GameFilterSheet, lifted out
// of the component so it can be unit-tested without React Native. The sheet
// re-exports everything here, so existing imports from GameFilterSheet keep
// working unchanged.

import { GameFormat, WeekdayIndex } from '@/types';
import { haversineKm } from '@/utils/geo';

/** Date window. `day` = a specific upcoming weekday (see `weekday`). */
export type GameTimeWindow = 'any' | 'today' | 'tomorrow' | 'day';

export interface GameFilters {
  when: GameTimeWindow;
  weekday: WeekdayIndex | null;
  formats: GameFormat[];
  openToAll: boolean;
  onlyAvailable: boolean;
  nearby: boolean;
  nearbyRadiusKm: number;
}

/** Default "near me" radius — a metro-area cluster. */
export const DEFAULT_GAME_NEARBY_RADIUS_KM = 25;

export const EMPTY_GAME_FILTERS: GameFilters = {
  when: 'any',
  weekday: null,
  formats: [],
  openToAll: false,
  onlyAvailable: false,
  nearby: false,
  nearbyRadiusKm: DEFAULT_GAME_NEARBY_RADIUS_KM,
};

export function isFiltersEmpty(f: GameFilters): boolean {
  return (
    f.when === 'any' &&
    f.formats.length === 0 &&
    !f.openToAll &&
    !f.onlyAvailable &&
    !f.nearby
  );
}

export function activeFiltersCount(f: GameFilters): number {
  let n = 0;
  if (f.when !== 'any') n += 1;
  if (f.formats.length) n += 1;
  if (f.openToAll) n += 1;
  if (f.onlyAvailable) n += 1;
  if (f.nearby) n += 1;
  return n;
}

/** Start-of-day ms for the date `daysAhead` days from `now`. */
function dayStart(now: number, daysAhead: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ms range [start, end] of the next upcoming occurrence of `weekday`. */
function nextWeekdayRange(
  weekday: WeekdayIndex,
  now = Date.now(),
): { start: number; end: number } {
  const today = new Date(now).getDay();
  const ahead = (weekday - today + 7) % 7; // 0 = today, else next occurrence
  const start = dayStart(now, ahead);
  return { start, end: start + 24 * 60 * 60 * 1000 - 1 };
}

/** Apply the time window to a startsAt timestamp. */
export function gameMatchesWhen(
  startsAt: number,
  when: GameTimeWindow,
  weekday: WeekdayIndex | null,
  now = Date.now(),
): boolean {
  if (when === 'any') return true;
  if (startsAt < now) return false;
  if (when === 'today') {
    return startsAt <= dayStart(now, 1) - 1;
  }
  if (when === 'tomorrow') {
    return startsAt >= dayStart(now, 1) && startsAt <= dayStart(now, 2) - 1;
  }
  if (when === 'day' && weekday !== null) {
    const { start, end } = nextWeekdayRange(weekday, now);
    return startsAt >= start && startsAt <= end;
  }
  return true;
}

export interface GameApplyContext {
  nearbyLatLng?: { lat: number; lng: number };
  nearbyCityFallback?: string;
}

export function applyGameFilters<
  T extends {
    startsAt: number;
    format?: GameFormat;
    visibility?: 'public' | 'community';
    maxPlayers: number;
    players: string[];
    fieldLat?: number;
    fieldLng?: number;
    city?: string;
  },
>(games: T[], f: GameFilters, ctx: GameApplyContext = {}): T[] {
  return games.filter((g) => {
    if (!gameMatchesWhen(g.startsAt, f.when, f.weekday)) return false;
    if (f.formats.length > 0 && (!g.format || !f.formats.includes(g.format))) {
      return false;
    }
    if (f.openToAll && (g.visibility ?? 'community') !== 'public') {
      return false;
    }
    if (f.onlyAvailable && g.players.length >= g.maxPlayers) return false;
    if (f.nearby) {
      if (
        ctx.nearbyLatLng &&
        typeof g.fieldLat === 'number' &&
        typeof g.fieldLng === 'number'
      ) {
        const km = haversineKm(ctx.nearbyLatLng, {
          lat: g.fieldLat,
          lng: g.fieldLng,
        });
        return km <= f.nearbyRadiusKm;
      }
      if (ctx.nearbyCityFallback && g.city) {
        return (
          g.city.trim().toLowerCase() ===
          ctx.nearbyCityFallback.trim().toLowerCase()
        );
      }
      return false;
    }
    return true;
  });
}

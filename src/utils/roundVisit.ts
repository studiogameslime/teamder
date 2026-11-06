import type { Game } from '@/types';

export type RoundVisit = { startsAt: number | null; fieldName: string; fieldAddress: string; city: string; lat: number | null; lng: number | null };
const text = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function roundVisit(game: Pick<Game, 'startsAt' | 'fieldName' | 'fieldAddress' | 'city' | 'fieldLat' | 'fieldLng'>): RoundVisit {
  return {startsAt: number(game.startsAt), fieldName: text(game.fieldName), fieldAddress: text(game.fieldAddress), city: text(game.city), lat: number(game.fieldLat), lng: number(game.fieldLng)};
}
export function roundChanges(previous: RoundVisit | null, current: RoundVisit) {
  return {
    time: !!previous && previous.startsAt !== current.startsAt,
    location: !!previous && (previous.fieldName !== current.fieldName || previous.fieldAddress !== current.fieldAddress || previous.city !== current.city || previous.lat !== current.lat || previous.lng !== current.lng),
  };
}
export function parseRoundVisit(value: unknown): RoundVisit | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as RoundVisit;
  if (![v.fieldName, v.fieldAddress, v.city].every(x => typeof x === 'string') ||
      ![v.startsAt, v.lat, v.lng].every(x => x === null || typeof x === 'number' && Number.isFinite(x))) return null;
  return {startsAt: v.startsAt, fieldName: v.fieldName, fieldAddress: v.fieldAddress, city: v.city, lat: v.lat, lng: v.lng};
}

import type { GameGuest } from '@/types';

/** A committed guest may already be present through the live snapshot. */
export function upsertSavedGuest(guests: GameGuest[] | undefined, saved: GameGuest): GameGuest[] {
  const current = guests ?? [];
  return current.some((guest) => guest.id === saved.id)
    ? current.map((guest) => guest.id === saved.id ? saved : guest)
    : [...current, saved];
}

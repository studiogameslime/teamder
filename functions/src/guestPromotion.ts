/** Registered waitlist entries and outstanding offers take priority over guests. */
export function promoteWaitingGuests<T extends { waitlisted?: boolean; createdAt?: number }>(
  roster: {
    guests: T[];
    players: string[];
    waitlist: string[];
    pendingPromotion?: { uid?: string } | null;
    maxPlayers?: number;
    status?: unknown;
  },
  seatFreed: boolean,
): T[] | null {
  if (!seatFreed || ![undefined, 'open', 'scheduled', 'locked'].includes(roster.status as string | undefined)) return null;
  if (roster.waitlist.length || roster.pendingPromotion?.uid) return null;
  const capacity = roster.maxPlayers ?? 15;
  if (!Number.isFinite(capacity) || capacity < 0) return null;
  const activeCount = roster.guests.filter((guest) => !guest.waitlisted).length;
  const free = Math.max(0, Math.floor(capacity - roster.players.length - activeCount));
  if (!free) return null;
  // Stable order for legacy guests without a timestamp; never reorder the stored roster.
  const waiting = roster.guests
    .map((guest, index) => ({ guest, index }))
    .filter(({ guest }) => guest.waitlisted === true)
    .sort((a, b) => (a.guest.createdAt ?? 0) - (b.guest.createdAt ?? 0) || a.index - b.index)
    .slice(0, free);
  if (!waiting.length) return null;
  const promoted = new Set(waiting.map(({ index }) => index));
  return roster.guests.map((guest, index) => promoted.has(index) ? { ...guest, waitlisted: false } : guest);
}

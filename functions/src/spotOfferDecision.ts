/** A decision can only resolve the caller's existing reservation, never join
 *  a new player. Locked or rescheduled registration preserves existing waitlist rights. */
export function decideSpotOffer(
  game: {
    status?: string; players?: string[]; waitlist?: string[]; pending?: string[];
    guests?: { waitlisted?: boolean }[]; maxPlayers?: number;
    pendingPromotion?: { uid?: string } | null;
  },
  uid: string,
  decision: 'confirm' | 'pass',
  now: number,
): { changed: false } | { changed: true; patch: {
  players: string[]; waitlist: string[]; participantIds: string[];
  pendingPromotion: { uid: string; offeredAt: number } | null; updatedAt: number;
} } {
  const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
  const players = [...new Set(game.players ?? [])];
  const queued = [...new Set(game.waitlist ?? [])];
  if (decision === 'confirm' && players.includes(uid)) return { changed: false };
  if (game.pendingPromotion?.uid !== uid) {
    if (decision === 'pass') return { changed: false };
    fail('STALE_OFFER');
  }
  if (game.status !== 'open' && game.status !== 'locked' && game.status !== 'scheduled') fail('GAME_NOT_OPEN');
  if (!queued.includes(uid)) fail('STALE_OFFER');
  const guests = (game.guests ?? []).filter(guest => !guest.waitlisted).length;
  const capacity = typeof game.maxPlayers === 'number' ? game.maxPlayers : 15;
  if (decision === 'confirm' && players.length + guests >= capacity) fail('GROUP_FULL');
  if (decision === 'confirm') players.push(uid);
  const waitlist = queued.filter(player => player !== uid);
  const next = waitlist.find(player => !players.includes(player));
  return { changed: true, patch: {
    players, waitlist,
    participantIds: [...new Set([...players, ...waitlist, ...(game.pending ?? [])])],
    pendingPromotion: next && players.length + guests < capacity ? { uid: next, offeredAt: now } : null,
    updatedAt: now,
  } };
}

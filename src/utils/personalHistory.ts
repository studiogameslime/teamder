import type { Game } from '@/types';

/** Personal history includes past completed registrations, even no-shows and
 * waiting-list members. Attendance remains the canonical isAttendedGame gate. */
export function isPersonalHistoryGame(
  game: Pick<Game, 'status' | 'startsAt' | 'participantIds' | 'players' | 'waitlist' | 'pending'>,
  userId: string,
  now = Date.now(),
): boolean {
  return !!userId && game.status === 'finished' && game.startsAt < now
    && (game.participantIds ?? [
      ...(game.players ?? []), ...(game.waitlist ?? []), ...(game.pending ?? []),
    ]).includes(userId);
}

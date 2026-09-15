// Attendance follows the evening, not the status field.
//
// `isAttendedGame` is the canonical "did this player play this game" predicate
// — the Profile count, the Statistics screen, the History list and the
// achievements all run through it. It used to ask only whether the game was
// `finished`, while the SERVER credited attendance only for evenings that left
// evidence of play. A night the server refused to count therefore still
// appeared in a player's totals, and nothing reconciled the two.
//
// These pin the reconciliation: one question, asked once, in one module.
import { isAttendedGame } from '@/utils/playedGames';

const YESTERDAY = Date.now() - 24 * 60 * 60 * 1000;
const base = {
  startsAt: YESTERDAY,
  players: ['u1', 'u2'],
  arrivals: {} as Record<string, string>,
};

describe('attendance and the evening gate', () => {
  it('counts an evening an admin closed, with no other trace', () => {
    expect(
      isAttendedGame({ ...base, status: 'finished', endedBy: 'admin' }, 'u1'),
    ).toBe(true);
  });

  it('counts an auto-closed evening whose clock ran', () => {
    expect(
      isAttendedGame(
        {
          ...base,
          status: 'finished',
          endedBy: 'auto',
          liveMatch: { startedAt: YESTERDAY },
        },
        'u1',
      ),
    ).toBe(true);
  });

  it('does NOT count an unverified evening', () => {
    // The change with teeth: this used to be `true` purely because the status
    // said 'finished', putting a night nobody played into a player's record.
    expect(
      isAttendedGame({ ...base, status: 'finished', endedBy: 'auto' }, 'u1'),
    ).toBe(false);
  });

  it('counts it the moment an admin confirms it', () => {
    expect(
      isAttendedGame(
        { ...base, status: 'finished', endedBy: 'auto', playVerified: true },
        'u1',
      ),
    ).toBe(true);
  });

  it('never counts one an admin said did not happen', () => {
    expect(
      isAttendedGame(
        { ...base, status: 'finished', endedBy: 'auto', playVerified: false },
        'u1',
      ),
    ).toBe(false);
  });

  it('still counts every evening closed before this shipped', () => {
    // No `endedBy`: legacy. Not one historical number moves.
    expect(isAttendedGame({ ...base, status: 'finished' }, 'u1')).toBe(true);
  });

  it('keeps the rules it already had, on top of the new one', () => {
    const ok = { ...base, status: 'finished', endedBy: 'admin' as const };
    // Not on the roster.
    expect(isAttendedGame(ok, 'u9')).toBe(false);
    // Marked a no-show.
    expect(isAttendedGame({ ...ok, arrivals: { u1: 'no_show' } }, 'u1')).toBe(
      false,
    );
    // Kickoff still ahead.
    expect(isAttendedGame({ ...ok, startsAt: Date.now() + 60_000 }, 'u1')).toBe(
      false,
    );
    // Cancelled.
    expect(isAttendedGame({ ...ok, status: 'cancelled' }, 'u1')).toBe(false);
    // No user.
    expect(isAttendedGame(ok, '')).toBe(false);
  });
});

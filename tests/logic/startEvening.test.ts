// The evening an admin could not start.
//
// Seven people at the pitch, a game created as 4v4 — a format that implies
// eight — and no way into the live screen at all: the roster gate held the
// primary CTA on "invite players" and the menu entry needs the game to be
// active already, which only the live screen can make it. canStartEvening is
// the rule that resolves it, and until this it had no caller.

import { canStartEvening, canEnterLive } from '@/services/gameLifecycle';
import type { Game } from '@/types';

const MIN = 60 * 1000;

function game(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    groupId: 'c1',
    title: 'מחזור',
    status: 'open',
    startsAt: Date.now() + 10 * MIN,
    players: [],
    waitlist: [],
    guests: [],
    format: '4v4',
    ...over,
  } as unknown as Game;
}

const admin = { isOrganizerOrAdmin: true };

describe('canStartEvening', () => {
  it('opens 30 minutes before kickoff, however few players turned up', () => {
    expect(canStartEvening(game({ startsAt: Date.now() + 10 * MIN }), admin)).toBe(true);
    expect(canStartEvening(game({ startsAt: Date.now() - 5 * MIN }), admin)).toBe(true);
  });

  it('stays shut earlier than that — then the job is still recruiting', () => {
    expect(canStartEvening(game({ startsAt: Date.now() + 90 * MIN }), admin)).toBe(false);
    expect(canStartEvening(game({ startsAt: Date.now() + 24 * 60 * MIN }), admin)).toBe(false);
  });

  it('shuts again once the evening has gone stale', () => {
    expect(canStartEvening(game({ startsAt: Date.now() - 7 * 60 * MIN }), admin)).toBe(false);
  });

  it('is an admin door only', () => {
    expect(canStartEvening(game(), { isOrganizerOrAdmin: false, isParticipant: true })).toBe(false);
  });

  it('works from locked as well as open, and not from a finished evening', () => {
    expect(canStartEvening(game({ status: 'locked' }), admin)).toBe(true);
    expect(canStartEvening(game({ status: 'finished' }), admin)).toBe(false);
    expect(canStartEvening(game({ status: 'cancelled' }), admin)).toBe(false);
  });

  // The two rules together are the whole fix: canEnterLive answers "is there a
  // live evening to join", canStartEvening answers "may I make one". Before,
  // only the first was ever asked, so a game nobody had started had no door.
  it('answers where canEnterLive cannot', () => {
    const g = game();
    expect(canEnterLive(g, admin)).toBe(false);
    expect(canStartEvening(g, admin)).toBe(true);
  });
});

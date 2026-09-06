// Who may open the live screen.
//
// Until now the gate was "admin or someone on this week's roster". A club
// member who was left off the roster hit "the match isn't active yet" and was
// bounced straight back out — which reads as a bug, not a rule (owner report).
// Membership now grants WATCHING; every control on both live screens is gated
// on isOrganizerOrAdmin separately, so a member lands on the read-only view.
//
// Firestore already agreed: `match /games/{id}` allows a read to
// isGroupMember(groupId), so this was only ever a client-side restriction.

import { canEnterLive } from '@/services/gameLifecycle';
import type { Game } from '@/types';

const activeGame = (over: Partial<Game> = {}): Game =>
  ({
    id: 'g1',
    groupId: 'club1',
    status: 'active',
    players: ['p1'],
    waitlist: ['w1'],
    startsAt: Date.now(),
    ...over,
  }) as Game;

describe('canEnterLive', () => {
  it('lets a club member who is NOT on the roster watch — the reported gap', () => {
    expect(
      canEnterLive(activeGame(), { isOrganizerOrAdmin: false, isParticipant: false, isClubMember: true }),
    ).toBe(true);
  });

  it('still lets the admin in', () => {
    expect(
      canEnterLive(activeGame(), { isOrganizerOrAdmin: true, isParticipant: false, isClubMember: false }),
    ).toBe(true);
  });

  it('still lets a registered participant in', () => {
    expect(
      canEnterLive(activeGame(), { isOrganizerOrAdmin: false, isParticipant: true, isClubMember: false }),
    ).toBe(true);
  });

  it('keeps NON-members out — the rule that must not loosen', () => {
    expect(
      canEnterLive(activeGame(), { isOrganizerOrAdmin: false, isParticipant: false, isClubMember: false }),
    ).toBe(false);
  });

  it('keeps a member out of a game that is not active', () => {
    // The live screen only exists while the evening is running; membership
    // does not grant entry to a finished or not-yet-started evening.
    for (const status of ['open', 'locked', 'scheduled', 'finished', 'cancelled'] as const) {
      expect(
        canEnterLive(activeGame({ status }), {
          isOrganizerOrAdmin: false,
          isParticipant: false,
          isClubMember: true,
        }),
      ).toBe(false);
    }
  });

  it('treats an absent isClubMember as false, so old callers are unchanged', () => {
    expect(
      canEnterLive(activeGame(), { isOrganizerOrAdmin: false, isParticipant: false }),
    ).toBe(false);
  });
});

import { promoteWaitingGuests } from '../../functions/src/guestPromotion';

const guests = [
  { id: 'active', name: 'פעיל', addedBy: 'coach', createdAt: 1 },
  { id: 'newer', name: 'חדש', addedBy: 'coach', createdAt: 30, waitlisted: true },
  { id: 'older', name: 'ותיק', addedBy: 'coach', createdAt: 20, estimatedRating: 4, waitlisted: true },
];
const roster = { guests, players: ['player'], waitlist: [] as string[], maxPlayers: 3, status: 'open' };

describe('automatic guest promotion', () => {
  it('fills a freed seat with the earliest guest and preserves identity and rating', () => {
    const result = promoteWaitingGuests(roster, true)!;
    expect(result[2]).toEqual({ ...guests[2], waitlisted: false });
    expect(result[1].waitlisted).toBe(true);
    expect(guests[2].waitlisted).toBe(true);
    expect(promoteWaitingGuests({ ...roster, guests: result }, true)).toBeNull();
  });
  it('fills multiple free seats without exceeding capacity', () => {
    const result = promoteWaitingGuests({ ...roster, maxPlayers: 4 }, true)!;
    expect(result.filter(g => !g.waitlisted)).toHaveLength(3);
    expect(promoteWaitingGuests({ ...roster, maxPlayers: 2 }, true)).toBeNull();
  });
  it('respects registered players and outstanding offers', () => {
    expect(promoteWaitingGuests({ ...roster, waitlist: ['waiting-player'] }, true)).toBeNull();
    expect(promoteWaitingGuests({ ...roster, pendingPromotion: { uid: 'offered-player' } }, true)).toBeNull();
  });
  it.each(['active', 'finished', 'cancelled'])('does not admit guests in %s rounds', status => {
    expect(promoteWaitingGuests({ ...roster, status }, true)).toBeNull();
  });
  it.each(['open', 'scheduled', 'locked', undefined])('admits during registration: %s', status => {
    expect(promoteWaitingGuests({ ...roster, status }, true)?.[2].waitlisted).toBe(false);
  });
  it('does not undo a manual roster move or treat removal of a waiting guest as a freed seat', () => {
    expect(promoteWaitingGuests(roster, false)).toBeNull();
  });
  it('uses stable array order for guests with equal or missing timestamps', () => {
    const tied = guests.map(g => ({ ...g, createdAt: undefined }));
    expect(promoteWaitingGuests({ ...roster, guests: tied }, true)?.[1].waitlisted).toBe(false);
  });
});

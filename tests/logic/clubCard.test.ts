// The club card's state machine. Every rule in the spec has a case here,
// because the card is the first thing a new user sees and a wrong CTA either
// hides a club they could join or offers a join they can't make.

import {
  RECOMMEND_MAX_KM,
  RECOMMEND_MIN_PLAYERS,
  clubActivity,
  resolveClubCard,
  type ClubCardContext,
} from '@/utils/clubCard';

const ctx = (over: Partial<ClubCardContext> = {}): ClubCardContext => ({
  isAdmin: false,
  isMember: false,
  isPending: false,
  isOpen: false,
  playerCount: 20,
  distanceKm: 5,
  friends: [],
  gamesLast30: null,
  gamesLast60: null,
  ...over,
});

const friend = (id: string) => ({ id, name: `חבר ${id}` });

describe('what the button says', () => {
  it('a member sees membership, never a join offer', () => {
    expect(resolveClubCard(ctx({ isMember: true })).cta).toBe('member');
    // …even when the club is open, which would otherwise say "הצטרף".
    expect(resolveClubCard(ctx({ isMember: true, isOpen: true })).cta).toBe('member');
  });

  it('an admin is a member too', () => {
    const vm = resolveClubCard(ctx({ isAdmin: true }));
    expect(vm.relation).toBe('admin');
    expect(vm.cta).toBe('member');
  });

  it('offers an instant join only when the club is open', () => {
    expect(resolveClubCard(ctx({ isOpen: true })).cta).toBe('join');
    expect(resolveClubCard(ctx({ isOpen: false })).cta).toBe('request');
  });

  it('a pending request outranks the club being open', () => {
    // Otherwise an open club keeps offering "הצטרף" to someone who already
    // asked, and a second tap creates a duplicate request.
    expect(resolveClubCard(ctx({ isPending: true, isOpen: true })).cta).toBe(
      'requested',
    );
  });
});

describe('the badge in the top corner', () => {
  it('shows the crown to an admin', () => {
    expect(resolveClubCard(ctx({ isAdmin: true })).topBadge).toBe('manager');
  });

  it('recommends a club that is both close AND big enough', () => {
    expect(
      resolveClubCard(ctx({ distanceKm: RECOMMEND_MAX_KM, playerCount: RECOMMEND_MIN_PLAYERS }))
        .topBadge,
    ).toBe('recommended');
  });

  it('needs BOTH conditions, not either', () => {
    expect(resolveClubCard(ctx({ distanceKm: 2, playerCount: 9 })).topBadge).toBeNull();
    expect(resolveClubCard(ctx({ distanceKm: 11, playerCount: 40 })).topBadge).toBeNull();
  });

  it('never treats "no location" as far away', () => {
    // A missing distance means we don't know — not that the club is distant.
    expect(resolveClubCard(ctx({ distanceKm: null, playerCount: 40 })).topBadge).toBeNull();
  });

  it('gives the crown priority over the recommendation', () => {
    // One corner, one badge.
    const vm = resolveClubCard(ctx({ isAdmin: true, distanceKm: 1, playerCount: 50 }));
    expect(vm.topBadge).toBe('manager');
  });
});

describe('activity, from games actually played', () => {
  it('follows the bands exactly', () => {
    expect(clubActivity(4, 6)).toBe('veryActive');
    expect(clubActivity(9, 9)).toBe('veryActive');
    expect(clubActivity(2, 3)).toBe('active');
    expect(clubActivity(3, 4)).toBe('active');
    expect(clubActivity(0, 0)).toBe('inactive');
  });

  it('does not call a club active on a single game', () => {
    // The case that raised the bar: one finished game twenty days ago used
    // to earn "פעיל". A badge a near-dormant club also gets tells a player
    // nothing about the clubs that really do play every week.
    expect(clubActivity(1, 1)).toBeNull();
    expect(clubActivity(1, 3)).toBeNull();
  });

  it('says NOTHING for the in-between club', () => {
    // Quiet this month, but it did play within two — not active enough to
    // advertise, not dead enough to brand. Silence is the honest answer.
    expect(clubActivity(0, 2)).toBeNull();
  });

  it('says nothing at all before the counters exist', () => {
    // Otherwise every club on earth is "לא פעיל" the day this ships.
    expect(clubActivity(null, null)).toBeNull();
    expect(clubActivity(0, null)).toBeNull();
  });
});

describe('friends already here', () => {
  it('caps the avatars and counts the rest', () => {
    const vm = resolveClubCard(
      ctx({ friends: ['a', 'b', 'c', 'd', 'e', 'f'].map(friend) }),
    );
    expect(vm.friends).toHaveLength(3);
    expect(vm.friendsOverflow).toBe(3);
  });

  it('does not count an overflow that is not there', () => {
    const vm = resolveClubCard(ctx({ friends: [friend('a')] }));
    expect(vm.friends).toHaveLength(1);
    expect(vm.friendsOverflow).toBe(0);
  });

  it('is hidden entirely inside a club I am already in', () => {
    // "3 friends here" is a reason to join. Inside, it's noise.
    const asMember = resolveClubCard(
      ctx({ isMember: true, friends: [friend('a'), friend('b')] }),
    );
    expect(asMember.friends).toEqual([]);
    expect(asMember.friendsOverflow).toBe(0);

    const asAdmin = resolveClubCard(
      ctx({ isAdmin: true, friends: [friend('a')] }),
    );
    expect(asAdmin.friends).toEqual([]);
  });

  it('still shows them to someone with a pending request', () => {
    // They aren't in yet, so the reason to want in still applies.
    const vm = resolveClubCard(ctx({ isPending: true, friends: [friend('a')] }));
    expect(vm.friends).toHaveLength(1);
  });
});

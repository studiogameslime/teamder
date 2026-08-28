// Mirrors ctaForGame's ordering in src/components/match/MatchListCard.tsx.
//
// The rule this pins: whether a SEAT EXISTS is a fact about the game; whether
// an admin must bless it is a fact about the club. Asking the second question
// first is what let a full game keep advertising "בקש להצטרף" and collect
// requests that could only ever be declined.
type G = { players: string[]; activeGuests: number; maxPlayers: number; requiresApproval: boolean };
function cta(g: G): 'join' | 'requestJoin' | 'waitlist' {
  const occupancy = g.players.length + g.activeGuests;
  if (occupancy >= g.maxPlayers) return 'waitlist';
  if (g.requiresApproval) return 'requestJoin';
  return 'join';
}

describe('join CTA respects capacity before approval', () => {
  it('offers the waitlist on the real production case, not a join request', () => {
    // F.c.Bavli, the only public game in the country on 2026-08-28:
    // 1 registered player + 20 active guests against a cap of 21, approval on.
    // It had collected 7 pending requests, aged up to 18 days.
    expect(cta({ players: ['u1'], activeGuests: 20, maxPlayers: 21, requiresApproval: true }))
      .toBe('waitlist');
  });

  it('still asks for approval when there IS a seat', () => {
    expect(cta({ players: ['u1'], activeGuests: 19, maxPlayers: 21, requiresApproval: true }))
      .toBe('requestJoin');
  });

  it('joins directly when open and not full', () => {
    expect(cta({ players: [], activeGuests: 0, maxPlayers: 10, requiresApproval: false }))
      .toBe('join');
  });

  it('counts GUESTS toward capacity — a roster padded with guests is still full', () => {
    // The production game was full almost entirely on hand-typed guests. Count
    // only registered players and it reads 1/21, which is how it stayed listed.
    expect(cta({ players: ['u1'], activeGuests: 20, maxPlayers: 21, requiresApproval: false }))
      .toBe('waitlist');
  });

  it('treats over-full the same as full', () => {
    expect(cta({ players: ['a', 'b'], activeGuests: 20, maxPlayers: 21, requiresApproval: true }))
      .toBe('waitlist');
  });
});

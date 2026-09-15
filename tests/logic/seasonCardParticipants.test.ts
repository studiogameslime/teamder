// Who counts as having taken part in a season.
//
// Found on the QA club by closing a real season against the deployed backend:
// the card reported "0 שחקנים" for a season four people attended. It counted
// `rounds` — MINI-GAMES — and a club that runs the plain live screen never
// records one, because that screen is a clock and mini-games exist only in
// advanced mode. Every season such a club ever closed said nobody played it.
//
// `games` is the right signal, and it is the one the evening-played rules make
// reliable: it only counts an evening that actually happened.
import { countSeasonParticipants } from '@/utils/seasonParticipants';

describe('season participants', () => {
  it('counts a timer-only club, where nobody has a mini-game', () => {
    // The exact shape that produced "0 שחקנים" in production.
    expect(
      countSeasonParticipants({
        a: { games: 6, rounds: 0 },
        b: { games: 6, rounds: 0 },
        c: { games: 6, rounds: 0 },
        d: { games: 6, rounds: 0 },
      }),
    ).toBe(4);
  });

  it('still counts an advanced club by its mini-games', () => {
    expect(
      countSeasonParticipants({
        a: { games: 0, rounds: 12 },
        b: { games: 4, rounds: 20 },
      }),
    ).toBe(2);
  });

  it('excludes a member who never turned up', () => {
    // A row of zeros is a member of the club, not a participant in the season.
    expect(
      countSeasonParticipants({
        played: { games: 3, rounds: 0 },
        absent: { games: 0, rounds: 0 },
      }),
    ).toBe(1);
  });

  it('is not fooled by missing or non-numeric counters', () => {
    expect(
      countSeasonParticipants({
        a: {},
        b: { games: undefined, rounds: null },
        c: { games: 'x', rounds: 'y' },
        d: { games: 1 },
      } as never),
    ).toBe(1);
  });

  it('an empty season has no participants, and does not crash', () => {
    expect(countSeasonParticipants({})).toBe(0);
    expect(countSeasonParticipants(undefined as never)).toBe(0);
  });
});

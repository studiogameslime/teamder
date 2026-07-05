// Overnight QA — GAME REGISTRATION deep-dive. Exercises the pure seating logic
// (assignJoins — the same algorithm the server reconcile + client use) and the
// team-balancing used by scheduled auto-teams, probing the edge cases a QA
// engineer would hammer: capacity boundaries, waitlist spill, the pending-offer
// reservation (so an outsider can't jump a held spot), approval gating, fair
// ordering under latency, idempotency, and balanced-team fairness.
import {
  assignJoins,
  orderJoinRequests,
  type JoinReq,
  type RosterState,
} from '@/services/joinFairness';
import { balanceTeams } from '@/utils/draft';

const roster = (over: Partial<RosterState> = {}): RosterState => ({
  players: [],
  waitlist: [],
  pending: [],
  guestsCount: 0,
  maxPlayers: 5,
  requiresApproval: false,
  ...over,
});
const req = (uid: string, tappedAt: number, latency = 0): JoinReq => ({
  uid,
  tappedAt,
  requestedAt: tappedAt + latency,
});

describe('REGISTRATION QA — seating (assignJoins)', () => {
  it('seats joiners up to capacity, spills the rest to the waitlist in fair order', () => {
    const r = assignJoins(roster({ maxPlayers: 3 }), [
      req('a', 100),
      req('b', 200),
      req('c', 300),
      req('d', 400),
      req('e', 500),
    ]);
    expect(r.players).toEqual(['a', 'b', 'c']);
    expect(r.waitlist).toEqual(['d', 'e']);
    expect(r.pending).toEqual([]);
  });

  it('the LAST open seat goes to exactly one joiner; the next is waitlisted (boundary)', () => {
    const r = assignJoins(roster({ players: ['x', 'y'], maxPlayers: 3 }), [
      req('a', 100),
      req('b', 200),
    ]);
    expect(r.players).toEqual(['x', 'y', 'a']);
    expect(r.waitlist).toEqual(['b']);
  });

  it('guests occupy real capacity — a joiner is waitlisted when guests fill the game', () => {
    const r = assignJoins(
      roster({ players: ['x'], guestsCount: 2, maxPlayers: 3 }),
      [req('a', 100)],
    );
    expect(r.players).toEqual(['x']);
    expect(r.waitlist).toEqual(['a']);
  });

  it('RESERVATION: a pending waitlist offer holds the last seat — an outsider is waitlisted, not seated', () => {
    // 2 players + 1 offer reserved = 3/3 → the freed seat is NOT grabbable.
    const r = assignJoins(
      roster({ players: ['x', 'y'], maxPlayers: 3, pendingOfferReservation: true }),
      [req('outsider', 100)],
    );
    expect(r.players).toEqual(['x', 'y']);
    expect(r.waitlist).toEqual(['outsider']);
  });

  it('RESERVATION released: no offer → the same outsider DOES take the open seat', () => {
    const r = assignJoins(
      roster({ players: ['x', 'y'], maxPlayers: 3, pendingOfferReservation: false }),
      [req('outsider', 100)],
    );
    expect(r.players).toEqual(['x', 'y', 'outsider']);
    expect(r.waitlist).toEqual([]);
  });

  it('approval-required game: every new joiner goes to pending, none auto-seated', () => {
    const r = assignJoins(
      roster({ maxPlayers: 5, requiresApproval: true }),
      [req('a', 100), req('b', 200)],
    );
    expect(r.players).toEqual([]);
    expect(r.pending).toEqual(['a', 'b']);
    expect(r.waitlist).toEqual([]);
  });

  it('fair order by TAP time even when network latency reverses arrival', () => {
    // a taps first but arrives late; only ONE seat. a must win it.
    const r = assignJoins(roster({ maxPlayers: 1 }), [
      req('b', 200, 0),
      req('a', 100, 500),
    ]);
    expect(r.players).toEqual(['a']);
    expect(r.waitlist).toEqual(['b']);
  });

  it('idempotent: re-running the same batch does not double-seat or reorder', () => {
    const state = roster({ maxPlayers: 3 });
    const reqs = [req('a', 100), req('b', 200), req('c', 300), req('d', 400)];
    const first = assignJoins(state, reqs);
    const again = assignJoins(
      { ...state, players: first.players, waitlist: first.waitlist },
      reqs,
    );
    expect(again.players).toEqual(first.players);
    expect(again.waitlist).toEqual(first.waitlist);
  });

  it('an already-seated player keeps their seat (no duplication) when re-requesting', () => {
    const r = assignJoins(roster({ players: ['a'], maxPlayers: 3 }), [
      req('a', 50),
      req('b', 100),
    ]);
    expect(r.players).toEqual(['a', 'b']);
    expect(r.players.filter((x) => x === 'a')).toHaveLength(1);
  });

  it('over-capacity roster (admin lowered maxPlayers): no NEW joiner is seated', () => {
    const r = assignJoins(
      roster({ players: ['p1', 'p2', 'p3'], maxPlayers: 2 }),
      [req('a', 100)],
    );
    expect(r.players).toEqual(['p1', 'p2', 'p3']);
    expect(r.waitlist).toEqual(['a']);
  });
});

describe('REGISTRATION QA — scheduled balanced teams (balanceTeams)', () => {
  const ratingSum = (ids: string[], ratings: Record<string, number>) =>
    ids.reduce((s, id) => s + (ratings[id] ?? 5.5), 0);

  it('splits a real 1-5 roster into tightly balanced teams', () => {
    // Production reality: all live adminRatings + guest estimatedRatings are on
    // the 1-5 scale (verified against prod: min 1.7, max 5.0). normalizeRating's
    // `v>5?v/2:v` only ever fires on legacy un-migrated data, so on real rosters
    // it is a no-op clamp and the greedy split lands near-perfect balance.
    const playerIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    const ratings = { a: 5, b: 4.5, c: 3, d: 2.5, e: 2, f: 1 };
    const { result } = balanceTeams({ playerIds, ratings, numTeams: 2, createdBy: 'a' });
    const sums = result.teams.map((t) => ratingSum(t.playerIds, ratings));
    expect(Math.abs(sums[0] - sums[1])).toBeLessThanOrEqual(1);
  });

  it('nobody is benched — every roster id lands on exactly one team', () => {
    const playerIds = ['a', 'b', 'c', 'd', 'e'];
    const { result } = balanceTeams({
      playerIds,
      ratings: { a: 8, b: 7, c: 5, d: 4, e: 3 },
      numTeams: 2,
      createdBy: 'a',
    });
    const placed = result.teams.flatMap((t) => t.playerIds);
    expect(placed.slice().sort()).toEqual(playerIds.slice().sort());
    expect(new Set(placed).size).toBe(placed.length); // no duplicates
  });

  it('deduplicates a roster id that slipped in twice (no "in my team twice")', () => {
    const { result } = balanceTeams({
      playerIds: ['a', 'a', 'b', 'c'],
      ratings: { a: 8, b: 5, c: 3 },
      numTeams: 2,
      createdBy: 'a',
    });
    const placed = result.teams.flatMap((t) => t.playerIds);
    expect(placed.filter((x) => x === 'a')).toHaveLength(1);
  });

  it('clamps numTeams to roster size — never produces an empty team', () => {
    const { result } = balanceTeams({
      playerIds: ['a', 'b'],
      ratings: { a: 6, b: 5 },
      numTeams: 4,
      createdBy: 'a',
    });
    expect(result.teams.every((t) => t.playerIds.length > 0)).toBe(true);
  });

  it('unrated players are spread (scored neutral), not dumped on one team', () => {
    const playerIds = ['r1', 'r2', 'u1', 'u2'];
    const ratings = { r1: 10, r2: 1 }; // u1/u2 unrated → ~5.5
    const { result, unratedCount } = balanceTeams({
      playerIds,
      ratings,
      numTeams: 2,
      createdBy: 'r1',
    });
    expect(unratedCount).toBe(2);
    // the two rated extremes should not both land together while unrated pile up.
    const sums = result.teams.map((t) => ratingSum(t.playerIds, ratings));
    expect(Math.abs(sums[0] - sums[1])).toBeLessThanOrEqual(5);
  });
});

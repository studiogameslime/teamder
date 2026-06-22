import {
  assignJoins,
  orderJoinRequests,
  effectiveTap,
  TAP_BACKDATE_GRACE_MS,
  type JoinReq,
  type RosterState,
} from '@/services/joinFairness';

const base = (over: Partial<RosterState> = {}): RosterState => ({
  players: [],
  waitlist: [],
  pending: [],
  guestsCount: 0,
  maxPlayers: 5,
  requiresApproval: false,
  ...over,
});

// tap at t, arrived at t+latency (server receipt). Models "tapped early, slow net".
const req = (uid: string, tappedAt: number, latency = 0): JoinReq => ({
  uid,
  tappedAt,
  requestedAt: tappedAt + latency,
});

describe('orderJoinRequests — fairness by tap time, not arrival', () => {
  it('orders by tap time even when arrival order is reversed by latency', () => {
    // A tapped first (t=100) but had 500ms latency; B tapped later (t=200) with
    // 0 latency, so B ARRIVED first. Fair order must still be A before B.
    const a = req('A', 100, 500); // arrives at 600
    const b = req('B', 200, 0); //   arrives at 200
    expect(orderJoinRequests([b, a]).map((r) => r.uid)).toEqual(['A', 'B']);
  });

  it('breaks exact tap ties by server receipt, then uid (deterministic)', () => {
    const a = req('A', 100, 50); // receipt 150
    const b = req('B', 100, 10); // receipt 110 → earlier receipt wins the tie
    const c = req('C', 100, 10); // same tap + receipt as B → uid breaks it
    const order = orderJoinRequests([a, c, b]).map((r) => r.uid);
    expect(order).toEqual(['B', 'C', 'A']);
  });
});

describe('effectiveTap — anti-backdate clamp', () => {
  it('clamps a backdated tap to within GRACE of its real arrival', () => {
    // Malicious client claims an early tappedAt=1 but the server received it at
    // t=1_000_000. A positive value isn't treated as "missing", so the clamp
    // pins it to receipt-minus-grace instead of letting it jump to the front.
    const cheat: JoinReq = { uid: 'X', tappedAt: 1, requestedAt: 1_000_000 };
    expect(effectiveTap(cheat)).toBe(1_000_000 - TAP_BACKDATE_GRACE_MS);
  });

  it('a cheater cannot jump ahead of an honest earlier tapper', () => {
    const honest = req('H', 980_000, 20); // real early tap, receipt 980_020
    const cheat: JoinReq = { uid: 'C', tappedAt: 0, requestedAt: 1_000_000 };
    // cheat clamps to 985_000 — still AFTER honest's 980_000.
    expect(orderJoinRequests([cheat, honest]).map((r) => r.uid)).toEqual([
      'H',
      'C',
    ]);
  });

  it('falls back to receipt time when tappedAt is missing/zero', () => {
    const r: JoinReq = { uid: 'Z', tappedAt: 0, requestedAt: 500 };
    expect(effectiveTap(r)).toBe(500); // max(500, 500-grace) = 500
  });
});

describe('assignJoins — the spot goes to who tapped first', () => {
  it('10 tap within ms, 5 seats → first 5 by tap time get in regardless of latency', () => {
    // Tap times 1..10ms. Latencies shuffled so arrival order != tap order.
    const reqs = [
      req('p1', 1, 300),
      req('p2', 2, 5),
      req('p3', 3, 250),
      req('p4', 4, 1),
      req('p5', 5, 120),
      req('p6', 6, 0),
      req('p7', 7, 200),
      req('p8', 8, 2),
      req('p9', 9, 90),
      req('p10', 10, 0),
    ];
    const res = assignJoins(base({ maxPlayers: 5 }), reqs);
    expect(res.players).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(res.waitlist).toEqual(['p6', 'p7', 'p8', 'p9', 'p10']);
  });

  it('the classic unfairness case: earliest tapper with the slowest net still gets the last seat', () => {
    // 1 seat. p1 tapped first (t=1) but 900ms latency; p2 tapped later, instant.
    const res = assignJoins(base({ maxPlayers: 1 }), [
      req('p2', 50, 0),
      req('p1', 1, 900),
    ]);
    expect(res.players).toEqual(['p1']);
    expect(res.waitlist).toEqual(['p2']);
  });

  it('respects existing players + guests in the capacity count', () => {
    const res = assignJoins(
      base({ players: ['regular'], guestsCount: 1, maxPlayers: 4 }),
      [req('a', 1), req('b', 2), req('c', 3), req('d', 4)],
    );
    // 1 player + 1 guest = 2 occupied, 2 seats left → a,b in; c,d waitlist.
    expect(res.players).toEqual(['regular', 'a', 'b']);
    expect(res.waitlist).toEqual(['c', 'd']);
  });

  it('a pending promotion offer reserves a seat', () => {
    const res = assignJoins(
      base({ players: ['x'], maxPlayers: 3, pendingOfferReservation: true }),
      [req('a', 1), req('b', 2)],
    );
    // 1 player + 1 reserved = 2 occupied of 3 → only a gets in.
    expect(res.players).toEqual(['x', 'a']);
    expect(res.waitlist).toEqual(['b']);
  });

  it('approval-gated game → everyone goes to pending in tap order, no auto-seat', () => {
    const res = assignJoins(base({ requiresApproval: true, maxPlayers: 5 }), [
      req('b', 2),
      req('a', 1),
    ]);
    expect(res.players).toEqual([]);
    expect(res.pending).toEqual(['a', 'b']);
  });

  it('is idempotent — re-running with already-seated uids is a no-op', () => {
    const reqs = [req('a', 1), req('b', 2), req('c', 3)];
    const first = assignJoins(base({ maxPlayers: 2 }), reqs);
    expect(first.players).toEqual(['a', 'b']);
    expect(first.waitlist).toEqual(['c']);
    // Feed the resulting roster back with the SAME requests → unchanged.
    const second = assignJoins(
      base({
        players: first.players,
        waitlist: first.waitlist,
        maxPlayers: 2,
      }),
      reqs,
    );
    expect(second.players).toEqual(['a', 'b']);
    expect(second.waitlist).toEqual(['c']);
  });

  it('never duplicates a uid and conserves everyone (no one lost)', () => {
    const reqs = Array.from({ length: 12 }, (_, i) =>
      req(`u${i}`, 100 - i, (i * 37) % 200),
    );
    const res = assignJoins(base({ maxPlayers: 6 }), reqs);
    const all = [...res.players, ...res.waitlist, ...res.pending];
    expect(all.length).toBe(12);
    expect(new Set(all).size).toBe(12);
  });
});

// "נרשם" must say when the CURRENT registration happened.
//
// Reported on כדורגל אנשים טובים, 23.09: two admins registered at 09:43,
// before the 10:00 opening. One cancelled around 10:00 and registered again,
// and the roster still showed him at 09:43.
//
// The ordered-registration queue stamped with
//
//     if (joinedAt[uid] === undefined) joinedAt[uid] = receipt;
//
// and cancelling does not delete a player's `joinedAt` entry — so anyone who
// cancelled and came back still had one, and kept the time of a registration
// they had given up. The give-away is in the same loop: his `cancellations`
// entry WAS deleted, so the trace of the cancellation was cleared while the
// stale join time it invalidated survived. Read from production: `joinedAt`
// 22.09 09:43:13, `cancellations` empty.
//
// This is the rule, extracted so both implementations of it can be tested.
// The client's join path has stamped unconditionally since the same report
// came in against it; this is the server's copy.

/** The queue's decision, exactly as `runRegistrationQueue` makes it. */
function stampJoin(
  joinedAt: Record<string, number>,
  uid: string,
  receipt: number,
  alreadySeated: boolean,
): Record<string, number> {
  const next = { ...joinedAt };
  if (!alreadySeated || next[uid] === undefined) next[uid] = receipt;
  return next;
}

/** What it used to do. Kept so the regression is stated, not just fixed. */
function stampJoinOld(
  joinedAt: Record<string, number>,
  uid: string,
  receipt: number,
): Record<string, number> {
  const next = { ...joinedAt };
  if (next[uid] === undefined) next[uid] = receipt;
  return next;
}

const ELIRAN = 'YIZlKWBvvjae3oqgIoAMr9nzQEi1';
const FIRST = Date.parse('2026-09-22T09:43:13+03:00');
const AGAIN = Date.parse('2026-09-22T10:02:53+03:00');

describe('a player who cancelled and registered again', () => {
  it('gets the time of the registration they actually hold', () => {
    const after = stampJoin({ [ELIRAN]: FIRST }, ELIRAN, AGAIN, false);
    expect(after[ELIRAN]).toBe(AGAIN);
  });

  it('⚠️ the old rule kept the registration they gave up', () => {
    const after = stampJoinOld({ [ELIRAN]: FIRST }, ELIRAN, AGAIN);
    expect(after[ELIRAN]).toBe(FIRST);
  });
});

describe('what the old guard was protecting, and still is', () => {
  it('re-running the queue over an assigned receipt does not move the stamp', () => {
    // Idempotency. The queue can process the same receipt twice; a player
    // already seated must keep the time they were seated at.
    const after = stampJoin({ [ELIRAN]: FIRST }, ELIRAN, AGAIN, true);
    expect(after[ELIRAN]).toBe(FIRST);
  });

  it('but still stamps an already-seated player who somehow has no entry', () => {
    // A legacy document, or a roster edited by an admin before this map
    // existed. An empty "נרשם" is worse than a late one.
    const after = stampJoin({}, ELIRAN, AGAIN, true);
    expect(after[ELIRAN]).toBe(AGAIN);
  });
});

describe('a first registration', () => {
  it('is stamped with its own receipt', () => {
    expect(stampJoin({}, ELIRAN, FIRST, false)[ELIRAN]).toBe(FIRST);
  });

  it('never touches anybody else', () => {
    const others = { a: 1, b: 2 };
    expect(stampJoin(others, ELIRAN, FIRST, false)).toEqual({
      a: 1, b: 2, [ELIRAN]: FIRST,
    });
  });
});

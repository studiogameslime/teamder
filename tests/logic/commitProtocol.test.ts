// The invariant: a round marked committed always has its history (audit P0-2).
//
// Each test drives the real ordering helper with an injected failure at one of
// the windows that actually killed rounds in production, then asserts the
// resulting state. The store is a two-slot model of the only two things a
// committed round writes outside itself: the latched stats batch, and the
// round-history document.

import { commitRoundInOrder } from '../../functions/src/commitProtocol';

const ALREADY_EXISTS = Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });

/** Minimal model of the two artefacts a round produces. */
function world() {
  return {
    history: null as string | null,
    committed: false,
    /** How many times the increments were APPLIED — the double-count witness. */
    statsApplied: 0,
  };
}

/** Wires a payload to a world, with optional injected failures. */
function steps(
  w: ReturnType<typeof world>,
  payload: string,
  fail: { history?: boolean; commit?: boolean } = {},
) {
  return {
    isAlreadyCommitted: async () => w.committed,
    writeHistory: async () => {
      if (fail.history) throw new Error('network');
      w.history = payload; // set() — idempotent by construction
    },
    commitStats: async () => {
      if (fail.commit) throw new Error('unavailable');
      // The latch is inside the batch: a second commit of the same round is
      // rejected wholesale, increments included.
      if (w.committed) throw ALREADY_EXISTS;
      w.committed = true;
      w.statsApplied += 1;
    },
    healHistory: async () => {
      if (w.history === null) w.history = payload; // create() semantics
    },
    isAlreadyExists: (e: unknown) => (e as { code?: unknown })?.code === 6,
    historyFailure: (e: unknown) => Object.assign(new Error('unavailable'), { cause: e }),
  };
}

/** The property every test below asserts. */
const invariant = (w: ReturnType<typeof world>) => {
  if (w.committed) expect(w.history).not.toBeNull();
  expect(w.statsApplied).toBeLessThanOrEqual(1);
};

describe('a mini-game that ends once', () => {
  it('1. writes history and commits stats exactly once', async () => {
    const w = world();
    const r = await commitRoundInOrder(steps(w, 'round-1'));
    expect(r).toEqual({ ok: true });
    expect(w.committed).toBe(true);
    expect(w.history).toBe('round-1');
    expect(w.statsApplied).toBe(1);
    invariant(w);
  });

  it('2. a legacy caller with no roundId commits stats and writes no history', async () => {
    const w = world();
    const s = steps(w, 'x');
    const r = await commitRoundInOrder({
      ...s,
      writeHistory: undefined,
      healHistory: undefined,
    });
    expect(r).toEqual({ ok: true });
    expect(w.committed).toBe(true);
    expect(w.history).toBeNull(); // nothing to write, nothing missing
  });
});

describe('the same commit sent twice', () => {
  it('3. the second call is a no-op success, not a double count', async () => {
    const w = world();
    await commitRoundInOrder(steps(w, 'round-1'));
    const second = await commitRoundInOrder(steps(w, 'round-1'));
    expect(second).toEqual({ ok: true, alreadyCommitted: true });
    expect(w.statsApplied).toBe(1);
    invariant(w);
  });

  it('4. a retry NEVER overwrites the history the first commit agreed with', async () => {
    const w = world();
    await commitRoundInOrder(steps(w, 'original'));
    // The client keeps the goal log alive after a commit it believes failed, so
    // a retry can legitimately carry an EDITED payload. The stats for this round
    // are already counted from the ORIGINAL one, so the record must not move.
    const r = await commitRoundInOrder(steps(w, 'edited-after-the-fact'));
    expect(r).toEqual({ ok: true, alreadyCommitted: true });
    expect(w.history).toBe('original');
    expect(w.statsApplied).toBe(1);
    invariant(w);
  });
});

describe('the failure windows that used to lose history for good', () => {
  it('5. the process dies after the commit, before history — retry repairs it', async () => {
    const w = world();
    // Old order reproduced by hand: stats land, then the instance is killed.
    w.committed = true;
    w.statsApplied = 1;
    expect(w.history).toBeNull(); // ← the production symptom
    // The client retries. Under the OLD code this returned `alreadyCommitted`
    // immediately and the history stayed missing forever; now the latch read
    // routes it into the heal path.
    const r = await commitRoundInOrder(steps(w, 'round-1'));
    expect(r).toEqual({ ok: true, alreadyCommitted: true });
    expect(w.history).toBe('round-1'); // healed
    expect(w.statsApplied).toBe(1);    // and not re-counted
    invariant(w);
  });

  it('6. history fails → stats are NOT committed, and the retry succeeds', async () => {
    const w = world();
    await expect(
      commitRoundInOrder(steps(w, 'round-1', { history: true })),
    ).rejects.toThrow();
    // Nothing counted: the round can be retried honestly.
    expect(w.committed).toBe(false);
    expect(w.statsApplied).toBe(0);
    invariant(w);

    const r = await commitRoundInOrder(steps(w, 'round-1'));
    expect(r).toEqual({ ok: true });
    expect(w.history).toBe('round-1');
    expect(w.statsApplied).toBe(1);
    invariant(w);
  });

  it('7. the batch fails → history exists without a commit, which the retry closes', async () => {
    const w = world();
    await expect(
      commitRoundInOrder(steps(w, 'round-1', { commit: true })),
    ).rejects.toThrow('unavailable');
    // The tolerated asymmetry: history for a round whose stats did not land.
    // Invisible in every aggregate, and not yet committed.
    expect(w.history).toBe('round-1');
    expect(w.committed).toBe(false);
    invariant(w);

    // The retry rewrites the identical document, then commits.
    const r = await commitRoundInOrder(steps(w, 'round-1'));
    expect(r).toEqual({ ok: true });
    expect(w.committed).toBe(true);
    expect(w.statsApplied).toBe(1);
    invariant(w);
  });

  it('8. a non-latch commit error still propagates — it is not swallowed', async () => {
    const w = world();
    const s = steps(w, 'round-1');
    await expect(
      commitRoundInOrder({
        ...s,
        commitStats: async () => {
          throw Object.assign(new Error('resource-exhausted'), { code: 8 });
        },
      }),
    ).rejects.toThrow('resource-exhausted');
    expect(w.committed).toBe(false);
  });
});

describe('a timed-out call the SDK retries under the hood', () => {
  // Both attempts read "not committed" before either commits — the residual
  // race the pre-check cannot remove. Bounded: both describe the same instant of
  // the same live match, so the payloads agree, and the latch keeps stats single.
  it('9. two concurrent attempts leave one commit and one history', async () => {
    const w = world();
    const [a, b] = await Promise.all([
      commitRoundInOrder(steps(w, 'round-1')),
      commitRoundInOrder(steps(w, 'round-1')),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.alreadyCommitted)).toHaveLength(1);
    expect(w.statsApplied).toBe(1);
    expect(w.history).toBe('round-1');
    invariant(w);
  });

  it('10. five rapid taps still credit the round once', async () => {
    const w = world();
    const out = await Promise.all(
      Array.from({ length: 5 }, () => commitRoundInOrder(steps(w, 'round-1'))),
    );
    expect(out.every((r) => r.ok)).toBe(true);
    expect(w.statsApplied).toBe(1);
    invariant(w);
  });
});

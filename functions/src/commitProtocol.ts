// A round's history, additive statistics and create-only latch now share ONE
// atomic batch in commitRoundStats (index.ts). Concurrent requests have one
// winner; the losing payload cannot rewrite that winner's history.
//
// This helper still supports an optional pre-write hook for legacy callers
// and the recovery of a historical latch with missing history. Production
// passes no writeHistory: commitStats includes history, statistics, the latch,
// and (for new clients) an update-time-guarded live-board clear. On ALREADY_EXISTS
// healHistory uses create-only semantics and never replaces existing history.
// See commitProtocol.test.ts and preReleaseRoundIntegrity.test.ts.

export interface RoundCommitSteps {
  /** Read the idempotency latch. True when this round was already committed by
   *  an earlier attempt — in which case its history must not be rewritten. */
  isAlreadyCommitted?: () => Promise<boolean>;
  /** Write the round-history document (set — this attempt's payload is the one
   *  about to be committed). Absent for legacy callers with no roundId. */
  writeHistory?: () => Promise<void>;
  /** Commit the latched stats batch. Throws ALREADY_EXISTS on a re-run. */
  commitStats: () => Promise<void>;
  /** CREATE the history document — used only on the ALREADY_EXISTS path, so an
   *  existing document is never overwritten. Must swallow "already exists". */
  healHistory?: () => Promise<void>;
  /** Recognises the latch collision. */
  isAlreadyExists: (err: unknown) => boolean;
  /** Wraps a failed history write in the error the caller wants to surface. */
  historyFailure: (err: unknown) => Error;
}

export interface RoundCommitResult {
  ok: true;
  alreadyCommitted?: true;
}

export async function commitRoundInOrder(
  steps: RoundCommitSteps,
): Promise<RoundCommitResult> {
  // Already committed by an earlier attempt? Then the stored history belongs to
  // THAT payload. Restore it if it is missing; never overwrite it if it is not.
  if (steps.isAlreadyCommitted && (await steps.isAlreadyCommitted())) {
    if (steps.healHistory) await steps.healHistory();
    return { ok: true, alreadyCommitted: true };
  }

  if (steps.writeHistory) {
    try {
      await steps.writeHistory();
    } catch (err) {
      // NOT swallowed. If the history cannot be stored, do not commit stats
      // that would then be permanently unexplainable — fail so the caller can
      // retry the whole thing.
      throw steps.historyFailure(err);
    }
  }

  try {
    await steps.commitStats();
  } catch (err) {
    if (!steps.isAlreadyExists(err)) throw err;
    // The round was already committed — by a previous attempt whose response
    // was lost, or by a double tap. Repair a missing history before reporting
    // success, then report success (a retry must be idempotent, not an error).
    if (steps.healHistory) await steps.healHistory();
    return { ok: true, alreadyCommitted: true };
  }

  return { ok: true };
}

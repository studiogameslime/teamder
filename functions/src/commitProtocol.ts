// The order in which a committed round's two writes happen — and why it is the
// order it is (audit P0-2).
//
// A round produces two artefacts that live in different places:
//
//   • the STATS batch — increments across users / communityPlayerStats /
//     gamePlayerStats / communityStats / pairStats, made idempotent by a
//     `committedRounds/{roundId}` create inside the very same batch;
//   • the round HISTORY document — who played, the score, the goal log, the
//     shootout. Deliberately outside the batch: an unbounded goal log could
//     push it toward the 1 MiB document limit, and letting display richness
//     abort the stats batch would be the worse trade.
//
// Two writes, no shared transaction, so one of them can be the survivor of a
// crash. The only question is WHICH failure we choose to be possible.
//
// The old order — stats first, history afterwards, best-effort in a swallowed
// try/catch — chose the unrecoverable one. Three routes led to a round marked
// committed with no history at all:
//   1. the history write failed and the error was swallowed;
//   2. the instance died between the commit landing and the history write;
//   3. the client lost the success response and retried; the latch threw
//      ALREADY_EXISTS, the handler returned early, and the history write was
//      never reached on ANY attempt.
// In all three the increments were already applied and the latch blocked
// re-processing, so nothing downstream could ever repair it.
//
// Reversing the order fixes it because `set()` is idempotent and `increment()`
// is not. History first can at worst leave history for a round whose stats
// never committed — invisible in every aggregate, and healed by the next retry,
// which rewrites the identical document and then commits. And when the latch
// does report ALREADY_EXISTS, we no longer bail out blind: we try to CREATE the
// history, which restores it if it is genuinely absent (a round committed by an
// older build, or one that died in the old post-commit window) and does nothing
// if it is already there.
//
// One more hazard the reversal introduces on its own, and how it is closed.
// Writing history first means a RETRY writes history before it discovers the
// round was already committed — and a retry does not have to carry the same
// payload (the client keeps the goal log alive after a failed commit, so an
// admin can add a goal and press again). That would leave the stored history
// describing a round the stats never counted. So the latch is READ first: if
// the round is already committed, we do not touch an existing history at all,
// only restore an absent one.
//
// What remains is a genuinely CONCURRENT double-tap, where both attempts read
// "not committed" before either commits. Both then describe the same instant of
// the same live match, so the payloads agree; the latch still keeps the stats
// single. That is the residual, and it is bounded to identical content.
//
// The invariant this buys:  committed ⇒ history exists.

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

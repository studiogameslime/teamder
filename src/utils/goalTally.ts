// The evening goal BADGE, and the one rule that decides who it credits.
//
// A live match keeps two goal records with deliberately different scopes:
//   • `liveMatch.goals`     — the CURRENT mini-game's log. Cleared at every
//                             round end, and by a reset.
//   • `liveMatch.goalTally` — per-player totals for the WHOLE evening. Survives
//                             round ends; that is the point of it.
//
// They are not two views of one number, so they will legitimately disagree.
// What they must never do is disagree by ACCIDENT — and they did, twice:
//
//   • a round reset wiped `goals[]` and the score but left `goalTally` alone,
//     so goals that were discarded and never committed to stats stayed in the
//     badge for the rest of the evening;
//   • stopping the rotation zeroed `goalTally` but left `goals[]` behind, and
//     the live screen's "empty tally → derive from the log" fallback promptly
//     resurrected the goals the reset had just cleared.
//
// Both writes now go through the helpers here, so the crediting rule lives in
// exactly one place instead of being re-stated at each call site.

/** The minimum a goal has to expose for tallying. */
export interface TallyableGoal {
  scorerId?: string | null;
  ownGoal?: boolean;
}

/**
 * Who a goal credits on the evening badge.
 *
 * Any attributed scorer — real OR guest, since a guest is a full player in the
 * cycle. An own goal credits nobody (it is not a scoring achievement), and
 * neither does a goal with no scorer recorded. This is the rule `recordGoal`
 * applies when it increments, so every rollback must apply the same one.
 */
export function tallyCreditFor(goal: TallyableGoal): string | null {
  return !goal.ownGoal && goal.scorerId ? goal.scorerId : null;
}

/** Per-player counts for a set of goals — the amount to add, or take back. */
export function tallyDelta(goals: readonly TallyableGoal[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of goals ?? []) {
    const id = tallyCreditFor(g);
    if (!id) continue;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/**
 * `tally` with `goals` removed — for a reset, which DISCARDS a round rather
 * than committing it. Never goes below zero, and drops players whose count
 * reaches it so the map does not accumulate dead keys.
 */
export function tallyWithout(
  tally: Record<string, number> | undefined,
  goals: readonly TallyableGoal[] | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...(tally ?? {}) };
  for (const [id, n] of Object.entries(tallyDelta(goals))) {
    const left = (out[id] ?? 0) - n;
    if (left > 0) out[id] = left;
    else delete out[id];
  }
  return out;
}

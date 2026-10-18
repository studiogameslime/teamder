// Completed-game participation, independent of the CURRENT live lineup.
// Shared with the server through functions/scripts/genRoundParticipants.mjs.

export interface ParticipantGoal {
  scorerId?: string | null;
  assisterId?: string | null;
  ownGoal?: boolean;
  team?: string | null;
}

/** Preserve the current sides, then recover participants whose recorded goal
 * or assist proves that they played before being substituted out. This only
 * builds new historical arrays; it never edits teams, loans or a next lineup.
 * Callers writing statistics must supply their registered-roster predicate.
 * Readers of trusted history may omit it. Real-only global pair statistics
 * continue to use buildRoundSides, not this full guest-inclusive roster. */
export function roundParticipantSides(args: {
  teamA: readonly string[];
  teamB: readonly string[];
  goals: readonly ParticipantGoal[];
  eligible?: (id: string) => boolean;
  maxSide?: number;
}): { teamA: string[]; teamB: string[] } {
  const teamA: string[] = [];
  const teamB: string[] = [];
  const seen = new Set<string>();
  const limit = args.maxSide ?? Infinity;
  const eligible = (id: string | null | undefined): id is string =>
    typeof id === 'string' && id.length > 0 && (!args.eligible || args.eligible(id));
  const add = (id: string | null | undefined, side: string[]) => {
    if (side.length >= limit || !eligible(id) || seen.has(id)) return;
    seen.add(id);
    side.push(id);
  };

  // A current membership wins over a conflicting old event, matching the
  // established real-player restoration rule; nobody earns both results.
  for (const id of args.teamA) add(id, teamA);
  for (const id of args.teamB) add(id, teamB);
  for (const goal of args.goals) {
    if (goal.team !== 'A' && goal.team !== 'B') continue;
    const benefited = goal.team === 'A' ? teamA : teamB;
    const conceded = goal.team === 'A' ? teamB : teamA;
    add(goal.scorerId, goal.ownGoal ? conceded : benefited);
    // Unknown scorers, own goals and self-assists cannot establish an assist.
    if (!goal.ownGoal && eligible(goal.scorerId) && goal.assisterId !== goal.scorerId) {
      add(goal.assisterId, benefited);
    }
  }
  return { teamA, teamB };
}

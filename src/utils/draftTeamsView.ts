// How the "הכוחות שחולקו" record is derived for display, and when it should
// warn that it no longer matches the roster.
//
// This lived inline in MatchDetailsScreen and produced two separate bugs there,
// both from the same cause: the section RENDERED one array and the staleness
// check READ another. Keeping both in one module makes the invariant — the
// check must judge exactly what the user is looking at — impossible to break
// silently, and testable.

export interface SplitTeam {
  index: number;
  captainId: string;
  playerIds: string[];
}

interface DraftTeamsLike {
  teams?: { index: number; captainId?: string; playerIds?: string[] }[];
  originalTeams?: { index: number; captainId?: string; playerIds?: string[] }[];
}

interface RotationLike {
  baseTeams?: { index: number; playerIds?: string[] }[];
}

/**
 * The split AS DIVIDED — the record of how the evening started.
 *
 * Precedence, and why:
 *  1. `originalTeams` — the frozen snapshot. `teams` is the live/working roster
 *     (go-home and permanent-fill mutate it), so it is the wrong thing to show
 *     as "how we split up".
 *  2. `rotation.baseTeams` — older games predate the snapshot but froze the
 *     starting rosters here. `playerIds[0]` is the captain by construction.
 *  3. `teams` — legacy games with neither.
 */
export function resolveSplitTeams(
  draftTeams: DraftTeamsLike | null | undefined,
  rotation?: RotationLike | null,
): SplitTeam[] {
  const norm = (
    t: { index: number; captainId?: string; playerIds?: string[] },
  ): SplitTeam => ({
    index: t.index,
    captainId: t.captainId ?? '',
    playerIds: [...(t.playerIds ?? [])],
  });

  if (draftTeams?.originalTeams?.length) {
    return [...draftTeams.originalTeams].sort((a, b) => a.index - b.index).map(norm);
  }
  if (rotation?.baseTeams?.length) {
    return [...rotation.baseTeams]
      .sort((a, b) => a.index - b.index)
      .map((b) => ({
        index: b.index,
        captainId: b.playerIds?.[0] ?? '',
        playerIds: [...(b.playerIds ?? [])],
      }));
  }
  return (draftTeams?.teams ?? []).map(norm);
}

/**
 * True when a registered player is missing from the split on screen — i.e.
 * somebody signed up after the teams were drawn and the admin should re-balance.
 *
 * Judged against the SAME teams the section renders. Judging it against the live
 * `teams` array counted a player who went home as one who "joined late", so the
 * warning fired on a full, balanced evening.
 */
export function isSplitStale(
  splitTeams: SplitTeam[],
  players: string[] | undefined,
  hasSplit: boolean,
): boolean {
  if (!hasSplit) return false;
  const assigned = new Set(splitTeams.flatMap((t) => t.playerIds));
  return (players ?? []).some((uid) => !assigned.has(uid));
}

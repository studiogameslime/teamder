// teamSlots — the arithmetic behind an empty "מקום פנוי" slot in the live
// rotation, and the one guard on filling it.
//
// WHY THIS EXISTS. A roster that isn't divisible by teams × format size is born
// uneven: 13 players over 3 teams of 5 drafts as 5/4/4, and a cancellation or a
// "הלך הביתה" takes another team down mid-evening. The only manual tool on the
// live screen was "החלפה", which exchanges two players one-for-one — team sizes
// are invariant under it, so no amount of swapping could ever fix a short team.
// The automatic remedy (the "מי מחליף?" picker) is skippable, and once skipped
// the admin was left with a tool that mathematically could not do the job.
//
// An empty slot is the missing half: tapping a player and then a slot MOVES
// them, which is the only interaction that changes a team's size by hand.
//
// Pure and tiny on purpose — the rules are the part worth testing, and the
// components should not each re-derive them.

/**
 * A team may not be emptied out from under the evening.
 *
 * Two, not three: a team of two is a real (if grim) state that an organiser may
 * genuinely be passing through on the way to somewhere better, and blocking it
 * would mean refusing the very rearrangement they opened the mode to perform.
 * One is not a team, and zero deletes it from the rotation.
 */
export const MIN_TEAM_AFTER_MOVE = 2;

/**
 * How many empty slots a team shows: the gap between its roster and the format.
 *
 * `size` is the EFFECTIVE roster — for a team on the pitch that means loans
 * included, so a team completed by a borrowed player offers no slot. It is
 * already full; the shortage lives on the team that lent them out.
 */
export function openSlots(size: number, perTeam: number): number {
  if (!Number.isFinite(size) || !Number.isFinite(perTeam)) return 0;
  return Math.max(0, Math.floor(perTeam) - Math.floor(size));
}

/** Whether the picked player's team can afford to lose them. */
export function canMoveOut(sourceTeamSize: number): boolean {
  return Number.isFinite(sourceTeamSize) && sourceTeamSize > MIN_TEAM_AFTER_MOVE;
}

/**
 * Can this player be moved into this team right now?
 *
 * Both halves have to hold, and they fail for different reasons worth keeping
 * apart: a full target has no slot to tap, while a source at the floor has a
 * slot in front of it that must not accept the drop.
 */
export function canMoveInto(
  sourceTeamSize: number,
  targetTeamSize: number,
  perTeam: number,
): boolean {
  return canMoveOut(sourceTeamSize) && openSlots(targetTeamSize, perTeam) > 0;
}

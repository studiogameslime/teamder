// Which team a returning player rejoins.
//
// Normally his own — the one he left. The case that needed thinking about is
// when that team no longer plays: an emptied team can be retired mid-evening,
// which takes it out of the rotation but deliberately leaves its entry (and
// its colour, and its record) in `draftTeams`.
//
// So "does this team still exist" is the wrong question, and asking it put a
// returning player onto a side that would never take the field again. He then
// appeared nowhere, and neither did his team:
//
//   "הוצאתי את כל הקבוצה של הירוקים ורק הכחולים והאדומים נשארו ועשו משחק.
//    לאחר מכן החזרתי את lioz למחזור והוא לא מופיע עכשיו וגם לא הקבוצה הירוקה."
//
// The right question is whether the team is still IN THE ROTATION. And when it
// is not, the fallback is the smallest side still playing — a player coming
// back should even the evening out, not pile onto whichever team happens to
// sit first in the list.

export interface RestoreTeam {
  index: number;
  playerIds: readonly string[];
}

export interface RestoreRotation {
  playing?: readonly number[];
  waiting?: readonly number[];
}

/**
 * The team index a restored player should land on.
 *
 * `rotation` absent or empty means the evening has not started rotating yet —
 * teams drawn, nothing retired — so every drawn team is still a candidate and
 * the player simply goes home.
 */
export function restoreTargetTeam(
  homeTeam: number,
  teams: readonly RestoreTeam[],
  rotation?: RestoreRotation,
): number {
  const live = new Set<number>([
    ...(rotation?.playing ?? []),
    ...(rotation?.waiting ?? []),
  ]);

  if (live.size === 0) {
    return teams.some((t) => t.index === homeTeam)
      ? homeTeam
      : (teams[0]?.index ?? 0);
  }

  if (live.has(homeTeam)) return homeTeam;

  const smallest = [...live]
    .map((index) => ({
      index,
      size: teams.find((t) => t.index === index)?.playerIds.length ?? 0,
    }))
    // Stable on ties: the lower team index wins, so the choice is repeatable
    // rather than dependent on Set iteration order.
    .sort((a, b) => a.size - b.size || a.index - b.index)[0];

  return smallest?.index ?? teams[0]?.index ?? 0;
}

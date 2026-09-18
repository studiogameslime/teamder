// Is "you are Nth in wins" a fact about this player, or an artefact of the
// tie-break?
//
// Pure, and in its own module, because the whole fact-check lives here: the
// rule that renders the line only sees a number and a place, so nothing
// downstream can catch a place that was decided alphabetically.

/** The leader has to have won something for a podium to mean anything. Mirrors
 *  CROWN_MIN in the rules, which exists for the same reason. */
const PODIUM_MIN_WINS = 3;

/**
 * Seven of the twelve clubs in production with any stat rows have never
 * recorded a single win (`wins` is written only by the
 * mini-game commit path, and the common club runs the plain timer), and in
 * those the podium was `a.uid.localeCompare(b.uid)` — three arbitrary members
 * told they lead a competition that has never been scored.
 */
export function winsPlaceIsFactual(
  byWins: readonly { wins: number }[],
  myWins: number,
  myIndex: number,
): boolean {
  const topWins = byWins[0]?.wins ?? 0;
  return (
    myIndex >= 0 &&
    myWins > 0 &&
    topWins >= PODIUM_MIN_WINS &&
    byWins.filter((r) => r.wins === myWins).length === 1
  );
}

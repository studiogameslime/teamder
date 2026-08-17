// "שער נקי" — the clean-sheet rule, in one place.
//
// A clean sheet is one MINI-GAME whose side finished with nothing conceded,
// credited to every player who counted as a participant in it. It is a TEAM
// outcome, not a claim about who defended: nothing here tries to work out who
// made a tackle, because the app collects no such thing.
//
//   2:0  → one clean sheet to each player on the winning side (one, not two)
//   0:0  → one to everybody on both sides
//   3:1  → nobody
//
// ⚠️ MIRRORED in `commitRoundStats` (functions/src/index.ts §1c-clean) and in
//    scripts/backfill_clean_sheets.py. This module is the canonical spec — the
//    tests here are what the other two are expected to agree with.

/** One mini-game, as the stat path sees it. */
export interface CleanSheetRound {
  /** Participants on side A — already filtered to real, rostered players. */
  sideA: string[];
  sideB: string[];
  /** Goals credited to each side. A missing/negative score means the round has
   *  no usable result and credits nothing. */
  scoreA?: number | null;
  scoreB?: number | null;
}

const usable = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * Which side(s) kept a clean sheet. A side qualifies when the OPPOSING score is
 * zero — so an own goal, which the score credits to the side that benefited,
 * correctly denies the conceding side its clean sheet.
 */
export function cleanSheetSides(round: CleanSheetRound): {
  a: boolean;
  b: boolean;
} {
  // A round with no usable score isn't a result — it must not read as 0:0 and
  // hand both sides a clean sheet for a mini-game that was never played out.
  if (!usable(round.scoreA) || !usable(round.scoreB)) return { a: false, b: false };
  return { a: round.scoreB === 0, b: round.scoreA === 0 };
}

/**
 * Roster id → clean sheets earned in this ONE mini-game: always 0 or 1 per
 * player, however many goals their side scored. A player named on both sides
 * (a malformed payload) is credited once, for side A.
 */
export function cleanSheetCredits(round: CleanSheetRound): Record<string, number> {
  const { a, b } = cleanSheetSides(round);
  const out: Record<string, number> = {};
  if (a) for (const id of round.sideA) if (id) out[id] = 1;
  if (b) for (const id of round.sideB) if (id && out[id] === undefined) out[id] = 1;
  return out;
}

/** Accumulate clean sheets across a whole evening (or any list of rounds). */
export function cleanSheetTotals(
  rounds: CleanSheetRound[],
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const r of rounds) {
    for (const [id, n] of Object.entries(cleanSheetCredits(r))) {
      total[id] = (total[id] ?? 0) + n;
    }
  }
  return total;
}

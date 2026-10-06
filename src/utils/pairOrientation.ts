// Turning a stored pair document into "you" and "them".
//
// `communityPairStats` (and the season archives that mirror it) key everything
// by the LEXICOGRAPHICALLY FIRST uid, not by whoever the screen happens to call
// player A. `winsA` belongs to the uid that sorts first; `assistsAToB` runs
// from that same uid to the other one. Read the fields straight and the two
// players' numbers swap — silently, with no error and no obviously wrong value,
// which is the worst kind of bug a statistics screen can have.
//
// So nothing reads those fields directly. Everything goes through `orientPair`,
// which is pure, takes the two uids in the caller's own order, and hands back
// numbers already labelled from the VIEWER's side.
//
// Pure and import-light on purpose: it is the one piece of this screen that a
// test can pin completely.

import { pairKey, EMPTY_PAIR, type PairTotals } from '@/utils/clubChemistry';

export { pairKey };

/**
 * One pair's record, already turned round to face the viewer.
 *
 * Every field answers a question about `viewerUid` — "how many did YOU win",
 * "how many did YOU set up for them" — so a renderer never has to know that
 * the document underneath is stored in a fixed order.
 */
export interface OrientedPair {
  /** Mini-games the two played on the SAME team. */
  roundsTogether: number;
  winsTogether: number;
  lossesTogether: number;
  /** Everything that was neither a win nor a loss. See `tiesFrom`. */
  tiesTogether: number;
  /** Mini-games their team finished without conceding, both on the pitch. */
  cleanSheetsTogether: number;
  /** Mini-games they played on OPPOSITE teams. */
  roundsAgainst: number;
  /** Head-to-head wins for the VIEWER. */
  winsViewer: number;
  /** Head-to-head wins for the OTHER player. */
  winsOther: number;
  tiesAgainst: number;
  /** Goals the VIEWER set up for the other player. */
  assistsViewerToOther: number;
  /** Goals the other player set up for the VIEWER. */
  assistsOtherToViewer: number;
}

export const EMPTY_ORIENTED: OrientedPair = {
  roundsTogether: 0,
  winsTogether: 0,
  lossesTogether: 0,
  tiesTogether: 0,
  cleanSheetsTogether: 0,
  roundsAgainst: 0,
  winsViewer: 0,
  winsOther: 0,
  tiesAgainst: 0,
  assistsViewerToOther: 0,
  assistsOtherToViewer: 0,
};

/**
 * Draws, derived rather than stored.
 *
 * Nothing counts ties on a pair: a mini-game that ended level credits neither
 * `winsTogether` nor `lossesTogether`, and neither `winsA` nor `winsB`. What is
 * left over after both is exactly the drawn games — the same derivation the
 * player card has used since the row was written.
 *
 * Floored at zero. The subtraction can only go negative if the stored counters
 * disagree with each other, and a negative number of draws is worse than a
 * missing one.
 */
function tiesFrom(total: number, won: number, lost: number): number {
  return Math.max(0, total - won - lost);
}

/**
 * Read a stored pair document from the viewer's side.
 *
 * `viewerUid` and `otherUid` are the caller's own order — whoever the screen
 * calls A and B. The document's internal order is resolved here and nowhere
 * else.
 */
export function orientPair(
  viewerUid: string,
  otherUid: string,
  totals: PairTotals | null | undefined,
): OrientedPair {
  const t = totals ?? EMPTY_PAIR;
  // Which of the two the document calls "a". Everything suffixed A belongs to
  // this one — `winsA`, and the FROM side of `assistsAToB`.
  const viewerIsFirst = [viewerUid, otherUid].sort()[0] === viewerUid;

  const winsViewer = viewerIsFirst ? t.winsA : t.winsB;
  const winsOther = viewerIsFirst ? t.winsB : t.winsA;
  const assistsViewerToOther = viewerIsFirst ? t.assistsAToB : t.assistsBToA;
  const assistsOtherToViewer = viewerIsFirst ? t.assistsBToA : t.assistsAToB;

  return {
    // Symmetric counters — the same number whichever way round you ask.
    roundsTogether: t.sameTeam,
    winsTogether: t.winsTogether,
    lossesTogether: t.lossesTogether,
    tiesTogether: tiesFrom(t.sameTeam, t.winsTogether, t.lossesTogether),
    cleanSheetsTogether: t.cleanSheetsTogether,
    roundsAgainst: t.against,
    // Directional — the four that make this function necessary.
    winsViewer,
    winsOther,
    tiesAgainst: tiesFrom(t.against, winsViewer, winsOther),
    assistsViewerToOther,
    assistsOtherToViewer,
  };
}

/**
 * Win rate, with draws OUT of the denominator.
 *
 * The app has computed it this way everywhere since the compare card was
 * written (`playerCompareService`), and the two screens merging here must not
 * start disagreeing about what a percentage means. A pair with no decided
 * mini-game has no rate — `null`, never 0, because 0% is a claim about a team
 * that lost and this one has not played.
 */
export function winPct(wins: number, losses: number): number | null {
  const decided = wins + losses;
  if (decided <= 0) return null;
  return Math.round((wins / decided) * 100);
}

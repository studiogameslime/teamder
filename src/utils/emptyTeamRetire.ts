// A team that emptied out mid-evening, and whether the rotation should carry
// on without it.
//
// The situation, from a real evening: fifteen players in three teams of five,
// then five people go home. Everyone who leaves is removed from their team, so
// one team can end up with nobody in it — and the rotation still has that team
// queued. Finish the current mini-game and an EMPTY team is brought on, at
// which point the fill logic offers to borrow five players into it. That is the
// moment the team statistics break: people start collecting wins under a shirt
// they never wore.
//
// The engine already handles the end state correctly — `recordWinner` keeps the
// same two teams playing when nothing is waiting — so the only thing missing is
// taking the empty team OUT of the queue.
//
// Deliberately NOT automatic. Dropping a team from the evening on our own
// initiative is the kind of decision that looks obvious to code and presumptuous
// to a person standing on a pitch: maybe those five are coming back, maybe the
// admin is mid-reshuffle. So this module only ever ANSWERS "is there an empty
// team waiting, and what is it called" — the screen asks, and the admin decides.

import { teamName, type TeamLike } from '@/utils/teamIdentity';

export interface RotationLike {
  playing: readonly [number, number] | readonly number[];
  waiting: readonly number[];
}

export interface TeamRosterLike extends TeamLike {
  playerIds: readonly string[];
}

/**
 * Waiting teams with nobody left on them.
 *
 * Only WAITING teams. A team that is on the pitch right now cannot be dropped
 * mid-mini-game without erasing a result in progress — if the side that emptied
 * is playing, the admin ends the round first and the question comes up then.
 *
 * Loans are ignored on purpose: a borrowed player is on someone else's team for
 * a stint and does not make his home team non-empty.
 */
export function emptyWaitingTeams(
  rotation: RotationLike | null | undefined,
  teams: readonly TeamRosterLike[] | null | undefined,
): number[] {
  if (!rotation || !teams) return [];
  return rotation.waiting.filter((idx) => {
    const t = teams.find((x) => x.index === idx);
    return !!t && t.playerIds.length === 0;
  });
}

/** The teams still carrying players — what the evening would continue as. */
export function remainingTeams(
  rotation: RotationLike | null | undefined,
  teams: readonly TeamRosterLike[] | null | undefined,
  dropping: number,
): number[] {
  if (!rotation || !teams) return [];
  const inPlay = [...rotation.playing, ...rotation.waiting];
  return inPlay.filter((i) => i !== dropping);
}

/**
 * The question to put to the admin, in the evening's real colours.
 *
 * Reads as "הקבוצה של האדומים ריקה — להמשיך לשחק רק הכחולים והירוקים?" using
 * whatever colours this evening actually chose, never א׳/ב׳/ג׳.
 */
export function retirePrompt(
  dropping: number,
  remaining: readonly number[],
  teams: readonly TeamLike[],
): { title: string; body: string } {
  const gone = teamName(dropping, teams);
  const names = remaining.map((i) => teamName(i, teams));
  // "הכחולים והירוקים" — the ו attaches to the definite name and KEEPS its ה.
  // (Only ל / ב / כ absorb it, which is what teamNameAfterPreposition is for.)
  const list =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`;
  return {
    title: `${gone} נשארו בלי שחקנים`,
    // Fewer than two sides left is not a shorter evening, it is no evening —
    // say that instead of offering to continue with one team.
    body:
      names.length >= 2
        ? `כולם הלכו הביתה. להמשיך את הערב רק עם ${list}?`
        : 'כולם הלכו הביתה. לא נשארו מספיק קבוצות כדי להמשיך.',
  };
}

/** The rotation queue without the retired team. */
export function withoutTeam(
  rotation: RotationLike,
  dropping: number,
): { waiting: number[] } {
  return { waiting: rotation.waiting.filter((i) => i !== dropping) };
}

/**
 * Can the evening still be played after dropping this team?
 *
 * Two teams is a real format — they simply play each other repeatedly, which is
 * what `recordWinner` already does with an empty queue. One is not.
 */
export function canContinueWithout(
  rotation: RotationLike | null | undefined,
  teams: readonly TeamRosterLike[] | null | undefined,
  dropping: number,
): boolean {
  return (
    remainingTeams(rotation, teams, dropping).filter((i) => {
      const t = teams?.find((x) => x.index === i);
      return !!t && t.playerIds.length > 0;
    }).length >= 2
  );
}

// seasonService — the three admin actions on a club's seasons.
//
// All three are callables and none of them is a plain document write, which is
// why seasons are not part of the club settings form. Switching seasons on can
// CLOSE the club's history into season 1, and ending a season archives and
// zeroes every stat row in the club. Decisions like that belong to the server,
// which knows what the numbers mean; the client's job is to ask, and to report
// the refusal in words a person can act on.

import { httpsCallable } from 'firebase/functions';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { he } from '@/i18n/he';

/** Why the server said no. Anything else is a real failure. */
export type SeasonRefusal =
  | 'openGame'
  | 'unsealedGame'
  | 'seasonsOff'
  | 'notAdmin'
  | 'targetBehind'
  | 'nothingToReopen'
  | 'closedSeasonGame'
  | 'unknown';

export class SeasonRefusedError extends Error {
  reason: SeasonRefusal;
  /** The number the server refused against, when it named one. Carried because
   *  "the target is already behind the club" is unanswerable without it — and
   *  the screen it appears on does not show the season's progress anywhere
   *  else, so the admin had nothing at all to go on. */
  played?: number;
  constructor(reason: SeasonRefusal, played?: number) {
    super(reason);
    this.name = 'SeasonRefusedError';
    this.reason = reason;
    if (typeof played === 'number') this.played = played;
  }
}

/** The refusals worth wording carefully — a club mid-evening must not be told
 *  "something went wrong" when the answer is "finish tonight first". */
export function seasonRefusalText(
  reason: SeasonRefusal,
  /** The figure the server refused against, when it named one. */
  played?: number,
): string {
  switch (reason) {
    case 'openGame':
      return he.seasonBlockedOpenGame;
    case 'unsealedGame':
      return he.seasonBlockedUnsealed;
    case 'seasonsOff':
      return he.seasonBlockedOff;
    case 'targetBehind':
      return typeof played === 'number'
        ? he.seasonBlockedTargetBehindAt(played)
        : he.seasonBlockedTargetBehind;
    case 'nothingToReopen':
      return he.seasonBlockedNothingToReopen;
    case 'closedSeasonGame':
      return he.seasonBlockedClosedGame;
    case 'notAdmin':
      return he.seasonBlockedNotAdmin;
    default:
      return he.seasonActionFailed;
  }
}

function refusalOf(err: unknown): SeasonRefusal | null {
  const e = err as { code?: string; message?: string };
  const code = String(e?.code ?? '');
  if (code === 'functions/permission-denied') return 'notAdmin';
  if (code !== 'functions/failed-precondition') return null;
  const msg = String(e?.message ?? '');
  if (msg.includes('openGame')) return 'openGame';
  if (msg.includes('unsealedGame')) return 'unsealedGame';
  if (msg.includes('seasons are off')) return 'seasonsOff';
  if (msg.includes('no closed season') || msg.includes('no archive')) {
    return 'nothingToReopen';
  }
  if (msg.includes('closedSeasonGame')) return 'closedSeasonGame';
  // The server refuses a target the club has already passed, because saving it
  // would close the season on the spot — "end it now" without the confirmation
  // that action carries. Falling through to the generic line told an admin to
  // "try again in a moment", which would never work.
  if (msg.includes('is not above the') || msg.includes('end date is in the past')) {
    return 'targetBehind';
  }
  return 'unknown';
}

/** `target 10 is not above the 14 rounds already played` → 14. The server has
 *  always computed this and put it in the message; nothing read it back. */
export function playedFromError(err: unknown): number | undefined {
  const msg = String((err as { message?: string })?.message ?? '');
  const m = /is not above the (\d+)/.exec(msg);
  return m ? Number(m[1]) : undefined;
}

async function call<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const { functions } = getFirebase();
  const fn = httpsCallable(functions, name);
  try {
    // Same cold-start auth race every other callable here guards against.
    const res = await withAuthRaceRetry(() => fn(payload));
    return res.data as T;
  } catch (err) {
    const refusal = refusalOf(err);
    if (refusal) throw new SeasonRefusedError(refusal, playedFromError(err));
    logError(name, err, { groupId: String(payload.groupId ?? '') });
    throw err;
  }
}

export interface EnableSeasonsArgs {
  groupId: string;
  /** `date` ends the season on a deadline; `rounds` when a round count is hit. */
  cadenceType: 'date' | 'rounds';
  /** What to do with the club's existing history: carry season 1 on, or seal
   *  it now and open season 2. Only meaningful on the first enable. */
  historyChoice?: 'continue' | 'sealNow';
  /** The last day of season 1, when carrying it on under a date cadence — it
   *  holds the whole history, so there is no start date to compute. */
  season1EndsOn?: string;
  /** For `date`. */
  months?: number;
  /** For `rounds` — the season's TOTAL finished rounds, not a remainder. */
  targetRounds?: number;
  /**
   * Seal everything played so far as season 1 and start season 2 clean.
   *
   * The alternative — continuing — counts the club's whole history as the
   * running season. Neither is wrong, which is exactly why the admin is asked
   * rather than defaulted.
   */
  closeFirstNow?: boolean;
}

export const seasonService = {
  async enable(args: EnableSeasonsArgs): Promise<void> {
    if (USE_MOCK_DATA) return;
    await call('enableClubSeasons', { ...args });
  },

  /**
   * Switch seasons off. Does NOT close the running season — that is a separate,
   * deliberate action. Numbering survives, so re-enabling opens the next one.
   */
  async disable(groupId: string): Promise<void> {
    if (USE_MOCK_DATA) return;
    await call('disableClubSeasons', { groupId });
  },

  /** Move the finish line. The server refuses a target already behind the club
   *  — that would close the season on save, which is "end it now" in disguise. */
  async updateTarget(args: {
    groupId: string;
    cadenceType: 'date' | 'rounds';
    months?: number;
    targetRounds?: number;
  }): Promise<void> {
    if (USE_MOCK_DATA) return;
    await call('updateSeasonTarget', { ...args });
  },

  /**
   * Undo the last close. Restores the table, takes the titles back off the
   * winners, and deletes the archive — only for the most recent season, and
   * only while the club is quiet.
   */
  async reopenLast(groupId: string): Promise<{ reopenedNo: number }> {
    if (USE_MOCK_DATA) return { reopenedNo: 1 };
    return call<{ reopenedNo: number }>('reopenLastSeason', { groupId });
  },

  /** End it now. Archives, awards, zeroes — and pushes every player their card. */
  async endNow(groupId: string): Promise<{ closedNo: number }> {
    if (USE_MOCK_DATA) return { closedNo: 1 };
    return call<{ closedNo: number }>('endSeasonNow', { groupId });
  },
};

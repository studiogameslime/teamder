// assistantInsightsService — the club-shaped facts behind the coach's messages.
//
// Everything else the coach reasons about (next match, played-this-week,
// availability, lifetime stats) already sits in the home screen's state. Where
// you STAND in your club does not, and that's where the best lines come from —
// "two goals off the club's golden boot", "seven nights in a row". So this is
// the one place the assistant is allowed to fetch, and both halves sit behind
// caches sized to how expensive they are (see the read-cost note below).
//
// WHY A SEPARATE SCORER RANKING: the club table itself ranks by wins first,
// then goals. Saying "two goals and you pass דניאל" against THAT ordering
// would be false — two goals wouldn't move you past someone ahead on wins. So
// the rows are re-sorted by goals (and separately by assists) here, and every
// claim is made about the table it's actually true in.
//
// Any field may be null. Null means "we don't know", and a null is always
// better than a guess: the rule that wanted it simply stays quiet.

import { gameService } from '@/services/gameService';
import { userService } from '@/services';
import { logError } from '@/services/errorLog';
import type { GroupId, UserId } from '@/types';

export interface ClubInsight {
  /** Goals this player has scored THROUGH this club. */
  goals: number;
  assists: number;
  /** 1-based place in the club's scorer ranking. */
  scorerPlace: number;
  scorerTotal: number;
  /** True when nobody in the club has more goals. */
  isTopScorer: boolean;
  /** Goals needed to take the club's scoring crown. Null when already top. */
  goalsToCrown: number | null;
  /** True when nobody in the club has more assists. */
  isTopAssister: boolean;
  /** Assists needed to top the club's assist chart. Null when already top. */
  assistsToCrown: number | null;
  /** The player one place above in the SCORER table. */
  rivalName: string | null;
  /** Goals needed to pass that rival. */
  goalsToPassRival: number | null;
  /** Current run of consecutive attended nights at this club. */
  attendanceStreak: number;
  /** Nights attended at this club. */
  attendedNights: number;
  /** Club-wide wins ranking place (1-based), for the "most winning" line. */
  winsPlace: number | null;
}

// ── Read cost ────────────────────────────────────────────────────────────
// The two halves cost very different amounts, so they're cached separately:
//
//   • the club TABLE is one query over `communityPlayerStats` — roughly one
//     doc per member. Cheap, and it moves whenever ANY member scores, so a
//     30-minute window keeps it current.
//
//   • the ATTENDANCE scan reads up to 200 game docs. That is far too heavy to
//     repeat on a screen the user opens all day, and it cannot change unless
//     THIS user plays another match — so it is keyed on `lastPlayedMs` and
//     then held for the session. Playing a match changes the key and the
//     streak refreshes by itself; nothing else can move it.
//
// Without the split, the coach's "7 nights in a row" line would have cost a
// 200-document scan every half hour, per user, forever.
const TABLE_TTL_MS = 30 * 60 * 1000;
// A streak CAN break without this user playing: the club plays a night they
// miss. That doesn't move `lastPlayedMs`, so the key alone would keep serving
// "you're on a 7-night run" long after it ended. The key avoids re-reading 200
// docs on every open; this ceiling stops a stale boast from living forever.
const ATTENDANCE_TTL_MS = 6 * 60 * 60 * 1000;

let tableCache: {
  at: number;
  key: string;
  value: Awaited<ReturnType<typeof gameService.getCommunityChampionship>> | null;
} | null = null;
let attendanceCache: {
  at: number;
  key: string;
  value: { streak: number; nights: number };
} | null = null;
// The rival's display name — one /users read, and userService has no cache of
// its own, so without this it fired on every home focus even with both data
// caches warm.
let rivalCache: { key: string; uid: string; name: string | null } | null = null;
// Keyed by the exact request. An unkeyed promise meant the first call (fired
// before `lastPlayedMs` had loaded, so it skipped the attendance scan) was
// handed back to the second call that DID have it — and the streak silently
// stayed 0 until the next focus.
let inFlight: { key: string; p: Promise<ClubInsight | null> } | null = null;

/** Drop both caches (pull-to-refresh). */
export function invalidateAssistantInsights(): void {
  tableCache = null;
  attendanceCache = null;
  rivalCache = null;
}

export const assistantInsightsService = {
  async getClubInsight(
    userId: UserId,
    groupId: GroupId,
    /** The user's most recent played match. Keys the attendance cache — see
     *  the read-cost note above. Omit and the attendance scan is skipped
     *  entirely (the streak/loyalty lines simply stay quiet). */
    lastPlayedMs?: number | null,
  ): Promise<ClubInsight | null> {
    if (!userId || !groupId) return null;
    const key = `${userId}__${groupId}`;
    const attendanceKey = `${key}__${lastPlayedMs ?? 'none'}`;
    const now = Date.now();
    const tableFresh =
      tableCache && tableCache.key === key && now - tableCache.at < TABLE_TTL_MS;
    const attendanceFresh =
      attendanceCache &&
      attendanceCache.key === attendanceKey &&
      now - attendanceCache.at < ATTENDANCE_TTL_MS;
    if (inFlight && inFlight.key === attendanceKey) return inFlight.p;
    const p = (async () => {
      try {
        const champ = tableFresh
          ? tableCache!.value
          : await gameService.getCommunityChampionship(groupId);
        if (!tableFresh) tableCache = { at: Date.now(), key, value: champ };
        if (!champ) return null;

        // Only pay for the 200-doc attendance scan when we don't already hold
        // a result for this exact "last played" moment.
        let attendance = attendanceFresh ? attendanceCache!.value : null;
        if (!attendance && lastPlayedMs != null) {
          const stats = await gameService
            .getCommunityStats(groupId)
            .catch(() => null);
          attendance = {
            streak: stats?.currentStreakByUser?.[userId] ?? 0,
            nights: stats?.attendedByUser?.[userId] ?? 0,
          };
          attendanceCache = { at: Date.now(), key: attendanceKey, value: attendance };
        }
        const rows = champ.players.filter((p) => p.uid);
        const mine = rows.find((p) => p.uid === userId);
        // Not in the club table at all → nothing club-shaped to say.
        if (!mine) return null;

        const byGoals = [...rows].sort(
          (a, b) => b.goals - a.goals || a.uid.localeCompare(b.uid),
        );
        const byAssists = [...rows].sort(
          (a, b) => b.assists - a.assists || a.uid.localeCompare(b.uid),
        );
        const byWins = [...rows].sort(
          (a, b) => b.wins - a.wins || a.uid.localeCompare(b.uid),
        );

        const scorerIdx = byGoals.findIndex((p) => p.uid === userId);
        const assistIdx = byAssists.findIndex((p) => p.uid === userId);
        const winsIdx = byWins.findIndex((p) => p.uid === userId);

        const topGoals = byGoals[0]?.goals ?? 0;
        const topAssists = byAssists[0]?.assists ?? 0;
        // "Top" only counts when there's something to be top OF — a club where
        // nobody has scored has no golden boot to award.
        // SOLE leader only. On a tie `>=` crowned every tied player "מלך
        // השערים", and suppressed the chase line for all of them at once.
        const soleTop = (
          sorted: typeof rows,
          pick: (r: (typeof rows)[number]) => number,
        ) => {
          const top = pick(sorted[0]);
          return top > 0 && sorted.filter((r) => pick(r) === top).length === 1;
        };
        const isTopScorer =
          mine.goals > 0 && mine.goals === topGoals && soleTop(byGoals, (r) => r.goals);
        const isTopAssister =
          mine.assists > 0 &&
          mine.assists === topAssists &&
          soleTop(byAssists, (r) => r.assists);

        // The rival one place up in the scorer table, when the gap is real.
        let rivalName: string | null = null;
        let goalsToPassRival: number | null = null;
        const rival = scorerIdx > 0 ? byGoals[scorerIdx - 1] : null;
        if (rival && rival.goals - mine.goals > 0) {
          const gap = rival.goals - mine.goals;
          if (rivalCache && rivalCache.key === key && rivalCache.uid === rival.uid) {
            rivalName = rivalCache.name;
          } else {
            const u = await userService.getUserById(rival.uid).catch(() => null);
            rivalName = (u?.name ?? '').trim().split(/\s+/)[0] || null;
            rivalCache = { key, uid: rival.uid, name: rivalName };
          }
          if (rivalName) goalsToPassRival = gap;
        }

        const value: ClubInsight = {
          goals: mine.goals,
          assists: mine.assists,
          scorerPlace: scorerIdx + 1,
          scorerTotal: byGoals.length,
          isTopScorer,
          goalsToCrown:
            !isTopScorer && topGoals > mine.goals ? topGoals - mine.goals : null,
          isTopAssister,
          assistsToCrown:
            !isTopAssister && topAssists > mine.assists
              ? topAssists - mine.assists
              : null,
          rivalName,
          goalsToPassRival,
          attendanceStreak: attendance?.streak ?? 0,
          attendedNights: attendance?.nights ?? 0,
          winsPlace: winsIdx >= 0 ? winsIdx + 1 : null,
        };
        return value;
      } catch (err) {
        logError('assistantClubInsight', err, { userId, groupId });
        return null;
      } finally {
        inFlight = null;
      }
    })();
    inFlight = { key: attendanceKey, p };
    return p;
  },
};

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
import { winsPlaceIsFactual } from '@/utils/assistant/winsPlace';

export interface ClubInsight {
  /** Goals this player has scored THROUGH this club. */
  goals: number;
  assists: number;
  /** 1-based place in the club's scorer ranking. 0 when the player has no row
   *  in the club table at all — see the empty-table branch below. */
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
  /** Club-wide wins ranking place (1-based), for the "most winning" line.
   *
   *  Null unless the placing is a FACT about this player rather than an
   *  artefact of the sort's tie-break — the gate lives with the numbers, in
   *  the wins block below, because the place alone cannot carry it. */
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
// Mirrors CROWN_MIN in the assistant rules: the wins podium is a crown like any
// other, and one win is no more a title in week one of a season than one goal
// is. Kept here rather than imported because it guards the DATA — the place is
// simply not reported below this line, so no future rule can print it either.


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

        const rows = champ.players.filter((p) => p.uid);
        const mine = rows.find((p) => p.uid === userId) ?? null;
        // A missing row used to end the function right here — and it ended it
        // AFTER the 200-doc scan below had already been paid for. Both halves
        // of that were wrong, in opposite directions.
        //
        //   • The club table IS the running season once a club runs seasons,
        //     and a close zeroes communityPlayerStats. Zeroed rows then fail
        //     the championship's "has anything happened" filter, so
        //     `champ.players` comes back EMPTY and nobody has a row — which
        //     silenced every club-shaped line the coach owns (the streak, "N
        //     ערבים על הדשא", the standing, both crowns, the rivalry, the
        //     game-day stake) for the whole club, from the close until its
        //     next sealed evening. On the one club that has run seasons that
        //     is seven members with a 22-night history and nothing to say
        //     about it: all 7 rows read {goals:0, wins:0, games:0, rounds:0}.
        //   • And when the table is NOT empty and this player simply isn't in
        //     it, he has no history at this club for the scan to find — yet we
        //     read 200 game docs to discover that, every 6h, per user.
        //
        // So the two cases are separated: no row in a table that HAS rows is a
        // stranger to the club (quiet, and no scan); no row because the table
        // itself is empty says nothing about the player, so the attendance
        // half gets its chance to speak.
        if (!mine && rows.length > 0) return null;

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
        // Empty table AND nothing on the pitch either (or no `lastPlayedMs`, so
        // we never looked): an insight of nothing but zeros is a guess dressed
        // as a fact, and a null is always better than a guess.
        if (!mine && !(attendance && (attendance.nights > 0 || attendance.streak > 0))) {
          return null;
        }
        // My own numbers. All zero on the empty-table path — which every rule
        // downstream already reads as "stay quiet", so the table-shaped lines
        // hold their tongue while the attendance ones speak.
        const myGoals = mine?.goals ?? 0;
        const myAssists = mine?.assists ?? 0;
        const myWins = mine?.wins ?? 0;

        const byGoals = [...rows].sort(
          (a, b) => b.goals - a.goals || a.uid.localeCompare(b.uid),
        );
        const byAssists = [...rows].sort(
          (a, b) => b.assists - a.assists || a.uid.localeCompare(b.uid),
        );
        const byWins = [...rows].sort(
          (a, b) => b.wins - a.wins || a.uid.localeCompare(b.uid),
        );

        const scorerIdx = mine ? byGoals.findIndex((p) => p.uid === userId) : -1;
        const winsIdx = mine ? byWins.findIndex((p) => p.uid === userId) : -1;

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
          // `rows` can now be empty — that is the whole point of the branch
          // above — and the callers only happen to short-circuit before they
          // reach here. Don't leave that to luck: an empty table has no top.
          const head = sorted[0];
          if (!head) return false;
          const top = pick(head);
          return top > 0 && sorted.filter((r) => pick(r) === top).length === 1;
        };
        const isTopScorer =
          myGoals > 0 && myGoals === topGoals && soleTop(byGoals, (r) => r.goals);
        const isTopAssister =
          myAssists > 0 &&
          myAssists === topAssists &&
          soleTop(byAssists, (r) => r.assists);

        // ── the wins podium ──
        //
        // `wins` is written ONLY by the mini-game commit path — onGameRosterChanged
        // increments `games` alone — so a timer-only club, which is the common
        // club, sits at 0 wins for every season it will ever play. `byWins` then
        // falls through to its `a.uid.localeCompare(b.uid)` tie-break and hands
        // places 1-3 to whoever is alphabetically first by user id, and the rule
        // downstream had no value gate of its own: seven of the twelve clubs
        // with any stat rows were in exactly that state (sEj71nwAJGpxX8oh4KlF:
        // 15 rows, 15 games, 0 wins between them), and three arbitrary members
        // of each were being told they lead a competition nobody has ever
        // scored — one of them with "אתה השחקן עם הכי הרבה ניצחונות".
        //
        // So the place is reported only where it is a fact about the player:
        //   • he has actually won something — with 0 wins the place is purely
        //     the alphabet, whatever the rest of the table looks like;
        //   • the podium is worth naming at all, held to the same minimum as
        //     the golden boot, for the same "a crown needs something to have
        //     happened first" reason;
        //   • and the place is HIS, not one the tie-break lent him. The first
        //     version of this guarded only place 1 — `winsIdx > 0 || soleTop`
        //     — which moved the alphabet one rank down instead of removing it.
        //     Club jDIPM1jrtvBFRoavAAKm in production is the proof: 16 rows,
        //     wins [3,3,2,2,2,2,2,2,2,2,…]. Place 1 was correctly silenced
        //     (two players on 3), place 2 went to the OTHER player on 3 —
        //     joint top, told he is second — and place 3 went to whichever of
        //     the EIGHT players on 2 wins sorts first by uid, while the seven
        //     club-mates with an identical record were told nothing. The copy
        //     is "אתה מקום 3 בניצחונות", a definite claim about one person, so
        //     the honest test is the same at every rank: nobody else in the
        //     club has this number. That subsumes the sole-lead check for
        //     place 1 and is strictly narrower than what it replaces — it can
        //     only ever suppress a line, never add one.
        // Anything else is null, which the rule already reads as "stay quiet".
        const winsPlaceIsFact = winsPlaceIsFactual(byWins, myWins, winsIdx);

        // The rival one place up in the scorer table, when the gap is real.
        let rivalName: string | null = null;
        let goalsToPassRival: number | null = null;
        const rival = scorerIdx > 0 ? byGoals[scorerIdx - 1] : null;
        if (rival && rival.goals - myGoals > 0) {
          const gap = rival.goals - myGoals;
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
          goals: myGoals,
          assists: myAssists,
          scorerPlace: scorerIdx + 1,
          scorerTotal: byGoals.length,
          isTopScorer,
          goalsToCrown:
            !isTopScorer && topGoals > myGoals ? topGoals - myGoals : null,
          isTopAssister,
          assistsToCrown:
            !isTopAssister && topAssists > myAssists
              ? topAssists - myAssists
              : null,
          rivalName,
          goalsToPassRival,
          attendanceStreak: attendance?.streak ?? 0,
          attendedNights: attendance?.nights ?? 0,
          winsPlace: winsPlaceIsFact ? winsIdx + 1 : null,
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

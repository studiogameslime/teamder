// trustService — derives a single 0-100 reliability score per user
// from objective game-history signals.
//
// Replaces the old yellow/red discipline-card UI. The underlying
// events on /users/{uid}.discipline still get logged by the
// `onGameRosterChanged` Cloud Function trigger, but the player-facing
// surface now shows a single number + visual meter rather than two
// separate counters.
//
// Inputs (all from a 90-day rolling window of past terminal games):
//
//   attendanceRate = attended / registered
//     • registered: was in `players[]` at game-end on a FINISHED game
//                   (admin-cancelled games don't count — not the
//                   user's responsibility)
//     • attended:   registered AND `arrivals[uid] !== 'no_show'`
//
//   softCancels: cancellations[uid] timestamp <= deadline cutoff
//     • the user cancelled BEFORE the admin's deadline (responsible
//       behaviour, but still moved the admin's logistics — small
//       penalty)
//
//   hardCancels: cancellations[uid] timestamp > deadline cutoff
//     • the user cancelled AFTER the deadline — game already
//       balanced, hard for admin to find a replacement
//
// Formula:
//   score = round(attendanceRate * 100) - softCancels*3 - hardCancels*10
//   clamped to 0..100
//
//   if registered < MIN_GAMES_FOR_SCORE: null (caller renders "new")
//
// Tunable constants below — kept inline rather than in env / Firestore
// config so the formula is auditable and reproducible. Adjust here
// after observing real data.

import { getDocs, query, where } from 'firebase/firestore';
import { ArrivalStatus, Game, UserId } from '@/types';
import { USE_MOCK_DATA } from '@/firebase/config';
import { col } from '@/firebase/firestore';
import { mockGamesV2 } from '@/data/mockData';

// ── Tunables ─────────────────────────────────────────────────────────────
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Below this many qualifying games, the score is `null` (caller
 *  renders the "🆕 חדש" chip — too little data to be meaningful). */
const MIN_GAMES_FOR_SCORE = 3;
const SOFT_CANCEL_PENALTY = 3;
const HARD_CANCEL_PENALTY = 10;

// ── Public API ───────────────────────────────────────────────────────────

export type TrustTier = 'new' | 'low' | 'basic' | 'good' | 'excellent';

export interface TrustSummary {
  /** 0-100, or null when there's insufficient data. */
  score: number | null;
  tier: TrustTier;
  /** Inputs used to compute the score, exposed for the drill-down UI. */
  breakdown: {
    /** Games where user was in players[] on a FINISHED game. */
    registered: number;
    /** Of those, the ones where arrivals[uid] !== 'no_show'. */
    attended: number;
    softCancels: number;
    hardCancels: number;
    /** Total games inspected (any terminal status, user involved). */
    gamesEvaluated: number;
  };
}

/**
 * Deterministic helper — same input, same output. Pure given the
 * games array. Used by the live computation path AND by tests.
 */
export function computeTrustFromGames(
  userId: UserId,
  games: Game[],
  now: number = Date.now(),
): TrustSummary {
  const cutoff = now - WINDOW_MS;

  let registered = 0;
  let attended = 0;
  let softCancels = 0;
  let hardCancels = 0;
  let gamesEvaluated = 0;

  for (const g of games) {
    // Window filter: only past games inside the 90d look-back.
    const startsAt =
      typeof g.startsAt === 'number' ? g.startsAt : null;
    if (startsAt === null) continue;
    if (startsAt < cutoff) continue;
    if (startsAt >= now) continue;
    if (g.status !== 'finished' && g.status !== 'cancelled') continue;
    gamesEvaluated += 1;

    // Cancellations apply regardless of game status. Compute first
    // so we can also avoid double-counting attendance for someone
    // who cancelled.
    const cancelTs = g.cancellations?.[userId];
    if (typeof cancelTs === 'number') {
      const deadline =
        typeof g.cancelDeadlineHours === 'number'
          ? startsAt - g.cancelDeadlineHours * HOUR_MS
          : null;
      if (deadline !== null && cancelTs > deadline) {
        hardCancels += 1;
      } else {
        // Either no deadline configured (treat any cancellation as
        // soft — the admin didn't set a hard rule) or before the
        // deadline. Both → soft.
        softCancels += 1;
      }
      continue;
    }

    // Game-cancelled (admin abandoned the evening): doesn't count
    // toward attendance — the user wasn't asked to attend.
    if (g.status !== 'finished') continue;

    // Attendance only applies if the user was in the final players[].
    const inPlayers = (g.players ?? []).includes(userId);
    if (!inPlayers) continue;
    registered += 1;
    const arrivalsMap = (g.arrivals ?? {}) as Record<UserId, ArrivalStatus>;
    const arrival = arrivalsMap[userId];
    if (arrival !== 'no_show') {
      attended += 1;
    }
  }

  if (registered < MIN_GAMES_FOR_SCORE) {
    return {
      score: null,
      tier: 'new',
      breakdown: {
        registered,
        attended,
        softCancels,
        hardCancels,
        gamesEvaluated,
      },
    };
  }

  const attendanceRate = attended / registered;
  const raw =
    Math.round(attendanceRate * 100) -
    softCancels * SOFT_CANCEL_PENALTY -
    hardCancels * HARD_CANCEL_PENALTY;
  const score = Math.max(0, Math.min(100, raw));

  return {
    score,
    tier: tierForScore(score),
    breakdown: {
      registered,
      attended,
      softCancels,
      hardCancels,
      gamesEvaluated,
    },
  };
}

/** Map a numeric score to a 5-tier label. `null` → 'new'. */
export function tierForScore(score: number | null): TrustTier {
  if (score === null) return 'new';
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'basic';
  return 'low';
}

export const trustService = {
  /**
   * Live computation against Firestore (or mock data). Loads the
   * user's recent games and runs the pure helper. Network failures
   * propagate — the component renders a skeleton in that case.
   */
  async getSummary(userId: UserId): Promise<TrustSummary> {
    if (!userId) {
      return {
        score: null,
        tier: 'new',
        breakdown: {
          registered: 0,
          attended: 0,
          softCancels: 0,
          hardCancels: 0,
          gamesEvaluated: 0,
        },
      };
    }
    const games: Game[] = USE_MOCK_DATA
      ? mockGamesV2.map((g) => ({ ...g, matches: [] }) as Game)
      : await (async () => {
          const snap = await getDocs(
            query(
              col.games(),
              where('participantIds', 'array-contains', userId),
            ),
          );
          return snap.docs.map(
            (d) => ({ ...d.data(), matches: [] }) as Game,
          );
        })();
    return computeTrustFromGames(userId, games);
  },
};

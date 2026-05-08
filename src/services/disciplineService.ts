// disciplineService — issue / revoke yellow & red cards.
//
// Phase 4 rules (auto-issued from "I'm late"):
//   minutesLate >  5 && <= 60  → yellow, reason='late'
//   minutesLate >  60          → red,    reason='late'
//
// Coaches can also override manually (issue or revoke a card) from the
// Player Card. Reason for those is 'manual'. There's no suspension /
// auto-ban logic in v1 — these counters are purely a record.
//
// Storage: lifetime counters + last MAX_EVENTS events live on
// /users/{uid}.discipline. We don't write to the game doc — discipline
// review happens via the user's own card history.

import {
  getDocs,
  increment,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  DisciplineCardType,
  DisciplineEvent,
  DisciplineReason,
  Game,
  User,
  UserDisciplineState,
  UserId,
  defaultDisciplineState,
} from '@/types';
import { USE_MOCK_DATA } from '@/firebase/config';
import { col, docs } from '@/firebase/firestore';
import { mockGamesV2 } from '@/data/mockData';
import { storage } from './storage';
import { AnalyticsEvent, logEvent } from './analyticsService';

/** Minutes past kickoff at which a yellow becomes a red. */
export const RED_THRESHOLD_MIN = 60;
/** Minutes past kickoff below which no card is issued. */
export const YELLOW_THRESHOLD_MIN = 5;
/** How many events to keep on the user doc. */
const MAX_EVENTS = 20;

/**
 * Window size for the displayed-trust snapshot. Spec calls for "last
 * 10 games" — anything older falls off the indicator so a single bad
 * stretch doesn't permanently blacken a profile. The lifetime
 * counters on /users/{uid}.discipline are kept untouched for backward
 * compatibility (other surfaces may still read them) but are NOT
 * what the player card shows anymore.
 */
const SNAPSHOT_WINDOW_GAMES = 10;
/** Terminal statuses that count as "a game that happened". */
const SNAPSHOT_TERMINAL_STATUSES: readonly string[] = ['finished', 'cancelled'];

export const disciplineService = {
  /**
   * Inspect lateness from the "I'm late" trigger and issue the matching
   * card if any. No-op when below the yellow threshold.
   */
  async reportLate(input: {
    userId: UserId;
    gameId: string;
    gameStartsAt: number;
  }): Promise<DisciplineEvent | null> {
    const minutesLate = (Date.now() - input.gameStartsAt) / 60_000;
    if (minutesLate <= YELLOW_THRESHOLD_MIN) return null;
    const type: DisciplineCardType =
      minutesLate > RED_THRESHOLD_MIN ? 'red' : 'yellow';
    return this.issueCard({
      userId: input.userId,
      gameId: input.gameId,
      type,
      reason: 'late',
    });
  },

  /**
   * Issue a card. `reason='manual'` is used by the coach override UI;
   * `reason='no_show'` is reserved for the Phase 5 arrival-detection
   * trigger.
   */
  async issueCard(input: {
    userId: UserId;
    type: DisciplineCardType;
    reason: DisciplineReason;
    gameId?: string;
    issuedBy?: UserId;
  }): Promise<DisciplineEvent | null> {
    if (!input.userId) return null;
    const event: DisciplineEvent = {
      id: `disc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      type: input.type,
      reason: input.reason,
      gameId: input.gameId,
      issuedBy: input.issuedBy,
      createdAt: Date.now(),
    };
    if (USE_MOCK_DATA) {
      try {
        await applyMock(input.userId, (cur) => applyEvent(cur, event, +1));
        logEvent(AnalyticsEvent.DisciplineCardIssued, {
          cardType: input.type,
          reason: input.reason,
          gameId: input.gameId,
          manual: !!input.issuedBy,
        });
        return event;
      } catch (err) {
        if (__DEV__) console.warn('[discipline] issueCard mock failed', err);
        return null;
      }
    }
    // Firebase mode: cards on OTHER users are issued server-side by
    // the `onGameRosterChanged` Cloud Function trigger (which watches
    // game.arrivals transitions). The hardened /users rules block
    // cross-user writes from the client, so issuing from here would
    // always 403 — we just log analytics and let the server do the
    // actual write.
    logEvent(AnalyticsEvent.DisciplineCardIssued, {
      cardType: input.type,
      reason: input.reason,
      gameId: input.gameId,
      manual: !!input.issuedBy,
      viaServerTrigger: true,
    });
    return event;
  },

  /**
   * Remove a previously-issued card. Decrements the matching counter
   * and drops the event from the user's events list.
   */
  async revokeCard(userId: UserId, eventId: string): Promise<boolean> {
    if (!userId || !eventId) return false;
    try {
      if (USE_MOCK_DATA) {
        await applyMock(userId, (cur) => {
          const event = cur.events.find((e) => e.id === eventId);
          if (!event) return cur;
          return applyEvent(cur, event, -1, /*remove=*/ true);
        });
        return true;
      }
      // Firebase: read, splice, write.
      const { userService } = await import('./userService');
      const user = await userService.getUserById(userId);
      const cur = readState(user);
      const event = cur.events.find((e) => e.id === eventId);
      if (!event) return false;
      const next = applyEvent(cur, event, -1, /*remove=*/ true);
      await updateDoc(docs.user(userId), {
        discipline: serializeDiscipline(next),
        updatedAt: Date.now(),
      });
      return true;
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[discipline] revokeCard failed', err);
      }
      return false;
    }
  },

  /** Read-only helper for the Player Card. */
  state(user: User | null | undefined): UserDisciplineState {
    return readState(user);
  },

  /**
   * Snapshot of yellow/red signals derived from the user's MOST
   * RECENT SNAPSHOT_WINDOW_GAMES (default 10) PAST terminal games.
   * This is what the player card surfaces — lifetime counters are
   * deliberately NOT shown so a single bad stretch doesn't
   * permanently mark a profile.
   *
   * The derivation is intentionally objective — no human reports,
   * no admin marking. Two purely data-driven signals:
   *
   *   YELLOW (cancelled after the deadline):
   *     • the game has `cancelDeadlineHours` defined (admin set
   *       a deadline at creation), AND
   *     • the user appears in `cancellations` with a timestamp
   *       LATER than (startsAt - cancelDeadlineHours hours).
   *     Games without a deadline are SKIPPED for the yellow check
   *     — there's no objective "late" boundary to compare against.
   *
   *   RED (no-show):
   *     • the game has `teams` populated (admin used the team
   *       feature; without it we have no proof of who showed up),
   *     • the user is in the final `players[]` (still registered
   *       at game end, did NOT cancel), AND
   *     • the user does NOT appear in any team's `playerIds`.
   *     Games without team data are SKIPPED for the red check —
   *     we don't punish the user for the admin's tooling choice.
   *
   * A single game contributes at most one card. If both signals
   * fire (theoretically impossible — a cancelled user can't
   * simultaneously be in players[]) the red wins.
   *
   * Selection criteria:
   *   • the user appears in `participantIds` for the array-contains
   *     query (defensive fallback merges players/waitlist/pending/
   *     cancellations so a re-joined-then-cancelled user is still
   *     in the candidate pool)
   *   • status ∈ {finished, cancelled}
   *   • startsAt < now (past only)
   *   • sorted by startsAt desc, take first SNAPSHOT_WINDOW_GAMES
   *
   * gamesCounted reflects how many of the user's past games were
   * actually evaluable (passed the selection filter). It does NOT
   * tell you how many games contributed to each signal — a game
   * without `cancelDeadlineHours` is still counted in
   * `gamesCounted` but is invisible to the yellow check.
   *
   * Network failures are surfaced to the caller (Promise rejects)
   * — the card has its own catch + skeleton UI.
   */
  async getPlayerDisciplineSnapshot(userId: UserId): Promise<{
    yellowCardsLast10: number;
    redCardsLast10: number;
    gamesCounted: number;
  }> {
    if (!userId) {
      return { yellowCardsLast10: 0, redCardsLast10: 0, gamesCounted: 0 };
    }
    const candidates: Game[] = USE_MOCK_DATA
      ? mockGamesV2.map((g) => ({ ...g, matches: [] } as Game))
      : await (async () => {
          const snap = await getDocs(
            query(
              col.games(),
              where('participantIds', 'array-contains', userId),
            ),
          );
          return snap.docs.map((d) => ({ ...d.data(), matches: [] } as Game));
        })();

    const userInvolved = (g: Game): boolean => {
      if ((g.participantIds ?? []).includes(userId)) return true;
      if (g.players?.includes(userId)) return true;
      if (g.waitlist?.includes(userId)) return true;
      if ((g.pending ?? []).includes(userId)) return true;
      // A user who cancelled may have been removed from
      // participantIds. They still belong in the snapshot pool
      // because we want to evaluate the late-cancel signal.
      if (g.cancellations?.[userId] !== undefined) return true;
      return false;
    };

    // Past-only: a "completed" game must actually have happened.
    // Without this, a future game that was prematurely marked
    // finished/cancelled (rare but possible: organizer cancels in
    // advance) would inflate the window. When startsAt is missing
    // we trust the terminal status alone.
    const now = Date.now();
    const recent = candidates
      .filter((g) => {
        if (!SNAPSHOT_TERMINAL_STATUSES.includes(g.status)) return false;
        if (!userInvolved(g)) return false;
        if (typeof g.startsAt === 'number' && g.startsAt >= now) return false;
        return true;
      })
      .sort((a, b) => (b.startsAt ?? 0) - (a.startsAt ?? 0))
      .slice(0, SNAPSHOT_WINDOW_GAMES);

    const HOUR_MS = 60 * 60 * 1000;
    let yellow = 0;
    let red = 0;
    for (const g of recent) {
      // YELLOW — cancelled after deadline.
      const cancelTs = g.cancellations?.[userId];
      if (
        typeof cancelTs === 'number' &&
        typeof g.cancelDeadlineHours === 'number' &&
        typeof g.startsAt === 'number'
      ) {
        const deadlineMs = g.startsAt - g.cancelDeadlineHours * HOUR_MS;
        if (cancelTs > deadlineMs) {
          yellow += 1;
          continue; // a cancellation can't ALSO be a no-show
        }
      }
      // RED — no-show: in the final roster, no team membership,
      // teams data exists.
      const teams = g.teams;
      if (
        Array.isArray(teams) &&
        teams.length > 0 &&
        (g.players ?? []).includes(userId)
      ) {
        const inSomeTeam = teams.some((t) =>
          (t.playerIds ?? []).includes(userId),
        );
        if (!inSomeTeam) {
          red += 1;
        }
      }
    }
    return {
      yellowCardsLast10: yellow,
      redCardsLast10: red,
      gamesCounted: recent.length,
    };
  },
};

// ─── Internals ────────────────────────────────────────────────────────────

function readState(
  user: User | null | undefined,
): UserDisciplineState {
  const d = user?.discipline;
  if (!d) return { ...defaultDisciplineState };
  return {
    yellowCards: d.yellowCards ?? 0,
    redCards: d.redCards ?? 0,
    lateCount: d.lateCount ?? 0,
    noShowCount: d.noShowCount ?? 0,
    events: Array.isArray(d.events) ? d.events : [],
  };
}

/**
 * Pure transition: apply a single event with delta=+1 (issue) or -1
 * (revoke). Caller passes `remove=true` to also strip the event from
 * the events array.
 */
function applyEvent(
  prev: UserDisciplineState,
  event: DisciplineEvent,
  delta: 1 | -1,
  remove = false,
): UserDisciplineState {
  const yellowDelta = event.type === 'yellow' ? delta : 0;
  const redDelta = event.type === 'red' ? delta : 0;
  const lateDelta = event.reason === 'late' ? delta : 0;
  const noShowDelta = event.reason === 'no_show' ? delta : 0;
  const events = remove
    ? prev.events.filter((e) => e.id !== event.id)
    : [event, ...prev.events].slice(0, MAX_EVENTS);
  return {
    yellowCards: Math.max(0, prev.yellowCards + yellowDelta),
    redCards: Math.max(0, prev.redCards + redDelta),
    lateCount: Math.max(0, prev.lateCount + lateDelta),
    noShowCount: Math.max(0, prev.noShowCount + noShowDelta),
    events,
  };
}

async function applyMock(
  userId: UserId,
  transition: (cur: UserDisciplineState) => UserDisciplineState,
): Promise<void> {
  const json = await storage.getAuthUserJson();
  if (!json) return;
  let cur: User;
  try {
    cur = JSON.parse(json) as User;
  } catch {
    return;
  }
  // Mock-mode storage holds only the auth user — cross-user writes
  // (admin issuing on someone else) silently no-op.
  if (cur.id !== userId) return;
  const prev = readState(cur);
  const next = transition(prev);
  const nextUser: User = {
    ...cur,
    discipline: next,
    updatedAt: Date.now(),
  };
  await storage.setAuthUserJson(JSON.stringify(nextUser));
}

async function applyFirebase(
  userId: UserId,
  event: DisciplineEvent,
  delta: 1 | -1,
): Promise<void> {
  // Issue path: counter increments are atomic via increment(); the
  // events array is rewritten from a fresh read to enforce the cap and
  // dedupe. Two-phase write is acceptable for v1 (concurrent issues on
  // the same user are vanishingly rare).
  const ref = docs.user(userId);
  const yellowDelta = event.type === 'yellow' ? delta : 0;
  const redDelta = event.type === 'red' ? delta : 0;
  const lateDelta = event.reason === 'late' ? delta : 0;
  const noShowDelta = event.reason === 'no_show' ? delta : 0;
  await updateDoc(ref, {
    'discipline.yellowCards': increment(yellowDelta),
    'discipline.redCards': increment(redDelta),
    'discipline.lateCount': increment(lateDelta),
    'discipline.noShowCount': increment(noShowDelta),
    updatedAt: Date.now(),
  });
  // Re-read to update the events array under the cap.
  const { userService } = await import('./userService');
  const fresh = await userService.getUserById(userId);
  const cur = readState(fresh);
  const events = [event, ...cur.events.filter((e) => e.id !== event.id)].slice(
    0,
    MAX_EVENTS,
  );
  await updateDoc(ref, {
    'discipline.events': events,
    updatedAt: Date.now(),
  });
}

function serializeDiscipline(s: UserDisciplineState): UserDisciplineState {
  return {
    yellowCards: s.yellowCards,
    redCards: s.redCards,
    lateCount: s.lateCount,
    noShowCount: s.noShowCount,
    events: s.events,
  };
}

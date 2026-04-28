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

import { updateDoc, increment } from 'firebase/firestore';
import {
  DisciplineCardType,
  DisciplineEvent,
  DisciplineReason,
  User,
  UserDisciplineState,
  UserId,
  defaultDisciplineState,
} from '@/types';
import { USE_MOCK_DATA } from '@/firebase/config';
import { docs } from '@/firebase/firestore';
import { storage } from './storage';

/** Minutes past kickoff at which a yellow becomes a red. */
export const RED_THRESHOLD_MIN = 60;
/** Minutes past kickoff below which no card is issued. */
export const YELLOW_THRESHOLD_MIN = 5;
/** How many events to keep on the user doc. */
const MAX_EVENTS = 20;

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
    try {
      if (USE_MOCK_DATA) {
        await applyMock(input.userId, (cur) =>
          applyEvent(cur, event, +1),
        );
      } else {
        await applyFirebase(input.userId, event, +1);
      }
      return event;
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[discipline] issueCard failed', err);
      }
      return null;
    }
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

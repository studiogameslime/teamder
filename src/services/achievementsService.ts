// achievementsService — counter increments + unlock evaluation.
//
// Two unlock paths now coexist:
//
//   1. Legacy bump path (kept for backward compat). `bump(uid, metric)`
//      increments a stored counter and unlocks any definition whose
//      threshold was just met. Trigger sites historically called this
//      on every join/create/invite/approve. The DERIVED path below
//      now supersedes it for display purposes — but the persisted
//      `unlocked` list is still respected (sticky), so any badge
//      already earned via legacy bumps stays earned.
//
//   2. Derived path (new). `deriveCounters(userId, ctx)` computes the
//      five metric values from real, hard-to-fake sources:
//        • gamesJoined    → past terminal games where the user was in
//                           players[] AND in some team (i.e. actually
//                           showed up)
//        • teamsCreated   → groups whose `creatorId`/first admin is
//                           the user
//        • teamsJoined    → distinct groups where the user is in
//                           playerIds OR adminIds
//        • invitesSent    → users whose `invitedBy` points at this
//                           user (real referrals)
//        • playersCoached → distinct players across all groups where
//                           the user is an admin (excluding self)
//      Combined with `listFromCounters(user, derived)` this produces
//      the display list whose unlock decision uses the real numbers.
//
// Failures are best-effort. All Firestore writes are wrapped in
// try/catch with a dev-only warning.

import {
  getDocs,
  increment,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AchievementMetric,
  Game,
  Group,
  UnlockedAchievement,
  User,
  UserAchievementState,
  UserId,
  defaultAchievementState,
} from '@/types';
import { ACHIEVEMENTS, type AchievementDef } from '@/data/achievements';
import { USE_MOCK_DATA } from '@/firebase/config';
import { col, docs } from '@/firebase/firestore';
import { mockGamesV2 } from '@/data/mockData';
import { storage } from '@/services/storage';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

export interface AchievementListItem {
  def: AchievementDef;
  unlocked: boolean;
  unlockedAt?: number;
}

export const achievementsService = {
  /**
   * Apply an increment to one of the achievement counters and persist
   * any newly-met thresholds. Safe to call repeatedly — the unlock list
   * is treated as a Set.
   */
  async bump(
    uid: UserId,
    metric: AchievementMetric,
    by = 1,
  ): Promise<void> {
    if (!uid || by <= 0) return;
    // Self-only client write. The hardened /users/{uid} rule blocks
    // any signed-in user from writing to a different user's doc, so
    // cross-user bumps (admin approving a join → bump the joiner)
    // would fail silently. Server-side triggers handle those cases:
    //   • game roster grew → onGameRosterChanged (functions/src) bumps
    //   • group playerIds grew → onGroupPendingChanged bumps
    if (!USE_MOCK_DATA) {
      // Lazy-import to keep mock branch lean.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getFirebase } = require('@/firebase/config');
      const auth = getFirebase().auth.currentUser;
      if (!auth || auth.uid !== uid) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            '[achievements] cross-user bump skipped (server-side trigger handles it)',
            { metric, target: uid },
          );
        }
        return;
      }
    }
    try {
      if (USE_MOCK_DATA) {
        await bumpMock(uid, metric, by);
      } else {
        await bumpFirebase(uid, metric, by);
      }
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[achievements] bump failed', metric, err);
      }
    }
  },

  /**
   * Build the display list for the Player Card. Pure read — no writes.
   * Each entry includes the definition, whether it's currently unlocked
   * (either via the persisted list or because the live counter already
   * meets the threshold), and the unlock time when known.
   */
  list(user: User): AchievementListItem[] {
    const state = readState(user);
    const unlockedById: Record<string, number> = {};
    for (const u of state.unlocked) {
      unlockedById[u.id] = u.unlockedAt;
    }
    return ACHIEVEMENTS.map((def) => {
      const counterValue = state[def.metric];
      const persistedAt = unlockedById[def.id];
      const unlocked =
        persistedAt !== undefined || counterValue >= def.threshold;
      return {
        def,
        unlocked,
        unlockedAt: persistedAt,
      };
    });
  },

  /** Counters only — handy for tests / debug screens. */
  counters(user: User): UserAchievementState {
    return readState(user);
  },

  /**
   * Recompute the five achievement metrics from authoritative data
   * sources instead of trusting the stored counters (which historically
   * drifted: e.g. `gamesJoined` was bumped on every "join" tap including
   * games the user later cancelled or that never happened).
   *
   * Inputs:
   *   • userId    — the user we're scoring.
   *   • ctx.groups — the user's known groups, typically read from
   *     `useGroupStore.getState().groups`. Optional; when omitted we
   *     skip the team metrics and they default to 0.
   *
   * Returns a fresh UserAchievementState with `.unlocked` set to []
   * — the caller is expected to merge this with the user's stored
   * `unlocked` list via `listFromCounters`.
   *
   * Network: at most two reads — one games query (array-contains on
   * participantIds, same index used elsewhere) and one count
   * aggregation for referrals. Both are best-effort; on failure the
   * affected metric falls back to 0.
   */
  async deriveCounters(
    userId: UserId,
    ctx: { groups?: Group[] } = {},
  ): Promise<UserAchievementState> {
    if (!userId) return { ...defaultAchievementState };
    const groups = ctx.groups ?? [];

    // ── teamsJoined / teamsCreated / playersCoached — derive from
    //    the in-memory groups list (already hydrated by groupStore).
    //    No network needed.
    const teamsJoined = groups.filter(
      (g) =>
        (g.playerIds ?? []).includes(userId) ||
        (g.adminIds ?? []).includes(userId),
    ).length;

    const teamsCreated = groups.filter(
      (g) => (g.creatorId ?? g.adminIds?.[0]) === userId,
    ).length;

    // Sum distinct player ids across every group where I'm an admin,
    // minus self. Distinct because the same person can be in multiple
    // groups I admin and we don't want to double-count.
    const playersCoachedSet = new Set<string>();
    for (const g of groups) {
      if (!(g.adminIds ?? []).includes(userId)) continue;
      for (const pid of g.playerIds ?? []) {
        if (pid !== userId) playersCoachedSet.add(pid);
      }
    }
    const playersCoached = playersCoachedSet.size;

    // ── gamesJoined — past terminal games where the user was in the
    //    final players[] AND appeared in any team. Mirrors the
    //    discipline derivation: if you were in a team, you actually
    //    played.
    let gamesJoined = 0;
    try {
      const candidates = await loadParticipatedGames(userId);
      const now = Date.now();
      for (const g of candidates) {
        if (g.status !== 'finished') continue;
        if (typeof g.startsAt === 'number' && g.startsAt >= now) continue;
        if (!(g.players ?? []).includes(userId)) continue;
        const teams = g.teams;
        if (!Array.isArray(teams) || teams.length === 0) continue;
        const inSomeTeam = teams.some((t) =>
          (t.playerIds ?? []).includes(userId),
        );
        if (inSomeTeam) gamesJoined += 1;
      }
    } catch {
      // Silent — leave gamesJoined at 0 on transient failures.
    }

    // ── invitesSent — real referrals (users whose invitedBy points
    //    at me). Reuses the existing count aggregation; lazy import
    //    avoids a circular dep with userService.
    let invitesSent = 0;
    try {
      const { userService } = await import('./userService');
      invitesSent = await userService.getInvitedUsersCount(userId);
    } catch {
      // Silent — leave at 0.
    }

    return {
      unlocked: [],
      gamesJoined,
      teamsCreated,
      teamsJoined,
      invitesSent,
      playersCoached,
    };
  },

  /**
   * Build the display list using DERIVED counters (strict). An
   * achievement appears unlocked if and only if the derived metric
   * currently meets its threshold. The persisted unlocked list is
   * NOT used as a "sticky" override — that was the source of the
   * old "5-games badge but 0 stats" bug, since legacy bumps wrote
   * unlocks based on join clicks rather than actual play.
   *
   * `unlockedAt` is preserved from the persisted list when the
   * achievement is still derived-unlocked — so badges keep their
   * "earned at" date for users whose unlocks were valid all along.
   */
  listFromCounters(
    user: User,
    counters: UserAchievementState,
  ): AchievementListItem[] {
    const stored = readState(user);
    const persistedAtById: Record<string, number> = {};
    for (const u of stored.unlocked) {
      persistedAtById[u.id] = u.unlockedAt;
    }
    return ACHIEVEMENTS.map((def) => {
      const counterValue = counters[def.metric];
      const unlocked = counterValue >= def.threshold;
      return {
        def,
        unlocked,
        unlockedAt: unlocked ? persistedAtById[def.id] : undefined,
      };
    });
  },

  /**
   * Reconcile the persisted `unlocked` list with the current
   * derivation. Adds newly-met thresholds (with `now` as the unlock
   * time) and REMOVES persisted entries whose derived counter no
   * longer meets the threshold. Best-effort — failures are silent.
   *
   * Why we prune: legacy bumps wrote unlocks eagerly on join clicks
   * and similar intent events. Those entries are stuck in
   * `user.achievements.unlocked` even after the derived counter
   * (which counts actual play) returns 0. Pruning brings the
   * persisted state into agreement with reality.
   */
  async persistDerivedUnlocks(
    userId: UserId,
    counters: UserAchievementState,
  ): Promise<void> {
    if (!userId) return;
    try {
      if (USE_MOCK_DATA) {
        await persistMock(userId, counters);
      } else {
        await persistFirebase(userId, counters);
      }
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[achievements] persistDerivedUnlocks failed', err);
      }
    }
  },
};

// ─── Helpers for derived counters ───────────────────────────────────────

async function loadParticipatedGames(userId: UserId): Promise<Game[]> {
  if (USE_MOCK_DATA) {
    return mockGamesV2
      .filter((g) =>
        (g.participantIds ?? [
          ...g.players,
          ...g.waitlist,
          ...(g.pending ?? []),
        ]).includes(userId),
      )
      .map((g) => ({ ...g, matches: [] } as Game));
  }
  const snap = await getDocs(
    query(col.games(), where('participantIds', 'array-contains', userId)),
  );
  return snap.docs.map((d) => ({ ...d.data(), matches: [] } as Game));
}

// ─── Internals ────────────────────────────────────────────────────────────

function readState(user: User): UserAchievementState {
  const a = user.achievements;
  if (!a) return { ...defaultAchievementState };
  return {
    unlocked: Array.isArray(a.unlocked) ? a.unlocked : [],
    gamesJoined: a.gamesJoined ?? 0,
    teamsCreated: a.teamsCreated ?? 0,
    teamsJoined: a.teamsJoined ?? 0,
    invitesSent: a.invitesSent ?? 0,
    playersCoached: a.playersCoached ?? 0,
  };
}

async function bumpMock(
  uid: UserId,
  metric: AchievementMetric,
  by: number,
): Promise<void> {
  const json = await storage.getAuthUserJson();
  if (!json) return;
  let cur: User;
  try {
    cur = JSON.parse(json) as User;
  } catch {
    return;
  }
  if (cur.id !== uid) return;
  const prev = readState(cur);
  // Only the numeric counter moves. The unlocked list is now owned
  // by `persistDerivedUnlocks` (which uses real data sources), so
  // bumping no longer pre-unlocks anything — that path was the
  // source of the "5 games badge with 0 actually played" bug.
  const nextState: UserAchievementState = {
    ...prev,
    [metric]: prev[metric] + by,
  };
  const next: User = {
    ...cur,
    achievements: nextState,
    updatedAt: Date.now(),
  };
  await storage.setAuthUserJson(JSON.stringify(next));
}

async function bumpFirebase(
  uid: UserId,
  metric: AchievementMetric,
  by: number,
): Promise<void> {
  const ref = docs.user(uid);
  // Just bump the numeric counter — same rationale as the mock
  // branch above. We deliberately no longer touch
  // `achievements.unlocked`; that's `persistDerivedUnlocks`'s job.
  await updateDoc(ref, {
    [`achievements.${metric}`]: increment(by),
    updatedAt: Date.now(),
  });
}

// ─── Persist the derived unlocked list ──────────────────────────────────

function diffUnlocks(
  current: UnlockedAchievement[],
  counters: UserAchievementState,
): {
  next: UnlockedAchievement[];
  changed: boolean;
} {
  const now = Date.now();
  const persistedById: Record<string, number> = {};
  for (const u of current) persistedById[u.id] = u.unlockedAt;
  const next: UnlockedAchievement[] = [];
  for (const def of ACHIEVEMENTS) {
    const value = counters[def.metric];
    if (value < def.threshold) continue; // not unlocked under derivation
    next.push({
      id: def.id,
      unlockedAt: persistedById[def.id] ?? now,
    });
  }
  // Compare: same ids in same order? We sort both by id for a stable
  // equality check that doesn't care about insertion order.
  const a = current.map((u) => u.id).sort();
  const b = next.map((u) => u.id).sort();
  const changed = a.length !== b.length || a.some((id, i) => id !== b[i]);
  return { next, changed };
}

async function persistMock(
  uid: UserId,
  counters: UserAchievementState,
): Promise<void> {
  const json = await storage.getAuthUserJson();
  if (!json) return;
  let cur: User;
  try {
    cur = JSON.parse(json) as User;
  } catch {
    return;
  }
  if (cur.id !== uid) return;
  const prev = readState(cur);
  const { next, changed } = diffUnlocks(prev.unlocked, counters);
  if (!changed) return;
  logNewlyUnlocked(prev.unlocked, next);
  const nextUser: User = {
    ...cur,
    achievements: { ...prev, unlocked: next },
    updatedAt: Date.now(),
  };
  await storage.setAuthUserJson(JSON.stringify(nextUser));
}

async function persistFirebase(
  uid: UserId,
  counters: UserAchievementState,
): Promise<void> {
  // Lazy import to avoid a circular dep with userService.
  const { userService } = await import('@/services/userService');
  const fresh = await userService.getUserById(uid);
  if (!fresh) return;
  const prev = readState(fresh);
  const { next, changed } = diffUnlocks(prev.unlocked, counters);
  if (!changed) return;
  logNewlyUnlocked(prev.unlocked, next);
  // Whole-array overwrite — `arrayUnion` would only add, never
  // remove, and removing stale unlocks is the whole point.
  await updateDoc(docs.user(uid), {
    'achievements.unlocked': next,
    updatedAt: Date.now(),
  });
}

/** Fire one analytics event per newly-unlocked achievement id. */
function logNewlyUnlocked(
  prev: UnlockedAchievement[],
  next: UnlockedAchievement[],
): void {
  const had = new Set(prev.map((u) => u.id));
  for (const u of next) {
    if (had.has(u.id)) continue;
    logEvent(AnalyticsEvent.AchievementUnlocked, {
      achievementId: u.id,
    });
  }
}

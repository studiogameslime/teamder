// achievementsService — counter increments + unlock evaluation.
//
// Trigger sites call `bump(uid, metric, by=1)` after a relevant action
// (game joined, group created, invite sent, member approved). The
// service:
//   1. Increments the counter on the user doc (mock or Firestore)
//   2. Re-evaluates every definition that watches that metric
//   3. Persists newly-unlocked entries into `user.achievements.unlocked`
//      with a current timestamp
//
// Failures are best-effort: a missing achievement unlock should never
// block the originating action. All Firestore writes are wrapped in
// try/catch with a dev-only warning.

import { increment, updateDoc, arrayUnion } from 'firebase/firestore';
import {
  AchievementMetric,
  UnlockedAchievement,
  User,
  UserAchievementState,
  UserId,
  defaultAchievementState,
} from '@/types';
import { ACHIEVEMENTS, type AchievementDef } from '@/data/achievements';
import { USE_MOCK_DATA } from '@/firebase/config';
import { docs } from '@/firebase/firestore';
import { storage } from '@/services/storage';

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
};

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

/** Definitions whose threshold becomes met at exactly `nextValue`. */
function newlyUnlocked(
  metric: AchievementMetric,
  prevValue: number,
  nextValue: number,
  alreadyUnlockedIds: Set<string>,
): UnlockedAchievement[] {
  const now = Date.now();
  const out: UnlockedAchievement[] = [];
  for (const def of ACHIEVEMENTS) {
    if (def.metric !== metric) continue;
    if (alreadyUnlockedIds.has(def.id)) continue;
    if (prevValue < def.threshold && nextValue >= def.threshold) {
      out.push({ id: def.id, unlockedAt: now });
    }
  }
  return out;
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
  // The mock-mode store only persists the auth user; trigger sites for
  // *other* users (e.g. admin approving someone else) just no-op here.
  if (cur.id !== uid) return;
  const prev = readState(cur);
  const nextValue = prev[metric] + by;
  const alreadyIds = new Set(prev.unlocked.map((u) => u.id));
  const nu = newlyUnlocked(metric, prev[metric], nextValue, alreadyIds);
  const nextState: UserAchievementState = {
    ...prev,
    [metric]: nextValue,
    unlocked: nu.length ? [...prev.unlocked, ...nu] : prev.unlocked,
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
  // Increment the counter atomically. We then re-fetch via the user
  // service to read the new value and persist newly-unlocked entries.
  // Two-phase write is fine — concurrent bumps on the same metric are
  // rare in practice, and the unlock list is idempotent (ids never
  // duplicate because we filter against the existing set).
  await updateDoc(ref, {
    [`achievements.${metric}`]: increment(by),
    updatedAt: Date.now(),
  });
  // Re-read to evaluate. We import lazily to avoid a circular ref to
  // userService.
  const { userService } = await import('@/services/userService');
  const fresh = await userService.getUserById(uid);
  if (!fresh) return;
  const state = readState(fresh);
  const prev = state[metric] - by;
  const alreadyIds = new Set(state.unlocked.map((u) => u.id));
  const nu = newlyUnlocked(metric, prev, state[metric], alreadyIds);
  if (nu.length === 0) return;
  await updateDoc(ref, {
    'achievements.unlocked': arrayUnion(...nu),
    updatedAt: Date.now(),
  });
}

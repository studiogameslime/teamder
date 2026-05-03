// userService — single entry point for everything user-shaped.
// In mock mode we read from src/data/mockUsers.ts and persist a copy
// in AsyncStorage so name/avatar edits survive reload.
// In real mode we hit Firebase Auth + /users/{uid} in Firestore.

import {
  deleteField,
  getCountFromServer,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { User } from '@/types';
import { mockCurrentUser } from '@/data/mockUsers';
import { pickRandomAvatarId } from '@/data/avatars';
import { storage } from './storage';
import { USE_MOCK_DATA } from '@/firebase/config';
import {
  deleteCurrentFirebaseUser,
  signInWithGoogle as fbSignInWithGoogle,
  signOutFirebase,
  waitForAuthRestore,
} from '@/firebase/auth';
import { col, docs } from '@/firebase/firestore';

export const userService = {
  /**
   * Read the persisted user.
   * - Mock mode: reads AsyncStorage cache.
   * - Firebase mode: waits for auth restore on cold start, then reads
   *   /users/{uid}. Lazily creates the doc if it doesn't exist (first launch
   *   after sign-in completed before the doc was written).
   */
  async getCurrentUser(): Promise<User | null> {
    if (USE_MOCK_DATA) {
      const json = await storage.getAuthUserJson();
      if (!json) return null;
      try {
        return JSON.parse(json) as User;
      } catch {
        return null;
      }
    }
    const fbUser = await waitForAuthRestore();
    if (!fbUser) return null;
    const ref = docs.user(fbUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    // Lazily (re-)create with a random built-in avatar — handles two
    // cases: (a) brand-new sign-in where signInWithGoogle's setDoc
    // never ran, (b) recovery after a previous launch left an Auth
    // user with no /users doc (e.g. that setDoc failed). Wrapped in
    // try/catch so a transient write failure doesn't crash the app
    // — we surface `null` and the caller sees "not signed in" until
    // the next launch retries.
    const fresh: User = {
      id: fbUser.uid,
      name: fbUser.displayName ?? '',
      email: fbUser.email ?? undefined,
      avatarId: pickRandomAvatarId(),
      createdAt: Date.now(),
      onboardingCompleted: false,
    };
    try {
      await setDoc(ref, fresh);
    } catch (err) {
      if (__DEV__) console.warn('[auth] lazy user-doc create failed', err);
      return null;
    }
    await applyInviteAttributionIfFresh(fresh.id);
    return fresh;
  },

  /**
   * Sign in with Google.
   * - Mock mode: returns the canned user and writes it to AsyncStorage.
   * - Firebase mode: kicks off the OAuth dance, exchanges the id_token via
   *   Firebase Auth, then loads/creates /users/{uid}.
   */
  async signInWithGoogle(): Promise<User> {
    if (USE_MOCK_DATA) {
      const user = { ...mockCurrentUser };
      await storage.setAuthUserJson(JSON.stringify(user));
      return user;
    }
    const fbUser = await fbSignInWithGoogle();
    const ref = docs.user(fbUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const fresh: User = {
      id: fbUser.uid,
      name: fbUser.displayName ?? '',
      email: fbUser.email ?? undefined,
      avatarId: pickRandomAvatarId(),
      createdAt: Date.now(),
      onboardingCompleted: false,
    };
    // Defensive try/catch: if the doc write fails (rules denied,
    // quota exceeded, network blip), we MUST sign the user back out —
    // otherwise we'd leave a Firebase Auth user with no /users doc,
    // and the next launch would crash on `currentUser.name`.
    try {
      await setDoc(ref, fresh);
    } catch (err) {
      if (__DEV__) console.warn('[auth] user doc create failed', err);
      // Best-effort sign-out — if THAT fails too there's nothing we
      // can do but propagate. Auth restore on next launch will hit
      // `getCurrentUser()` which lazy-creates the doc anyway.
      try {
        await signOutFirebase();
      } catch {
        /* swallow */
      }
      throw err;
    }
    await applyInviteAttributionIfFresh(fresh.id);
    return fresh;
  },

  /**
   * Persist the result of the post-sign-in onboarding flow: confirmed name,
   * chosen avatar, and the onboardingCompleted flag. Email already came from
   * sign-in and is not changed here. Touches `updatedAt`.
   */
  async completeOnboarding(patch: {
    name: string;
    avatarId?: string;
    jersey?: import('@/types').Jersey;
  }): Promise<User> {
    const trimmedName = patch.name.trim();
    if (!trimmedName) throw new Error('completeOnboarding: name is required');
    if (USE_MOCK_DATA) {
      const cur = await this.getCurrentUser();
      if (!cur) throw new Error('completeOnboarding: no current user');
      const next: User = {
        ...cur,
        name: trimmedName,
        ...(patch.avatarId ? { avatarId: patch.avatarId } : {}),
        ...(patch.jersey ? { jersey: patch.jersey } : {}),
        onboardingCompleted: true,
        updatedAt: Date.now(),
      };
      await storage.setAuthUserJson(JSON.stringify(next));
      return next;
    }
    const cur = await this.getCurrentUser();
    if (!cur) throw new Error('completeOnboarding: no current user');
    const ref = docs.user(cur.id);
    const updatedAt = Date.now();
    const updates: Partial<User> = {
      name: trimmedName,
      onboardingCompleted: true,
      updatedAt,
    };
    if (patch.avatarId) updates.avatarId = patch.avatarId;
    if (patch.jersey) updates.jersey = patch.jersey;
    await updateDoc(ref, updates);
    return {
      ...cur,
      name: trimmedName,
      ...(patch.avatarId ? { avatarId: patch.avatarId } : {}),
      ...(patch.jersey ? { jersey: patch.jersey } : {}),
      onboardingCompleted: true,
      updatedAt,
    };
  },

  /**
   * Look up an arbitrary user by id. Used by PlayerCardScreen and any
   * surface that needs to show "another player" — never falls back to the
   * current user. Returns null if the doc doesn't exist or the read fails.
   */
  async getUserById(uid: string): Promise<User | null> {
    if (!uid) return null;
    if (USE_MOCK_DATA) {
      const cur = await this.getCurrentUser();
      if (cur && cur.id === uid) return cur;
      // Mock players have rich identity but no persisted User record;
      // surface a synthetic User so the Player Card can still render.
      const { mockPlayers } = await import('@/data/mockData');
      const p = mockPlayers.find((x) => x.id === uid);
      if (!p) return null;
      return {
        id: p.id,
        name: p.displayName,
        avatarId: undefined,
        photoUrl: p.avatarUrl,
        createdAt: Date.now(),
      };
    }
    try {
      const ref = docs.user(uid);
      const snap = await getDoc(ref);
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      if (__DEV__) console.warn('[userService] getUserById failed', err);
      return null;
    }
  },

  /**
   * Phase 9 — find users who would be a good invite candidate for a
   * given game.
   *
   * Filters (all client-side after a coarse Firestore query):
   *   - availability.isAvailableForInvites !== false
   *   - availability.preferredDays includes the game's weekday
   *   - availability.preferredCity matches game.city (case-insensitive)
   *     when both are set
   *   - availability.timeFrom..timeTo brackets the game hour (when set)
   *   - id not in excludeIds (already in the game / blocked)
   *
   * Returns up to `limit` users (default 50). Mock mode hydrates from
   * the bundled mock users; Firebase mode uses an `array-contains`
   * query on `availability.preferredDays` so we don't fan out a full
   * /users scan.
   */
  async findAvailablePlayers(opts: {
    /** ISO weekday 0..6 of the game. */
    day: number;
    /** "HH:mm" of the kickoff. Used for time-window match. */
    hour?: string;
    /** Free-text city — compared case-insensitively. */
    city?: string;
    excludeIds: string[];
    limit?: number;
  }): Promise<User[]> {
    const limit = opts.limit ?? 50;
    const excluded = new Set(opts.excludeIds);
    const matches = (u: User): boolean => {
      if (excluded.has(u.id)) return false;
      const a = u.availability;
      if (!a) return false;
      if (a.isAvailableForInvites === false) return false;
      if (!Array.isArray(a.preferredDays) || !a.preferredDays.includes(opts.day as never)) {
        return false;
      }
      if (opts.city && a.preferredCity) {
        if (a.preferredCity.trim().toLowerCase() !== opts.city.trim().toLowerCase()) {
          return false;
        }
      }
      if (opts.hour && a.timeFrom && a.timeTo) {
        if (opts.hour < a.timeFrom || opts.hour > a.timeTo) return false;
      }
      return true;
    };

    if (USE_MOCK_DATA) {
      // Mock mode has no shared user directory — the only persisted
      // User is the current auth user. Return an empty list (the UI
      // shows an "no candidates" empty state) so the surface still
      // works during local development.
      return [];
    }

    // Firebase: a focused query using array-contains on preferredDays.
    // Combining multiple inequalities in Firestore is rough, so we read
    // a candidate set then filter client-side.
    const { col } = await import('@/firebase/firestore');
    const { getDocs, query, where, limit: qlimit } = await import(
      'firebase/firestore'
    );
    const snap = await getDocs(
      query(
        col.users(),
        where('availability.preferredDays', 'array-contains', opts.day),
        qlimit(Math.max(limit * 2, 50)),
      ),
    );
    return snap.docs
      .map((d) => d.data())
      .filter(matches)
      .slice(0, limit);
  },

  /**
   * Permanently delete the user's account.
   *
   * Step 1: anonymize the /users/{uid} doc — wipe name/email/photo/push
   * tokens/availability so historical references in other collections
   * (game rosters, ratings) no longer expose any PII. We don't hard-
   * delete the doc because Firestore rules forbid it: keeping the row
   * preserves referential integrity (game.players[] still resolves to
   * "משתמש שהוסר" instead of dangling).
   *
   * Step 2: delete the Firebase Auth user. After this, the next sign-in
   * with the same Google account creates a brand-new uid.
   *
   * Step 3: clear local AsyncStorage so the app boots into the
   * sign-in screen.
   */
  async deleteOwnAccount(): Promise<void> {
    if (USE_MOCK_DATA) {
      await storage.setAuthUserJson(null);
      await storage.setCurrentGroupId(null);
      return;
    }
    const cur = await this.getCurrentUser();
    if (!cur) throw new Error('deleteOwnAccount: no current user');
    const ref = docs.user(cur.id);
    await updateDoc(ref, {
      name: 'משתמש שהוסר',
      email: deleteField(),
      photoUrl: deleteField(),
      avatarId: deleteField(),
      jersey: deleteField(),
      availability: deleteField(),
      fcmTokens: deleteField(),
      notificationPrefs: deleteField(),
      newGameSubscriptions: deleteField(),
      onboardingCompleted: false,
      updatedAt: Date.now(),
    });
    await deleteCurrentFirebaseUser();
    await storage.setCurrentGroupId(null);
  },

  async signOut(): Promise<void> {
    if (USE_MOCK_DATA) {
      await storage.setAuthUserJson(null);
      await storage.setCurrentGroupId(null);
      return;
    }
    await signOutFirebase();
    await storage.setCurrentGroupId(null);
  },

  async updateProfile(
    patch: Partial<Pick<User, 'name' | 'avatarId' | 'jersey'>>
  ): Promise<User> {
    if (USE_MOCK_DATA) {
      const cur = await this.getCurrentUser();
      if (!cur) throw new Error('updateProfile: no current user');
      const next: User = { ...cur, ...patch };
      await storage.setAuthUserJson(JSON.stringify(next));
      return next;
    }
    const cur = await this.getCurrentUser();
    if (!cur) throw new Error('updateProfile: no current user');
    const ref = docs.user(cur.id);
    const next: User = { ...cur, ...patch };
    const updates: Partial<User> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.avatarId !== undefined) updates.avatarId = patch.avatarId;
    if (patch.jersey !== undefined) updates.jersey = patch.jersey;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = Date.now();
      await updateDoc(ref, updates);
    }
    return next;
  },

  /**
   * Returns how many users have `invitedBy === userId`. Powers the
   * "שחקנים שהצטרפו דרכי" stat on the player card. Uses Firestore's
   * count aggregation so we don't pay for a full collection scan or
   * download user docs we don't display.
   *
   * Best-effort: returns 0 on failure (no Firestore, query not
   * indexed, rules deny). The stat row hides itself when this is 0
   * so the UI doesn't show a dead "0" for everyone.
   */
  async getInvitedUsersCount(userId: string): Promise<number> {
    if (USE_MOCK_DATA) return 0;
    if (!userId) return 0;
    try {
      const q = query(col.users(), where('invitedBy', '==', userId));
      const snap = await getCountFromServer(q);
      return snap.data().count ?? 0;
    } catch (err) {
      if (__DEV__) console.warn('[users] getInvitedUsersCount failed', err);
      return 0;
    }
  },
};

/**
 * Best-effort invite attribution. Called once per *fresh* user
 * creation (lazy-create on cold start, or new account from Google
 * sign-in). Reads the pending invite from storage and writes the
 * inviter's id + the invite target onto the new user's profile.
 *
 * Guards (each is a hard bail):
 *   • USE_MOCK_DATA — no-op (not meaningful when the dataset resets).
 *   • No pending invite at all.
 *   • Pending invite has no `invitedBy` (anonymous link).
 *   • `invitedBy === newUserId` — self-invite, ignored.
 *   • The user doc already has `invitedBy` set — never overwrite.
 *
 * Failures are swallowed so the signup path never fails because of
 * the attribution write. We re-fetch the user doc inside the guard
 * to be defensive even though both call sites just `setDoc`'d a
 * fresh user without these fields.
 */
async function applyInviteAttributionIfFresh(
  newUserId: string,
): Promise<void> {
  try {
    if (USE_MOCK_DATA) return;
    const pending = await storage.getPendingInvite();
    if (!pending?.invitedBy) return;
    if (pending.invitedBy === newUserId) return;

    const ref = docs.user(newUserId);
    const snap = await getDoc(ref);
    const existing = snap.data();
    if (existing?.invitedBy) return;

    // serverTimestamp() (NOT Date.now()) so the attribution time is
    // resilient to a wrong device clock and analytics queries can
    // trust ordering. Firestore replaces the sentinel server-side.
    await updateDoc(ref, {
      invitedBy: pending.invitedBy,
      invitedByType: pending.type,
      invitedByTargetId: pending.id,
      invitedAt: serverTimestamp(),
    });
  } catch (err) {
    if (__DEV__) console.warn('[userService] invite attribution failed', err);
  }
}

// userService — single entry point for everything user-shaped.
// In mock mode we read from src/data/mockUsers.ts and persist a copy
// in AsyncStorage so name/avatar edits survive reload.
// In real mode we hit Firebase Auth + /users/{uid} in Firestore.

import { getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { User } from '@/types';
import { mockCurrentUser } from '@/data/mockUsers';
import { pickRandomAvatarId } from '@/data/avatars';
import { storage } from './storage';
import { USE_MOCK_DATA } from '@/firebase/config';
import {
  signInWithGoogle as fbSignInWithGoogle,
  signOutFirebase,
  waitForAuthRestore,
} from '@/firebase/auth';
import { docs } from '@/firebase/firestore';

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
    // Lazily create with a random built-in avatar so the user always has
    // a face on first render — they can change it from ProfileSetup.
    const fresh: User = {
      id: fbUser.uid,
      name: fbUser.displayName ?? '',
      email: fbUser.email ?? undefined,
      avatarId: pickRandomAvatarId(),
      createdAt: Date.now(),
      onboardingCompleted: false,
    };
    await setDoc(ref, fresh);
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
    await setDoc(ref, fresh);
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
    await updateDoc(ref, updates);
    return {
      ...cur,
      name: trimmedName,
      ...(patch.avatarId ? { avatarId: patch.avatarId } : {}),
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
};

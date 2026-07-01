// userService — single entry point for everything user-shaped.
// In mock mode we read from src/data/mockUsers.ts and persist a copy
// in AsyncStorage so name/avatar edits survive reload.
// In real mode we hit Firebase Auth + /users/{uid} in Firestore.

import {
  deleteField,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import { User } from '@/types';
import { haversineKm } from '@/utils/geo';
import { sanitizeDisplayString } from '@/utils/validate';
import { mockCurrentUser } from '@/data/mockUsers';
import { pickRandomAvatarId } from '@/data/avatars';
import { storage } from './storage';
import { USE_MOCK_DATA } from '@/firebase/config';
import {
  deleteCurrentFirebaseUser,
  signInAnonymously as fbSignInAnonymously,
  signInWithGoogle as fbSignInWithGoogle,
  signInWithApple as fbSignInWithApple,
  signInWithEmail as fbSignInWithEmail,
  signUpWithEmail as fbSignUpWithEmail,
  sendPasswordReset as fbSendPasswordReset,
  signOutFirebase,
  waitForAuthRestore,
} from '@/firebase/auth';
import { col, docs } from '@/firebase/firestore';
import { logError, isExpectedDenial } from './errorLog';
import { rcBool } from './remoteConfigService';
import { gameService } from './gameService';

/** A runtime-only User for an anonymous guest session (no /users doc). */
function buildGuestUser(uid: string): User {
  return {
    id: uid,
    name: '',
    avatarId: pickRandomAvatarId(),
    createdAt: Date.now(),
    onboardingCompleted: true,
    isGuest: true,
  };
}

export const userService = {
  /**
   * Start a guest session (Firebase Anonymous Auth). Lets the user browse
   * public communities + games without registering; account actions later
   * prompt a real sign-in. No /users doc is created.
   */
  async signInAsGuest(): Promise<User> {
    if (USE_MOCK_DATA) {
      return buildGuestUser('guest-mock');
    }
    const fbUser = await fbSignInAnonymously();
    return buildGuestUser(fbUser.uid);
  },

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
    // Anonymous "browse as guest" session — synthesize a runtime-only guest
    // user. No /users doc is read or created; the guest can browse but every
    // account action prompts a real sign-in. `onboardingCompleted: true` and
    // the `isGuest` flag let RootNavigator skip the profile/onboarding gates.
    if (fbUser.isAnonymous) {
      return buildGuestUser(fbUser.uid);
    }
    const ref = docs.user(fbUser.uid);
    // Race the network read with a timeout. On a cold start with NO offline
    // persistence, an offline `getDoc` hangs (in-memory cache is empty) — and
    // the boot awaits this, so the splash would spin forever (very common for
    // this app: locker rooms / dead zones). On timeout we fall back to the
    // AsyncStorage-cached user so a signed-in user still gets into the app; the
    // live doc refreshes once the network returns.
    let snap: import('firebase/firestore').DocumentSnapshot<User> | null = null;
    try {
      snap = await Promise.race([
        getDoc(ref),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getCurrentUser: read timeout')), 8000),
        ),
      ]);
    } catch (err) {
      if (__DEV__) console.warn('[auth] getCurrentUser read timed out', err);
      const cachedJson = await storage.getAuthUserJson();
      if (cachedJson) {
        try {
          const cached = JSON.parse(cachedJson) as User;
          if (cached?.id === fbUser.uid) return cached;
        } catch {
          /* corrupt cache — fall through to null */
        }
      }
      return null;
    }
    if (snap.exists()) {
      // Presence ping — powers Pulse's platform / "inactive N days" segments.
      // Fire-and-forget; a failure here must never block sign-in.
      void touchPresence(fbUser.uid);
      return snap.data();
    }
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
      logError('createUserDoc', err, { uid: fresh.id, source: 'getCurrentUser' });
      if (__DEV__) console.warn('[auth] lazy user-doc create failed', err);
      return null;
    }
    await applyInviteAttributionIfFresh(fresh.id);
    await applyAcquisitionIfFresh(fresh.id);
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
      logError('createUserDoc', err, { uid: fresh.id, provider: 'google', email: fresh.email });
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
    await applyAcquisitionIfFresh(fresh.id);
    return fresh;
  },

  async signInWithApple(): Promise<User> {
    if (USE_MOCK_DATA) {
      const user = { ...mockCurrentUser };
      await storage.setAuthUserJson(JSON.stringify(user));
      return user;
    }
    const { user: fbUser, fullName } = await fbSignInWithApple();
    const ref = docs.user(fbUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const fresh: User = {
      id: fbUser.uid,
      // Apple hands the name back only on the first authorization
      // (via `fullName`); Firebase's displayName is usually empty for
      // Apple, so prefer the one-shot fullName and let onboarding fill
      // the rest if both are missing.
      name: fbUser.displayName ?? fullName ?? '',
      email: fbUser.email ?? undefined,
      avatarId: pickRandomAvatarId(),
      createdAt: Date.now(),
      onboardingCompleted: false,
    };
    try {
      await setDoc(ref, fresh);
    } catch (err) {
      logError('createUserDoc', err, { uid: fresh.id, provider: 'apple', email: fresh.email });
      if (__DEV__) console.warn('[auth] apple user doc create failed', err);
      try {
        await signOutFirebase();
      } catch {
        /* swallow */
      }
      throw err;
    }
    await applyInviteAttributionIfFresh(fresh.id);
    await applyAcquisitionIfFresh(fresh.id);
    return fresh;
  },

  /**
   * Sign in an EXISTING email/password account. The /users doc was created at
   * sign-up; if it's somehow missing (legacy/edge), lazy-create it so the app
   * never crashes on `currentUser.name`.
   */
  async signInWithEmail(email: string, password: string): Promise<User> {
    if (USE_MOCK_DATA) {
      const user = { ...mockCurrentUser };
      await storage.setAuthUserJson(JSON.stringify(user));
      return user;
    }
    const fbUser = await fbSignInWithEmail(email, password);
    const ref = docs.user(fbUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const fresh: User = {
      id: fbUser.uid,
      name: fbUser.displayName ?? '',
      email: fbUser.email ?? email.trim(),
      avatarId: pickRandomAvatarId(),
      createdAt: Date.now(),
      onboardingCompleted: false,
    };
    try {
      await setDoc(ref, fresh);
    } catch (err) {
      logError('createUserDoc', err, { uid: fresh.id, provider: 'email', email: fresh.email });
      try {
        await signOutFirebase();
      } catch {
        /* swallow */
      }
      throw err;
    }
    return fresh;
  },

  /**
   * Create a NEW email/password account + its /users doc, then run the same
   * invite-attribution / acquisition hooks as Google/Apple. Onboarding fills
   * name + avatar afterwards (the provider gives us neither). The verification
   * email is sent in the auth layer but does NOT block usage.
   */
  async signUpWithEmail(email: string, password: string): Promise<User> {
    if (USE_MOCK_DATA) {
      const user = { ...mockCurrentUser };
      await storage.setAuthUserJson(JSON.stringify(user));
      return user;
    }
    const fbUser = await fbSignUpWithEmail(email, password);
    const ref = docs.user(fbUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const fresh: User = {
      id: fbUser.uid,
      name: '',
      email: fbUser.email ?? email.trim(),
      avatarId: pickRandomAvatarId(),
      createdAt: Date.now(),
      onboardingCompleted: false,
    };
    try {
      await setDoc(ref, fresh);
    } catch (err) {
      logError('createUserDoc', err, { uid: fresh.id, provider: 'email', email: fresh.email });
      try {
        await signOutFirebase();
      } catch {
        /* swallow */
      }
      throw err;
    }
    await applyInviteAttributionIfFresh(fresh.id);
    await applyAcquisitionIfFresh(fresh.id);
    return fresh;
  },

  /** Send a password-reset email (Firebase-hosted). No-op under mock data. */
  async sendPasswordReset(email: string): Promise<void> {
    await fbSendPasswordReset(email);
  },

  /**
   * Persist the result of the post-sign-in onboarding flow: confirmed name,
   * chosen avatar, and the onboardingCompleted flag. Email already came from
   * sign-in and is not changed here. Touches `updatedAt`.
   */
  async completeOnboarding(patch: {
    name: string;
    avatarId?: string;
    photoUrl?: string;
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
        ...(patch.photoUrl ? { photoUrl: patch.photoUrl } : {}),
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
    if (patch.photoUrl) updates.photoUrl = patch.photoUrl;
    try {
      await updateDoc(ref, updates);
    } catch (e) {
      logError('completeOnboarding', e, {
        uid: cur.id,
        name: trimmedName,
        avatarId: patch.avatarId,
      });
      throw e;
    }
    return {
      ...cur,
      name: trimmedName,
      ...(patch.avatarId ? { avatarId: patch.avatarId } : {}),
      ...(patch.photoUrl ? { photoUrl: patch.photoUrl } : {}),
      onboardingCompleted: true,
      updatedAt,
    };
  },

  /**
   * Look up an arbitrary user by id. Used by PlayerCardScreen and any
   * surface that needs to show "another player" — never falls back to the
   * current user. Returns null if the doc doesn't exist or the read fails.
   */
  /** Toggle whether only friends may start a DM with me. */
  async setDmFriendsOnly(uid: string, value: boolean): Promise<void> {
    if (!uid || USE_MOCK_DATA) return;
    await updateDoc(docs.user(uid), { dmFriendsOnly: value, updatedAt: Date.now() });
  },

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
      logError('getUserById', err, { uid });
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
    /** Free-text city — fallback match when geo coords are unavailable. */
    city?: string;
    /** Game location (preferred) — drives the radius/distance match. */
    gameLat?: number;
    gameLng?: number;
    excludeIds: string[];
    limit?: number;
  }): Promise<User[]> {
    const limit = opts.limit ?? 50;
    const excluded = new Set(opts.excludeIds);
    const gamePt =
      typeof opts.gameLat === 'number' && typeof opts.gameLng === 'number'
        ? { lat: opts.gameLat, lng: opts.gameLng }
        : null;
    const matches = (u: User): boolean => {
      if (excluded.has(u.id)) return false;
      const a = u.availability;
      if (!a) return false;
      if (a.isAvailableForInvites === false) return false;
      if (!Array.isArray(a.preferredDays) || !a.preferredDays.includes(opts.day as never)) {
        return false;
      }
      // ── Location: RADIUS-based (the whole point of `availabilityRadiusKm`).
      // Compute the great-circle distance from the player's home to the game
      // and include them when it's within their chosen radius — so a Kiryat
      // Ekron player with a 50km radius IS offered a Petah Tikva game (~30km),
      // not excluded just because the city NAMES differ. City-name equality is
      // kept only as a fallback when either side is missing coordinates.
      const home =
        typeof a.homeCityLat === 'number' && typeof a.homeCityLng === 'number'
          ? { lat: a.homeCityLat, lng: a.homeCityLng }
          : null;
      const radiusKm =
        typeof a.availabilityRadiusKm === 'number' && a.availabilityRadiusKm > 0
          ? a.availabilityRadiusKm
          : 20; // model default
      if (gamePt && home) {
        if (haversineKm(home, gamePt) > radiusKm) return false;
      } else if (opts.city) {
        const playerCity = a.homeCity || a.preferredCity;
        if (
          playerCity &&
          playerCity.trim().toLowerCase() !== opts.city.trim().toLowerCase()
        ) {
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
    try {
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
    } catch (err) {
      logError('findAvailablePlayers', err, {
        day: opts.day,
        city: opts.city,
        limit,
      });
      throw err;
    }
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
  async deleteOwnAccount(password?: string): Promise<void> {
    if (USE_MOCK_DATA) {
      const cur = await this.getCurrentUser();
      if (cur) {
        await gameService.leaveAllGamesForAccountDeletion(cur.id);
      }
      await storage.setAuthUserJson(null);
      await storage.setCurrentGroupId(null);
      return;
    }
    const cur = await this.getCurrentUser();
    if (!cur) throw new Error('deleteOwnAccount: no current user');

    // Why this order:
    //   • Anonymisation requires the user's own auth (rules: isSelf).
    //     Once the auth user is deleted, no client-side write to the
    //     /users doc can succeed, so anonymise CANNOT come after
    //     auth deletion.
    //   • Conversely, if anonymisation succeeds and auth deletion
    //     then fails (network drop, token expiry, etc.), we'd be
    //     stuck with a half-deleted state. To avoid that, we cache
    //     the original profile data BEFORE anonymising and restore
    //     it on auth-deletion failure. Anonymisation is safe to
    //     retry — restoring + re-anonymising is idempotent.
    //   • Game sweep runs first so registered admins get the
    //     "playerCancelled" push while the user's name is still
    //     intact. (The push body resolves the user name on the CF
    //     side at delivery time; sequencing matters only for the
    //     window between sweep and anonymise.)

    // Idempotent push gate: if a previous attempt already notified
    // admins (latch in AsyncStorage), suppress notifications on this
    // run. The sweep itself is naturally idempotent (a second
    // transaction simply reads no-op state and writes nothing).
    const alreadyNotified = await storage.wasDeleteSweepNotified(cur.id);
    try {
      await gameService.leaveAllGamesForAccountDeletion(cur.id, {
        suppressNotifications: alreadyNotified,
      });
      if (!alreadyNotified) {
        // Latch the marker so a retry of deleteOwnAccount doesn't
        // re-fire the per-admin pushes. Cleared after auth-delete
        // succeeds so future sign-ins start fresh.
        await storage.setDeleteSweepNotified(cur.id);
      }
    } catch (err) {
      logError('deleteAccountGameSweep', err, { uid: cur.id });
      if (__DEV__) console.warn('[deleteAccount] game sweep failed', err);
    }

    // Cache fields that anonymisation will overwrite, so we can
    // restore on failure. Only round-trip the keys we touch — no
    // need to copy the entire doc.
    const restorePayload: Record<string, unknown> = {
      name: cur.name,
      onboardingCompleted: cur.onboardingCompleted ?? true,
    };
    if (cur.email !== undefined) restorePayload.email = cur.email;
    if (cur.photoUrl !== undefined) restorePayload.photoUrl = cur.photoUrl;
    if (cur.avatarId !== undefined) restorePayload.avatarId = cur.avatarId;
    if (cur.jersey !== undefined) restorePayload.jersey = cur.jersey;
    if (cur.availability !== undefined)
      restorePayload.availability = cur.availability;
    if (cur.fcmTokens !== undefined) restorePayload.fcmTokens = cur.fcmTokens;
    if (cur.notificationPrefs !== undefined)
      restorePayload.notificationPrefs = cur.notificationPrefs;
    if (cur.newGameSubscriptions !== undefined)
      restorePayload.newGameSubscriptions = cur.newGameSubscriptions;

    const ref = docs.user(cur.id);
    try {
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
    } catch (e) {
      logError('deleteAccount', e, { uid: cur.id });
      throw e;
    }
    try {
      await deleteCurrentFirebaseUser(password);
    } catch (err) {
      logError('deleteAccount', err, { uid: cur.id });
      // Auth deletion failed — restore the profile so the user
      // isn't stuck in a "anonymised but signed-in" limbo.
      // The user can retry deleteOwnAccount safely. The
      // sweep-notified latch stays SET so the retry's sweep won't
      // re-spam admins.
      try {
        await updateDoc(ref, {
          ...restorePayload,
          updatedAt: Date.now(),
        });
      } catch (restoreErr) {
        logError('deleteAccountRestore', restoreErr, { uid: cur.id });
        if (__DEV__)
          console.warn('[deleteAccount] restore after auth fail failed', restoreErr);
      }
      throw err;
    }
    // Auth-delete succeeded — clear the latch so this device starts
    // fresh next time someone signs in.
    await storage.clearDeleteSweepNotified();
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
    patch: Partial<Pick<User, 'name' | 'avatarId' | 'photoUrl' | 'position'>>,
  ): Promise<User> {
    // Strip zero-width / bidi-override (U+202E) / control chars from the display
    // name — blocks impersonation (a hidden suffix duplicating someone's name)
    // and layout-reversal attacks. sanitizeDisplayString existed for exactly
    // this but had no call-site until now.
    if (typeof patch.name === 'string') {
      patch = { ...patch, name: sanitizeDisplayString(patch.name) };
    }
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
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.avatarId !== undefined) updates.avatarId = patch.avatarId;
    // photoUrl: a present-but-empty value (switched to a built-in avatar) must
    // CLEAR the field, not be skipped — otherwise the doc keeps a photoUrl
    // pointing at a now-deleted Storage object and everyone else sees a broken
    // image. `'photoUrl' in patch` distinguishes "clear it" from "don't touch".
    if ('photoUrl' in patch) {
      updates.photoUrl = patch.photoUrl ? patch.photoUrl : deleteField();
    }
    if (patch.position !== undefined) updates.position = patch.position;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = Date.now();
      try {
        // `updates` carries a possible deleteField() sentinel (photo clear), so
        // it's a dynamic map rather than a typed Partial<User> — cast like the
        // other dynamic update-map call sites (e.g. updateGameDoc).
        await updateDoc(ref, updates as never);
      } catch (e) {
        logError('updateProfile', e, {
          uid: cur.id,
          fields: Object.keys(patch || {}),
        });
        throw e;
      }
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
      // unauthenticated/offline during early hydration is expected — skip.
      if (!isExpectedDenial(err)) {
        logError('getInvitedUsersCount', err, { userId });
      }
      if (__DEV__) console.warn('[users] getInvitedUsersCount failed', err);
      return 0;
    }
  },

  /**
   * Returns the actual list of users the given user invited — name,
   * avatar, when they joined, and where the invite landed. Used by the
   * tappable referrals tile on Profile so the user can see WHO they
   * brought (not just a count).
   *
   * Sorted newest-first (most recent joiner at the top). Best-effort:
   * returns [] on failure so the consumer can render an empty state
   * instead of crashing.
   */
  async listInvitedUsers(userId: string): Promise<{
    id: string;
    name: string;
    avatarId?: string;
    photoUrl?: string;
    invitedAt?: number;
    invitedByType?: 'session' | 'team';
    invitedByTargetId?: string;
  }[]> {
    if (USE_MOCK_DATA) return [];
    if (!userId) return [];
    try {
      const q = query(col.users(), where('invitedBy', '==', userId));
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => {
        const data = d.data() as unknown as Record<string, unknown>;
        const at = data.invitedAt;
        const invitedAtMs =
          at && typeof (at as { toMillis?: () => number }).toMillis === 'function'
            ? (at as { toMillis: () => number }).toMillis()
            : typeof at === 'number'
              ? at
              : undefined;
        const invitedByType: 'session' | 'team' | undefined =
          data.invitedByType === 'session' || data.invitedByType === 'team'
            ? data.invitedByType
            : undefined;
        return {
          id: d.id,
          name: typeof data.name === 'string' ? data.name : '',
          avatarId: typeof data.avatarId === 'string' ? data.avatarId : undefined,
          photoUrl:
            typeof data.photoUrl === 'string' ? data.photoUrl : undefined,
          invitedAt: invitedAtMs,
          invitedByType,
          invitedByTargetId:
            typeof data.invitedByTargetId === 'string'
              ? data.invitedByTargetId
              : undefined,
        };
      });
      // Newest first. Users without invitedAt sink to the bottom.
      rows.sort((a, b) => (b.invitedAt ?? 0) - (a.invitedAt ?? 0));
      return rows;
    } catch (err) {
      logError('listInvitedUsers', err, { userId });
      if (__DEV__) console.warn('[users] listInvitedUsers failed', err);
      return [];
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

    // A generic app invite has no game/team target — use an 'app'
    // placeholder so the rules' "type+target present" guard still passes
    // and the referral is credited (the count query keys on invitedBy).
    const targetId = pending.type === 'app' ? 'app' : pending.id;

    // serverTimestamp() (NOT Date.now()) so the attribution time is
    // resilient to a wrong device clock and analytics queries can
    // trust ordering. Firestore replaces the sentinel server-side.
    await updateDoc(ref, {
      invitedBy: pending.invitedBy,
      invitedByType: pending.type,
      invitedByTargetId: targetId,
      invitedAt: serverTimestamp(),
    });
  } catch (err) {
    logError('applyInviteAttribution', err, { newUserId });
    if (__DEV__) console.warn('[userService] invite attribution failed', err);
  }
}

/**
 * Record where this install came from (UTM acquisition) on a brand-new
 * user, from the same pending-invite stash the referrer / clipboard /
 * deep-link paths fill. Set-once: never overwrites an existing
 * `acquisition`. Independent of invite attribution — a link can carry a
 * `source` with no inviter, and vice-versa. Best-effort; never throws.
 */
async function applyAcquisitionIfFresh(newUserId: string): Promise<void> {
  try {
    if (USE_MOCK_DATA) return;
    const pending = await storage.getPendingInvite();
    const source = pending?.source;
    if (!source) return;

    const ref = docs.user(newUserId);
    const snap = await getDoc(ref);
    const existing = snap.data() as { acquisition?: unknown } | undefined;
    if (existing?.acquisition) return; // set-once

    const gameId =
      pending && (pending.type === 'session' || pending.type === 'team')
        ? pending.id
        : undefined;
    await updateDoc(ref, {
      acquisition: {
        source,
        ...(pending?.campaign ? { campaign: pending.campaign } : {}),
        ...(pending?.linkId ? { linkId: pending.linkId } : {}),
        ...(gameId ? { gameId } : {}),
        at: Date.now(),
      },
    });
  } catch (err) {
    logError('applyAcquisition', err, { newUserId });
    if (__DEV__) console.warn('[userService] acquisition write failed', err);
  }
}

/**
 * Lightweight presence ping written on every launch. Records `platform`
 * (so iOS/Android segments work) and `lastSeenAt` (so "inactive N days"
 * segments are accurate — Auth's lastRefreshTime is too coarse). Throttled
 * to once per ~6h via AsyncStorage so we don't write on every foreground.
 * Fire-and-forget: never throws into the caller.
 */
const PRESENCE_THROTTLE_MS = 6 * 60 * 60 * 1000;
async function touchPresence(uid: string): Promise<void> {
  try {
    if (USE_MOCK_DATA) return;
    if (!rcBool('feature_campaigns')) return; // remote kill-switch
    const last = await storage.getPresencePingAt();
    const now = Date.now();
    if (last && now - last < PRESENCE_THROTTLE_MS) return;
    await storage.setPresencePingAt(now);
    await updateDoc(docs.user(uid), {
      platform: Platform.OS,
      lastSeenAt: now,
    });
  } catch (err) {
    // A denied/transient write here is non-fatal — segments degrade
    // gracefully (fall back to Auth metadata). Don't surface it.
    if (__DEV__) console.warn('[userService] presence ping failed', err);
  }
}

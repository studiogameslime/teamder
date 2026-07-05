import { create } from 'zustand';
import { User } from '@/types';
import { userService } from '@/services';
import { notificationsService } from '@/services/notificationsService';
import { storage } from '@/services/storage';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { useGroupStore } from '@/store/groupStore';
import { useGameStore } from '@/store/gameStore';
import { useChatStore } from '@/store/chatStore';
import { onSnapshot } from 'firebase/firestore';
import { docs } from '@/firebase/firestore';
import { USE_MOCK_DATA } from '@/firebase/config';

interface UserStore {
  // Bootstrap
  hydrated: boolean;        // true once we've read AsyncStorage on app launch
  hydrate: () => Promise<void>;

  // Onboarding
  onboardingDone: boolean;
  completeOnboarding: () => Promise<void>;

  // Auth
  currentUser: User | null;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInAsGuest: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Optional password re-auth for email/password accounts (Firebase
   *  requires a fresh login to delete). */
  deleteOwnAccount: (password?: string) => Promise<void>;
  updateProfile: (
    patch: Partial<Pick<User, 'name' | 'avatarId' | 'photoUrl' | 'position'>>,
  ) => Promise<void>;
  /** Live listener on /users/{uid} → keeps currentUser fresh with every
   *  server-derived change (stats.goals/assists/wins, internal rating,
   *  friends, achievements). Root fix for the "stale store" bug class:
   *  before this, currentUser only refreshed on sign-in / profile edit, so
   *  screens each re-fetched on focus. Returns an unsubscribe. */
  subscribeCurrentUser: (uid: string) => () => void;

  // Profile completion: true once name is set (covers the case where Google
  // gave us "" or the user hasn't seen the ProfileSetup screen yet).
  isProfileComplete: () => boolean;

  // Post-sign-in onboarding: true once /users/{uid}.onboardingCompleted is true.
  hasCompletedOnboarding: () => boolean;
  completePostSignInOnboarding: (
    patch: { name: string; avatarId?: string; photoUrl?: string },
  ) => Promise<void>;
}

/**
 * Upper bound (ms) on how long sign-out / delete waits for this device's push
 * token to be removed from the account. The token-removal write is self-only
 * (Firestore rules) so it MUST land while the user is still authenticated —
 * once auth is torn down the write is denied and the token lingers on the old
 * account, leaking the previous user's pushes to the NEXT user on this phone.
 *
 * We therefore AWAIT the write to server-ack before revoking auth. The previous
 * 1500ms cap was too short for slow-but-online cellular: the timeout won the
 * race, auth was revoked mid-write, and the write failed with permission-denied
 * — the exact leak above. A Firestore write never resolves while fully offline
 * (it stays pending until reconnect), so we keep a generous bound purely so a
 * dead-zone sign-out can't hang forever; any realistically-online write for a
 * single arrayRemove completes well within it.
 */
// When ONLINE the arrayRemove server-acks in well under a second, so the race
// resolves on the write — the cap only bites when OFFLINE (the write never acks
// until reconnect). Keep it short so a sign-out in a dead zone doesn't freeze
// the UI for long; an offline token can't be removed client-side anyway (the
// next-login leak is only reachable online, which this still covers).
const TOKEN_UNREGISTER_MAX_WAIT_MS = 4000;

/**
 * Remove this device's push token from `uid`, awaiting server-ack, BEFORE the
 * caller tears down auth. Bounded by TOKEN_UNREGISTER_MAX_WAIT_MS so an offline
 * caller isn't blocked indefinitely. Best-effort: never throws.
 */
async function removeDeviceTokenBeforeAuthTeardown(uid: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      notificationsService.unregisterThisDevice(uid).catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TOKEN_UNREGISTER_MAX_WAIT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const useUserStore = create<UserStore>((set, get) => ({
  hydrated: false,
  onboardingDone: false,
  currentUser: null,

  hydrate: async () => {
    // Defensive: each branch wrapped so a single failure (transient
    // network drop on the /users/{uid} read, AsyncStorage corruption)
    // doesn't leave `hydrated: false` forever. RootNavigator gates
    // the splash on this flag — silent rejections meant a perma-
    // splash that was unrecoverable without a force-close.
    const [onboardingDone, user] = await Promise.all([
      storage.getOnboardingDone().catch((err) => {
        logError('userHydrateGetOnboardingDone', err, {});
        return false;
      }),
      userService.getCurrentUser().catch((err) => {
        logError('userHydrateGetCurrentUser', err, {});
        if (__DEV__) console.warn('[userStore.hydrate] getCurrentUser', err);
        return null;
      }),
    ]);
    set({ hydrated: true, onboardingDone, currentUser: user });
  },

  completeOnboarding: async () => {
    await storage.setOnboardingDone(true);
    set({ onboardingDone: true });
  },

  signInWithGoogle: async () => {
    const user = await userService.signInWithGoogle();
    set({ currentUser: user });
    logEvent(AnalyticsEvent.SignInSuccess);
  },

  signInWithApple: async () => {
    const user = await userService.signInWithApple();
    set({ currentUser: user });
    logEvent(AnalyticsEvent.SignInSuccess);
  },

  signInAsGuest: async () => {
    const user = await userService.signInAsGuest();
    set({ currentUser: user });
    logEvent(AnalyticsEvent.SignInSuccess, { method: 'guest' });
  },

  signInWithEmail: async (email, password) => {
    const user = await userService.signInWithEmail(email, password);
    set({ currentUser: user });
    logEvent(AnalyticsEvent.SignInSuccess);
  },

  signUpWithEmail: async (email, password) => {
    const user = await userService.signUpWithEmail(email, password);
    set({ currentUser: user });
    logEvent(AnalyticsEvent.SignInSuccess);
  },

  sendPasswordReset: async (email) => {
    await userService.sendPasswordReset(email);
  },

  signOut: async () => {
    // Remove THIS device's push token from the account BEFORE auth is torn
    // down — otherwise the next user on this phone keeps getting the previous
    // user's pushes (privacy leak). Best-effort; never blocks sign-out.
    const uid = get().currentUser?.id;
    // AWAIT the token-removal write to server-ack before auth is revoked — the
    // write is self-only and can't succeed once auth is gone (see
    // removeDeviceTokenBeforeAuthTeardown). The old 1500ms cap let a slow-but-
    // online write lose the race, so the token stayed on the old account and
    // leaked its pushes to the next user on this device.
    if (uid) {
      await removeDeviceTokenBeforeAuthTeardown(uid);
    }
    await userService.signOut();
    set({ currentUser: null });
    // Wipe per-user stores so the next account (incl. the common
    // guest→register flow) never sees the previous user's communities/roster.
    useGroupStore.getState().reset();
    useGameStore.getState().reset();
    // chatStore held the previous account's unread counts — without this the
    // tab badge briefly leaked Account A's chat activity into Account B.
    useChatStore.getState().clear();
    logEvent(AnalyticsEvent.SignOut);
  },

  deleteOwnAccount: async (password) => {
    // Drop this device's token before the account is anonymized/deleted, so a
    // deleted account doesn't keep receiving pushes on this device.
    const uid = get().currentUser?.id;
    // AWAIT token-removal to server-ack before the account is anonymized/deleted
    // (see signOut) so a deleted account can't keep pushing to this device.
    // Bounded so an offline delete can't hang.
    if (uid) {
      await removeDeviceTokenBeforeAuthTeardown(uid);
    }
    await userService.deleteOwnAccount(password);
    set({ currentUser: null });
    useGroupStore.getState().reset();
    useGameStore.getState().reset();
    useChatStore.getState().clear();
    logEvent(AnalyticsEvent.AccountDeleted);
  },

  subscribeCurrentUser: (uid) => {
    if (USE_MOCK_DATA || !uid) return () => {};
    return onSnapshot(
      docs.user(uid),
      (snap) => {
        if (!snap.exists()) return;
        const fresh = snap.data();
        // Guard against a late snapshot arriving after sign-out / account
        // switch — only apply it while this is still the signed-in user.
        const cur = get().currentUser;
        if (cur && cur.id === uid) set({ currentUser: fresh });
      },
      (err) => {
        logError('subscribeCurrentUser', err, { uid });
        if (__DEV__) console.warn('[userStore] currentUser listener failed', err);
      },
    );
  },

  updateProfile: async (patch) => {
    const prev = get().currentUser;
    const wasComplete = !!prev && prev.name.trim().length > 0;
    const next = await userService.updateProfile(patch);
    set({ currentUser: next });
    // First time the profile transitions from "incomplete" → "has name".
    if (!wasComplete && next.name.trim().length > 0) {
      logEvent(AnalyticsEvent.ProfileCreated);
    } else {
      const fields = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
      logEvent(AnalyticsEvent.ProfileEdited, { fields: fields.join(',') });
      if (patch.avatarId !== undefined) {
        logEvent(AnalyticsEvent.AvatarChanged);
      }
    }
  },

  isProfileComplete: () => {
    const u = get().currentUser;
    return !!u && u.name.trim().length > 0;
  },

  hasCompletedOnboarding: () => {
    const u = get().currentUser;
    return !!u && u.onboardingCompleted === true;
  },

  completePostSignInOnboarding: async (patch) => {
    const next = await userService.completeOnboarding(patch);
    set({ currentUser: next });
    logEvent(AnalyticsEvent.ProfileCreated);
    logEvent(AnalyticsEvent.OnboardingCompleted);
  },
}));

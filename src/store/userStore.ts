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
  /**
   * True when hydrate finished with NO session because the silent anonymous
   * sign-in itself failed — almost always no network on a fresh install.
   *
   * Without this the app has no way to tell "still starting a guest session"
   * from "there will never be one", and RootNavigator would sit on the splash
   * forever. It is the fallback flag, not a normal state: on every successful
   * boot it stays false.
   */
  guestInitFailed: boolean;

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


/**
 * Everything the signed-out person left on the DEVICE, not on their account.
 *
 * `footy.pending.action` and the draft slots are device-scoped by design — a
 * deep link has to survive the sign-in it triggers. That same property makes
 * them a leak across identities: sign out mid-way through creating a club and
 * the next person to sign in on the phone would have the resume fire for them.
 *
 * Best-effort on each key. A failure here must not stop a sign-out.
 */
async function clearSignedOutUserState(): Promise<void> {
  // Imported lazily, not at module scope. A static import here pulls
  // pendingAction's and draftStore's native dependency chain into every module
  // that touches the user store, and that broke `silentGuest.test.ts` on an
  // untransformed expo-constants — the same trap `actionResumers` hit with
  // notificationActionService. The cost is nothing: this runs once, on a tap.
  const [{ clearPendingAction }, { draftStore }] = await Promise.all([
    import('@/services/pendingAction'),
    import('@/services/draftStore'),
  ]);
  await clearPendingAction();
  await Promise.all(
    (['club', 'game', 'availability'] as const).map((kind) =>
      draftStore.discard(kind),
    ),
  );
}

/**
 * Start an anonymous session and land the store in a state the navigator can
 * leave.
 *
 * Shared by boot and sign-out ON PURPOSE. It used to live inline in `hydrate`,
 * which meant a guest was only ever created at launch — and `signOut` set
 * `currentUser: null` without one. That combination
 *
 *     hydrated: true, currentUser: null, guestInitFailed: false
 *
 * is terminal: RootNavigator's first guard passes (hydrated), the second finds
 * no user and no failure flag, and returns the splash forever. Signing out
 * froze the app until it was force-quit. Having exactly one place that ends a
 * session-less state is what stops that shape existing at all.
 *
 * The post-condition every caller relies on: when this resolves, EITHER
 * `currentUser` is set, OR `guestInitFailed` is true. Never neither.
 */
async function startSilentGuest(
  set: (partial: Partial<UserStore>) => void,
  onboardingDone: boolean,
  origin: 'silent' | 'post_sign_out',
): Promise<void> {
  if (USE_MOCK_DATA) {
    // `guestInitFailed: true` because the flag is what the navigator reads to
    // mean "there is no session and none is coming" — and in mock mode that
    // is literally true: the attempt is skipped, so nothing will ever produce
    // one. Setting it false left `currentUser` null with no fallback, and the
    // navigator sat on the splash forever with no control to escape it. That
    // broke every screenshot run and every mock QA pass.
    set({ hydrated: true, onboardingDone, currentUser: null, guestInitFailed: true });
    return;
  }
  let guest: User | null = null;
  try {
    guest = await userService.signInAsGuest();
    logEvent(AnalyticsEvent.GuestSessionStarted, { origin });
  } catch (err) {
    // Offline is the realistic case — on first launch, or on the network drop
    // that made somebody sign out in the first place. Report it and let
    // RootNavigator fall back to the sign-in screen, which is where this
    // person would have landed before any of this existed.
    // Key kept as `userHydrateSilentGuest` even though this no longer lives in
    // `hydrate`: it is the grouping key for an existing production error
    // fingerprint, and renaming it in a hotfix would split the history for no
    // gain. `origin` in the context says which path failed.
    logError('userHydrateSilentGuest', err, { origin });
    logEvent(AnalyticsEvent.BootHydrateFailed, { source: 'silent_guest' });
    if (__DEV__) console.warn('[userStore] silent guest failed', origin, err);
  }
  set({
    hydrated: true,
    onboardingDone,
    currentUser: guest,
    guestInitFailed: guest === null,
  });
}

export const useUserStore = create<UserStore>((set, get) => ({
  hydrated: false,
  onboardingDone: false,
  currentUser: null,
  guestInitFailed: false,

  hydrate: async () => {
    // Defensive: each branch wrapped so a single failure (transient
    // network drop on the /users/{uid} read, AsyncStorage corruption)
    // doesn't leave `hydrated: false` forever. RootNavigator gates
    // the splash on this flag — silent rejections meant a perma-
    // splash that was unrecoverable without a force-close.
    const [onboardingDone, user] = await Promise.all([
      storage.getOnboardingDone().catch((err) => {
        logError('userHydrateGetOnboardingDone', err, {});
        logEvent(AnalyticsEvent.BootHydrateFailed, { source: 'storage' });
        return false;
      }),
      userService.getCurrentUser().catch((err) => {
        logError('userHydrateGetCurrentUser', err, {});
        logEvent(AnalyticsEvent.BootHydrateFailed, { source: 'user_read' });
        if (__DEV__) console.warn('[userStore.hydrate] getCurrentUser', err);
        return null;
      }),
    ]);
    if (user) {
      set({ hydrated: true, onboardingDone, currentUser: user, guestInitFailed: false });
      return;
    }

    // ── No session at all ────────────────────────────────────────────────
    //
    // A fresh install, or a device somebody signed out of. Give it an
    // ANONYMOUS one rather than showing a sign-in wall: browsing Teamder does
    // not need an account, and the wall was the first thing every new person
    // met.
    //
    // Done here rather than in an effect so the boot stays atomic — `hydrated`
    // flips once, with the session already in hand, and nothing renders the
    // in-between state. An effect would paint the signed-out tree for a frame
    // first.
    //
    // NOT in mock mode: there `getCurrentUser` reads a seeded AsyncStorage
    // user, and manufacturing a guest when the seed is absent would change
    // what screenshot runs and QA see.
    await startSilentGuest(set, onboardingDone, 'silent');
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
    // Drop the old identity from the tree before anything else runs, so no
    // screen can render the previous account against the next session.
    set({ currentUser: null, guestInitFailed: false });
    // Wipe per-user stores so the next account (incl. the common
    // guest→register flow) never sees the previous user's communities/roster.
    useGroupStore.getState().reset();
    useGameStore.getState().reset();
    // chatStore held the previous account's unread counts — without this the
    // tab badge briefly leaked Account A's chat activity into Account B.
    useChatStore.getState().clear();
    // The pending action and its drafts are keyed to the DEVICE, not the uid.
    // Left in place they would resume the signed-out person's half-finished
    // club or availability under whoever signs in next.
    await clearSignedOutUserState();
    logEvent(AnalyticsEvent.SignOut);
    // Signing out of Teamder means becoming a guest, not leaving. Without this
    // the store sits at `currentUser: null, guestInitFailed: false` and the
    // navigator has nothing to render but the splash — forever.
    await startSilentGuest(set, get().onboardingDone, 'post_sign_out');
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
    await clearSignedOutUserState();
    logEvent(AnalyticsEvent.AccountDeleted);
    // Same terminal state as sign-out, reached a different way: the account is
    // gone and nothing would start a session, so the navigator would sit on the
    // splash. Deleting an account leaves you a guest, like a fresh install.
    await startSilentGuest(set, get().onboardingDone, 'post_sign_out');
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

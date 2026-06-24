import { create } from 'zustand';
import { User } from '@/types';
import { userService } from '@/services';
import { storage } from '@/services/storage';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';

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

  // Profile completion: true once name is set (covers the case where Google
  // gave us "" or the user hasn't seen the ProfileSetup screen yet).
  isProfileComplete: () => boolean;

  // Post-sign-in onboarding: true once /users/{uid}.onboardingCompleted is true.
  hasCompletedOnboarding: () => boolean;
  completePostSignInOnboarding: (
    patch: { name: string; avatarId?: string; photoUrl?: string },
  ) => Promise<void>;
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
    await userService.signOut();
    set({ currentUser: null });
    logEvent(AnalyticsEvent.SignOut);
  },

  deleteOwnAccount: async (password) => {
    await userService.deleteOwnAccount(password);
    set({ currentUser: null });
    logEvent(AnalyticsEvent.AccountDeleted);
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

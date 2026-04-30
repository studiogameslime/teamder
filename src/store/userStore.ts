import { create } from 'zustand';
import { User } from '@/types';
import { userService } from '@/services';
import { storage } from '@/services/storage';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

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
  signOut: () => Promise<void>;
  deleteOwnAccount: () => Promise<void>;
  updateProfile: (
    patch: Partial<Pick<User, 'name' | 'avatarId'>>
  ) => Promise<void>;

  // Profile completion: true once name is set (covers the case where Google
  // gave us "" or the user hasn't seen the ProfileSetup screen yet).
  isProfileComplete: () => boolean;

  // Post-sign-in onboarding: true once /users/{uid}.onboardingCompleted is true.
  hasCompletedOnboarding: () => boolean;
  completePostSignInOnboarding: (
    patch: { name: string; avatarId?: string }
  ) => Promise<void>;
}

export const useUserStore = create<UserStore>((set, get) => ({
  hydrated: false,
  onboardingDone: false,
  currentUser: null,

  hydrate: async () => {
    const [onboardingDone, user] = await Promise.all([
      storage.getOnboardingDone(),
      userService.getCurrentUser(),
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

  signOut: async () => {
    await userService.signOut();
    set({ currentUser: null });
    logEvent(AnalyticsEvent.SignOut);
  },

  deleteOwnAccount: async () => {
    await userService.deleteOwnAccount();
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

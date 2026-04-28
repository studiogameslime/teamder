// Top-level "decider": picks which sub-stack to render based on
// onboarding / auth / group state. We deliberately re-mount stacks on state
// transitions (no shared history) so each phase starts fresh.
//
// Existing GameRegistrationScreen still uses the old `RootStackParamList`
// type — we re-export it as an alias of GameStackParamList for backward
// compatibility, so I don't have to touch the working screens.

import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { OnboardingScreen } from '@/screens/onboarding/OnboardingScreen';
import { PostSignInOnboardingScreen } from '@/screens/onboarding/PostSignInOnboardingScreen';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { PendingApprovalScreen } from '@/screens/groups/PendingApprovalScreen';
import { colors } from '@/theme';
import { adsService } from '@/services/adsService';
import { initAnalytics } from '@/services/analyticsService';
import { notificationsService } from '@/services/notificationsService';
import { useGameStore } from '@/store/gameStore';

// Backward-compat: GameRegistrationScreen imports RootStackParamList from here.
export type { GameStackParamList as RootStackParamList } from './GameStack';

export function RootNavigator() {
  const userHydrated = useUserStore((s) => s.hydrated);
  const onboardingDone = useUserStore((s) => s.onboardingDone);
  const currentUser = useUserStore((s) => s.currentUser);
  const profileComplete = useUserStore((s) => s.isProfileComplete());
  const hasCompletedOnboarding = useUserStore((s) => s.hasCompletedOnboarding());
  const hydrateUser = useUserStore((s) => s.hydrate);

  const groupHydrated = useGroupStore((s) => s.hydrated);
  const hydrateGroup = useGroupStore((s) => s.hydrate);
  const membership = useGroupStore((s) =>
    currentUser ? s.getMembership(currentUser.id) : 'unknown'
  );

  // Hydrate user store on mount + initialize side services.
  // Each side service is wrapped so a failure in one doesn't break boot.
  useEffect(() => {
    hydrateUser();
    try {
      initAnalytics();
    } catch (err) {
      if (__DEV__) console.warn('[boot] initAnalytics threw', err);
    }
    try {
      adsService.initializeAds();
    } catch (err) {
      if (__DEV__) console.warn('[boot] adsService.initializeAds threw', err);
    }
  }, [hydrateUser]);

  // Show the app-open ad once we land on MainTabs, but never while a match
  // is locked/in-progress (the live screen shouldn't be obstructed by an ad).
  const gameStatus = useGameStore((s) => s.game.status);
  useEffect(() => {
    if (membership === 'member' && gameStatus !== 'locked') {
      adsService.showAppOpenAdIfAvailable();
    }
  }, [membership, gameStatus]);

  // After we know who the user is, hydrate their group state and tell
  // gameStore who "self" is (so registerSelf/cancelSelf use the auth uid in
  // Firebase mode rather than the mock-seed uid).
  const setGameCurrentUserId = useGameStore((s) => s.setCurrentUserId);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  useEffect(() => {
    if (currentUser) {
      hydrateGroup(currentUser.id);
      setGameCurrentUserId(currentUser.id);
      hydratePlayers([currentUser.id]);
    }
  }, [currentUser, hydrateGroup, setGameCurrentUserId, hydratePlayers]);

  // Phase E.2: register the device's push token once we have a user. The
  // helper is idempotent and quietly no-ops when the native module isn't
  // linked (Expo Go, fresh dev clients before rebuild) or when the user
  // declines the permission prompt — push features stay non-blocking.
  useEffect(() => {
    if (!currentUser) return;
    notificationsService
      .requestAndRegisterPushToken(currentUser.id)
      .catch((err) => {
        if (__DEV__) {
          console.warn('[boot] requestAndRegisterPushToken threw', err);
        }
      });
  }, [currentUser?.id]);

  // Splash while we figure out where to go.
  if (!userHydrated) return <Splash />;

  if (!onboardingDone) return <OnboardingScreen />;

  if (!currentUser) return <AuthStack initialRoute="SignIn" />;

  // Post-sign-in onboarding (welcome → how → profile confirm) before group
  // selection. Once completed, /users/{uid}.onboardingCompleted is true and
  // we fall through to the existing group flow. Existing accounts that
  // never had this field stay grandfathered as long as the converter writes
  // `false` rather than promoting them — they'll see it once.
  if (currentUser && !hasCompletedOnboarding) {
    return <PostSignInOnboardingScreen />;
  }

  if (!profileComplete) return <AuthStack initialRoute="ProfileSetup" />;

  // Wait for group hydration so the membership state is real.
  if (!groupHydrated) return <Splash />;
  if (membership === 'pending') return <PendingApprovalScreen />;
  // New users without any community land directly on MainTabs — the
  // Communities tab is the first/default tab, so they immediately see
  // the public-groups feed and can join from there. The legacy
  // GroupStack (GroupChoose / GroupCreate / GroupJoin / GroupSearch)
  // is no longer reachable from this entry point.
  return <MainTabs />;
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

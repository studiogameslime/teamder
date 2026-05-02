// Top-level "decider": picks which sub-stack to render based on
// onboarding / auth / group state. We deliberately re-mount stacks on state
// transitions (no shared history) so each phase starts fresh.
//
// Existing GameRegistrationScreen still uses the old `RootStackParamList`
// type — we re-export it as an alias of GameStackParamList for backward
// compatibility, so I don't have to touch the working screens.

import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { OnboardingScreen } from '@/screens/onboarding/OnboardingScreen';
import { PostSignInOnboardingScreen } from '@/screens/onboarding/PostSignInOnboardingScreen';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { navigateInvite } from './navigationRef';
import { colors } from '@/theme';
import { adsService } from '@/services/adsService';
import { notificationsService } from '@/services/notificationsService';
import { storage } from '@/services/storage';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { toast } from '@/components/Toast';
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

  // Pending-deep-link consumer. We deliberately wait for the user to be
  // fully ready (profile complete, group state hydrated) before firing
  // navigation — otherwise the target screen could mount before auth
  // and Firestore reads would 401. `consumedRef` guarantees we hit the
  // navigator at most once per app launch.
  // Pending-invite consumer — the SOLE place in the app that touches
  // the navigator with a deep-link target. App.tsx only stashes;
  // deepLinkService never navigates. Keeping a single consumer makes
  // double-navigation impossible.
  //
  // Readiness = "user is signed in and onboarded". We deliberately do
  // NOT wait on `groupHydrated`: it adds a noticeable delay and the
  // membership distinction (full details vs public details) is a UX
  // optimization, not a correctness requirement — public details
  // works for any signed-in user regardless of membership.
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    if (!currentUser || !profileComplete || !hasCompletedOnboarding) return;
    consumedRef.current = true;
    (async () => {
      const pending = await storage.getPendingInvite();
      if (__DEV__) {
        console.info('[invite] consumer — pending before consume', pending);
      }
      if (!pending) return;

      // Pre-flight existence check. If the target is gone (deleted
      // game, missing community), we surface a friendly toast and
      // skip the navigation rather than dumping the user on a
      // silently-empty screen. A *fetch error* (network, transient)
      // doesn't block — we navigate optimistically and let the
      // target screen render its own loading/error UI.
      let exists = true;
      try {
        if (pending.type === 'session') {
          exists = (await gameService.getGameById(pending.id)) !== null;
        } else {
          exists = (await groupService.getPublic(pending.id)) !== null;
        }
      } catch (err) {
        if (__DEV__) console.warn('[invite] pre-flight failed', err);
        exists = true;
      }
      if (!exists) {
        if (__DEV__) {
          console.info('[invite] consumer — target missing, dropping', pending);
        }
        toast.error('הקישור לא תקין או שהפריט כבר לא קיים');
        await storage.clearPendingInvite();
        return;
      }

      // Best-effort membership read — pulls the latest store state at
      // consume time (not via the React deps array, which would force
      // us to wait on group hydration). If groups haven't loaded yet
      // we route to the public details screen, which works for
      // members and non-members alike.
      const cachedGroups = useGroupStore.getState().groups;
      const isMember =
        pending.type === 'team'
          ? cachedGroups.some((g) => g.id === pending.id)
          : false;
      if (__DEV__) {
        console.info('[invite] consumer — navigating', {
          type: pending.type,
          id: pending.id,
          isMember,
        });
      }
      const ok = navigateInvite({
        type: pending.type,
        id: pending.id,
        isMember,
      });
      // Only clear on a successful navigation — if the navigator
      // wasn't ready (rare race at cold start), keep the stash so
      // the next mount/foreground retries. `consumedRef` guards
      // against re-firing on the same mount.
      if (ok) {
        if (__DEV__) console.info('[invite] consumer — cleared after navigate');
        await storage.clearPendingInvite();
      } else if (__DEV__) {
        console.info(
          '[invite] consumer — navigateInvite returned false, keeping stash',
        );
      }
    })().catch((err) => {
      if (__DEV__) console.warn('[invite] consume failed', err);
    });
  }, [currentUser, profileComplete, hasCompletedOnboarding]);

  // Hydrate user store on mount + initialize side services.
  // Each side service is wrapped so a failure in one doesn't break boot.
  useEffect(() => {
    hydrateUser();
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
  // No more dedicated full-screen views for "pending request" or "new
  // user without community". Both states fall through to MainTabs and
  // surface their context inline (toasts on submit + a "pending" tag
  // in the communities feed).
  return <MainTabs />;
}

function Splash() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SoccerBallLoader size={56} />
    </View>
  );
}

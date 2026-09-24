// Top-level "decider": picks which sub-stack to render based on
// onboarding / auth / group state. We deliberately re-mount stacks on state
// transitions (no shared history) so each phase starts fresh.
//
// Existing GameRegistrationScreen still uses the old `RootStackParamList`
// type — we re-export it as an alias of GameStackParamList for backward
// compatibility, so I don't have to touch the working screens.

import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SplashVisual } from '@/screens/SplashScreen';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { PostSignInOnboardingScreen } from '@/screens/onboarding/PostSignInOnboardingScreen';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { navigateInvite, navigatePersonalInvite } from './navigationRef';
import { colors } from '@/theme';
import { adsService } from '@/services/adsService';
import { initRemoteConfig } from '@/services/remoteConfigService';
import { notificationsService } from '@/services/notificationsService';
import { storage } from '@/services/storage';
import {
  readPendingAction,
  clearPendingAction,
  isOpenKind,
} from '@/services/pendingAction';
import { wasLandingShown, markLandingShown } from '@/services/inviteLanding';
import { resumePendingAction } from '@/services/actionCoordinator';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { toast } from '@/components/Toast';
import { useGameStore } from '@/store/gameStore';

// Backward-compat: GameRegistrationScreen imports RootStackParamList from here.
export type { GameStackParamList as RootStackParamList } from './GameStack';

export function RootNavigator() {
  const userHydrated = useUserStore((s) => s.hydrated);
  const guestInitFailed = useUserStore((s) => s.guestInitFailed);
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
    // Readiness is "we know who is asking", and a GUEST counts. The old
    // condition also required `profileComplete`, which is `name.trim().length
    // > 0` — and a guest's name is empty by construction. So every deep link
    // opened by somebody without an account was stashed, never consumed, and
    // they landed on the games feed wondering where the game went. Viewing a
    // public target needs no account; that is the whole point of the link.
    if (!currentUser) return;
    const viewerIsGuest = currentUser.isGuest === true;
    if (!viewerIsGuest && (!profileComplete || !hasCompletedOnboarding)) return;
    consumedRef.current = true;
    (async () => {
      // PendingAction is the source of truth now. It reads the new key and
      // falls back to deriving from the legacy one, so a target stashed by a
      // previous build still resolves — and the legacy key is left in place
      // for the seven other readers that have not moved.
      const action = await readPendingAction();
      if (__DEV__) {
        console.info('[invite] consumer — pending before consume', action);
      }
      if (!action) return;

      const ageMs = Math.max(0, Date.now() - action.createdAt);
      logEvent(AnalyticsEvent.PendingActionResumed, {
        kind: action.kind,
        origin: action.origin,
        age_ms: ageMs,
        is_guest: viewerIsGuest,
      });

      // Actions that WRITE are not consumable yet — the contextual auth that
      // completes them is the next round. Keeping them stashed is the correct
      // behaviour, not a gap: the intent is still valid and the machinery to
      // finish it arrives shortly. Clearing them here would silently discard
      // what somebody asked for.
      if (!isOpenKind(action.kind)) {
        if (__DEV__) {
          console.info('[invite] consumer — write action held for later', action.kind);
        }
        return;
      }

      // ── A personal invite ────────────────────────────────────────────
      //
      // An inviter and no target. It now has a destination — the landing that
      // says who sent you — and, more importantly, it must NOT be cleared.
      //
      // The line that used to be here cleared the stash, on the reasoning that
      // "attribution already landed at signup". That was true when a link sent
      // you to a sign-in wall: stash → sign up → attribute → clear, all in one
      // breath. The guest session reordered it. Now it is stash → anonymous
      // session → THIS consumer → browse → maybe sign up much later, and the
      // signup is what reads `footy.invite.pending`
      // (applyInviteAttributionIfFresh / applyAcquisitionIfFresh, in
      // userService). Clearing here meant every personal invite opened by
      // somebody without an account — which is the whole audience — was
      // credited to nobody.
      //
      // So the landing gets its own latch and the stash keeps its own
      // lifetime; see `inviteLanding.ts`.
      if (action.kind === 'open_invite') {
        const invitedBy = action.invitedBy;
        // ── No inviter, no invitation ──────────────────────────────────
        //
        // `open_invite` covers more than a friend's link. The Play Install
        // Referrer resolves to `{type:'app', source:'google-play'}` on an
        // ORDINARY store install — an acquisition tag with nobody attached —
        // and the emulator run showed it opening "הזמינו אותך ל-Teamder" for
        // somebody who had simply downloaded the app. That is the app
        // inventing a friend.
        //
        // The stash still matters: `applyAcquisitionIfFresh` reads that same
        // `source` at signup. So this returns WITHOUT clearing and without
        // latching — nothing was shown, and there is nothing to remember.
        if (!invitedBy) return;
        if (await wasLandingShown(invitedBy)) return;
        const ok = navigatePersonalInvite({ invitedBy, source: action.origin });
        // Latch only on a navigation that actually happened. A navigator that
        // was not ready yet is a race to retry on the next mount, not an
        // invitation this device has already seen.
        if (ok) await markLandingShown(invitedBy);
        return;
      }

      // Narrow on the discriminant itself rather than through `isOpenKind`,
      // which is a boolean and cannot tell the compiler that `targetId` is
      // present. Everything past here has a real target.
      if (action.kind !== 'open_game' && action.kind !== 'open_club') return;

      // Shaped like the legacy value the rest of this effect was written
      // against, so the pre-flight and navigation below are untouched.
      const pending =
        action.kind === 'open_game'
          ? ({ type: 'session', id: action.targetId } as const)
          : ({ type: 'team', id: action.targetId } as const);

      // Pre-flight existence check. Three explicit outcomes:
      //   • exists=true  → navigate; the target screen renders the
      //     game/group as usual (or its own blocked-access UI).
      //   • exists=false → target genuinely deleted; toast + clear
      //     the stash so we don't keep retrying on next launch.
      //   • exists=true (after ACCESS_BLOCKED) → the doc exists but
      //     we can't read it (community-only invite to non-member).
      //     We still navigate so MatchDetails shows its dedicated
      //     blocked-access screen; the user gets a clear message
      //     instead of a misleading "link is invalid" toast.
      //   Any other fetch error (network/transient) is also
      //     optimistic-navigate — the target screen handles loading
      //     errors better than the consumer can here.
      let exists = true;
      try {
        if (pending.type === 'session') {
          exists = (await gameService.getGameById(pending.id)) !== null;
        } else {
          exists = (await groupService.getPublic(pending.id)) !== null;
        }
      } catch (err) {
        const code =
          typeof (err as { code?: unknown })?.code === 'string'
            ? ((err as { code: string }).code)
            : '';
        if (code === 'ACCESS_BLOCKED') {
          // Doc exists; viewer just isn't allowed in. Navigate so
          // the target screen can render the rules-blocked UI.
          exists = true;
        } else {
          if (__DEV__) console.warn('[invite] pre-flight failed', err);
          exists = true;
        }
      }
      if (!exists) {
        if (__DEV__) {
          console.info('[invite] consumer — target missing, dropping', pending);
        }
        logEvent(AnalyticsEvent.InviteLinkDead, {
          type: pending.type,
          id: pending.id,
        });
        logEvent(AnalyticsEvent.PendingActionFailed, {
          kind: action.kind,
          reason: 'target_deleted',
        });
        toast.error('הקישור לא תקין או שהפריט כבר לא קיים');
        await clearPendingAction();
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
        await clearPendingAction();
      } else if (__DEV__) {
        console.info(
          '[invite] consumer — navigateInvite returned false, keeping stash',
        );
      }
    })().catch((err) => {
      if (__DEV__) console.warn('[invite] consume failed', err);
    });
  }, [currentUser, profileComplete, hasCompletedOnboarding]);

  // ── Resuming what somebody asked for before they had an identity ────────
  //
  // Runs whenever there is a REAL account. That single condition covers all
  // three ways a resume becomes possible, which is why it is an effect on
  // `currentUser` rather than a callback at the auth site:
  //
  //   • the existing-account path replaced the session, so the navigator
  //     remounted and this fires on the way back up;
  //   • a brand-new account has just saved its name and avatar, which flips
  //     `hasCompletedOnboarding` and re-runs this;
  //   • the process died between authenticating and finishing, and this is the
  //     next launch.
  //
  // Idempotency comes from two places, not from a ref here: the coordinator
  // holds an in-flight lock keyed by action identity, and the stash is cleared
  // only on a TERMINAL business outcome — so a half-finished attempt is still
  // on disk to be tried again, and a finished one is gone.
  useEffect(() => {
    if (!currentUser || currentUser.isGuest === true) return;
    if (!hasCompletedOnboarding) return; // the profile screen is up; wait for it
    void resumePendingAction().catch((err) => {
      if (__DEV__) console.warn('[coordinator] resume failed', err);
    });
  }, [currentUser?.id, currentUser?.isGuest, hasCompletedOnboarding]);

  // Reaching the app with nothing to consume — the organic arrival. Fires once
  // per launch, after the consumer has had its chance, so it counts people who
  // opened Teamder rather than followed a link into it.
  const organicRef = useRef(false);
  useEffect(() => {
    if (organicRef.current || !currentUser || !groupHydrated) return;
    organicRef.current = true;
    void (async () => {
      const pending = await readPendingAction().catch(() => null);
      if (pending) return;
      logEvent(AnalyticsEvent.OrganicEntryViewed, {
        is_guest: currentUser.isGuest === true,
      });
    })();
  }, [currentUser, groupHydrated]);

  // Hydrate user store on mount + initialize side services.
  // Each side service is wrapped so a failure in one doesn't break boot.
  useEffect(() => {
    hydrateUser();
    // Fetch server-tunable knobs (ad frequency, etc.) early so they're
    // active before the app-open ad gate runs. Fire-and-forget; getters
    // fall back to in-code defaults until it resolves.
    void initRemoteConfig();
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
      // accountCreatedAt drives the new-user ad-free grace inside the service.
      adsService.showAppOpenAdIfAvailable({
        accountCreatedAt: currentUser?.createdAt,
      });
    }
  }, [membership, gameStatus, currentUser]);

  // After we know who the user is, hydrate their group state and tell
  // gameStore who "self" is (so registerSelf/cancelSelf use the auth uid in
  // Firebase mode rather than the mock-seed uid).
  const setGameCurrentUserId = useGameStore((s) => s.setCurrentUserId);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const subscribeGroups = useGroupStore((s) => s.subscribe);
  useEffect(() => {
    if (currentUser) {
      hydrateGroup(currentUser.id);
      setGameCurrentUserId(currentUser.id);
      hydratePlayers([currentUser.id]);
      // Live listener so incoming join requests (and any group change)
      // reach admins without an app restart. Torn down on sign-out / user
      // switch via the returned cleanup.
      const unsub = subscribeGroups(currentUser.id);
      return unsub;
    }
  }, [
    currentUser,
    hydrateGroup,
    subscribeGroups,
    setGameCurrentUserId,
    hydratePlayers,
  ]);

  // Live listener on the signed-in user's own /users doc → keeps currentUser
  // fresh with every server-derived change (stats, rating, friends,
  // achievements). Keyed on the ID only so a profile EDIT doesn't tear down
  // and re-attach the listener. Root fix for the "stale store" bug class.
  const subscribeCurrentUser = useUserStore((s) => s.subscribeCurrentUser);
  const currentUserId = currentUser?.id;
  useEffect(() => {
    if (!currentUserId) return;
    return subscribeCurrentUser(currentUserId);
  }, [currentUserId, subscribeCurrentUser]);

  // Phase E.2: register the device's push token once we have a user. The
  // helper is idempotent and quietly no-ops when the native module isn't
  // linked (Expo Go, fresh dev clients before rebuild) or when the user
  // declines the permission prompt — push features stay non-blocking.
  useEffect(() => {
    if (!currentUser) return;
    // Skip guests: an anonymous session shouldn't trigger the OS push-permission
    // prompt (App Store 5.1.1 friction) and would only register an orphan token
    // under a throwaway uid. Real push starts after a real sign-up.
    if (currentUser.isGuest) return;
    // REGISTER, never REQUEST. The OS permission dialog used to appear on the
    // first launch after signing in — before the person had seen a single game
    // — and a dialog asked at the wrong moment is usually answered "no" once,
    // permanently. The contextual prompt that replaces it lands in the next
    // round; until then we simply do not ask.
    //
    // Somebody who already granted push keeps everything: FCM rotates tokens,
    // so the refresh below still has to run on every launch for their existing
    // notifications to keep arriving.
    notificationsService
      .registerPushTokenIfPermitted(currentUser.id)
      .catch((err) => {
        if (__DEV__) {
          console.warn('[boot] registerPushTokenIfPermitted threw', err);
        }
      });
  }, [currentUser?.id]);

  // ── The decision tree ───────────────────────────────────────────────────
  //
  // What changed: arriving no longer costs an account. The old order was
  // carousel → sign-in wall → app, so the first thing a new person met was a
  // demand. Now `hydrate` starts an anonymous session when there is no
  // session, and an anonymous session is a LEGAL state of the app — not an
  // error, not a half-finished sign-up, and not something to be onboarded out
  // of.
  //
  // Splash while we figure out where to go.
  if (!userHydrated) return <Splash />;

  // No session AND the silent guest could not be started — realistically no
  // network on a fresh install. Fall back to the sign-in screen, which is
  // where this person landed before any of this existed. Without this branch
  // the splash would never end.
  if (!currentUser) {
    if (guestInitFailed) return <AuthStack initialRoute="SignIn" />;
    // Hydrate is still in flight (it flips `hydrated` only once the session
    // is in hand), so this is a belt-and-braces frame, not a normal path.
    return <Splash />;
  }

  // The three-screen carousel is deliberately NOT here any more. It ran before
  // anyone had seen the product, which is the worst moment to explain it. The
  // screen, the `onboardingDone` flag and its storage all still exist — see
  // the note on OnboardingScreen — they are simply no longer on the way in.
  //
  // Guests (anonymous "browse" sessions) skip the registration gates and go
  // straight to the tabs — browsing public communities/games must not require
  // an account (App Store guideline 5.1.1(v)). Account actions prompt sign-in.
  const isGuest = currentUser.isGuest === true;

  // Post-sign-in onboarding (welcome → how → profile confirm) before group
  // selection. Once completed, /users/{uid}.onboardingCompleted is true and
  // we fall through to the existing group flow. Existing accounts that
  // never had this field stay grandfathered as long as the converter writes
  // `false` rather than promoting them — they'll see it once.
  if (!isGuest && currentUser && !hasCompletedOnboarding) {
    return <PostSignInOnboardingScreen />;
  }

  if (!isGuest && !profileComplete) return <AuthStack initialRoute="ProfileSetup" />;

  // Wait for group hydration so the membership state is real.
  if (!groupHydrated) return <Splash />;
  // No more dedicated full-screen views for "pending request" or "new
  // user without community". Both states fall through to MainTabs and
  // surface their context inline (toasts on submit + a "pending" tag
  // in the communities feed).
  return <MainTabs />;
}

// Fallback splash for the rare case where RootNavigator re-renders
// with !groupHydrated AFTER the parent SplashScreen has already faded
// out (e.g. signing out + back in mid-session). Reuses the same
// visual as the boot splash so the user never sees a different
// loader — one big ball, end to end.
function Splash() {
  return <SplashVisual />;
}

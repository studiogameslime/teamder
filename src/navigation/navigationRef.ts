// Shared NavigationContainer ref used by non-React code (deep-link
// handler, push-notification taps) that needs to navigate without
// being mounted inside the React tree. App.tsx wires this same
// instance into the NavigationContainer's `ref` prop.

import { Linking } from 'react-native';
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

/**
 * Route a popup-campaign button tap (authored in Pulse) to the right
 * destination. Mirrors the action types in
 * src/services/campaignService.ts + pulse/src/services/campaigns.ts.
 * Returns false if it couldn't navigate (caller just closes the modal).
 */
export function navigateCampaign(action: {
  type: string;
  value?: string;
}): boolean {
  if (action.type === 'openUrl') {
    // Only allow safe web / own-scheme URLs — never javascript:, file:, etc.
    const v = (action.value ?? '').trim();
    if (/^(https?:\/\/|teamder:\/\/|footy:\/\/)/i.test(v)) {
      void Linking.openURL(v).catch(() => {});
    }
    return true;
  }
  if (!navigationRef.isReady()) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigationRef as unknown as { navigate: (...a: any[]) => void };
  switch (action.type) {
    case 'openGame':
      if (!action.value) return false;
      nav.navigate('GameTab', {
        screen: 'MatchDetails',
        initial: false,
        params: { gameId: action.value },
      });
      return true;
    case 'openCommunity':
      if (!action.value) {
        nav.navigate('CommunitiesTab', { screen: 'CommunitiesFeed' });
        return true;
      }
      // Public screen reads /groupsPublic/{id} — safe for non-members too.
      nav.navigate('CommunitiesTab', {
        screen: 'CommunityDetailsPublic',
        initial: false,
        params: { groupId: action.value },
      });
      return true;
    case 'openProfile':
      nav.navigate('ProfileTab', { screen: 'Profile' });
      return true;
    case 'openScreen': {
      // A small allowlist of safe top-level destinations by keyword.
      const v = (action.value ?? '').toLowerCase();
      if (v === 'communities') nav.navigate('CommunitiesTab', { screen: 'CommunitiesFeed' });
      else if (v === 'games') nav.navigate('GameTab', { screen: 'GamesList' });
      else if (v === 'achievements') nav.navigate('ProfileTab', { screen: 'Achievements' });
      else if (v === 'profile') nav.navigate('ProfileTab', { screen: 'Profile' });
      else return false;
      return true;
    }
    case 'dismiss':
    default:
      return true;
  }
}

/**
 * Navigate to a deep-linked screen. Tab navigators receive the
 * sub-screen via the `screen` + `params` shape.
 *
 *   navigateInvite({ type: 'session', id: 'abc' })
 *     → MainTabs > GameTab > MatchDetails({ gameId: 'abc' })
 *
 *   navigateInvite({ type: 'team', id: 'xyz', isMember: false })
 *     → MainTabs > CommunitiesTab > CommunityDetailsPublic({ groupId: 'xyz' })
 */
export function navigateInvite(args: {
  type: 'session' | 'team';
  id: string;
  isMember?: boolean;
}): boolean {
  if (!navigationRef.isReady()) return false;
  // Cast to `any` because navigationRef has no generic type — the ref
  // is shared across stacks with different ParamLists. Each branch
  // below targets a known route shape verified by manual testing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigationRef as unknown as { navigate: (...a: any[]) => void };
  if (args.type === 'session') {
    nav.navigate('GameTab', {
      screen: 'MatchDetails',
      // Keep GamesList below MatchDetails in the stack — see the
      // navigateForPush calls below for the same rationale.
      initial: false,
      params: { gameId: args.id },
    });
    return true;
  }
  // Team — prefer the full details screen for members (richer view +
  // we know firestore rules allow them to read /groups/{id}). Public
  // screen reads /groupsPublic/{id} which is readable by any signed-in
  // user, so it's the safe fallback for not-yet-members.
  nav.navigate('CommunitiesTab', {
    screen: args.isMember ? 'CommunityDetails' : 'CommunityDetailsPublic',
    initial: false,
    params: { groupId: args.id },
  });
  return true;
}

/**
 * Route a tapped push notification to the most relevant screen, based
 * on the notification's `type` + payload. Returns false if the nav
 * isn't ready yet — the caller is expected to either retry or stash
 * the payload for later (App.tsx does the latter for cold-start taps).
 *
 * The mapping mirrors the user's intent for each push type. Every
 * NotificationType from `src/types/index.ts` is covered:
 *
 *   joinRequest         → AdminApproval queue (ProfileTab)
 *   approved/rejected   → MatchDetails (game flow) or CommunityDetails (group)
 *                         based on which id the payload carries
 *   newGameInCommunity  → MatchDetails for the new game (falls back to
 *                         the community's CommunityDetails if gameId is
 *                         missing — better than a dead-end)
 *   gameReminder        → MatchDetails (the reminded game)
 *   gameCanceledOrUpdated → MatchDetails (or the user's GamesList if
 *                         the game was deleted and the doc no longer
 *                         exists; MatchDetails handles the empty case)
 *   spotOpened          → MatchDetails (the freed spot)
 *   inviteToGame        → MatchDetails (invited game)
 *   rateReminder        → MatchDetails (where the rating CTA lives)
 *   gameFillingUp       → MatchDetails (the filling game)
 *   growthMilestone     → Achievements (where the badge / milestone
 *                         is displayed; payload.badgeId is read by
 *                         Achievements to highlight on entry)
 */
export function navigateForPush(
  type: string,
  data: Record<string, unknown>,
): boolean {
  if (!navigationRef.isReady()) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigationRef as unknown as { navigate: (...a: any[]) => void };
  const gameId = typeof data.gameId === 'string' ? data.gameId : undefined;
  const groupId = typeof data.groupId === 'string' ? data.groupId : undefined;

  switch (type) {
    case 'joinRequest':
      // Game-bound requests carry a gameId → open the game so the admin
      // approves/rejects right there (the pending section lives on
      // MatchDetails). Community requests have no gameId and go to the
      // admin approval queue in ProfileTab — a single home for "things
      // waiting on me", independent of which community sent it.
      if (gameId) {
        nav.navigate('GameTab', {
          screen: 'MatchDetails',
          params: { gameId },
        });
        return true;
      }
      nav.navigate('ProfileTab', { screen: 'AdminApproval' });
      return true;

    case 'approved':
    case 'rejected':
      // Game-context approvals carry a gameId; community ones carry
      // groupId. Pick the screen that matches what the user just got
      // a yes/no for.
      if (gameId) {
        nav.navigate('GameTab', {
          screen: 'MatchDetails',
          params: { gameId },
        });
        return true;
      }
      if (groupId) {
        nav.navigate('CommunitiesTab', {
          screen: 'CommunityDetails',
          initial: false,
          params: { groupId },
        });
        return true;
      }
      return false;

    case 'newGameInCommunity':
      // The notification announces a NEW game — drop the user straight
      // into the match details so they can see all info + join. If the
      // gameId is somehow missing fall back to the community page.
      if (gameId) {
        nav.navigate('GameTab', {
          screen: 'MatchDetails',
          params: { gameId },
        });
        return true;
      }
      if (groupId) {
        nav.navigate('CommunitiesTab', {
          screen: 'CommunityDetails',
          initial: false,
          params: { groupId },
        });
        return true;
      }
      return false;

    case 'gameReminder':
    case 'gameCanceledOrUpdated':
    case 'spotOpened':
    case 'spotOffered':
    case 'inviteToGame':
    case 'rateReminder':
    case 'gameFillingUp':
    case 'gameRsvpNudge':
    case 'gamePlayersJoined':
    case 'playerCancelled':
    // Cross-community filler flow — admin-side pushes ("someone
    // applied to fill", "no matching fillers right now") and the
    // candidate-side "fillerOpportunity" all carry a `gameId` in
    // the payload. Land the user on MatchDetails for that game so
    // they can see the filler section / approve / lower the trust
    // threshold without hunting through tabs.
    case 'fillerNoCandidates':
    case 'fillerInterestReceived':
    case 'fillerOpportunity':
    case 'gameShortageWarning':
      // Account-deletion variant: no specific gameId in the payload
      // (the user dropped from multiple games at once). Send the
      // admin to the Communities tab so they can pick which of
      // their groups to inspect.
      if (!gameId) {
        nav.navigate('CommunitiesTab', { screen: 'CommunitiesFeed' });
        return true;
      }
      nav.navigate('GameTab', {
        screen: 'MatchDetails',
        // `initial: false` ensures the tab's root screen (GamesList)
        // sits BELOW MatchDetails in the stack, so the in-screen
        // back arrow pops to GamesList instead of dumping the user
        // back on whichever tab was active before the push tap.
        initial: false,
        params: { gameId },
      });
      return true;

    case 'groupDeleted':
      // The community is gone — there's no destination doc to deep-
      // link into. Drop the user on the communities feed where they
      // can find a different community to join.
      nav.navigate('CommunitiesTab', { screen: 'CommunitiesFeed' });
      return true;

    case 'growthMilestone':
      // Achievements page surfaces all unlocked badges; the inner
      // detail popover keys off the optional `badgeId` payload field.
      nav.navigate('ProfileTab', { screen: 'Achievements' });
      return true;

    case 'promotePrompt':
      // Post-orphan-game push to the creator. Open the promote screen
      // pre-filled with the personal group + the source game.
      if (gameId && groupId) {
        nav.navigate('GameTab', {
          screen: 'PromoteOrphan',
          params: { groupId, gameId },
        });
        return true;
      }
      return false;

    case 'groupInvitation':
      // A user the orphan-game creator just promoted into a real
      // community has been invited. Land them on the community page —
      // they're in `pendingPlayerIds` and will see the "המתנה לאישור"
      // banner there.
      if (groupId) {
        nav.navigate('CommunitiesTab', {
          screen: 'CommunityDetails',
          initial: false,
          params: { groupId },
        });
        return true;
      }
      return false;

    default:
      return false;
  }
}

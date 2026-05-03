// Shared NavigationContainer ref used by non-React code (deep-link
// handler, push-notification taps) that needs to navigate without
// being mounted inside the React tree. App.tsx wires this same
// instance into the NavigationContainer's `ref` prop.

import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

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
 * The mapping mirrors the user's intent for each push type:
 *   joinRequest        → AdminApproval queue (ProfileTab)
 *   approved/rejected  → MatchDetails (game flow) or CommunityDetails (group)
 *   newGameInCommunity → MatchDetails for the new game
 *   gameReminder       → MatchDetails (the reminded game)
 *   gameCanceledOrUpdated → MatchDetails (or harmless if game deleted)
 *   spotOpened         → MatchDetails (the freed spot)
 *   inviteToGame       → MatchDetails (invited game)
 *   rateReminder       → MatchDetails (where the rating CTA lives)
 *   gameFillingUp      → MatchDetails (the filling game)
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
          params: { groupId },
        });
        return true;
      }
      return false;

    case 'newGameInCommunity':
    case 'gameReminder':
    case 'gameCanceledOrUpdated':
    case 'spotOpened':
    case 'inviteToGame':
    case 'rateReminder':
    case 'gameFillingUp':
    case 'imLate':
      if (!gameId) return false;
      nav.navigate('GameTab', {
        screen: 'MatchDetails',
        params: { gameId },
      });
      return true;

    default:
      return false;
  }
}

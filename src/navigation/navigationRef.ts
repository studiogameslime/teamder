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

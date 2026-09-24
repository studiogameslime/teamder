// Which Home, and what "tap the Home tab" means.
//
// Two places have to agree about this and they are in different files: the
// stack's `initialRouteName` (where you START) and the tab-press reset (where
// you go BACK to). When they disagree, a guest lands on the Option A Home and
// a single tap on the tab they are already on walks them off it and onto the
// profile wall — the screen the previous round took off the entry path.
//
// So the decision lives here, once, and both callers read it.

export type HomeRoute = 'GuestHome' | 'Profile';

/**
 * The Home-tab landing for this viewer.
 *
 * `isGuest` and nothing else. The alternative — separating a NEW full account
 * from an established one — has no clean signal: "in no club" is also true of
 * a veteran who left theirs, and a score invented to tell them apart would be
 * a guess applied to real people's home screens. It is also unnecessary:
 * `ProfileScreen` already carries the activation checklist that IS the
 * new-account experience. Guests are the round's target and the auth state
 * cannot be wrong about them.
 */
export function homeRouteFor(isGuest: boolean): HomeRoute {
  return isGuest ? 'GuestHome' : 'Profile';
}

/**
 * The configured root of a tab's nested stack.
 *
 * Used by the tab-press handler to reset a drilled-into stack back to its
 * root. Returns undefined for a tab it does not know, and the caller falls
 * back to the live first route.
 */
export function tabRootFor(tabName: string, isGuest: boolean): string | undefined {
  switch (tabName) {
    case 'GameTab':
      return 'GamesList';
    case 'CommunitiesTab':
      return 'CommunitiesFeed';
    case 'ChatTab':
      return 'ChatsList';
    case 'ProfileTab':
      return homeRouteFor(isGuest);
    default:
      return undefined;
  }
}

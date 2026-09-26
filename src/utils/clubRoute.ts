// Which club page a person is allowed to open.
//
// There are two, and they are not interchangeable. `CommunityDetails` is the
// members' page: it reads the canonical `/groups/{gid}` document, which the
// rules gate on membership —
//
//     allow read: if isSignedIn() && (
//       request.auth.uid in resource.data.playerIds ||
//       request.auth.uid in resource.data.adminIds ||
//       request.auth.uid in resource.data.pendingPlayerIds
//     );
//
// — so opening it as a non-member is not a degraded page, it is a
// `permission-denied` and a screen with nothing on it.
// `CommunityDetailsPublic` reads the public projection and is what everybody
// else gets.
//
// The clubs feed has always branched correctly. Two other entry points did
// not: the club chips on a player card, and the club row on a match screen
// both navigated straight to the members' page. Both are reachable by a GUEST
// — a public game → its roster → a player card, or the match screen itself —
// and 1.1.15 put a great many more guests in front of exactly those surfaces.
// Reported from production as `getGroup` / `communityDetailsReload`
// permission-denied on 1.1.15, first seen the morning the rollout began.
//
// One helper rather than three copies of the condition, because the next
// screen to link to a club will get it wrong in the same way.

import { useGroupStore } from '@/store/groupStore';

/** The route name to navigate to for `groupId`. */
export function clubRouteFor(groupId: string): 'CommunityDetails' | 'CommunityDetailsPublic' {
  // `groups` is exactly "the clubs this person belongs to" — the store loads
  // them from the same documents the rule checks, so membership here and
  // permission there cannot disagree.
  //
  // Anything unknown resolves to the PUBLIC page on purpose. Before the store
  // has hydrated, and for a guest, the honest answer is "not a member": the
  // public page renders for everyone, while the members' page renders for
  // nobody who is refused. Being briefly too cautious costs a member one tap;
  // being briefly too permissive costs a guest the whole screen.
  const mine = useGroupStore.getState().groups;
  return mine.some((g) => g.id === groupId)
    ? 'CommunityDetails'
    : 'CommunityDetailsPublic';
}

// The club card's state machine.
//
// One question — "what does this card say?" — has seven inputs (am I an admin,
// a member, pending, is it open, how far, how big, how active) and they used to
// be answered inline in JSX. This module answers it once, as data, so the
// component only paints.
//
// Everything here is pure. No Firebase, no navigation, no clock reads — `now`
// arrives as an argument — which is what makes the rules testable.

/** What the user is to this club. Order matters: see `resolveClubCard`. */
export type ClubRelation = 'admin' | 'member' | 'pending' | 'none';

/** The single badge allowed in the cover's top corner. */
export type ClubTopBadge = 'manager' | 'recommended' | null;

/** The single badge allowed in the cover's bottom corner. */
export type ClubActivity = 'veryActive' | 'active' | 'inactive' | null;

/** The one state the bottom button may be in. */
export type ClubCta = 'member' | 'join' | 'request' | 'requested';

export interface ClubCardContext {
  isAdmin: boolean;
  isMember: boolean;
  /** A join request of mine is awaiting an admin. */
  isPending: boolean;
  /** `Group.isOpen` — true = joining is auto-approved. */
  isOpen: boolean;
  playerCount: number;
  /** Kilometres from the viewer. Null when we have no location for either
   *  side — which must NOT be read as "far away". */
  distanceKm: number | null;
  /** Friends of mine who are members here. Empty for clubs I'm in — the
   *  section is hidden there by design. */
  friends: ClubFriend[];
  /** Games this club actually PLAYED in the last 30 / 60 days. Null when the
   *  counters haven't been computed yet, which renders no badge at all
   *  rather than a wrong "inactive". */
  gamesLast30: number | null;
  gamesLast60: number | null;
}

export interface ClubFriend {
  id: string;
  name: string;
  photoUrl?: string;
  avatarId?: string;
}

export interface ClubCardViewModel {
  relation: ClubRelation;
  topBadge: ClubTopBadge;
  activity: ClubActivity;
  cta: ClubCta;
  /** Friends to render, capped. Empty when the row must not appear. */
  friends: ClubFriend[];
  /** How many friends are NOT in `friends` — drives the "+N" bubble. */
  friendsOverflow: number;
  playerCount: number;
}

/** "Suits you" = close enough to reach AND big enough to actually play. */
export const RECOMMEND_MAX_KM = 10;
export const RECOMMEND_MIN_PLAYERS = 10;
/** Avatars shown before collapsing into "+N". */
export const FRIENDS_SHOWN = 3;

/**
 * Activity, from games the club really played.
 *
 * The bands are deliberately not exhaustive: a club that played nothing in the
 * last month but did play within two months gets NO badge. It isn't active
 * enough to advertise and calling it dead would be wrong — silence is the
 * honest answer, and it keeps the badge meaningful where it does appear.
 */
export function clubActivity(
  gamesLast30: number | null,
  gamesLast60: number | null,
): ClubActivity {
  // Counters absent = not computed yet. Saying "inactive" here would brand
  // every club as dead the moment the feature ships and before the first
  // sweep runs.
  if (gamesLast30 == null || gamesLast60 == null) return null;
  if (gamesLast30 >= 3) return 'veryActive';
  if (gamesLast30 >= 1) return 'active';
  if (gamesLast60 <= 0) return 'inactive';
  return null;
}

/**
 * The full card state.
 *
 * The order of the checks is the specification: admin outranks member,
 * membership outranks any join affordance, and a pending request outranks the
 * club's open/closed setting (otherwise an open club would keep offering
 * "הצטרף" to someone who already asked).
 */
export function resolveClubCard(
  ctx: ClubCardContext,
  _now = 0,
): ClubCardViewModel {
  const relation: ClubRelation = ctx.isAdmin
    ? 'admin'
    : ctx.isMember
      ? 'member'
      : ctx.isPending
        ? 'pending'
        : 'none';

  const inClub = relation === 'admin' || relation === 'member';

  const cta: ClubCta = inClub
    ? 'member'
    : relation === 'pending'
      ? 'requested'
      : ctx.isOpen
        ? 'join'
        : 'request';

  // Top corner holds ONE badge. Manager wins — it says something about the
  // user's standing, where "suits you" is only a suggestion, and stacking
  // them in the same corner would collide.
  const recommended =
    ctx.distanceKm != null &&
    ctx.distanceKm <= RECOMMEND_MAX_KM &&
    ctx.playerCount >= RECOMMEND_MIN_PLAYERS;
  const topBadge: ClubTopBadge =
    relation === 'admin' ? 'manager' : recommended ? 'recommended' : null;

  // Friends are a reason to JOIN. Showing "3 friends here" inside a club the
  // user is already in is noise, so the row is dropped entirely there.
  const friends = inClub ? [] : ctx.friends;

  return {
    relation,
    topBadge,
    activity: clubActivity(ctx.gamesLast30, ctx.gamesLast60),
    cta,
    friends: friends.slice(0, FRIENDS_SHOWN),
    friendsOverflow: Math.max(0, friends.length - FRIENDS_SHOWN),
    playerCount: ctx.playerCount,
  };
}

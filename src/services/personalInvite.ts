// What we can honestly say about the person who invited you.
//
// ─── The privacy shape of this file ──────────────────────────────────────
//
// A personal invite gives us one thing: a uid. Everything the landing screen
// shows has to be derived from that uid using ONLY what a guest is already
// allowed to read, and the rules are the boundary, not our good intentions:
//
//   • WHO they are comes from `/usersPublic` — the four-field mirror
//     (id, name, avatarId, photoUrl). `/users` is gated behind
//     `isFullAccount()`, so an anonymous session cannot read it and must not
//     try: a denied read is a permission error in the console for every
//     invited person on earth.
//
//   • WHAT they play comes from the PUBLIC GAMES QUERY the discovery feed
//     already runs — public, open, future — filtered to the ones this uid is
//     in. Every match in that result is a listing anybody browsing the app can
//     already see; the inviter's uid appearing in a roster we are allowed to
//     read is not a new disclosure.
//
//   • WHICH CLUBS comes from those games' `groupId`, resolved through
//     `/groupsPublic`. That is deliberately narrower than "the clubs Eliran is
//     in": it is "the clubs hosting a public match Eliran plays in". There is
//     no public membership index, and there should not be one — a club
//     somebody joined privately is not ours to announce because a friend sent
//     a link.
//
// Not read, at all: stats, availability, friends, email, phone, private clubs,
// member-only games. If a future caller wants one of those it will have to
// argue for it against this comment.
//
// ─── What it costs ───────────────────────────────────────────────────────
//
// One query (the games one, shared in shape with the Home feed), one get for
// the inviter, and at most `MAX_CLUBS` gets for the distinct clubs behind
// those games. No roster hydration, no N+1 over members.

import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { logError } from '@/services/errorLog';
import type { Game, GroupPublic, UserId } from '@/types';
import type { PublicUser } from '@/firebase/firestore';

/** Matches shown on the landing before it stops being a landing. */
export const MAX_GAMES = 3;
/** Clubs shown, and the cap on the gets this file will issue for them. */
export const MAX_CLUBS = 3;

export interface InviteContext {
  /** Public identity, or null when it could not be resolved — see
   *  `unresolvedReason`. The screen NEVER breaks on this being null. */
  inviter: PublicUser | null;
  /** Why `inviter` is null, for analytics. Absent when it resolved. */
  unresolvedReason?: 'no_inviter' | 'no_mirror' | 'read_failed';
  /** Public, open, future matches the inviter is in. */
  games: Game[];
  /** Public clubs hosting those matches. */
  clubs: GroupPublic[];
}

export const EMPTY_CONTEXT: InviteContext = { inviter: null, games: [], clubs: [] };

/**
 * Is this uid actually playing in this match?
 *
 * `players` only — not `waitlist` and not `pending`. "Eliran is in" has to be
 * true when the screen says it: somebody sixth in a queue is not in the squad,
 * and a request nobody has approved is not a fact about the match.
 */
function isPlaying(game: Game, uid: UserId): boolean {
  return game.players.includes(uid);
}

/**
 * Resolve the inviter's public identity.
 *
 * Separate from the context below because the screen renders it FIRST and on
 * its own: the hero is the whole point of a personal invite, and it must not
 * wait on — or be taken down by — a games query.
 */
export async function resolveInviter(
  invitedBy: string | undefined,
): Promise<{ inviter: PublicUser | null; reason?: InviteContext['unresolvedReason'] }> {
  if (!invitedBy) return { inviter: null, reason: 'no_inviter' };
  try {
    const [found] = await groupService.hydratePublicUsers([invitedBy]);
    // No mirror is an ordinary state, not an error: the account may predate
    // the backfill, or have been deleted. The screen has copy for it.
    if (!found) return { inviter: null, reason: 'no_mirror' };
    // A mirror with a blank name is a stub (the audit found ten of them, five
    // of which are test fixtures). "הגעת דרך " with nothing after it is worse
    // than the generic welcome.
    if (!found.name || found.name.trim().length === 0) {
      return { inviter: null, reason: 'no_mirror' };
    }
    return { inviter: found };
  } catch (err) {
    logError('resolveInviter', err, {});
    return { inviter: null, reason: 'read_failed' };
  }
}

/**
 * The public activity worth showing beside the invitation.
 *
 * Throws nothing. A failure here returns empty lists and the caller renders
 * the "nothing to show yet" state — the invitation itself does not depend on
 * whether a discovery query answered.
 */
export async function resolveInviteActivity(
  invitedBy: string | undefined,
  viewerId: UserId,
): Promise<{ games: Game[]; clubs: GroupPublic[] }> {
  if (!invitedBy) return { games: [], clubs: [] };
  let games: Game[] = [];
  try {
    // The discovery query, unchanged: public + open + future. It excludes
    // matches the VIEWER is already in, which is right here too — being shown
    // a game you have already joined is not a reason to have been invited.
    const open = await gameService.getOpenGames(viewerId, []);
    games = open.filter((g) => isPlaying(g, invitedBy)).slice(0, MAX_GAMES);
  } catch (err) {
    logError('resolveInviteGames', err, {});
    return { games: [], clubs: [] };
  }

  // Clubs behind those matches — deduped, capped, and each one a document the
  // rules already let any signed-in session read.
  const groupIds = Array.from(new Set(games.map((g) => g.groupId).filter(Boolean))).slice(
    0,
    MAX_CLUBS,
  );
  let clubs: GroupPublic[] = [];
  try {
    const found = await Promise.all(
      groupIds.map((id) => groupService.getPublic(id).catch(() => null)),
    );
    clubs = found.filter((g): g is GroupPublic => !!g);
  } catch (err) {
    // Games survive a club failure. They are separate sections on the screen
    // and there is no reason for one to take the other down.
    logError('resolveInviteClubs', err, {});
    clubs = [];
  }
  return { games, clubs };
}

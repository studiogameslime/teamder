/** Server-owned grants are separate from invitedUserIds (read access only). */
export type JoinInvitation = { inviterId: string; expiresAt: number };
export const INVITATION_TTL_MS = 7 * 86400000;
type Audience = {
  visibility?: unknown; createdBy?: unknown; players?: unknown; waitlist?: unknown;
  pending?: unknown; invitedUserIds?: unknown; acceptsFillers?: unknown;
  approvedInvites?: unknown;
};
type Club = { playerIds?: unknown; adminIds?: unknown; deletedAt?: unknown } | null;
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
export function validManagerInvitation(game: Audience, uid: string, club: Club, now: number): boolean {
  const grants = game.approvedInvites;
  if (!grants || typeof grants !== 'object') return false;
  const grant = (grants as Record<string, JoinInvitation>)[uid];
  return !!grant && typeof grant.expiresAt === 'number' && grant.expiresAt > now &&
    (grant.inviterId === game.createdBy || (!club?.deletedAt && ids(club?.adminIds).includes(grant.inviterId)));
}
export function roundJoinAccess(game: Audience, uid: string, club: Club, now: number): 'member' | 'invited' | 'candidate' | 'denied' {
  if (uid === game.createdBy || (!club?.deletedAt && ids(club?.adminIds).includes(uid)) ||
      (!club?.deletedAt && ids(club?.playerIds).includes(uid))) return 'member';
  if (validManagerInvitation(game, uid, club, now)) return 'invited';
  // Legacy invites grant access, never a new automatic approval. Filler pushes
  // also use this field, so it cannot safely be interpreted as approval.
  if (game.visibility === 'public') return 'member';
  const hadExplicitGrant = !!game.approvedInvites && typeof game.approvedInvites === 'object' && uid in game.approvedInvites;
  if (hadExplicitGrant && !(game.acceptsFillers === true && game.visibility !== 'private')) return 'denied';
  if (ids(game.invitedUserIds).includes(uid) ||
      (game.acceptsFillers === true && game.visibility !== 'private')) return 'candidate';
  return 'denied';
}
export function roundAcceptsInvitations(game: {status?: unknown; startsAt?: unknown; liveMatch?: unknown}, now: number): boolean {
  const phase = (game.liveMatch as {phase?: unknown} | undefined)?.phase;
  return (game.status === 'open' || game.status === 'scheduled') && phase !== 'live' &&
    !(typeof game.startsAt === 'number' && game.startsAt + 3600000 < now);
}

// notificationDedup — server-side mirror of `src/services/notificationDedup.ts`.
// Cloud Functions live in their own tsconfig rootDir (`functions/src`) so we
// can't import from the app source. Keep the two files in lockstep — the
// SAME dedupeKey/dedupeId must be produced on both sides for client-written
// and server-written notifications to collapse onto the same doc id when
// they target the same logical event.

export type NotificationKind =
  | 'joinRequest'
  | 'approved'
  | 'rejected'
  | 'newGameInCommunity'
  | 'gameReminder'
  | 'gameCanceledOrUpdated'
  | 'spotOpened'
  | 'spotOffered'
  | 'guestPromoted'
  | 'growthMilestone'
  | 'inviteToGame'
  | 'rateReminder'
  | 'gameFillingUp'
  | 'gameRsvpNudge'
  | 'gamePlayersJoined'
  | 'playerCancelled'
  | 'groupDeleted'
  | 'fillerOpportunity'
  | 'fillerInterestReceived'
  | 'fillerNoCandidates'
  | 'promotePrompt'
  | 'groupInvitation'
  | 'gameShortageWarning'
  | 'addedToGame'
  | 'friendRequest'
  | 'friendRequestAccepted';

export type NotificationEntity = 'game' | 'group' | 'user';

export interface DedupeInput {
  type: NotificationKind;
  recipientId: string;
  entityType: NotificationEntity;
  entityId: string;
  reason: string;
}

const COOLDOWN_MS: Record<NotificationKind, number> = {
  gameCanceledOrUpdated: 30 * 60 * 1000,
  newGameInCommunity: 12 * 60 * 60 * 1000,
  gameReminder: 6 * 60 * 60 * 1000,
  gameRsvpNudge: 6 * 60 * 60 * 1000,
  rateReminder: 7 * 24 * 60 * 60 * 1000,
  gameFillingUp: 24 * 60 * 60 * 1000,
  gamePlayersJoined: 5 * 60 * 1000,
  joinRequest: 5 * 60 * 1000,
  approved: 60 * 60 * 1000,
  rejected: 60 * 60 * 1000,
  spotOffered: 60 * 1000,
  spotOpened: 60 * 1000,
  guestPromoted: 60 * 1000,
  // Aggregation window for `playerCancelled`. Within 5 min of the FIRST
  // cancellation push, subsequent cancellations on the same game merge
  // into the same doc (count + names) without re-firing the trigger.
  playerCancelled: 5 * 60 * 1000,
  inviteToGame: 30 * 1000,
  fillerOpportunity: 6 * 60 * 60 * 1000,
  fillerInterestReceived: 60 * 1000,
  fillerNoCandidates: 6 * 60 * 60 * 1000,
  growthMilestone: 24 * 60 * 60 * 1000,
  groupDeleted: 24 * 60 * 60 * 1000,
  // One promote prompt per game — the cron flips
  // `game.promotePromptSent` after dispatch so the helper is the
  // belt-and-suspenders. 24h cooldown is irrelevant in practice but
  // safe.
  promotePrompt: 24 * 60 * 60 * 1000,
  // One group invitation per (recipient, group). Long cooldown so a
  // re-promote (edit) doesn't double-ping.
  groupInvitation: 24 * 60 * 60 * 1000,
  gameShortageWarning: 12 * 60 * 60 * 1000,
  // Admin registered a member to a game. Short cooldown so an admin
  // re-adding (e.g. after a mistaken remove) doesn't double-ping, but the
  // next genuine add still notifies.
  addedToGame: 5 * 60 * 1000,
  // Friendship pings — one per (sender, recipient) pair per day is plenty.
  friendRequest: 24 * 60 * 60 * 1000,
  friendRequestAccepted: 24 * 60 * 60 * 1000,
};

export function cooldownMsFor(type: NotificationKind): number {
  return COOLDOWN_MS[type] ?? 5 * 60 * 1000;
}

export function dedupeKeyFor(input: DedupeInput): string {
  return `${input.type}:${input.recipientId}:${input.entityType}:${input.entityId}:${input.reason}`;
}

export function dedupeIdFor(
  input: DedupeInput,
  nowMs: number = Date.now(),
): string {
  const cooldown = cooldownMsFor(input.type);
  const bucket = Math.floor(nowMs / cooldown);
  const raw = `${dedupeKeyFor(input)}__b${bucket}`;
  const safe = raw.replace(/[^A-Za-z0-9:_\-.]/g, '_');
  return safe.length > 480 ? safe.slice(0, 480) : safe;
}

/** Best-effort entity inference from (type, payload). Used both client-side
 *  (so existing call sites keep working without explicitly specifying
 *  entityType/entityId/reason) and server-side. */
export function inferEntityFromPayload(
  type: NotificationKind,
  recipientId: string,
  payload: Record<string, unknown>,
): { entityType: NotificationEntity; entityId: string; reason: string } {
  const gameId =
    typeof payload.gameId === 'string' ? (payload.gameId as string) : '';
  const groupId =
    typeof payload.groupId === 'string' ? (payload.groupId as string) : '';
  const action =
    typeof payload.action === 'string' ? (payload.action as string) : '';
  const requesterId =
    typeof payload.requesterId === 'string'
      ? (payload.requesterId as string)
      : '';
  const cancellingUserId =
    typeof payload.cancellingUserId === 'string'
      ? (payload.cancellingUserId as string)
      : '';
  const inviterId =
    typeof payload.inviterId === 'string'
      ? (payload.inviterId as string)
      : '';
  const milestone =
    typeof payload.milestone === 'string'
      ? (payload.milestone as string)
      : '';
  const fromUserId =
    typeof payload.fromUserId === 'string'
      ? (payload.fromUserId as string)
      : '';

  switch (type) {
    case 'joinRequest':
      // One pending request per (group, requester) — collapse repeats.
      return {
        entityType: 'group',
        entityId: groupId || recipientId,
        reason: requesterId ? `req-${requesterId}` : 'request',
      };
    case 'approved':
    case 'rejected':
      return gameId
        ? { entityType: 'game', entityId: gameId, reason: type }
        : { entityType: 'group', entityId: groupId || recipientId, reason: type };
    case 'newGameInCommunity':
      return {
        entityType: 'game',
        entityId: gameId || groupId || recipientId,
        reason: 'opened',
      };
    case 'gameReminder':
      return { entityType: 'game', entityId: gameId || recipientId, reason: 'reminder' };
    case 'gameRsvpNudge':
      return { entityType: 'game', entityId: gameId || recipientId, reason: 'rsvp-nudge' };
    case 'rateReminder':
      return { entityType: 'game', entityId: gameId || recipientId, reason: 'rate' };
    case 'gameFillingUp':
      return { entityType: 'game', entityId: gameId || recipientId, reason: 'filling-up' };
    case 'gamePlayersJoined':
      return { entityType: 'game', entityId: gameId || recipientId, reason: 'players-joined' };
    case 'gameCanceledOrUpdated':
      // `action` is critical — without it cancel/delete would collide with
      // a benign edit fired moments earlier.
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: action || 'updated',
      };
    case 'spotOpened':
    case 'spotOffered':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: type,
      };
    case 'guestPromoted':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: `guest-promoted-${
          typeof payload.guestName === 'string' ? payload.guestName : ''
        }`,
      };
    case 'inviteToGame':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: inviterId ? `inv-${inviterId}` : 'invite',
      };
    case 'addedToGame':
      // Admin registered this member to the game. One per (recipient, game).
      return { entityType: 'game', entityId: gameId || recipientId, reason: 'added' };
    case 'playerCancelled':
      // recipientId here is the admin; entity is the game. Reason is
      // intentionally NOT keyed by cancellingUserId — we WANT
      // cancellations from different players to share a dedupeKey so
      // they aggregate (count + names) into a single unread notice
      // instead of generating one push per cancellation. The
      // server-side `createNotificationOnce` aggregator (see
      // AGGREGATE_ON_DUPLICATE) does the merge work.
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: 'cancel',
      };
    case 'groupDeleted':
      return {
        entityType: 'group',
        entityId: groupId || recipientId,
        reason: 'deleted',
      };
    case 'fillerOpportunity':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: 'filler-opportunity',
      };
    case 'fillerInterestReceived':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: requesterId ? `interest-${requesterId}` : 'interest',
      };
    case 'fillerNoCandidates':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: 'no-candidates',
      };
    case 'growthMilestone':
      return {
        entityType: 'user',
        entityId: recipientId,
        reason: milestone || 'milestone',
      };
    case 'promotePrompt':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: 'promote-prompt',
      };
    case 'groupInvitation':
      return {
        entityType: 'group',
        entityId: groupId || recipientId,
        reason: 'invite',
      };
    case 'gameShortageWarning':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: 'shortage',
      };
    case 'friendRequest':
      return {
        entityType: 'user',
        entityId: fromUserId || recipientId,
        reason: 'friend-request',
      };
    case 'friendRequestAccepted':
      return {
        entityType: 'user',
        entityId: recipientId,
        reason: 'friend-accepted',
      };
  }
}

// notificationDedup — shared dedupe-key + bucket-id logic used by
// both the client (when writing notification docs from
// `notificationsService.dispatch`) and the Cloud Functions (Admin
// SDK helper `createNotificationOnce`).
//
// Why deterministic doc IDs?
//   The notification dispatch was producing duplicate pushes in two
//   scenarios:
//     1. The same logical event firing multiple times (e.g. an
//        admin editing a game ten times in quick succession produced
//        ten "game updated" pushes).
//     2. Two different code paths racing to dispatch the same
//        notification (e.g. groupStore wrapper + groupService both
//        dispatching `approved` → user got the push twice).
//
//   Auto-id `addDoc` writes always create a new doc, which fires
//   the `onDocumentCreated` trigger every time. Switching to
//   deterministic IDs makes the second concurrent write an UPDATE
//   (no trigger), so the natural "first-write-wins" semantics give
//   us free dedup.
//
// Why buckets?
//   We rotate the deterministic ID through cooldown buckets so that
//   AFTER the cooldown passes, a future event for the same
//   dedupeKey gets a fresh doc id and fires the trigger again —
//   which is the "if read, allow re-send" requirement at a coarse
//   time-granularity. (Real read-tracking needs UI work; this is
//   the pragmatic substitute.)

/** Notification types known to the system. Mirrors the union in
 *  `functions/src/index.ts` and `src/types`. Kept here as a string
 *  set so the helper doesn't depend on either side's enum. */
export type NotificationKind =
  | 'joinRequest'
  | 'approved'
  | 'rejected'
  | 'newGameInCommunity'
  | 'gameReminder'
  | 'gameCanceledOrUpdated'
  | 'spotOpened'
  | 'spotOffered'
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
  | 'friendRequestAccepted'
  | 'teamsGenerated';

/** Logical kind of entity the notification is about. `user` is
 *  used for a few cross-user events (rare). */
export type NotificationEntity = 'game' | 'group' | 'user';

export interface DedupeInput {
  type: NotificationKind;
  recipientId: string;
  entityType: NotificationEntity;
  entityId: string;
  /** A short discriminator for the SAME entity that distinguishes
   *  different reasons. e.g. for type=gameCanceledOrUpdated the
   *  reason might be 'updated' / 'cancelled' / 'deleted' so we
   *  don't dedupe a real cancel against a prior edit. */
  reason: string;
}

/** Cooldown windows tuned per notification type. Within the window,
 *  multiple events for the same dedupeKey collapse to one push. */
const COOLDOWN_MS: Record<NotificationKind, number> = {
  // Game lifecycle — protect against admin edit spam (the headline
  // bug). 30 minutes is long enough to suppress a flurry of
  // typos / repeated edits, short enough that a real subsequent
  // change gets through.
  gameCanceledOrUpdated: 30 * 60 * 1000,
  // Game open: one per game per 12h. The CF latch
  // (`openedNotificationSent`) is the primary defence; this is
  // belt-and-suspenders.
  newGameInCommunity: 12 * 60 * 60 * 1000,
  // Reminders — already latched by per-game flags; cooldown is
  // longer than the trigger window so a stuck retry doesn't
  // fire twice.
  gameReminder: 6 * 60 * 60 * 1000,
  gameRsvpNudge: 6 * 60 * 60 * 1000,
  rateReminder: 7 * 24 * 60 * 60 * 1000,
  gameFillingUp: 24 * 60 * 60 * 1000,
  gamePlayersJoined: 5 * 60 * 1000,
  // Approvals — usually one shot per user×community/game
  joinRequest: 5 * 60 * 1000,
  approved: 60 * 60 * 1000,
  rejected: 60 * 60 * 1000,
  // Waitlist promotion offer — short cooldown; if user passes, the
  // next offer is for a DIFFERENT recipient anyway, so dedup keys
  // diverge naturally.
  spotOffered: 60 * 1000,
  spotOpened: 60 * 1000,
  // Cancellation alerts — admin-facing, must surface fast. Short
  // cooldown so the first ping in a sequence wins; subsequent
  // cancellations for OTHER players use a different dedupeKey
  // (different cancellingUserId).
  // Aggregation window for `playerCancelled`. Within 5 min of the FIRST
  // cancellation push, subsequent cancellations on the same game merge
  // into the same doc (count + names) without re-firing the trigger —
  // server-side aggregator does the actual merge via Admin SDK.
  playerCancelled: 5 * 60 * 1000,
  // Direct invites — server already enforces a 30/hour rate limit;
  // cooldown here is just to dedupe accidental double-clicks.
  inviteToGame: 30 * 1000,
  // Filler matching
  fillerOpportunity: 6 * 60 * 60 * 1000,
  fillerInterestReceived: 60 * 1000,
  fillerNoCandidates: 6 * 60 * 60 * 1000,
  // Misc
  growthMilestone: 24 * 60 * 60 * 1000,
  groupDeleted: 24 * 60 * 60 * 1000,
  promotePrompt: 24 * 60 * 60 * 1000,
  groupInvitation: 24 * 60 * 60 * 1000,
  // Shortage warning — fires at most once per game per kickoff window.
  // 12h is wider than the runs that detect shortage so a missed retry
  // doesn't spam the admin.
  gameShortageWarning: 12 * 60 * 60 * 1000,
  addedToGame: 5 * 60 * 1000,
  // Friendship pings — one per (sender, recipient) pair per day is plenty.
  friendRequest: 24 * 60 * 60 * 1000,
  friendRequestAccepted: 24 * 60 * 60 * 1000,
  // Teams-ready — server fans out one doc per player (distinct recipients →
  // distinct dedupe keys) and latches re-spam via `teamsNotifiedAt`. This
  // cooldown only guards an accidental client double-call.
  teamsGenerated: 60 * 1000,
};

/** Pure helper. Returns the cooldown window for a given type
 *  (default 5 min for unknown). */
export function cooldownMsFor(type: NotificationKind): number {
  return COOLDOWN_MS[type] ?? 5 * 60 * 1000;
}

/** Plain-text representation of the dedupe key. Stored on the
 *  notification doc as `dedupeKey` for diagnostic / read-tracking
 *  queries. NOT used as the doc id (that's `dedupeIdFor`, hashed). */
export function dedupeKeyFor(input: DedupeInput): string {
  return `${input.type}:${input.recipientId}:${input.entityType}:${input.entityId}:${input.reason}`;
}

/** Doc id used for the notification.
 *
 *  Format: `<dedupeKey>__b<bucket>`.
 *  Bucket = floor(now / cooldownMs). Within the same bucket, two
 *  dispatches collide on the same doc id; the second `setDoc`
 *  becomes an UPDATE (no `onDocumentCreated` trigger → no second
 *  push). After the bucket rolls over, a new event lands on a
 *  fresh id and re-triggers the push.
 *
 *  Sanitisation: Firestore doc ids forbid `/`, leading/trailing
 *  `__`, and a few patterns. We replace any disallowed character
 *  with `_` and clamp the total length to 480 bytes (well under the
 *  1500-byte limit). */
export function dedupeIdFor(
  input: DedupeInput,
  nowMs: number = Date.now(),
): string {
  const cooldown = cooldownMsFor(input.type);
  const bucket = Math.floor(nowMs / cooldown);
  const raw = `${dedupeKeyFor(input)}__b${bucket}`;
  // Sanitise: keep alphanumerics + `:` + `-` + `_` + `.`. Replace
  // everything else (incl. `/`) with `_`.
  const safe = raw.replace(/[^A-Za-z0-9:_\-.]/g, '_');
  return safe.length > 480 ? safe.slice(0, 480) : safe;
}

/** Derive entityType / entityId / reason from `(type, payload)`. Lets the
 *  ~26 existing `notificationsService.dispatch` call sites keep their
 *  current shape — they pass `payload.gameId` etc. and we tease the
 *  entity info out for the dedupe key. Mirrored on the server side
 *  (functions/src/notificationDedup.ts) so identically-keyed events
 *  collide regardless of origin. */
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
    case 'inviteToGame':
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: inviterId ? `inv-${inviterId}` : 'invite',
      };
    case 'addedToGame':
      return { entityType: 'game', entityId: gameId || recipientId, reason: 'added' };
    case 'playerCancelled':
      // Reason intentionally NOT keyed by cancellingUserId — we want
      // cancellations from different players to share a dedupeKey and
      // aggregate (server-side `createNotificationOnce` merges
      // count + names into the existing unread doc).
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
      // Keyed by the sender so a re-send dedupes against the same doc.
      return {
        entityType: 'user',
        entityId: fromUserId || recipientId,
        reason: 'friend-request',
      };
    case 'friendRequestAccepted':
      // Keyed by the recipient (the accepter), who is the "other" party
      // from the sender's perspective.
      return {
        entityType: 'user',
        entityId: recipientId,
        reason: 'friend-accepted',
      };
    case 'teamsGenerated':
      // Per-player teams-ready push. Server fans these out directly (not via
      // client dispatch); keyed by game so a re-publish dedupes per player.
      return {
        entityType: 'game',
        entityId: gameId || recipientId,
        reason: 'teams-generated',
      };
  }
}

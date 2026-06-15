// Domain types for the app. These mirror the Firestore documents
// described in src/firebase/firestore.ts.
//
// CONCEPTUAL MODEL (matters!)
// ───────────────────────────
// • Group   = a permanent football community of 20–40 people. Membership is
//             persistent; admin approves new community members once.
// • GameSummary = a single scheduled session (e.g. "Thursday 23.5 at 20:00").
//               Each night belongs to one Group. Up to 15 group members
//               register per night; the rest land on a per-night waitlist.
// • Player  = the in-game role for a UserId during a specific GameSummary.
//             Currently 1:1 with User; kept separate so guests/ringers can be
//             added in the future without an auth account.

// ─── User ────────────────────────────────────────────────────────────────

export type UserId = string;

export interface User {
  id: UserId;
  name: string;
  email?: string;          // from Google account; optional in mock mode
  /**
   * Built-in avatar id (see src/data/avatars.ts). All app surfaces render
   * the user's face from this id; we no longer upload images to Storage.
   */
  avatarId?: string;
  /**
   * @deprecated Legacy field from the Storage-upload era. Kept readable so
   * existing user docs don't break, but never written for new accounts —
   * `avatarId` is the source of truth now.
   */
  photoUrl?: string;
  createdAt: number;       // ms epoch
  updatedAt?: number;
  /**
   * True once the user has finished the post-sign-in onboarding flow
   * (welcome → how-it-works → profile confirm). RootNavigator shows the
   * onboarding stack while this is false/missing.
   */
  onboardingCompleted?: boolean;

  /**
   * QA tester flag, toggled from the Pulse owner dashboard. Gates
   * tester-only surfaces in the app — currently the screenshot→bug-report
   * popup, which fires only when this is true.
   */
  qa?: boolean;

  /** When/where the user is generally available for pickup games. */
  availability?: UserAvailability;
  /**
   * Denormalized aggregate stats. Updated client-side at the moment a
   * relevant event happens (joined, attended, cancelled, won) — see
   * playerStatsService. Treated as best-effort, not authoritative.
   */
  stats?: UserStats;

  /**
   * Push tokens (one entry per device that's logged in). Cloud Functions
   * loop through the array when sending an FCM notification — multi-
   * device users get all of their phones notified.
   */
  fcmTokens?: string[];
  /** Per-type push notification preferences. */
  notificationPrefs?: NotificationPrefs;
  /**
   * Group ids the user has opted into "new game opened" notifications
   * for. Subscriptions are explicit per community so a member of many
   * groups isn't drowned in pings.
   */
  newGameSubscriptions?: GroupId[];

  /**
   * Accepted friends — a mutual, denormalized list of user ids kept in
   * sync on BOTH users' docs by a trusted callable when a friend
   * request is accepted. Powers the "הזמן חברים" picker in game
   * creation. Written ONLY server-side (Admin SDK) via
   * `acceptFriendRequest` / `removeFriendship` so a client can't fake a
   * friendship — see [[FriendRequestDoc]]. The converter reads it but
   * never writes it, so a profile save can't clobber the array.
   */
  friends?: UserId[];

  /**
   * The user's hidden "personal" community — created lazily on first
   * use of the "ללא קבוצה — משחק חד־פעמי" flow in GameCreate. All
   * orphan games this user creates land inside it so the rest of the
   * data model (game.groupId is non-null, rules expect a group, etc.)
   * keeps working unchanged. Once the user accepts the post-game
   * "צור קבוצה" prompt, this same group is promoted to a real
   * community via `promoteOrphanToGroup` and the field continues
   * pointing at the now-public group.
   *
   * Optional so legacy users round-trip; the callable creates it on
   * demand and writes it back here.
   */
  personalGroupId?: GroupId;

  /**
   * @deprecated Legacy from the jersey-as-avatar era. Round-tripped
   * by the converter so old user docs don't fail validation, but
   * never written for new accounts — visual identity is now driven
   * by `photoUrl` / `avatarId`.
   */
  jersey?: Jersey;

  /**
   * Counters + unlocked entries that drive the Player Card achievements
   * surface. All counters default to 0 when missing — see
   * `achievementsService.readCounters`. Optional so legacy users
   * round-trip without backfill.
   */
  achievements?: UserAchievementState;

  /**
   * Discipline counters + recent events. Drives the yellow/red card
   * badges on Player Card. Optional so legacy users round-trip.
   */
  discipline?: UserDisciplineState;

  /**
   * Invite attribution — set ONCE on fresh signup if the user arrived
   * via an invite link with `?invitedBy=<uid>`. Never overwritten and
   * never set on existing accounts. The four fields are written in
   * one transaction so `invitedBy` always implies the rest are set.
   * Powers the "שחקנים שהצטרפו דרכי" stat via a count aggregation.
   */
  invitedBy?: UserId;
  // 'app' = generic "invite to the app" link (no game/team target).
  invitedByType?: 'session' | 'team' | 'app';
  invitedByTargetId?: string;
  /**
   * Firestore server time at the moment we recorded the attribution
   * — written via `serverTimestamp()` (NOT client-side `Date.now()`)
   * so it's resistant to client-clock drift and useful for analytics
   * downstream. Read consumers can call `.toMillis()` to get a number.
   */
  invitedAt?: import('firebase/firestore').Timestamp;

  /**
   * UTM acquisition — set ONCE on fresh signup if the install arrived via
   * a tracked Pulse ad/share link (`?s=<source>&c=<campaign>`). Records
   * the channel so the admin can see which source drove the most
   * downloads / signups / game-joins. Independent of `invitedBy`.
   */
  acquisition?: {
    source: string;
    campaign?: string;
    gameId?: string;
    at: number;
  };

  /** Device platform + last-active ping, written on launch (Pulse segments). */
  platform?: 'ios' | 'android' | string;
  lastSeenAt?: number;
  /** Last broadcast-push timestamp — server-managed per-user daily cap. */
  lastBroadcastAt?: number;
}

// ─── Achievements ────────────────────────────────────────────────────────

/**
 * Buckets used to group achievements visually on the Player Card. Pure
 * presentation — the service treats every achievement the same.
 */
export type AchievementCategory = 'games' | 'teams' | 'invites' | 'coaching' | 'social';

/**
 * The counter that an achievement watches. All metrics live on
 * `User.achievements` (see `UserAchievementState`) so a single read
 * gives us everything we need to evaluate the full list.
 */
export type AchievementMetric =
  | 'gamesJoined'
  | 'teamsCreated'
  | 'teamsJoined'
  | 'invitesSent'
  | 'playersCoached'
  | 'friendsCount';

export interface UnlockedAchievement {
  id: string;
  /** ms epoch — the moment the threshold was first met. */
  unlockedAt: number;
}

export interface UserAchievementState {
  unlocked: UnlockedAchievement[];
  gamesJoined: number;
  teamsCreated: number;
  teamsJoined: number;
  invitesSent: number;
  /** Approvals an admin/coach has personally granted. */
  playersCoached: number;
  /** Accepted (mutual) friends. */
  friendsCount: number;
}

export const defaultAchievementState: UserAchievementState = {
  unlocked: [],
  gamesJoined: 0,
  teamsCreated: 0,
  teamsJoined: 0,
  invitesSent: 0,
  playersCoached: 0,
  friendsCount: 0,
};

// ─── Discipline (yellow / red cards) ─────────────────────────────────────

/** Why a card was issued. `manual` covers coach overrides. */
export type DisciplineReason = 'late' | 'no_show' | 'manual';
export type DisciplineCardType = 'yellow' | 'red';

export interface DisciplineEvent {
  /** Stable id — generated client-side via `disc-<ts>-<rnd>`. */
  id: string;
  userId: UserId;
  type: DisciplineCardType;
  reason: DisciplineReason;
  /** Game the event happened in. Absent for manual coach overrides. */
  gameId?: string;
  /** Coach who issued the card, when issued manually. */
  issuedBy?: UserId;
  createdAt: number;
}

export interface UserDisciplineState {
  yellowCards: number;
  redCards: number;
  lateCount: number;
  noShowCount: number;
  /** Last N events. Capped client-side to keep the user doc small. */
  events: DisciplineEvent[];
}

export const defaultDisciplineState: UserDisciplineState = {
  yellowCards: 0,
  redCards: 0,
  lateCount: 0,
  noShowCount: 0,
  events: [],
};

// ─── Jersey ──────────────────────────────────────────────────────────────

export type JerseyPattern = 'solid' | 'stripes' | 'split' | 'dots';

export interface Jersey {
  /** Hex string, e.g. '#E03131'. */
  color: string;
  pattern: JerseyPattern;
  /** 1–99. Not deduped across the app — two players can wear the same number. */
  number: number;
  /** Up to 10 chars. Falls back to first name when blank. */
  displayName: string;
}

/**
 * Per-type toggles for push notifications. All fields default to true
 * when absent (so a brand-new account gets the standard notifications
 * without having to fiddle with settings first).
 */
export interface NotificationPrefs {
  /** Admin: someone wants to join a community I run. */
  joinRequest: boolean;
  /** Player: my community-join request was approved or rejected. */
  approvedRejected: boolean;
  /** Player: a new game opened in a community I'm subscribed to. */
  newGameInCommunity: boolean;
  /** Player: a game I'm registered for starts soon. */
  gameReminder: boolean;
  /** Player: a game I'm in was canceled or rescheduled. */
  gameCanceledOrUpdated: boolean;
  /** Player: a registered player canceled and the waitlist promoted me. */
  spotOpened: boolean;
  /** Player (head of waitlist): a slot opened — confirm or pass. */
  spotOffered: boolean;
  /** Admin: a previously-batched group of players just confirmed attendance. */
  gamePlayersJoined: boolean;
  /** Admin: my community hit a member-count milestone. */
  growthMilestone: boolean;
  /** Player: someone invited me directly to a game. */
  inviteToGame: boolean;
  /** Player: a game I played in just ended — please rate teammates. */
  rateReminder: boolean;
  /** Player: a game in my community is almost full — last spots. */
  gameFillingUp: boolean;
  /** Player: gentle nudge 5h before a game I haven't RSVP'd to. */
  gameRsvpNudge: boolean;
  /** Organizer: a registered player just cancelled their participation. */
  playerCancelled: boolean;
  /** Member: a community I belong to was deleted by its admin. */
  groupDeleted: boolean;
  /** Organizer: not enough players have joined as the kickoff approaches. */
  gameShortageWarning: boolean;
  /** Player: someone sent me a friend request / accepted mine. Optional
   *  so existing pref objects round-trip without this key. */
  friendRequest?: boolean;
}

/** Defaults applied when `User.notificationPrefs` is missing or partial. */
export const defaultNotificationPrefs: NotificationPrefs = {
  joinRequest: true,
  approvedRejected: true,
  newGameInCommunity: true,
  gameReminder: true,
  gameCanceledOrUpdated: true,
  spotOpened: true,
  spotOffered: true,
  gamePlayersJoined: true,
  growthMilestone: false,
  inviteToGame: true,
  rateReminder: true,
  gameFillingUp: true,
  gameRsvpNudge: true,
  playerCancelled: true,
  groupDeleted: true,
  gameShortageWarning: true,
  friendRequest: true,
};

// ─── Friends ───────────────────────────────────────────────────────────

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';

/**
 * One friendship request. Stored at /friendRequests/{fromUserId__toUserId}
 * — the deterministic id stops a sender from queuing duplicate pending
 * requests at the same target, and lets us detect a reverse request.
 *
 * Friendship is MUTUAL: the two users are friends only once `status`
 * flips to 'accepted'. The accept is performed by a trusted callable
 * (Admin SDK) which also writes each user into the other's
 * `User.friends` array and pushes a `friendRequestAccepted` to the
 * sender. A decline just sets the status — no push is sent.
 */
export interface FriendRequestDoc {
  id: string;
  fromUserId: UserId;
  toUserId: UserId;
  status: FriendRequestStatus;
  createdAt: number;
  updatedAt?: number;
}

/** Discriminated union of dispatch payloads stored under /notifications. */
export type NotificationType =
  | 'joinRequest'
  | 'approved'
  | 'rejected'
  | 'newGameInCommunity'
  | 'gameReminder'
  | 'gameCanceledOrUpdated'
  | 'spotOpened'
  /**
   * Confirmation-required variant of spotOpened. Sent to the head of
   * the waitlist when a player slot opens — they must explicitly tap
   * "אישור" via the push action buttons (or in-app) to claim it. If
   * they pass / time out, the admin can advance to the next person.
   */
  | 'spotOffered'
  /**
   * Batched admin notification — N players who locked in attendance
   * within a short window are consolidated into one push. See
   * `flushPendingJoinerNotifs` in functions/src/index.ts.
   */
  | 'gamePlayersJoined'
  | 'growthMilestone'
  | 'inviteToGame'
  | 'rateReminder'
  | 'gameFillingUp'
  /**
   * 5h-before-kickoff "did you forget to RSVP?" push. Targeted at
   * community members who are NOT yet in players/waitlist/pending
   * for the game and haven't explicitly cancelled. Carries the
   * same `GAME_REMINDER` category as `gameReminder` so the user
   * can join/decline straight from the notification buttons.
   */
  | 'gameRsvpNudge'
  /**
   * Sent to the game admin (createdBy) every time a registered player
   * cancels their participation. The admin needs visibility into who
   * dropped out so they can chase replacements before the deadline.
   */
  | 'playerCancelled'
  /**
   * Sent to every member + admin of a community whose admin just
   * deleted the entire community. Distinct from `gameCanceledOrUpdated`
   * (which fans out to participants of the deleted games) — a member
   * who wasn't registered to any current game still wants to know
   * the community itself is gone.
   */
  | 'groupDeleted'
  /**
   * Post-orphan-game prompt to the creator: "שיחקתם נחמד 🤝 רוצה
   * לשמור את החברים? צור קבוצה בלחיצה". Fires from the
   * `promotePromptCron` after a game finishes inside a personal
   * (`isPersonal: true`) group. Single-shot per game (latched by
   * `game.promotePromptSent`).
   */
  | 'promotePrompt'
  /**
   * Push to participants of a freshly-promoted group: "{name} יצר
   * קבוצה ומזמין אותך". Fires from `promoteOrphanToGroup` to every
   * inviteUserId, asking them to confirm joining the new community.
   */
  | 'groupInvitation'
  /**
   * Admin-only nudge fired when a game is approaching kickoff but the
   * registered roster is below the configured min (or 80% of max).
   * Lets the organizer decide whether to cancel or wait it out —
   * replaces the previous auto-cancel behaviour.
   */
  | 'gameShortageWarning'
  /**
   * Recipient: someone sent you a friend request. Carries the sender's
   * id so the app can deep-link to the friends screen to accept/decline.
   */
  | 'friendRequest'
  /**
   * Requester: the person you asked accepted your friend request. No
   * push is ever sent for a declined request (by design).
   */
  | 'friendRequestAccepted';

/**
 * Document shape for /notifications/{id}. The client writes these on
 * triggering events; a Cloud Function picks them up, looks up the
 * recipient's fcmTokens + prefs, and delivers via FCM Admin SDK.
 *
 * `delivered` flips to true after the CF processes the doc. Until the
 * CF is deployed the docs accumulate harmlessly.
 */
export interface NotificationDoc {
  id: string;
  type: NotificationType;
  recipientId: UserId;
  /** Free-form payload, validated by the CF per type. */
  payload: Record<string, unknown>;
  createdAt: number;
  delivered?: boolean;
  deliveredAt?: number;
}

// ─── Chat ───────────────────────────────────────────────────────────────────
// Two chat scopes share one message shape + one screen:
//   game chat      → /games/{gameId}/messages/{id}   (registered players only)
//   community chat → /groups/{groupId}/messages/{id} (community members only)
// Access (read AND write) is members-only, enforced in firestore.rules.

export type ChatScope = 'game' | 'community';

export interface ChatMessage {
  id: string;
  /** Plain text (+ emoji). No images in v1. */
  text: string;
  senderId: UserId;
  /** Denormalised at send time so a message renders without an extra
   *  user fetch (avatar + name + text). WhatsApp-style historical naming. */
  senderName: string;
  senderAvatarId?: string;
  senderPhotoUrl?: string;
  /** ms epoch. Messages are ordered by this. */
  createdAt: number;
}

/**
 * Per-user unread index entry: /users/{uid}/chatUnread/{chatKey}.
 * Maintained by the message-trigger Cloud Function (fan-out on each new
 * message); the owner resets `count` to 0 when they open the chat. Powers
 * the chats-list sort + previews and the tab/per-chat unread badges.
 */
export interface ChatUnreadEntry {
  /** chatKey = `${scope}__${parentId}`. */
  id: string;
  count: number;
  lastMessageAt: number;
  lastText: string;
  lastSenderName: string;
  scope: ChatScope;
  parentId: string;
  title: string;
}

/** ISO weekday: 0=Sunday, 6=Saturday. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Coarse time-of-day buckets the user prefers to play in. */
export type TimeBucket = 'morning' | 'noon' | 'evening' | 'night';

export interface UserAvailability {
  /** Days the user is generally available, e.g. [4] = Thursday. */
  preferredDays: WeekdayIndex[];
  /** Preferred time-of-day buckets (replaces the old from/to fields in
   *  the UI; from/to kept below for backward compatibility). */
  preferredTimes?: TimeBucket[];
  /** @deprecated "HH:mm" 24h — superseded by `preferredTimes`. */
  timeFrom?: string;
  /** @deprecated "HH:mm" 24h — superseded by `preferredTimes`. */
  timeTo?: string;
  /**
   * @deprecated Pre-radius single-city field. Reads still work; new
   * writes go to `homeCity` + `availabilityRadiusKm`. The matcher
   * uses the home city + radius to filter games by distance.
   */
  preferredCity?: string;
  /**
   * @deprecated Multi-cities (Phase 1A). Replaced by the home-city
   * + radius pair below.
   */
  cities?: string[];
  /**
   * Home city (single, MUST be picked from autocomplete). Used by
   * the filler matcher together with `availabilityRadiusKm` to find
   * games near the user. Free-typed values are blocked at save by
   * the editor (see AvailabilityEditScreen).
   */
  homeCity?: string;
  /** Geocoded coords of `homeCity` — populated when the user picks
   *  the city from the dropdown. Used by the matcher's distance
   *  computation; clients only set them, never read. */
  homeCityLat?: number;
  homeCityLng?: number;
  /**
   * Radius (km) the user is willing to travel for a filler match.
   * Default 20. Matcher computes Haversine distance from
   * `homeCity` to the game's city; if greater than this, the user
   * is excluded from candidates regardless of `acceptsFillerPush`.
   */
  availabilityRadiusKm?: number;
  /** When false, the user is hidden from "Invite to Game" suggestions. */
  isAvailableForInvites: boolean;
  /**
   * Master opt-in for the cross-community filler push system. When
   * true AND `homeCity` is set, the user enters the candidate pool
   * that the scheduled CF scans when a community game in their
   * radius is short on players. Default: false (must opt in).
   */
  acceptsFillerPush?: boolean;
}

/**
 * Raw event counters only. Percentages (attendanceRate / cancelRate) are
 * derived at read time via the helpers below — never persisted, so they
 * can never drift from the underlying counts.
 */
export interface UserStats {
  totalGames: number;       // games the user was registered for and locked
  attended: number;         // status flipped to "arrived" by admin
  cancelled: number;        // user cancelled their own registration
  /** Lifetime "winner-stays" round wins — incremented server-side each time
   *  a round ends and the user was on the winning team (incl. as a filler). */
  wins?: number;
  /**
   * Lifetime goals scored. Not currently written by any path —
   * kept on the type so the profile UI can render a stable "0"
   * without a cast, and a future LiveMatch/round writer can fill
   * it in without a schema migration.
   */
  goals?: number;
}

export function getAttendanceRate(s: UserStats | undefined): number {
  if (!s || s.totalGames === 0) return 0;
  return Math.round((s.attended / s.totalGames) * 100);
}
export function getCancelRate(s: UserStats | undefined): number {
  if (!s || s.totalGames === 0) return 0;
  return Math.round((s.cancelled / s.totalGames) * 100);
}

// ─── Group (a community) ─────────────────────────────────────────────────

export type GroupId = string;

export interface Group {
  id: GroupId;
  name: string;
  /** Lowercase + trimmed form of `name`, used for case-insensitive prefix search. */
  normalizedName: string;
  /**
   * @deprecated A community is no longer tied to a single field. Field
   * info now lives on each Game. Kept optional for backward compat
   * with legacy /groups docs that pre-date the wizard split.
   * New groups created after the wizard refactor do NOT write this.
   */
  fieldName?: string;
  /** @deprecated Field info moved to Game. See `fieldName` above. */
  fieldAddress?: string;
  city?: string;
  /**
   * @deprecated Street belongs to per-game location, not the
   * community. Kept optional for legacy reads.
   */
  street?: string;
  /**
   * @deprecated Per-game address detail moved to Game.notes /
   * Game.fieldAddress. Kept optional for legacy reads.
   */
  addressNote?: string;
  description?: string;
  lat?: number;
  lng?: number;
  /**
   * Original founder of the team. Phase 8 — only the creator can
   * promote/demote coaches, and the creator can never be demoted.
   * Optional for backward compat: when missing, the first entry in
   * `adminIds` is treated as the founder.
   */
  creatorId?: UserId;
  /**
   * Coaches. Phase 8 renames the role conceptually — every entry here
   * is a coach with full management permissions (approve / create /
   * cancel games / remove players). Includes the founder.
   */
  adminIds: UserId[];
  playerIds: UserId[];          // approved community members
  pendingPlayerIds: UserId[];   // waiting for admin approval to join the COMMUNITY
  inviteCode: string;           // short token for code-based join
  /**
   * @deprecated Per-game roster cap moved to Game.maxPlayers. The
   * community no longer dictates a default for all its games.
   * Kept optional for legacy reads.
   */
  defaultMaxPlayers?: number;
  /**
   * If true, joining the community is auto-approved (no admin gate).
   * If false / undefined, admin must approve via /groupJoinRequests.
   * This single flag replaces the old `isOpenForRequests` — see git
   * history for the rename.
   */
  isOpen?: boolean;
  /** Hard cap on community membership. Enforced when approving a request. */
  maxMembers?: number;
  /**
   * Phone number (E.164 ideally) used by the "contact admin" button. The
   * UI opens https://wa.me/<digits> so + and dashes are tolerated.
   */
  contactPhone?: string;

  /**
   * @deprecated Recurring schedule moved to per-Game configuration.
   * A "recurring game" is now created via the Game wizard with a
   * `registrationOpensAt` set; the community no longer carries a
   * default day/time. Kept optional for legacy reads.
   */
  preferredDays?: WeekdayIndex[];
  /** @deprecated See `preferredDays`. */
  preferredHour?: string;
  /** Per-player cost in NIS (free if undefined or 0). */
  costPerGame?: number;
  /** @deprecated Use `description` or `rules`. Legacy free-text. */
  notes?: string;
  /**
   * Free-text "community rules" surfaced on the community details
   * screen. Distinct from `description` — this is the explicit
   * code-of-conduct.
   */
  rules?: string;

  /**
   * Admin-uploaded cover photo shown as the full-bleed hero on the
   * community details screen. A Firebase Storage download URL pointing
   * at /groups/{id}/cover.jpg. When absent, the UI falls back to the
   * bundled default stadium image. Only coaches can set it (enforced
   * in storage.rules via a Firestore admin lookup).
   */
  coverPhotoUrl?: string;

  /**
   * Built-in cover chosen from the in-app gallery (id from
   * src/data/coverImages.ts). Used when there's no uploaded
   * `coverPhotoUrl`. A new group gets a random one at creation; the
   * admin can switch to another gallery image or upload their own.
   */
  coverImageId?: string;

  /**
   * @deprecated Recurring-game configuration moved to per-Game
   * settings. The Game wizard now exposes a "recurring game" toggle
   * that drives `registrationOpensAt`. The community no longer
   * holds a default. All five fields are kept optional purely for
   * legacy reads — never written by new code paths.
   */
  recurringGameEnabled?: boolean;
  /** @deprecated See `recurringGameEnabled`. */
  recurringDayOfWeek?: WeekdayIndex;
  /** @deprecated See `recurringGameEnabled`. */
  recurringTime?: string;
  /** @deprecated See `recurringGameEnabled`. */
  recurringDefaultFormat?: GameFormat;
  /** @deprecated See `recurringGameEnabled`. */
  recurringNumberOfTeams?: number;

  /**
   * "Personal" / hidden community used to host one-shot games created
   * by users who didn't want to formally set up a community first.
   * The community exists in /groups so the rest of the app (rules,
   * notifications, fillers, balance) keeps working with no special
   * cases — but the UI never surfaces it as a real community: it's
   * filtered out of feeds, not searchable, and the games inside it
   * render with the "משחק חד־פעמי" label instead of the (empty)
   * community name.
   *
   * `isPersonal=true` is set on creation by the `ensurePersonalGroup`
   * callable. It flips to `false` when the user accepts the
   * post-game "צור קבוצה" prompt — at which point this group is
   * promoted to a real community via `promoteOrphanToGroup`.
   * `hidden=true` is the same lifecycle flag, kept as a separate
   * field for future use (e.g. an admin manually hiding a real
   * community).
   */
  isPersonal?: boolean;
  hidden?: boolean;

  createdAt: number;
  updatedAt?: number;
}

/**
 * Resolve the team's founder. Falls back to `adminIds[0]` for legacy
 * groups that pre-date the explicit `creatorId` field.
 */
export function getTeamCreatorId(g: Pick<Group, 'creatorId' | 'adminIds'>): UserId | undefined {
  return g.creatorId ?? g.adminIds[0];
}

// ─── Community-scoped player ratings ─────────────────────────────────────

/** Per-vote rating value. Pin the integer 1–5 in the type for safety. */
export type RatingValue = 1 | 2 | 3 | 4 | 5;

/**
 * One rater's vote on one rated user inside one community. Stored at:
 *   /groups/{groupId}/ratings/{ratedUserId}/votes/{raterUserId}
 *
 * Privacy rules in firestore.rules: only the rater themselves can
 * read this doc; other community members read the parent summary
 * (which strips voter identity).
 */
export interface RatingVote {
  raterUserId: UserId;
  ratedUserId: UserId;
  rating: RatingValue;
  createdAt: number;
  updatedAt: number;
}

/**
 * Summary doc kept in sync by a Cloud Function trigger so the client
 * never has to load every vote to display the average. Stored at:
 *   /groups/{groupId}/ratings/{ratedUserId}
 */
export interface GroupRatingSummary {
  userId: UserId;
  average: number; // 0..5; 0 means no votes yet
  count: number;
  sum: number;
  updatedAt: number;
}

/** Lightweight projection used by the search screen. */
export interface GroupSearchHit {
  id: GroupId;
  name: string;
  /** @deprecated Communities are no longer tied to a single field. */
  fieldName?: string;
  /** @deprecated See `fieldName`. */
  fieldAddress?: string;
  memberCount: number;
}

/**
 * Public-side projection of a Group. Stored in /groupsPublic/{groupId} and
 * mirrored from the private /groups doc by the admin (or a Cloud Function in
 * v2). Anyone signed-in can read this collection — that's why it deliberately
 * omits player lists, admin lists, and pending lists.
 */
export interface GroupPublic {
  id: GroupId;
  name: string;
  normalizedName: string;
  /** @deprecated Mirrored from Group; communities no longer own a field. */
  fieldName?: string;
  /** @deprecated See `fieldName`. */
  fieldAddress?: string;
  city?: string;
  /** @deprecated See `fieldName`. */
  street?: string;
  /** @deprecated See `fieldName`. */
  addressNote?: string;
  description?: string;
  memberCount: number;
  /** See `Group.isOpen`. Mirrored here so the public feed can show it. */
  isOpen?: boolean;
  maxMembers?: number;
  contactPhone?: string;
  /** Geo coords (WGS-84) — mirrored from `Group.lat`/`Group.lng`. Lets
   *  the "nearby" filter use radius-based matching instead of brittle
   *  city-name comparison. Optional for backward compat with older
   *  documents that predate this field. */
  lat?: number;
  lng?: number;
  /** Mirrored from Group. Lets the public showcase/feed render the cover. */
  coverPhotoUrl?: string;
  /** Mirrored from Group — built-in gallery cover id. */
  coverImageId?: string;
  /** @deprecated Recurring schedule moved to per-Game. Legacy reads only. */
  preferredDays?: WeekdayIndex[];
  /** @deprecated See `preferredDays`. */
  preferredHour?: string;
  costPerGame?: number;
  createdAt: number;
  updatedAt?: number;
}

// ─── Game history ─────────────────────────────────────────────────────────

export interface GameSummary {
  id: string;
  groupId: GroupId;
  date: number;       // ms epoch
  matchCount: number;
  lastResult?: { teamA: TeamColor; teamB: TeamColor; winner: TeamColor | 'tie' };
  /**
   * Terminal status — `'finished'` for normal completion, `'cancelled'`
   * for an admin-cancelled evening. Used by the History screen to
   * render the right banner. Optional for backward-compat with the
   * mock seed data which predates the field.
   */
  status?: 'finished' | 'cancelled';
  /**
   * Surface a couple of extra facets on the history row so the user
   * can tell games apart at a glance. Both optional — older summaries
   * skip them and the row degrades gracefully.
   */
  title?: string;
  fieldName?: string;
  format?: GameFormat;
}

// ─── Player ──────────────────────────────────────────────────────────────

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  displayName: string;
  avatarUrl?: string;
  /** Built-in avatar id chosen by the user (one of /data/avatars). */
  avatarId?: string;
  /** Uploaded profile photo URL — Firebase Storage download URL. */
  photoUrl?: string;
  /** @deprecated Legacy from the jersey-as-avatar era. Round-tripped
   *  for old docs; never written for new accounts. */
  jersey?: Jersey;
  stats?: PlayerStats; // denormalized for quick reads; recomputed server-side
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  attendancePct: number; // 0-100
  cancelRate: number;    // 0-100
}

// ─── Teams + rounds ───────────────────────────────────────────────────────

export type TeamColor = 'team1' | 'team2' | 'team3';

export interface Team {
  color: TeamColor;
  playerIds: PlayerId[];         // up to 5
  goalkeeperOrder: PlayerId[];   // ordered list, [0] = current GK
  isWaiting?: boolean;           // team currently sitting out
}

// ─── Draft Teams (חלוקת כוחות) ────────────────────────────────────────────
// Result of a manager-run captain draft, persisted on the game so the
// split survives and can be re-viewed. Independent of the live-match
// `teams`/`liveMatch` rotation model.
export interface DraftTeam {
  /** 0-based team index; 0 → 'א'. */
  index: number;
  captainId: UserId;
  /** All members, captain first, then players in the order they were picked. */
  playerIds: UserId[];
}
/** How a borrowed filler behaves when a short team is completed during the
 *  live rotation. 'temporary' = the filler returns to their home team the
 *  next time it comes on; 'permanent' = the filler stays with the team they
 *  completed (rosters reshape over the evening). Chosen on the draft screen. */
export type FillMode = 'temporary' | 'permanent';

export interface DraftTeamsResult {
  method: 'snake' | 'regular';
  numTeams: number;
  createdAt: number;
  createdBy: UserId;
  teams: DraftTeam[];
  /** Live-rotation fill behaviour. Defaults to 'temporary' when absent. */
  fillMode?: FillMode;
}

/** A player currently completing a team that isn't their own. */
export interface RotationLoan {
  playerId: UserId;
  /** The team the player actually belongs to (DraftTeam.index). */
  homeTeam: number;
  /** The team they're currently filling in for. */
  filledTeam: number;
}

/**
 * Live "winner stays" rotation state on top of `draftTeams`. Two teams play;
 * the rest wait in a queue. A round can only start when both playing teams
 * are FULL (per-team size = playersPerTeam) — a short incoming team is
 * completed by borrowing random players from the team that just lost.
 */
export interface MatchRotation {
  /** The two team indices on the field right now. */
  playing: [number, number];
  /** Team indices waiting to come on; front = next up. */
  waiting: number[];
  /** Fillers currently on a team that isn't their home. */
  loans: RotationLoan[];
  /** Wins per team index this session. */
  wins?: Record<string, number>;
  /** 1-based round counter. */
  round?: number;
  /** Registered uids who were on the winning team of the just-finished round
   *  (guests excluded — they have no user doc). A server function reads this
   *  to bump each player's lifetime `stats.wins`. */
  lastRoundWinners?: string[];
  /** Registered uids on the LOSING team of the just-finished round — for the
   *  pairwise "losses together" + "played on the same team" counts. */
  lastRoundLosers?: string[];
  /** Monotonic stamp of the last recorded result — the server function only
   *  awards wins when this advances (idempotent across listener ticks). */
  lastRoundAt?: number;
  updatedAt?: number;
}

export interface MatchRound {
  index: number;
  teamA: TeamColor;
  teamB: TeamColor;
  waiting: TeamColor;
  goalkeeperA: PlayerId;
  goalkeeperB: PlayerId;
  startedAt?: number;
  endedAt?: number;
  winner?: TeamColor | 'tie';
  /**
   * Snapshot of who was on each team when the round ENDED. Captured
   * by `LiveMatchScreen.endRound` so historical "who played with
   * whom" stats can be reconstructed later — `liveMatch.assignments`
   * itself only reflects the current/last round, not history.
   *
   * Optional because legacy rounds (saved before this field was
   * introduced) have no snapshot. Stats services treat the absence
   * as "no team data — exclude from same-team tallies".
   */
  teamAPlayerIds?: PlayerId[];
  teamBPlayerIds?: PlayerId[];
  /** Score recorded at end-of-round, useful for highlight reels. */
  scoreA?: number;
  scoreB?: number;
}

// ─── Game (one game night) ───────────────────────────────────────────────
// `Game` is the in-app type used by gameStore. Firestore mirrors it 1:1
// EXCEPT for the `matches` array (which lives in /rounds). Registration is
// flat user-id arrays — community-membership lives on Group, not here.

/**
 * Top-level lifecycle for a game/evening. Stage 2 lifecycle model:
 *
 *   scheduled  — future game; not yet open for registration. (Reserved
 *                for upcoming UX where the organizer drafts a game in
 *                advance; today most games are created already 'open'.)
 *   open       — registration is open. Users can join/cancel.
 *   locked     — registration closed. Admin prepares teams; no joins.
 *   active     — evening in progress. Live screen drives the
 *                sub-state via `liveMatch.phase`. No registration
 *                changes; admin can record goals / rotate rounds.
 *   finished   — evening ended. Read-only. Surfaces only in history.
 *   cancelled  — admin cancelled the game. Read-only. Hidden from the
 *                active/open lists. (Distinct from 'finished' — used
 *                to be overloaded; see `cancelGameByAdmin`.)
 *
 * Backward compat: legacy data may have `status='finished'` for what
 * is logically a cancellation. The lifecycle helpers in
 * `src/services/gameLifecycle.ts` treat both as terminal — the
 * distinction only matters for history labeling.
 */
export type GameStatus =
  | 'scheduled'
  | 'open'
  | 'locked'
  | 'active'
  | 'finished'
  | 'cancelled';
export type GameFormat = '4v4' | '5v5' | '6v6' | '7v7';
/** Surface of the pitch. Drives default match-duration suggestions. */
export type FieldType = 'asphalt' | 'synthetic' | 'grass';

export interface Game {
  id: string;
  groupId: GroupId;             // FK to /groups/{groupId}
  title: string;                // e.g. "חמישי כדורגל"
  startsAt: number;             // ms epoch
  fieldName: string;
  fieldLat?: number;
  fieldLng?: number;
  maxPlayers: number;           // 15
  /**
   * Optional minimum number of confirmed players required for the game to
   * actually run. Pure metadata for now — the UI surfaces it but doesn't
   * auto-cancel below the threshold.
   */
  minPlayers?: number;

  /** Approved registrations for this night, in order of arrival. ≤ maxPlayers. */
  players: UserId[];
  /** Per-night overflow waitlist, in order of arrival. */
  waitlist: UserId[];
  /**
   * Users awaiting organizer approval — only used when requiresApproval=true.
   * Distinct from waitlist (which is capacity overflow); these users
   * still need a yes/no decision from the game creator.
   */
  pending?: UserId[];
  /**
   * Denormalized union of `players + waitlist + pending`. Lets the
   * "my games" query be a single `array-contains` instead of three
   * unioned queries. Must be kept in sync on every write — see
   * gameService.joinGameV2 / cancelGameV2.
   */
  participantIds?: UserId[];
  /** Single user holding the ball / jerseys this night, or undefined. */
  ballHolderUserId?: UserId;
  jerseysHolderUserId?: UserId;
  /**
   * Players who self-marked "אני מביא כדור" via the in-game toggle.
   * Multiple bringers are allowed (often a backup is welcome). The
   * row in MatchParticipantsSection shows a ball icon next to their
   * name when they're in this list. Self-toggle only — see
   * `gameService.setBringingBall`.
   */
  ballBringerIds?: UserId[];

  teams?: Team[];               // populated once "Start Game" is pressed
  matches: MatchRound[];        // hydrated from /rounds in Firebase mode
  currentMatchIndex: number;

  /** Canonical status field — security rules read this. */
  status: GameStatus;
  /** Convenience boolean derived from status; kept for screens that read it. */
  locked: boolean;

  weather?: { tempC: number; rainProb: number };

  // ── New fields for the v2 Games tab. All optional so old docs still load.
  /** UID of the user who created the game. Required for approval workflows. */
  createdBy?: UserId;
  /**
   * Access-control on the game doc — the only flag controlling who
   * can read and discover the game.
   *
   *   • 'public'    — any signed-in user can read the game and join
   *                   (subject to `requiresApproval`). Surfaces in
   *                   the global "Open Games" feed.
   *
   *   • 'community' — only approved members + admins of the parent
   *                   group can read the game. Pending users are NOT
   *                   members and are blocked at the rules layer.
   *
   * Default at creation: `'public'` when the parent group is open
   * (`isOpen === true`), otherwise `'community'`. Admin can flip via
   * MatchDetailsScreen post-creation while the game is still in
   * status='open'.
   *
   * Optional in the type for legacy docs only — the converter
   * defaults missing fields to `'community'` (the conservative
   * choice; never silently exposes a doc).
   */
  visibility?: 'community' | 'public';
  /** When true, joining is a request that the creator must approve. */
  requiresApproval?: boolean;
  /** Match format. Drives team-size + player count suggestions. */
  format?: GameFormat;
  /** Number of teams (2–5). maxPlayers = playersPerTeam(format) * numberOfTeams. */
  numberOfTeams?: number;
  /**
   * Hours before kickoff after which a player can no longer cancel without
   * a "no-show". Pure metadata for now — the UI surfaces it but doesn't
   * auto-enforce.
   */
  cancelDeadlineHours?: number;
  /** Pitch surface. Phase 6 — drives a copy chip on the game card. */
  fieldType?: FieldType;
  /**
   * Total match duration in minutes. Used as the LiveMatch default
   * timer ceiling and surfaced on the game card. No auto-enforcement.
   */
  matchDurationMinutes?: number;
  /** "Someone needs to bring the ball" flag — UI toggle. */
  bringBall?: boolean;
  /** "Someone needs to bring the shirts" flag — UI toggle. */
  bringShirts?: boolean;
  /** Free-text note from the organizer ("שער צפוני, חניה ברחוב..."). */
  notes?: string;
  /** Per-game city override (defaults to the parent group's city in UI). */
  city?: string;
  /** Per-game full address override (defaults to the parent group's address). */
  fieldAddress?: string;
  /**
   * Free-text rule chips set by the organiser at create/edit time.
   * Each entry is a short label ("שופט", "משחקים עם חוצים", "ללא
   * החלקות"…) — no taxonomy, no preset list. Replaces the earlier
   * fixed booleans (`hasReferee`/`hasPenalties`/`hasHalfTime`) which
   * were too rigid: organisers wanted to surface their own rules,
   * not pick from a closed set.
   *
   * Display: rendered as a row of chips on MatchDetails when set.
   * Cap: 12 tags, each ≤30 chars (enforced in firestore.rules).
   */
  ruleTags?: string[];
  /** @deprecated See `ruleTags`. Kept readable so legacy game docs
   *  round-trip cleanly; never written by new code paths. */
  hasReferee?: boolean;
  /** @deprecated See `ruleTags`. */
  hasPenalties?: boolean;
  /** @deprecated See `ruleTags`. */
  hasHalfTime?: boolean;
  /** @deprecated See `ruleTags`. */
  extraTimeMinutes?: number;

  /**
   * Persisted live-match state — Phase D.1. Optional so unstarted games
   * (and old docs) round-trip cleanly. Mutated by LiveMatchScreen via
   * `gameService.setLiveMatch` and observed via `subscribeLiveMatch`.
   */
  liveMatch?: LiveMatchState;

  /** Captain-draft team split (חלוקת כוחות), set by the manager. */
  draftTeams?: DraftTeamsResult;

  /** Live "winner stays" rotation over `draftTeams` — which two teams play,
   *  who's waiting, and any borrowed fillers. Absent until the manager
   *  starts the rotation. */
  rotation?: MatchRotation;

  /**
   * ms epoch — the moment when this game's registration officially
   * opens. Until this point the game sits at `status: 'scheduled'`,
   * is hidden from every feed, and refuses joins. A scheduled CF
   * (`flipScheduledGames`) flips status to `'open'` and dispatches the
   * `newGameInCommunity` push to subscribers when the time arrives.
   *
   * Used today only by the recurring-game flow: an admin schedules a
   * weekly fixture days in advance but doesn't want it occupying feed
   * real estate (or accepting registrations) before, say, the day
   * before kickoff.
   *
   * Optional — when missing the game is feed-visible immediately on
   * creation, mirroring legacy behaviour for one-shot games.
   */
  registrationOpensAt?: number;

  /**
   * Idempotency latch flipped by `flipScheduledGames` once the CF has
   * dispatched the `newGameInCommunity` push for this game. Prevents
   * the cron from re-firing the notification on subsequent runs (e.g.
   * if the status flip failed and we retry), and prevents an admin
   * edit of `registrationOpensAt` from triggering a second push —
   * once the community has been notified, they don't need a duplicate.
   */
  openedNotificationSent?: boolean;

  /**
   * Recurring weekly fixture. When true, a Cloud Function clones this
   * game ~3h after kickoff into next week (startsAt +7d, and the same
   * relative registrationOpensAt / publicOpenAt / guestsOpenAt offsets),
   * so a community's regular game re-opens automatically every week with
   * the exact same settings. Just a toggle in the wizard — no series-
   * editing UI.
   */
  recurring?: boolean;

  /**
   * Idempotency latch: ms-epoch when the recurring clone-on-completion CF
   * created next week's instance from this game. Prevents the cron from
   * cloning the same fixture twice.
   */
  recurringNextCreatedAt?: number;

  /**
   * Optional ms-epoch when a community game flips from members-only
   * (`visibility:'community'`) to app-wide (`visibility:'public'`) so
   * non-members can see + join it from the feed. A Cloud Function flips
   * `visibility` at this time. Missing → visibility never auto-changes.
   */
  publicOpenAt?: number;

  /** Latch: set once the publicOpenAt visibility flip has been applied. */
  publicOpenedAt?: number;

  /**
   * Optional ms-epoch before which NON-admin players may not add guests.
   * The organiser/admin can always add guests; this only gates everyone
   * else. Missing → anyone allowed to add guests can do so anytime.
   */
  guestsOpenAt?: number;

  /**
   * Phase E.2.2: flipped to true by the scheduled `sendGameReminders`
   * Cloud Function once it has dispatched the 1h-before reminder, so a
   * subsequent run doesn't double-send.
   */
  reminderSent?: boolean;

  /**
   * Flipped to true by `sendRateReminders` once the post-game
   * "rate teammates" push has been dispatched. Idempotency guard so a
   * subsequent run doesn't re-notify the same players.
   */
  rateReminderSent?: boolean;

  /**
   * Flipped to true by `onGameRosterChanged` once the "almost full"
   * FOMO push has been dispatched for this game. We only want to fire
   * the notice once — additional joins shouldn't re-trigger.
   */
  capacityNoticeSent?: boolean;

  /**
   * Flipped to true by `sendRsvpNudges` once the 5h-before-kickoff
   * "did you forget to RSVP?" push has fanned out to community
   * members who hadn't joined or cancelled yet. Latches to one
   * dispatch per game.
   */
  rsvpNudgeSent?: boolean;

  /**
   * Per-player arrival status, keyed by user id. Missing keys are
   * treated as 'unknown'. Updated by player self-report ("I'm late" /
   * "I've arrived") today; future GPS-based arrival detection will
   * write to the same map. Discipline auto-issuance reads from here.
   */
  arrivals?: Record<UserId, ArrivalStatus>;

  /**
   * Admin-pinned announcement shown at the top of the game-details
   * screen. One short message (e.g. "המגרש החליף לדשא 2", "תביאו
   * חולצות שחורות") that broadcasts to everyone who can see the
   * game. Empty / missing → nothing rendered. Editable by admin via
   * the inline pencil on the pinned card. Capped at 280 chars in
   * the rules so it stays glanceable, not a full chat.
   */
  pinnedMessage?: string;

  /**
   * Set on games created via the "ללא קבוצה — משחק חד־פעמי" flow.
   * The game still belongs to a group (the creator's personal /
   * hidden community) — this flag tells the UI to render the game
   * as orphan-context: title shown as "משחק חד־פעמי", no community
   * link, no "פרטי קבוצה" CTA.
   *
   * Cleared (or stays untouched) on a regular community game.
   */
  isOrphanContext?: boolean;

  /**
   * Idempotency latch flipped by the `promotePromptCron` Cloud
   * Function once the post-game "rוצה לשמור את החברים?" push has
   * been dispatched to the creator. Prevents the cron from
   * re-firing on subsequent runs.
   */
  promotePromptSent?: boolean;

  /**
   * Per-player cancellation timestamp (ms epoch), keyed by user id.
   * Written by `cancelGameV2` whenever a registered user cancels;
   * used by the discipline-snapshot logic to distinguish "cancelled
   * in time" from "cancelled after the deadline" — only the latter
   * counts as a yellow card. The map is set-and-overwrite (latest
   * cancellation wins if the user re-joins then cancels again);
   * `joinGameV2` clears the entry on re-join so a stale timestamp
   * can't haunt a player who corrected their plan.
   */
  cancellations?: Record<UserId, number>;

  /**
   * Map of uid → ms epoch of when each player registered for this game.
   * Written on `joinGameV2` so the admin panel can show an accurate
   * "joined X ago" instead of falling back to the game's creation time.
   * Best-effort + client-written; games joined before this shipped have
   * no entry (consumers fall back to `createdAt`).
   */
  joinedAt?: Record<UserId, number>;

  /**
   * Pending waitlist promotion offer. Set by `cancelGameV2` when a
   * player slot opens and the waitlist isn't empty — the head of the
   * waitlist is "offered" the spot via a `spotOffered` push (with
   * confirm/pass action buttons). The slot is reserved (counted
   * toward capacity) until the user confirms / passes / the admin
   * advances. Cleared on confirm/pass/advance.
   */
  pendingPromotion?: { uid: UserId; offeredAt: number } | null;

  /**
   * Guests attached to this game only. Default `[]` for legacy docs.
   * Mutated by the coach via gameService.addGuest / removeGuest /
   * updateGuest — regular players can never write this field.
   */
  guests?: GameGuest[];

  /**
   * Phase: community-rating-driven auto-balance.
   * Minutes before kickoff to run the scheduled team generator.
   * Default 60 when missing.
   */
  autoTeamGenerationMinutesBeforeStart?: number;
  /** ms epoch — set by the scheduled function the first time teams are generated. */
  autoTeamsGeneratedAt?: number;
  /** Provenance marker so we can distinguish system-generated from coach-edited. */
  autoTeamsGeneratedBy?: 'system';
  /**
   * Flipped to true the moment the coach drags / shuffles the team
   * assignments. Once true, the scheduled auto-balance must skip
   * this game forever — manual edits are sticky.
   */
  teamsEditedManually?: boolean;
  /** Diagnostic snapshot of the last auto-balance run. */
  teamBalanceMeta?: {
    generatedAt: number;
    algorithm: 'rating_greedy_v1';
    unratedCount: number;
    teamRatings: number[];
  };

  // ── Cross-community filler matching (per-game opt-in) ─────────
  /**
   * When true, the game is open to receiving filler push notifications
   * for users outside the community whose `availability.cities`
   * includes the game's city. Default behaviour for new games is set
   * by the wizard (true for open communities, false for closed).
   */
  acceptsFillers?: boolean;
  /**
   * Minimum trust score (0-100) a filler must have to receive the
   * push for this game. `null` / undefined = no filter; players with
   * insufficient history (`score=null`) are NEVER pushed regardless
   * of this value (the `new` tier doesn't pass any minimum). Default
   * set by the wizard at 70.
   */
  fillerMinTrust?: number;

  createdAt: number;
  updatedAt?: number;
}

/**
 * Per-player arrival state for one game. `unknown` is the default until
 * the player self-checks-in or future GPS-based detection writes a
 * concrete status.
 */
export type ArrivalStatus = 'unknown' | 'arrived' | 'late' | 'no_show';

/**
 * A guest player attached to ONE game only. Guests are not real /users
 * docs — they have no account, no notifications, no achievements, no
 * player card. They DO count toward game capacity and DO participate in
 * team balancing. Only the game creator / community admin can add /
 * edit / remove guests.
 *
 * Wherever a player id is stored as a flat string (Team.playerIds,
 * LiveMatchState.assignments keys, …) guests are encoded as
 * `guest:<guestId>` so they don't collide with real uids.
 */
export interface GameGuest {
  id: string;
  /** Display name. Trimmed; max 20 chars (validated by service). */
  name: string;
  /** Optional 1–5 rating used by auto-balance when the coach knows the level. */
  estimatedRating?: number;
  /** uid of the coach who added the guest. */
  addedBy: UserId;
  createdAt: number;
}

/** Prefix used to distinguish guest ids from real uids in flat string id arrays. */
export const GUEST_ID_PREFIX = 'guest:';

export function isGuestId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(GUEST_ID_PREFIX);
}

export function toGuestRosterId(guestId: string): string {
  return `${GUEST_ID_PREFIX}${guestId}`;
}

export function parseGuestRosterId(rosterId: string): string | null {
  return isGuestId(rosterId) ? rosterId.slice(GUEST_ID_PREFIX.length) : null;
}

/**
 * Sub-state of an `active` game's live evening. The `'live'` value is
 * a legacy alias kept for backward compatibility with games written
 * before Stage 2 — newer code should prefer the round-aware
 * sub-states. Helpers in `gameLifecycle.ts` treat `'live'` and
 * `'roundRunning'` as equivalent for "match running" semantics.
 */
export type LiveMatchPhase =
  | 'organizing'
  | 'roundReady'
  | 'roundRunning'
  | 'roundEnded'
  | 'finished'
  | 'live';
/**
 * Per-player zones supported by the live-match screen. Up to 5 teams
 * (A..E) can exist in the roster; only the first two (A & B) appear on
 * the pitch at a time. The dedicated GK zones are scoped to those two
 * — waiting teams (C..E) hold their full roster in `team{X}` and pick a
 * keeper at swap-onto-field time.
 */
export type LiveMatchZone =
  | 'teamA'
  | 'teamB'
  | 'teamC'
  | 'teamD'
  | 'teamE'
  | 'bench'
  | 'gkA'
  | 'gkB';

export interface LiveMatchState {
  phase: LiveMatchPhase;
  /**
   * Wall-clock timestamp the FIRST time the timer was pressed — the
   * single signal that "this game actually happened". Used by
   * cleanupStaleGames to decide between deleting an unplayed roster
   * and finalising a played one, and by stats/trust pipelines to
   * skip games that were created and forgotten. Set once and never
   * cleared — pause/resume don't reset it. Absent on legacy games
   * written before this field existed (treated as "not started" for
   * cleanup purposes).
   */
  startedAt?: number;
  /**
   * Where each player currently sits. Stored as a flat object so it
   * round-trips through Firestore without special-casing Map.
   */
  assignments: Record<UserId, LiveMatchZone>;
  /**
   * Explicit ordering for the bench — Firestore object iteration is
   * unordered, so we keep a parallel array to preserve "first-on-bench
   * goes back in first" semantics.
   */
  benchOrder: UserId[];
  scoreA: number;
  scoreB: number;
  /** Score for team C — only used when numberOfTeams ≥ 3. */
  scoreC?: number;
  /** Score for team D — only used when numberOfTeams ≥ 4. */
  scoreD?: number;
  /** Score for team E — only used when numberOfTeams ≥ 5. */
  scoreE?: number;
  /**
   * Per-player slot index within their team's outfield. Lets the
   * coach drag a player into a specific formation position rather
   * than letting the UI auto-place. Keys are user ids whose
   * `assignments` value is `teamA`; the value is the formation outfield
   * index (0..playersPerTeam-2 — slot 0 of the formation is the
   * keeper, who lives in the `gkA` zone instead). Players with an
   * assignment of `teamA` but no entry here render in the first
   * available empty slot.
   */
  teamASlots?: Record<UserId, number>;
  teamBSlots?: Record<UserId, number>;
  /**
   * Current round (משחקון) number. Increments after every "סיים משחקון".
   * Optional so legacy state without the field reads as round 1.
   */
  roundNumber?: number;
  /**
   * Cumulative round-wins per team POSITION (A..E). The position is
   * stable across rotations — when a team loses and is rotated to the
   * back of the queue, the new active team starts fresh at 0. Used by
   * the team header so players can see who's been winning the day.
   * Optional so legacy live state without the field reads as 0 wins
   * for every team.
   */
  winsByTeam?: {
    A?: number;
    B?: number;
    C?: number;
    D?: number;
    E?: number;
  };

  // ─── Synced timer fields ─────────────────────────────────────────────
  // The shared, real-time-synced match clock. Every device looking at
  // the live match reads these three primitives and computes the
  // displayed time locally — no server ticking required. Admin
  // actions (start / pause / resume / reset) are wrapped in
  // Firestore transactions so two admins pressing the button at
  // exactly the same instant can't corrupt the math.
  //
  // Math:
  //   displayMs = timerAccumulatedMs +
  //     (timerRunning ? Date.now() - timerLastStartedAt : 0)
  //
  // Start :  running was false → set running=true, lastStartedAt=now
  // Pause :  running was true  → set accumulated += now - lastStartedAt,
  //                              running=false, lastStartedAt=null
  // Reset :  accumulated=0, running=false, lastStartedAt=null

  /** True while the timer is currently ticking. */
  timerRunning?: boolean;
  /** Wall-clock epoch of the most recent "start" press. Null while
   *  paused or never started. */
  timerLastStartedAt?: number | null;
  /** Total elapsed ms across all completed "running" segments —
   *  used to resume from where the previous pause left off. */
  timerAccumulatedMs?: number;
  /** User id of the admin who last touched a timer control. Renders
   *  as a "controlled by …" hint so other admins know who is driving. */
  timerControlledBy?: UserId | null;
  /** Denormalised display name of `timerControlledBy` so the hint UI
   *  doesn't have to look the user up. Optional — legacy state has
   *  neither field. */
  timerControlledByName?: string | null;

  /**
   * Chronological, synced log of every timer control press — drives the
   * "stoppages history" on the live screen so players can settle disputes
   * ("the clock kept running after the foul!"). Each entry is stamped in
   * the SHARED server-time base (`serverNow()`) so durations are identical
   * on every device. Cleared on reset. Kept small (one entry per press).
   */
  timerEvents?: TimerEvent[];

  /** Last write epoch (ms). Cheap "who edited most recently" tie-breaker. */
  updatedAt?: number;
}

/** One timer control press in `LiveMatchState.timerEvents`. */
export interface TimerEvent {
  /** 'start' = first press from 00:00; 'resume' = play after a pause;
   *  'pause' = stop. (Reset clears the whole log instead of logging.) */
  type: 'start' | 'resume' | 'pause';
  /** Server-time epoch (ms) of the press. */
  at: number;
  /** Denormalised name of whoever pressed — shown in the history row. */
  byName?: string | null;
}

// ─── Legacy types kept for compatibility ──────────────────────────────────
// The old Registration[] embedded array model is gone. These types stay so
// any leftover imports compile; they're unused by the new code.

export type RegistrationStatus =
  | 'registered'
  | 'waiting'
  | 'arrived'
  | 'no_show'
  | 'cancelled';

/** @deprecated Use `Game.players` / `Game.waitlist` instead. */
export interface Registration {
  playerId: PlayerId;
  status: RegistrationStatus;
  bringsBall?: boolean;
  bringsJerseys?: boolean;
  registeredAt: number;
}

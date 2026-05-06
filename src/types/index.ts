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
   * Visual identity. Replaces the old avatar surface across cards / lists
   * / live match. Optional so legacy users round-trip; the Jersey
   * component falls back to a deterministic auto-jersey derived from
   * `id`+`name` when this is missing.
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
  invitedByType?: 'session' | 'team';
  invitedByTargetId?: string;
  /**
   * Firestore server time at the moment we recorded the attribution
   * — written via `serverTimestamp()` (NOT client-side `Date.now()`)
   * so it's resistant to client-clock drift and useful for analytics
   * downstream. Read consumers can call `.toMillis()` to get a number.
   */
  invitedAt?: import('firebase/firestore').Timestamp;
}

// ─── Achievements ────────────────────────────────────────────────────────

/**
 * Buckets used to group achievements visually on the Player Card. Pure
 * presentation — the service treats every achievement the same.
 */
export type AchievementCategory = 'games' | 'teams' | 'invites' | 'coaching';

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
  | 'playersCoached';

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
}

export const defaultAchievementState: UserAchievementState = {
  unlocked: [],
  gamesJoined: 0,
  teamsCreated: 0,
  teamsJoined: 0,
  invitesSent: 0,
  playersCoached: 0,
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
  /** Admin: my community hit a member-count milestone. */
  growthMilestone: boolean;
  /** Player: someone invited me directly to a game. */
  inviteToGame: boolean;
  /** Player: a game I played in just ended — please rate teammates. */
  rateReminder: boolean;
  /** Player: a game in my community is almost full — last spots. */
  gameFillingUp: boolean;
  /** Organizer: a registered player just cancelled their participation. */
  playerCancelled: boolean;
  /** Member: a community I belong to was deleted by its admin. */
  groupDeleted: boolean;
}

/** Defaults applied when `User.notificationPrefs` is missing or partial. */
export const defaultNotificationPrefs: NotificationPrefs = {
  joinRequest: true,
  approvedRejected: true,
  newGameInCommunity: true,
  gameReminder: true,
  gameCanceledOrUpdated: true,
  spotOpened: true,
  growthMilestone: false,
  inviteToGame: true,
  rateReminder: true,
  gameFillingUp: true,
  playerCancelled: true,
  groupDeleted: true,
};

/** Discriminated union of dispatch payloads stored under /notifications. */
export type NotificationType =
  | 'joinRequest'
  | 'approved'
  | 'rejected'
  | 'newGameInCommunity'
  | 'gameReminder'
  | 'gameCanceledOrUpdated'
  | 'spotOpened'
  | 'growthMilestone'
  | 'inviteToGame'
  | 'rateReminder'
  | 'gameFillingUp'
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
  | 'groupDeleted';

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

/** ISO weekday: 0=Sunday, 6=Saturday. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface UserAvailability {
  /** Days the user is generally available, e.g. [4] = Thursday. */
  preferredDays: WeekdayIndex[];
  /** "HH:mm" 24h, inclusive. */
  timeFrom?: string;
  /** "HH:mm" 24h, inclusive. */
  timeTo?: string;
  /** Free-text city for "near me" match. No geo here. */
  preferredCity?: string;
  /** When false, the user is hidden from "Invite to Game" suggestions. */
  isAvailableForInvites: boolean;
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
  fieldName: string;
  fieldAddress?: string;
  city?: string;
  /** Street name selected from the Israeli streets dataset autocomplete. */
  street?: string;
  /** Free-text hint refining where exactly the field is (gate, landmark, etc.). */
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
  /** Default cap for game nights spawned from this group; usually 15. */
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

  /** Days the community usually plays on (e.g., [4] = Thursday). */
  preferredDays?: WeekdayIndex[];
  /** "HH:mm" — typical kick-off time of a regular game. */
  preferredHour?: string;
  /** Per-player cost in NIS (free if undefined or 0). */
  costPerGame?: number;
  /** Free-text notes shown on the community details screen. */
  notes?: string;
  /**
   * Phase 7: free-text "team rules" surfaced on the community details
   * screen. Distinct from `notes` (which is everyday housekeeping) — this
   * is the explicit code-of-conduct.
   */
  rules?: string;

  /** Phase 7: recurring-game configuration. All optional. */
  recurringGameEnabled?: boolean;
  /** 0..6, ISO weekday. */
  recurringDayOfWeek?: WeekdayIndex;
  /** "HH:mm" 24h. */
  recurringTime?: string;
  recurringDefaultFormat?: GameFormat;
  recurringNumberOfTeams?: number;

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
  fieldName: string;
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
  fieldName: string;
  fieldAddress?: string;
  city?: string;
  street?: string;
  addressNote?: string;
  description?: string;
  memberCount: number;
  /** See `Group.isOpen`. Mirrored here so the public feed can show it. */
  isOpen?: boolean;
  maxMembers?: number;
  contactPhone?: string;
  preferredDays?: WeekdayIndex[];
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
}

// ─── Player ──────────────────────────────────────────────────────────────

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  displayName: string;
  avatarUrl?: string;
  /** Hydrated from /users/{id}.jersey when available — drives the on-field
   *  Jersey component. Missing on legacy/mock data; the component falls
   *  back to a deterministic auto-jersey from id+displayName. */
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
export type GameFormat = '5v5' | '6v6' | '7v7';
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
  /** Game-rule flag: there's a referee on the night. */
  hasReferee?: boolean;
  /** Game-rule flag: penalty shootout decides ties. */
  hasPenalties?: boolean;
  /** Game-rule flag: matches play with halves (חוצים) instead of one straight period. */
  hasHalfTime?: boolean;
  /** Optional extra time minutes added to the match duration. */
  extraTimeMinutes?: number;

  /**
   * Persisted live-match state — Phase D.1. Optional so unstarted games
   * (and old docs) round-trip cleanly. Mutated by LiveMatchScreen via
   * `gameService.setLiveMatch` and observed via `subscribeLiveMatch`.
   */
  liveMatch?: LiveMatchState;

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
   * Per-player arrival status, keyed by user id. Missing keys are
   * treated as 'unknown'. Updated by player self-report ("I'm late" /
   * "I've arrived") today; future GPS-based arrival detection will
   * write to the same map. Discipline auto-issuance reads from here.
   */
  arrivals?: Record<UserId, ArrivalStatus>;

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
  /** Last write epoch (ms). Cheap "who edited most recently" tie-breaker. */
  updatedAt?: number;
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

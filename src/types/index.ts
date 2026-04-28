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
  /** Organizer: a registered player marked themselves as late. */
  imLate: boolean;
  /** Admin: my community hit a member-count milestone. */
  growthMilestone: boolean;
  /** Player: someone invited me directly to a game. */
  inviteToGame: boolean;
}

/** Defaults applied when `User.notificationPrefs` is missing or partial. */
export const defaultNotificationPrefs: NotificationPrefs = {
  joinRequest: true,
  approvedRejected: true,
  newGameInCommunity: true,
  gameReminder: true,
  gameCanceledOrUpdated: true,
  spotOpened: true,
  imLate: true,
  growthMilestone: false,
  inviteToGame: true,
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
  | 'imLate'
  | 'growthMilestone'
  | 'inviteToGame';

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

  /** Community vibe / skill level. Free-form union, "mixed" is the default. */
  skillLevel?: SkillLevel;
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
 * Vibe of a community / game. Strings (not numbers) so we can sort and
 * present in Hebrew without a numeric mapping.
 */
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'mixed';

/**
 * Resolve the team's founder. Falls back to `adminIds[0]` for legacy
 * groups that pre-date the explicit `creatorId` field.
 */
export function getTeamCreatorId(g: Pick<Group, 'creatorId' | 'adminIds'>): UserId | undefined {
  return g.creatorId ?? g.adminIds[0];
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
  skillLevel?: SkillLevel;
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

export type GameStatus = 'open' | 'locked' | 'finished';
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
  /** When true, surfaces in the public "Open Games" section. */
  isPublic?: boolean;
  /** When true, joining is a request that the creator must approve. */
  requiresApproval?: boolean;
  /** Match format. Drives team-size + player count suggestions. */
  format?: GameFormat;
  /** Number of teams (2–5). maxPlayers = playersPerTeam(format) * numberOfTeams. */
  numberOfTeams?: number;
  /** Suggested skill level for players joining this game. */
  skillLevel?: SkillLevel;
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

  /**
   * Persisted live-match state — Phase D.1. Optional so unstarted games
   * (and old docs) round-trip cleanly. Mutated by LiveMatchScreen via
   * `gameService.setLiveMatch` and observed via `subscribeLiveMatch`.
   */
  liveMatch?: LiveMatchState;

  /**
   * Phase E.2.2: flipped to true by the scheduled `sendGameReminders`
   * Cloud Function once it has dispatched the 1h-before reminder, so a
   * subsequent run doesn't double-send.
   */
  reminderSent?: boolean;

  /**
   * Per-player arrival status, keyed by user id. Missing keys are
   * treated as 'unknown'. Updated by player self-report ("I'm late" /
   * "I've arrived") today; future GPS-based arrival detection will
   * write to the same map. Discipline auto-issuance reads from here.
   */
  arrivals?: Record<UserId, ArrivalStatus>;

  createdAt: number;
  updatedAt?: number;
}

/**
 * Per-player arrival state for one game. `unknown` is the default until
 * the player self-checks-in or future GPS-based detection writes a
 * concrete status.
 */
export type ArrivalStatus = 'unknown' | 'arrived' | 'late' | 'no_show';

export type LiveMatchPhase = 'organizing' | 'live' | 'finished';
export type LiveMatchZone = 'teamA' | 'teamB' | 'bench' | 'gkA' | 'gkB';

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
  /** Players who tapped "I'm late". Persisted as an array. */
  lateUserIds: UserId[];
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

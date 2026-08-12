// analyticsService — thin wrapper over @react-native-firebase/analytics.
//
// Public API:
//   - `AnalyticsEvent`  — typed event-name constants
//   - `logEvent(name, params?)` — fire-and-forget, never throws
//
// In USE_MOCK_DATA / __DEV__ mode we still log to the console so devs
// can see what would be sent. Real delivery uses the native Firebase
// Analytics SDK that ships with @react-native-firebase, which talks
// directly to GoogleAnalyticsKit (iOS) / play-services-measurement
// (Android) over the binary plugged in via `google-services.json`.

import { Platform } from 'react-native';
import analytics from '@react-native-firebase/analytics';
import { USE_MOCK_DATA } from '@/firebase/config';
import { logError } from '@/services/errorLog';

export const AnalyticsEvent = {
  // Navigation
  ScreenView: 'screen_view',

  // Auth
  SignInSuccess: 'sign_in_success',
  SignOut: 'sign_out',
  AccountDeleted: 'account_deleted',
  OnboardingCompleted: 'onboarding_completed',

  // Profile
  ProfileCreated: 'profile_created',
  ProfileEdited: 'profile_edited',
  AvatarChanged: 'avatar_changed',
  PhotoUploaded: 'photo_uploaded',
  AvailabilitySet: 'availability_set',
  NotificationsToggled: 'notifications_toggled',

  // Groups
  GroupCreated: 'group_created',
  GroupSearch: 'group_search',
  GroupJoinRequested: 'group_join_requested',
  GroupJoinApproved: 'group_join_approved',
  GroupLeft: 'group_left',
  GroupMemberRemoved: 'group_member_removed',
  GroupSettingsEdited: 'group_settings_edited',
  GroupViewed: 'group_viewed',
  InviteShared: 'invite_shared',
  InviteCodeCopied: 'invite_code_copied',

  // Games
  GameCreated: 'game_created',
  GameJoined: 'game_joined',
  GameCancelled: 'game_cancelled',
  WaitlistJoined: 'waitlist_joined',
  RegistrationConflictBlocked: 'registration_conflict_blocked',
  GameEdited: 'game_edited',
  GameLocked: 'game_locked',
  GameStarted: 'game_started',
  GameFinished: 'game_finished',
  GameViewed: 'game_viewed',
  /** Player shared their post-game "סיכום הערב" card as an image. */
  SummaryShared: 'summary_shared',
  ArrivalMarked: 'arrival_marked',
  GuestAdded: 'guest_added',
  GuestRemoved: 'guest_removed',
  /** Admin decided on a pending /games/{id} join request — distinct
   *  from `GameJoined` so we can measure approval latency. */
  GameApprovalDecided: 'game_approval_decided',
  /** A registered user cancelled a game while inside the
   *  cancel-deadline window. Non-blocking — the discipline tracker
   *  also stamps the timestamp. */
  LateCancel: 'late_cancel',
  /** A user attempted to join/cancel a game that had already started
   *  (status='active' or kickoff time passed). Captures bad
   *  deep-link / stale-cache scenarios. */
  GameStartedJoinAttempt: 'game_started_join_attempt',
  /** A recurring game (deferred-open registration) was created. Lets
   *  us measure adoption of the recurring-game feature distinct from
   *  one-shot creation. */
  RecurringGameCreated: 'recurring_game_created',
  /** Promoted from waitlist into players when an earlier registrant
   *  cancelled. Useful for measuring waitlist health. */
  WaitlistPromoted: 'waitlist_promoted',

  // Discipline
  DisciplineCardIssued: 'discipline_card_issued',

  // Live match
  LiveMatchOpened: 'live_match_opened',
  PlayersShuffled: 'players_shuffled',
  TeamScoreChanged: 'team_score_changed',
  MatchRoundCompleted: 'match_round_completed',
  MatchCompleted: 'match_completed',
  /** Phase transitions on the live match (organizing → roundReady →
   *  roundRunning → roundEnded → finished). Lets us measure how
   *  long the typical match spends in each phase. */
  LiveMatchPhaseTransition: 'live_match_phase_transition',

  // Ratings
  PlayerRated: 'player_rated',
  RatingCleared: 'rating_cleared',

  // Achievements
  /** A user crossed an achievement threshold and the badge unlocked.
   *  Already tracked indirectly via `achievementsService.bump`; this
   *  surfaces it to GA so we can analyse engagement-by-badge. */
  AchievementUnlocked: 'achievement_unlocked',

  // Settings / preferences
  /** A specific notification toggle was flipped (vs. the existing
   *  `NotificationsToggled` which only counts how many are on). */
  NotificationPrefChanged: 'notification_pref_changed',

  // Growth
  /** We surfaced the in-app store-review prompt. The OS doesn't tell
   *  us whether the user actually rated, so this just measures how
   *  often the prompt was shown — gives us a top-of-funnel number
   *  to weigh against new ratings appearing in the store console. */
  StoreReviewPrompted: 'store_review_prompted',

  // Settings
  ReportBugClicked: 'report_bug_clicked',
  SuggestFeatureClicked: 'suggest_feature_clicked',
  RateAppClicked: 'rate_app_clicked',

  // ─── Friends ───────────────────────────────────────────────────────────
  /** A friend request was sent from one user to another. */
  FriendRequestSent: 'friend_request_sent',
  /** A friend request the user received was accepted. */
  FriendRequestAccepted: 'friend_request_accepted',
  /** A friend request the user received was declined. */
  FriendRequestDeclined: 'friend_request_declined',
  /** The user cancelled an outgoing friend request they had sent. */
  FriendRequestCancelled: 'friend_request_cancelled',
  /** A confirmed friendship was removed (either side initiated). */
  FriendRemoved: 'friend_removed',
  /** Friends screen / list was opened. */
  FriendsScreenOpened: 'friends_screen_opened',
  /** The "invite friends to game" picker inside the create-game wizard
   *  was opened (Step 3). Lets us count adoption of the new flow. */
  FriendPickerOpened: 'friend_picker_opened',
  /** Friends were attached to a freshly-created game as personal invitees. */
  FriendsInvitedToGame: 'friends_invited_to_game',

  // ─── Quick (no-community) games ────────────────────────────────────────
  /** The "ללא קבוצה / משחק חד־פעמי" CTA was tapped (entry to orphan flow). */
  QuickGameFlowStarted: 'quick_game_flow_started',
  /** A quick (orphan-context) game was successfully created. Distinct
   *  from `GameCreated` so adoption can be measured separately. */
  QuickGameCreated: 'quick_game_created',
  /** Post-game "צור קבוצה" prompt was accepted — the hidden personal
   *  group was promoted into a real community. */
  OrphanPromotedToCommunity: 'orphan_promoted_to_community',

  // ─── Approval flow (community membership) ──────────────────────────────
  /** Admin approved a pending community-join request. */
  GroupJoinApprovedByAdmin: 'group_join_approved_by_admin',
  /** Admin declined a pending community-join request. */
  GroupJoinDeclinedByAdmin: 'group_join_declined_by_admin',

  // ─── Wear OS companion ────────────────────────────────────────────────
  /** The watch sent a tap-action back to the phone via the Data Layer
   *  bridge. `action` distinguishes RSVP / open-on-phone / timer
   *  control. Phone-side counter — independent of any watch-side
   *  logging. */
  WatchActionReceived: 'watch_action_received',
  /** Phone-side: we pushed a state snapshot to the paired watch. Lets
   *  us measure sync throughput and detect regressions when the
   *  payload shape changes. */
  WatchSyncPushed: 'watch_sync_pushed',
  /** The watch app is detected as installed at session start (via
   *  the Wear capability API). Fires once per app launch. */
  WatchDetected: 'watch_detected',

  // ─── Phone home-screen widget ─────────────────────────────────────────
  /** The user tapped one of the widget's timer buttons (play / pause
   *  / reset). Captured via the deep link the widget fires on the
   *  Firestore round-trip; lets us measure widget engagement. */
  WidgetTimerAction: 'widget_timer_action',
  /** The user tapped the widget body to open the live match. */
  WidgetOpened: 'widget_opened',
  /** Phone-side: cached widget snapshot was refreshed in SharedPreferences. */
  WidgetSyncPushed: 'widget_sync_pushed',

  /** The Teamder Assistant card's CTA was tapped (params: scenario, id).
   *  Together with which scenario fired, this is how we learn which assistant
   *  lines actually move players and which are wallpaper. */
  HomeAssistantCtaTapped: 'home_assistant_cta_tapped',

  // ─── Discovery & filtering ─────────────────────────────────────────────
  /** A filter on the games-list screen was applied (date / city / format). */
  GameFilterApplied: 'game_filter_applied',
  /** All filters were cleared at once via the "נקה" button. */
  GameFilterCleared: 'game_filter_cleared',
  /** The filter sheet itself was opened. */
  GameFilterSheetOpened: 'game_filter_sheet_opened',
  /** The user switched between "פתוחים" and "שלי" tabs. */
  GamesTabSwitched: 'games_tab_switched',
  /** The Public Communities feed was opened (discovery surface). */
  PublicCommunitiesFeedOpened: 'public_communities_feed_opened',
  /** A community search was performed (typed query, ≥1 char). */
  CommunitySearchPerformed: 'community_search_performed',

  // ─── Cover photo & community media ─────────────────────────────────────
  /** Admin uploaded a new cover photo for a community. */
  CommunityCoverUploaded: 'community_cover_uploaded',
  /** Admin removed the cover photo (reverted to default). */
  CommunityCoverRemoved: 'community_cover_removed',

  // ─── Notifications — interactions ─────────────────────────────────────
  /** The user tapped on a push notification (any type). The `type`
   *  parameter mirrors the notification doc's type field. */
  NotificationOpened: 'notification_opened',
  /** An in-notification action button was tapped (join / cancel /
   *  view). Distinct from `NotificationOpened` (which is the body
   *  tap). */
  NotificationActionTapped: 'notification_action_tapped',
  /** The user explicitly tapped the in-app banner that announces an
   *  upcoming game (the "5 hours before" RSVP nudge surface). */
  RsvpNudgeOpened: 'rsvp_nudge_opened',

  // ─── Profile sub-screens ──────────────────────────────────────────────
  /** A specific profile sub-screen was opened (stats / achievements /
   *  history / friends / notifications-settings). */
  ProfileSectionOpened: 'profile_section_opened',
  /** The history / past games tab was opened. */
  HistoryOpened: 'history_opened',
  /** The stats screen was opened. */
  StatsOpened: 'stats_opened',
  /** Achievements screen was opened. */
  AchievementsOpened: 'achievements_opened',
  /** A single achievement card was tapped (drill-in). */
  AchievementCardTapped: 'achievement_card_tapped',

  // ─── Player card ──────────────────────────────────────────────────────
  /** The user opened another user's player card (drill-in from a
   *  game roster, community member list, or friend list). */
  PlayerCardOpened: 'player_card_opened',

  // ─── Sharing — granular surfaces ──────────────────────────────────────
  /** An invite share was completed (the system share sheet's
   *  `dismissedAction` is `false`). Better signal than `InviteShared`
   *  (which fires when the sheet opens). */
  InviteShareCompleted: 'invite_share_completed',
  /** A WhatsApp-specific share intent was launched (deep link). */
  WhatsappShareLaunched: 'whatsapp_share_launched',
  /** Deep-link arrival: the app was opened via an invite URL. */
  InviteLinkOpened: 'invite_link_opened',

  // ─── App lifecycle & launch ───────────────────────────────────────────
  /** App moved to foreground (cold start or resume). Distinguished
   *  by the `type` parameter: 'cold' | 'warm'. */
  AppForegrounded: 'app_foregrounded',
  /** App moved to background. */
  AppBackgrounded: 'app_backgrounded',
  /** The splash screen finished its initial hydration and routed to
   *  the first screen (sign-in / onboarding / home). */
  SplashCompleted: 'splash_completed',

  // ─── Onboarding granular ──────────────────────────────────────────────
  /** A specific step inside post-sign-in onboarding completed
   *  (welcome / how-it-works / profile / done). */
  OnboardingStepCompleted: 'onboarding_step_completed',
  /** Onboarding was skipped (the user used the "דלג" link). */
  OnboardingSkipped: 'onboarding_skipped',

  // ─── Geo / city ───────────────────────────────────────────────────────
  /** A city was picked from the autocomplete list during create
   *  game / create community. */
  CityPicked: 'city_picked',
  /** The user typed a query into the city autocomplete (≥2 chars). */
  CitySearchPerformed: 'city_search_performed',
  /** Weather forecast was successfully fetched for a game's location. */
  WeatherFetched: 'weather_fetched',

  // ─── Filler / cross-community matching ────────────────────────────────
  /** A user accepted a cross-community filler invitation push and
   *  joined a game outside their communities. */
  FillerInvitationAccepted: 'filler_invitation_accepted',
  /** A user expressed interest in being a filler for a specific
   *  short-handed game. */
  FillerInterestExpressed: 'filler_interest_expressed',
  /** Admin toggled "accepts fillers" on a game (opt-in to the
   *  cross-community matcher). */
  AcceptsFillersToggled: 'accepts_fillers_toggled',

  // ─── Errors ───────────────────────────────────────────────────────────
  /** An unhandled exception was caught by the global error boundary
   *  (caught before reaching Crashlytics). Helps correlate caught
   *  errors with the screen they happened on. */
  ErrorBoundaryTriggered: 'error_boundary_triggered',
  /** A user-visible error toast was shown. The `reason` parameter
   *  carries the short error code. */
  ErrorToastShown: 'error_toast_shown',
  /** A network call failed (no connectivity / 5xx). */
  NetworkFailure: 'network_failure',

  // ─── Public community page (web → app) ────────────────────────────────
  /** The public community page (web) "פתח באפליקציה" CTA was tapped
   *  and the user landed inside the app on the community details. */
  PublicPageDeepLinkOpened: 'public_page_deep_link_opened',
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/**
 * Fire-and-forget event logger. Never throws.
 * Mock mode → console only, no network.
 * Real mode → @react-native-firebase/analytics.logEvent (native bridge).
 */
export function logEvent(
  name: AnalyticsEventName | string,
  params?: Record<string, string | number | boolean | undefined | null>,
): void {
  const cleaned = cleanParams(params);

  if (__DEV__) console.log('[analytics]', name, cleaned);
  if (USE_MOCK_DATA) return;

  analytics()
    .logEvent(name, cleaned)
    .catch((err) => {
      logError('analyticsLogEvent', err, { event: name });
      if (__DEV__) console.warn('[analytics] logEvent failed', err);
    });
}

/**
 * Strip `undefined` / `null`, drop non-primitive values, stamp the
 * platform tag. Firebase Analytics requires param values to be string,
 * number, or boolean — anything else throws on the native side.
 */
function cleanParams(
  params?: Record<string, string | number | boolean | undefined | null>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    platform: Platform.OS,
  };
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

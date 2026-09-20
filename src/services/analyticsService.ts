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
import { joryio } from '@/services/joryio';

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
  // Seasons. The whole feature is a behavioural bet — that a competition with
  // an end makes people turn up — and it was shipping with no way to answer
  // whether a single club ever enabled it.
  SeasonsEnabled: 'seasons_enabled',
  SeasonsDisabled: 'seasons_disabled',
  SeasonTargetChanged: 'season_target_changed',
  SeasonEndedEarly: 'season_ended_early',
  // SeasonReopened was here. Removed 20.09.2026 with the button that fired it:
  // a club admin can no longer reopen a closed season (§12), and the operator
  // maintenance hook runs from `firebase functions:shell`, which emits no
  // client analytics. The event can never fire again, and analyticsWiring's
  // allowlist says in as many words not to park new dead constants in it.
  SeasonSummaryViewed: 'season_summary_viewed',
  SeasonSummaryShared: 'season_summary_shared',
  SeasonHistoryViewed: 'season_history_viewed',
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

  // ══════════════════════════════════════════════════════════════════
  // Added for full-funnel coverage. Every one of these is wired at a real
  // call site — see the matching logEvent() in the screen or service.
  // ══════════════════════════════════════════════════════════════════

  // ─── Auth — attempt funnel ───
  SignInAttempted: 'sign_in_attempted',
  SignInFailed: 'sign_in_failed',
  SignInCancelled: 'sign_in_cancelled',
  SignInProviderConflict: 'sign_in_provider_conflict',
  AuthModeSwitched: 'auth_mode_switched',
  PasswordResetRequested: 'password_reset_requested',

  // ─── Onboarding & activation ───
  OnboardingChecklistStepTapped: 'onboarding_checklist_step_tapped',
  BootHydrateFailed: 'boot_hydrate_failed',
  InviteLinkDead: 'invite_link_dead',

  // ─── Notifications ───
  PushPermissionResult: 'push_permission_result',
  NotificationPermissionSettingsOpened: 'notification_permission_settings_opened',

  // ─── Profile & account ───
  ProfileSaveFailed: 'profile_save_failed',
  PhotoUploadFailed: 'photo_upload_failed',
  PhotoUploadAbandoned: 'photo_upload_abandoned',
  SettingsSaveFailed: 'settings_save_failed',
  AccountDeleteSheetOpened: 'account_delete_sheet_opened',
  AccountDeleteCancelled: 'account_delete_cancelled',
  AccountDeleteFailed: 'account_delete_failed',
  GuestRegisterCtaTapped: 'guest_register_cta_tapped',
  GuestGateBlocked: 'guest_gate_blocked',
  ReferralsScreenOpened: 'referrals_screen_opened',
  UserUnblocked: 'user_unblocked',

  // ─── Support ───
  FeedbackSubmitted: 'feedback_submitted',

  // ─── Home surface ───
  HomeActionTileTapped: 'home_action_tile_tapped',

  // ─── Availability ───
  AvailabilityWeekOpened: 'availability_week_opened',
  AvailabilityDayPicked: 'availability_day_picked',
  AvailabilityPromptTapped: 'availability_prompt_tapped',
  AvailabilityLocationToggled: 'availability_location_toggled',
  AvailabilitySlotToggled: 'availability_slot_toggled',
  AvailabilityPresetApplied: 'availability_preset_applied',
  AvailabilityGpsUsed: 'availability_gps_used',
  AvailabilityFillerPushToggled: 'availability_filler_push_toggled',

  // ─── Communities — join funnel ───
  GroupJoined: 'group_joined',   // groupId, instant — instant = open community, no approval step
  GroupJoinFailed: 'group_join_failed',
  GroupJoinRequestCancelled: 'group_join_request_cancelled',

  // ─── Communities — lifecycle ───
  GroupCreateFailed: 'group_create_failed',
  GroupSettingsEditFailed: 'group_settings_edit_failed',
  GroupDeleted: 'group_deleted',
  GroupLeavePrompted: 'group_leave_prompted',
  CommunityCreateStarted: 'community_create_started',
  CommunityWizardStepCompleted: 'community_wizard_step_completed',
  CommunitySettingToggled: 'community_setting_toggled',
  CommunityEditOpened: 'community_edit_opened',

  // ─── Communities — discovery ───
  CommunitiesMapOpened: 'communities_map_opened',
  CommunityFilterSheetOpened: 'community_filter_sheet_opened',
  CommunityFilterApplied: 'community_filter_applied',
  CommunityFilterCleared: 'community_filter_cleared',
  RequestsInboxOpened: 'requests_inbox_opened',

  // ─── Communities — engagement ───
  CommunityPlayersOpened: 'community_players_opened',
  CommunityChatOpened: 'community_chat_opened',
  CommunityContactAdminTapped: 'community_contact_admin_tapped',
  CommunityApprovalsOpened: 'community_approvals_opened',
  CommunityRecurringCtaTapped: 'community_recurring_cta_tapped',
  CommunityNextGameLocked: 'community_next_game_locked',
  FriendsInvitedToCommunity: 'friends_invited_to_community',

  // ─── Player drill-ins ───
  PlayerCompareOpened: 'player_compare_opened',

  // ─── Discipline ───
  DisciplineCardPrompted: 'discipline_card_prompted',

  // ─── App lifecycle ───
  AppOpenAdShown: 'app_open_ad_shown',       // countToday — a REAL impression, after show() resolved
  AppOpenAdGateChecked: 'app_open_ad_gate_checked',  // timedOut — the splash wait, fires every cold start

  // ─── Live match — timer ───
  LiveTimerAction: 'live_timer_action',   // gameId, action ('start'|'pause'|'resume'|'reset'), elapsedSec, isAdmin
  LiveStoppagesOpened: 'live_stoppages_opened',   // gameId, stopCount, totalStoppedSec
  // The admin removed the last shootout kick.
  ShootoutKickUndone: 'shootout_kick_undone', // gameId, kicks, scored
  // Advanced live opened on a game with no drafted teams — the degraded state.
  LiveNoTeamsWarned: 'live_no_teams_warned',      // gameId, isAdmin
  LiveOvertimeReached: 'live_overtime_reached',   // gameId, totalMinutes, round
  LiveTimerRemoteChange: 'live_timer_remote_change',   // gameId, running

  // ─── Live match — entry ───
  LiveMatchEntryTapped: 'live_match_entry_tapped',   // gameId, source ('primary_cta'|'menu'), isAdmin

  // ─── Live match — rounds ───
  RoundStarted: 'round_started',   // gameId, round, teams, perTeam
  RoundEndPrompted: 'round_end_prompted',   // gameId, round, scoreA, scoreB, tie
  RoundTieDecision: 'round_tie_decision',   // gameId, round, method ('manual'|'penalties')
  RotationQueueReordered: 'rotation_queue_reordered', // gameId, round, teams — admin changed who is next up

  // ─── Penalty shootout ───
  ShootoutStarted: 'shootout_started',   // gameId, firstTeam, kicks
  ShootoutKeeperPicked: 'shootout_keeper_picked',   // gameId, team, kickIndex
  ShootoutKickRecorded: 'shootout_kick_recorded',   // gameId, team, scored, kickIndex, scoredA, scoredB
  ShootoutFinished: 'shootout_finished',   // gameId, result ('decided'|'tie'), scoredA, scoredB, kicks
  ShootoutAbandoned: 'shootout_abandoned',   // gameId, round

  // ─── Goals & assists ───
  GoalWizardOpened: 'goal_wizard_opened',   // gameId, team, minute
  GoalWizardCancelled: 'goal_wizard_cancelled',   // gameId, team
  OwnGoalPickerOpened: 'own_goal_picker_opened',   // gameId, team
  GoalDeletePrompted: 'goal_delete_prompted',   // gameId
  GoalLogToggled: 'goal_log_toggled',   // gameId, open, goals

  // ─── Retro goals ───
  RetroGoalsOpened: 'retro_goals_opened',   // gameId, roster
  RetroGoalAdded: 'retro_goal_added',   // gameId, hasAssist, total
  RetroGoalRemoved: 'retro_goal_removed',   // gameId, total

  // ─── Live match — roster ───
  LineupFillPrompted: 'lineup_fill_prompted',   // gameId, teamIndex, required, donors, keepClock
  LineupFillResolved: 'lineup_fill_resolved',   // gameId, teamIndex, result ('confirmed'|'cancelled'|'no_donor'), count
  LiveRosterAction: 'live_roster_action',   // gameId, action ('went_home'|'restored'|'swap_started'|'swapped'|'swap_cancelled'|'menu_o

  // ─── End of evening ───
  EndEveningPrompted: 'end_evening_prompted',   // gameId, source ('inline_button'|'menu'), elapsedSec
  EquipmentHandoffAction: 'equipment_handoff_action',   // gameId, groupId, action ('saved'|'skipped'), ballHolders, jerseysHolders

  // ─── Recap screens ───
  MatchRoundsOpened: 'match_rounds_opened',   // gameId, rounds, goals
  EveningSummaryOpened: 'evening_summary_opened',   // gameId, rounds, goals, assists, wins, noPlay

  // ─── Chat — surface ───
  ChatOpened: 'chat_opened',   // scope, parentId
  ChatTabPressed: 'chat_tab_pressed',   // badge
  ChatEntryPointTapped: 'chat_entry_point_tapped',   // source ('game_details'|'community_details'|'community_admin_dm'|'player_card'|'chats_lis

  // ─── Chat — messaging ───
  ChatMessageSent: 'chat_message_sent',   // scope, length
  ChatMessageSendFailed: 'chat_message_send_failed',   // scope
  ChatMessageBlockedProfanity: 'chat_message_blocked_profanity',   // scope, length

  // ─── Chat — terms gate ───
  ChatTermsPrompted: 'chat_terms_prompted',   // scope
  ChatTermsAccepted: 'chat_terms_accepted',   // scope
  ChatTermsDismissed: 'chat_terms_dismissed',   // scope

  // ─── Chat — moderation ───
  ChatMessageMenuOpened: 'chat_message_menu_opened',   // scope, mine, canModerate
  ChatMessageDeleted: 'chat_message_deleted',   // scope, mine, asModerator
  ChatMessageReported: 'chat_message_reported',   // scope, mine
  ChatUserBlocked: 'chat_user_blocked',   // scope
  ChatUserUnblocked: 'chat_user_unblocked',   // source
  ChatActionFailed: 'chat_action_failed',   // scope, action ('delete'|'report'|'block'|'unblock')
  ChatBlockedListOpened: 'chat_blocked_list_opened',   // count

  // ─── Chat — engagement ───
  ChatReadReceiptsViewed: 'chat_read_receipts_viewed',   // scope, seenCount, readerCount
  ChatMuteToggled: 'chat_mute_toggled',   // scope, muted
  ChatMembersSheetOpened: 'chat_members_sheet_opened',   // scope, memberCount

  // ─── Chat — health ───
  ChatAccessDenied: 'chat_access_denied',   // scope
  ChatLoadFailed: 'chat_load_failed',   // scope, reason ('listener_error'|'game_unavailable'|'fetch_failed'|'restricted'), attempt
  ChatLoadRetryTapped: 'chat_load_retry_tapped',   // scope

  // ─── Ratings ───
  RatingSheetOpened: 'rating_sheet_opened',   // groupId, hasRating

  // ─── Guests ───
  GuestModalOpened: 'guest_modal_opened',   // gameId, mode ('add'|'edit'), isAdmin
  GuestRatingSet: 'guest_rating_set',   // gameId, rating, cleared
  GuestRenamed: 'guest_renamed',   // gameId
  GuestSaveFailed: 'guest_save_failed',   // gameId, mode, reason ('GAME_FULL'|'GAME_NOT_OPEN'|'PERMISSION_DENIED'|'other')

  // ─── Teams / draft ───
  TeamsFlowOpened: 'teams_flow_opened',   // gameId, source ('menu'|'menu_view'|'create_banner'|'manage_banner'|'teams_section'), has
  TeamsSplitMethodChosen: 'teams_split_method_chosen',   // gameId, method ('auto'|'manual'|'random'|'edit'), numTeams
  TeamsGenerated: 'teams_generated',   // gameId, method, numTeams, players, unratedCount, gap, band, fallback, historyGames, rege
  TeamsGenerateFailed: 'teams_generate_failed',   // gameId, method
  DraftBoardStarted: 'draft_board_started',   // gameId, numTeams, order, participants
  DraftPickMade: 'draft_pick_made',   // gameId, pickIndex, isGuest
  DraftPickUndone: 'draft_pick_undone',   // gameId, pickIndex
  TeamColorPicked: 'team_color_picked',   // gameId, teamIndex, color
  TeamsSaved: 'teams_saved',   // gameId, numTeams, order, source, published
  TeamPlayerSwapped: 'team_player_swapped',   // gameId
  TeamsEditedManually: 'teams_edited_manually',   // gameId, numTeams
  TeamsPublished: 'teams_published',   // gameId, numTeams, stale
  TeamsNotifySent: 'teams_notify_sent',   // gameId, numTeams
  TeamFeedbackGiven: 'team_feedback_given',   // gameId, value ('like'|'dislike'|'cleared')
  TeamsViewed: 'teams_viewed',   // gameId, readOnly, numTeams
  TeamsExportShared: 'teams_export_shared',   // gameId, numTeams

  // ─── Auto-teams ───
  AutoTeamsScheduled: 'auto_teams_scheduled',   // gameId, method, leadMinutes, source ('create'|'edit')
  AutoTeamsScheduleToggled: 'auto_teams_schedule_toggled',   // enabled

  // ─── Games — create & edit ───
  GameCreateStarted: 'game_create_started',   // stage ('chooser'|'wizard'), source, mode ('community'|'quick'|'recurring'), prefilled, c
  GameWizardStepChanged: 'game_wizard_step_changed',   // step, direction ('next'|'back'|'submit'), mode
  GameCreateCommunityChanged: 'game_create_community_changed',   // groupId, communityCount
  GameFormWarningShown: 'game_form_warning_shown',   // mode, reason, confirmed, count
  GameSaveBlocked: 'game_save_blocked',   // mode, reason, registeredCount, newMaxPlayers
  GameWizardSubmitFailed: 'game_wizard_submit_failed',   // mode
  GameSettingToggled: 'game_setting_toggled',   // setting, enabled, value, mode
  GameScheduleSet: 'game_schedule_set',   // kind, leadMinutes, earlier, mode
  GameEditOpened: 'game_edit_opened',   // gameId, hasSeries, scope ('single'|'series')

  // ─── Games — recurring series ───
  GameRecurringToggled: 'game_recurring_toggled',   // enabled, mode
  GameSeriesSettingsApplied: 'game_series_settings_applied',   // seriesId, groupId
  GameSeriesStopped: 'game_series_stopped',   // seriesId

  // ─── Games — roster admin ───
  GameVisibilityChanged: 'game_visibility_changed',   // gameId, visibility, source
  GameDeleted: 'game_deleted',   // gameId, rosterCount, manual, hadSeries
  GamePinnedMessageSet: 'game_pinned_message_set',   // gameId, cleared, length
  PlayerRemovedByAdmin: 'player_removed_by_admin',   // gameId, fromWaitlist, offered
  RosterReordered: 'roster_reordered',   // gameId, list ('players'|'guests'), action ('reorder'|'promote'|'move_up'|'move_down'), p
  MembersAddedByAdmin: 'members_added_by_admin',   // gameId, requested, addedToPlayers, addedToWaitlist
  SpotOfferDecided: 'spot_offer_decided',   // gameId, decision ('passed'|'admin_advanced')
  AvailablePlayerInvited: 'available_player_invited',   // gameId, targetId
  FillerPulseSent: 'filler_pulse_sent',   // gameId, started, reason
  /** A club this person ADMINS crossed 2 / 5 / 10 members. Fired at most once
   *  per milestone per club — see milestoneCrossed. Carries `size` and
   *  `milestone` so a journey can branch without a merge field, which is the
   *  only way copy here can name a number. */
  ClubRosterMilestone: 'club_roster_milestone',   // groupId, milestone, size
  /** A club became playable (10+) — the trigger for "now run a round". */
  ClubBecamePlayable: 'club_became_playable',   // groupId, size
  /** The first-run question: organiser or player. Carries `role`, and the same
   *  answer is written to Joryio as `user_type` — the event says WHEN somebody
   *  answered, the attribute says what they are, and targeting needs the
   *  second. */
  RoleSelected: 'role_selected',   // role
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/**
 * Fire-and-forget event logger. Never throws.
 * Mock mode → console only, no network.
 * Real mode → @react-native-firebase/analytics.logEvent (native bridge).
 */
export function logEvent(
  // Deliberately NOT `| string`: the union let a typo'd literal like
  // 'grop_created' compile and ship a dead event name to both sinks. Every
  // call site uses an AnalyticsEvent constant, so the compiler can enforce it.
  name: AnalyticsEventName,
  params?: Record<string, string | number | boolean | undefined | null>,
): void {
  const cleaned = cleanParams(params);

  if (__DEV__) console.log('[analytics]', name, cleaned);
  if (USE_MOCK_DATA) return;

  // Second sink: the same event, to Joryio. Queued and batched there, so this
  // is a push onto an array — it cannot slow down or break the caller.
  void joryio.track(name, cleaned);

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

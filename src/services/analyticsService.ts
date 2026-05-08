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

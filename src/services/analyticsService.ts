// analyticsService — safe-by-default event logging.
//
// Goals:
//   - Calls never crash the app, even if Firebase Analytics isn't initialized
//     or the platform doesn't support it (RN web SDK has caveats).
//   - In mock/dev mode we log to the console so devs can see what would be
//     sent, without writing anything to Google.
//   - In Firebase mode we lazy-import firebase/analytics. If init fails
//     (it's known to throw on RN under some conditions), we cache the
//     failure so we don't retry every call.
//
// Tracked events (centralized as constants for typo safety):
//
//   AUTH:    sign_in_success | profile_created
//   GROUP:   group_created | group_search | group_join_requested
//            group_join_approved | invite_shared
//   NIGHT:   game_joined | game_cancelled | waitlist_joined
//            game_started | match_completed | game_finished
//   SETTINGS: report_bug_clicked | suggest_feature_clicked | rate_app_clicked

import { Platform } from 'react-native';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';

export const AnalyticsEvent = {
  // Auth
  SignInSuccess: 'sign_in_success',
  ProfileCreated: 'profile_created',
  // Groups
  GroupCreated: 'group_created',
  GroupSearch: 'group_search',
  GroupJoinRequested: 'group_join_requested',
  GroupJoinApproved: 'group_join_approved',
  InviteShared: 'invite_shared',
  // Game nights
  GameJoined: 'game_joined',
  GameCancelled: 'game_cancelled',
  WaitlistJoined: 'waitlist_joined',
  GameStarted: 'game_started',
  MatchCompleted: 'match_completed',
  GameFinished: 'game_finished',
  // Settings
  ReportBugClicked: 'report_bug_clicked',
  SuggestFeatureClicked: 'suggest_feature_clicked',
  RateAppClicked: 'rate_app_clicked',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

// State machine: 'unknown' → 'unavailable' or 'ready'. Once 'unavailable',
// every subsequent logEvent is a fast no-op.
type State = 'unknown' | 'ready' | 'unavailable';
let state: State = 'unknown';
// Lazy-loaded handles. Typed `any` because firebase/analytics is web-shaped
// and importing it eagerly would crash the bundle on some RN setups.
let analyticsRef: any = null;
let logEventFn: ((analytics: any, name: string, params?: object) => void) | null = null;

async function tryInit(): Promise<void> {
  if (state !== 'unknown') return;

  if (USE_MOCK_DATA) {
    state = 'unavailable';
    return;
  }

  try {
    // Dynamic import so a missing/incompatible firebase/analytics doesn't
    // break the bundle.
    const mod = await import('firebase/analytics');
    const { app } = getFirebase();
    // `isSupported` returns false on RN/Hermes for the web-only Analytics
    // SDK. We respect that signal instead of hoping for the best.
    if (typeof mod.isSupported === 'function') {
      const supported = await mod.isSupported();
      if (!supported) {
        state = 'unavailable';
        return;
      }
    }
    analyticsRef = mod.getAnalytics(app);
    logEventFn = mod.logEvent;
    state = 'ready';
  } catch (err) {
    if (__DEV__) console.warn('[analytics] init failed, disabling', err);
    state = 'unavailable';
  }
}

// Initialize once on app boot. Awaiting is optional — logEvent handles the
// pre-init case by ignoring the call rather than queuing.
export function initAnalytics(): Promise<void> {
  return tryInit();
}

/**
 * Fire-and-forget event logger. Never throws.
 *
 * In mock/dev mode this only console.logs. In Firebase mode it tries to
 * deliver via firebase/analytics; failures are swallowed.
 */
export function logEvent(
  name: AnalyticsEventName | string,
  params?: Record<string, string | number | boolean | undefined>
): void {
  // Always log in dev so it's visible during testing.
  if (__DEV__) console.log('[analytics]', name, params ?? {});

  // Mock mode is intentionally a no-op for deliveries.
  if (USE_MOCK_DATA) return;

  // Lazy init — first call kicks off init in the background.
  if (state === 'unknown') {
    tryInit().then(() => {
      // After init, replay this single event if we became ready.
      if (state === 'ready') deliver(name, params);
    });
    return;
  }

  if (state === 'ready') deliver(name, params);
}

function deliver(name: string, params?: Record<string, unknown>): void {
  try {
    if (analyticsRef && logEventFn) {
      // Firebase Analytics event params have to be primitives; strip undefined.
      const cleaned: Record<string, string | number | boolean> = {};
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v === undefined || v === null) continue;
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            cleaned[k] = v;
          }
        }
      }
      // Stamp a platform tag for debugging without leaking PII.
      cleaned.platform = Platform.OS;
      logEventFn(analyticsRef, name, cleaned);
    }
  } catch (err) {
    if (__DEV__) console.warn('[analytics] deliver failed', err);
  }
}

// Test helper
export function __resetAnalyticsForTests() {
  state = 'unknown';
  analyticsRef = null;
  logEventFn = null;
}

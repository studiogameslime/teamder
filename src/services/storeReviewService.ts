// Thin wrapper over expo-store-review.
//
// Triggers (per spec): the natural emotional peaks for each persona —
//   • admin sees their own game fill to capacity
//   • a game (organiser or registered player) just finished
//
// We layer THREE rate-limits on top of the OS-level throttle:
//   1. Per-app-launch dedup — Set in memory so the same gameId can't
//      double-prompt during one session (e.g. user navigates back
//      into the same MatchDetails twice).
//   2. 90-day cool-down — AsyncStorage timestamp so even cross-game
//      prompts wait. The OS will silently swallow extra calls
//      anyway, but our gate also stops us from logging analytics
//      events that map to no-ops.
//   3. `isAvailableAsync()` from expo-store-review — bails on
//      platforms / build types where the prompt isn't supported.
//
// The actual API (`requestReview`) returns no signal about what the
// user did with the modal — Apple/Google deliberately hide that. We
// log a `StoreReviewPrompted` analytics event so we can at least
// see how often we managed to surface it.

import * as StoreReview from 'expo-store-review';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { storage } from '@/services/storage';
import { USE_MOCK_DATA } from '@/firebase/config';

const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

export type StoreReviewTrigger = 'gameFilled' | 'matchFinished';

// In-memory dedup so re-renders / focus events can't re-fire the
// prompt for the same context within a session. Keyed by trigger +
// optional contextId (e.g. gameId).
const sessionShown = new Set<string>();

function sessionKey(trigger: StoreReviewTrigger, contextId?: string): string {
  return contextId ? `${trigger}:${contextId}` : trigger;
}

/**
 * Conditional ask. Returns `true` when we actually called into the
 * native API (regardless of whether the OS chose to render anything).
 * Safe to call from an event handler — never throws.
 */
export async function maybeRequestStoreReview(
  trigger: StoreReviewTrigger,
  contextId?: string,
): Promise<boolean> {
  // Mock / dev — log only so we can verify the trigger fires
  // without spamming the real OS prompt.
  if (USE_MOCK_DATA) {
    if (__DEV__) {
      console.log('[storeReview] would prompt', trigger, contextId);
    }
    return false;
  }

  const key = sessionKey(trigger, contextId);
  if (sessionShown.has(key)) return false;

  try {
    const lastAt = await storage.getStoreReviewLastShownAt();
    if (lastAt > 0 && Date.now() - lastAt < COOLDOWN_MS) {
      return false;
    }
    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;

    sessionShown.add(key);
    await storage.setStoreReviewLastShownAt(Date.now());
    logEvent(AnalyticsEvent.StoreReviewPrompted, {
      trigger,
      contextId,
    });
    await StoreReview.requestReview();
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[storeReview] requestReview failed', err);
    return false;
  }
}

// feedbackService — in-app "report a problem / suggest a feature" writes.
//
// Each submission creates ONE doc in the `feedback` collection (NOT the
// aggregated `errors` collection — that one is for automatic crash/error
// signatures). The admin panel reads these via a service account; clients
// can only create (see firestore.rules → match /feedback).
//
// Mock mode: no-op (resolves) so the dev build can exercise the UI flow
// without hitting Firebase, consistent with the other services.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { useUserStore } from '@/store/userStore';
import { logError } from '@/services/errorLog';

export type FeedbackType = 'bug' | 'suggestion';

const appVersion =
  (Constants.expoConfig?.version as string | undefined) ?? 'unknown';

/**
 * Submit a user-authored bug report or feature suggestion.
 *
 * - `message` is trimmed and capped to 2000 chars (matches the Firestore
 *   rule). Empty messages are rejected before any write.
 * - `screen` is optional context — the route the user submitted from.
 *
 * Re-throws on failure (after logging) so the calling screen can surface
 * an error toast and keep the user's text.
 */
export async function submitFeedback(
  type: FeedbackType,
  message: string,
  screen?: string,
  /** Optional raw base64 JPEG (no data: prefix) — e.g. a screenshot the
   *  user attached. Capped client-side so the doc stays well under 1 MB. */
  imageBase64?: string,
): Promise<void> {
  const text = message.trim().slice(0, 2000);
  if (text.length === 0) throw new Error('submitFeedback: empty message');

  // Mock mode — no Firebase. Resolve so the UI flow still works in dev.
  if (USE_MOCK_DATA) return;

  try {
    const { db, auth } = getFirebase();
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('submitFeedback: not signed in');

    // Prefer the app's profile name (kept current in the user store);
    // fall back to the auth displayName which is often empty post-onboarding.
    const userName =
      useUserStore.getState().currentUser?.name ?? fbUser.displayName ?? '';

    // Guard the doc size: a ~600px JPEG q0.4 is ~30–80 KB of base64; cap at
    // ~700 KB so we never approach Firestore's 1 MB document limit.
    const image =
      typeof imageBase64 === 'string' && imageBase64.length > 0 && imageBase64.length < 700_000
        ? imageBase64
        : undefined;

    await addDoc(collection(db, 'feedback'), {
      type,
      message: text,
      userId: fbUser.uid,
      userName,
      ...(screen ? { screen } : {}),
      ...(image ? { image } : {}),
      appVersion,
      platform: Platform.OS,
      createdAt: serverTimestamp(),
      status: 'new',
    });
  } catch (err) {
    logError('submitFeedback', err, { type, screen });
    throw err;
  }
}

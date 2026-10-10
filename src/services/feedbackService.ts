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
import { formatTrail } from '@/services/breadcrumbs';
import { diagnosticAttachment, diagnosticReportScreen, diagnosticOwner } from './diagnosticJournal';
import { readPreviousDiagnosticJournal } from './diagnosticStorage';
export type FeedbackDiagnostics={journal:string;trail:string;screen?:string;owner?:string|null};
export function captureFeedbackDiagnostics(screen?:string):FeedbackDiagnostics {
 return {journal:diagnosticAttachment(),trail:formatTrail().slice(-6000),screen:screen==='Feedback'?diagnosticReportScreen():screen,owner:diagnosticOwner()};
}

export type FeedbackType = 'bug' | 'suggestion';

/**
 * What KIND of thing the reporter says this is. Chosen by the tester in the
 * report sheet and carried straight through to the Pulse task list, so a
 * report lands already filed under the right heading instead of waiting in an
 * "unsorted" pile. Priority is deliberately NOT here — that's the owner's
 * call in Pulse, not the reporter's.
 */
export type FeedbackCategory = 'ui' | 'bug' | 'feature';

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
  /** How the reporter classified it. Defaults to 'bug' — the report sheet
   *  opens on a screenshot, which is nearly always something broken. */
  category: FeedbackCategory = 'bug',
  diagnostics?:FeedbackDiagnostics,
): Promise<void> {
  const text = message.trim().slice(0, 2000);
  if (text.length === 0) throw new Error('submitFeedback: empty message');
  const captured=diagnostics??captureFeedbackDiagnostics(screen);
  const {journal,trail}=captured;
  screen=captured.screen??screen;

  // Mock mode — no Firebase. Resolve so the UI flow still works in dev.
  if (USE_MOCK_DATA) return;

  try {
    const { db, auth } = getFirebase();
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('submitFeedback: not signed in');
    if(captured.owner!==undefined&&captured.owner!==fbUser.uid)throw new Error('submitFeedback: session changed');
    const previousJournal=await readPreviousDiagnosticJournal(fbUser.uid);
    if(auth.currentUser?.uid!==fbUser.uid)throw new Error('submitFeedback: session changed');

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

    // `addDoc` generates the id on the CLIENT, so a write that landed but whose
    // ack was lost (flaky network, backgrounded app) gets replayed by the SDK
    // with the same id and comes back `already-exists`. The report was saved;
    // telling the user it failed only makes them send it twice. Swallow that one
    // code — every other failure still surfaces.
    // A frozen structured session plus a short legacy text trail. Capture at
    // screenshot/form opening, before the reporting UI changes the context.
    // Size bounds preserve room for the screenshot in the same document.

    await addDoc(collection(db, 'feedback'), {
      type,
      message: text,
      ...(trail ? { trail } : {}),
      journal,
      ...(previousJournal?{previousJournal}:{}),
      userId: fbUser.uid,
      userName,
      ...(screen ? { screen } : {}),
      category,
      ...(image ? { image } : {}),
      appVersion,
      platform: Platform.OS,
      createdAt: serverTimestamp(),
      status: 'new',
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'already-exists') return;
    logError('submitFeedback', err, { type, screen });
    throw err;
  }
}

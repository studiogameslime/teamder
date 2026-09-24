// One vocabulary for "can we notify this person".
//
// The app had a boolean-ish answer — `{granted, canAskAgain, available}` — and
// it is not enough to decide anything with. `granted: false` covers three
// completely different people:
//
//   • somebody who has never been asked. An invitation is appropriate.
//   • somebody who was asked and said no. Asking again is nagging, and on
//     iOS the OS will not even show the dialog a second time.
//   • somebody on a build with no native module at all (Expo Go, mock mode),
//     where "denied" would be a lie about the device.
//
// Collapsing those into one flag is how an app ends up re-prompting people who
// already declined. So this is the five-state the rest of the feature reasons
// in, derived from the SAME underlying helper rather than a second reader —
// `notificationsService.getPushPermissionStatus` still owns the platform
// detail, and it now reports the OS's own `status` alongside the booleans.

import { notificationsService } from '@/services/notificationsService';

export type PushPermissionState =
  /** Never asked. The only state a contextual offer should appear in. */
  | 'undetermined'
  /** Push works. Nothing to offer; just make sure a token is registered. */
  | 'granted'
  /** Asked, declined, and the OS would still show a dialog if we asked
   *  again. We do not — but a future, better-timed context may explain. */
  | 'denied'
  /** Declined and the OS will not ask again. Only Settings can change it. */
  | 'blocked'
  /** No native module (Expo Go, mock mode) or the platform cannot answer.
   *  NOT "denied": we know nothing, so we say nothing. */
  | 'unsupported';

/**
 * Where this device stands, without prompting.
 *
 * Never throws — an unreadable answer is `unsupported`, which every caller
 * treats as "do nothing", the safe direction.
 */
export async function getPushPermissionState(): Promise<PushPermissionState> {
  try {
    const s = await notificationsService.getPushPermissionStatus();
    if (!s.available) return 'unsupported';
    if (s.granted) return 'granted';
    // `status` is the precise answer; the booleans are the fallback for a
    // platform that did not give us one.
    if (s.status === 'undetermined') return 'undetermined';
    if (s.status === 'denied') return s.canAskAgain ? 'denied' : 'blocked';
    return s.canAskAgain ? 'undetermined' : 'blocked';
  } catch {
    return 'unsupported';
  }
}

/** Can the OS dialog still be raised? The one question worth asking before
 *  offering a CTA that promises to raise it. */
export function canPrompt(state: PushPermissionState): boolean {
  return state === 'undetermined' || state === 'denied';
}

/** Is the app's own Settings page the only remaining route? */
export function needsSettings(state: PushPermissionState): boolean {
  return state === 'blocked';
}

/**
 * Open the OS settings page for this app.
 *
 * ONLY from an explicit tap. Opening settings by itself is the app throwing
 * somebody out of what they were doing to make a point.
 */
export async function openAppSettings(): Promise<void> {
  try {
    const { Linking } = await import('react-native');
    await Linking.openSettings();
  } catch {
    // A device that cannot open its own settings is not worth an error
    // dialog about; the sheet stays open and the person closes it.
  }
}

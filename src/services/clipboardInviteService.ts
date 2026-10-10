// clipboardInviteService — iOS deferred-deep-link recovery.
//
// Apple has no Play-Install-Referrer equivalent, so an invite link
// tapped before the app is installed can't carry the inviter through the
// App Store the way Android does. The bridge: the web landing page
// copies the canonical invite URL to the clipboard when the user taps
// "install" (a user gesture — required for clipboard writes in Safari).
// On the very first launch after install we read the clipboard ONCE,
// parse a Teamder invite URL out of it, and stash it as a PendingInvite
// so userService's attribution writes `invitedBy` on signup — exactly
// like the Android install-referrer path.
//
// Constraints that shape this file:
//   • iOS only. Android uses the native install referrer; reading the
//     clipboard there would be a pointless paste prompt.
//   • iOS 16+ shows a system "Allow Paste?" prompt when an app reads
//     clipboard *content*. We gate the read behind hasUrlAsync() (a
//     pattern check that does NOT prompt) so organic installs whose
//     clipboard isn't a URL never see the prompt, and we only ever read
//     once per install (the consumed latch).
//   • A live deep link / existing stash always wins — if a PendingInvite
//     is already set we skip the clipboard entirely.
//   • Best-effort: every failure path is swallowed; attribution is a
//     nice-to-have, never a blocker.

import { Platform } from 'react-native';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import * as Clipboard from 'expo-clipboard';
import { storage } from './storage';
import { resolveIncomingInvite } from './incomingInvite';
import { logError } from './errorLog';
import { receivePendingInvite } from './pendingAction';
import { rcBool } from './remoteConfigService';

/**
 * One-shot read-and-stash for iOS. Safe to call on every launch — the
 * `clipboardInviteConsumed` latch short-circuits after the first look,
 * so the system paste prompt is shown at most once per install.
 */
let inFlight: Promise<void> | null = null;
export function consumeClipboardInviteIfFresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = recoverClipboardInvite().finally(() => { inFlight = null; });
  return inFlight;
}
async function recoverClipboardInvite(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!rcBool('feature_ios_clipboard_invite')) return; // remote kill-switch
  try {
    if (await storage.getClipboardInviteConsumed()) return;

    // A deep link (already-installed tap) or a prior stash always wins
    // over the clipboard. Latch and bail so we never prompt later.
    const existing = await storage.getPendingInvite();
    if (existing) {
      await storage.setClipboardInviteConsumed();
      return;
    }

    // hasUrlAsync uses iOS `detectPatterns` under the hood — it reports
    // whether the clipboard *probably* holds a URL WITHOUT triggering the
    // paste prompt. No URL → we never read content, so organic installs
    // see nothing.
    const hasUrl = await Clipboard.hasUrlAsync();
    if (!hasUrl) return; // No content read and no prompt: allow a later launch to try.

    // The one read that surfaces the system paste prompt.
    await storage.setClipboardInviteConsumed(); // Latch before a possible system paste prompt.
    const raw = (await Clipboard.getStringAsync())?.trim();
    if (raw) {
      const invite = await resolveIncomingInvite(raw, 'deferred_deep_link');
      if (invite && await receivePendingInvite(invite, 'deferred_deep_link')) {
        logEvent(AnalyticsEvent.DeferredDeepLinkResolved, {
          channel: 'clipboard',
          target_type: invite.type,
          target_id: invite.type === 'app' ? undefined : invite.id,
          has_inviter: !!invite.invitedBy,
        });
        // Leave the clipboard intact: the user may have copied something new.
        if (__DEV__) {
          console.info('[clipboardInvite] recovered invite', invite);
        }
      }
    }
  } catch (e) {
    logError('consumeClipboardInvite', e, {});
    if (__DEV__) console.warn('[clipboardInvite] failed', e);
  }
}

export const clipboardInviteService = {
  consumeClipboardInviteIfFresh,
};

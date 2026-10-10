import { resolveIncomingInvite } from './incomingInvite';
// installReferrerService — recover an invite from the Play Install
// Referrer after a fresh install.
//
// How the round-trip works:
//   1. Landing page (public/invite.html) sends users to Google Play
//      with `&referrer=invite_<type>_<id>` appended to the store URL.
//   2. Play forwards the referrer string to the freshly installed app
//      via the native Install Referrer API.
//   3. On first launch we ask the native module for the referrer,
//      parse `invite_<type>_<id>`, and stash a PendingInvite — but
//      only if no invite is already pending (a current deep link
//      always wins over a stale install referrer).
//
// Behavioural notes:
//   • Android-only. iOS doesn't expose an equivalent API; on iOS this
//     module no-ops cleanly (the require fails, we swallow it).
//   • We persist a `consumed` flag so subsequent launches don't
//     re-process the same referrer (the native API would return the
//     same value forever otherwise).
//   • Custom dev/sideloaded installs have no referrer — that's not
//     an error, just an empty result we ignore.

import { Platform } from 'react-native';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { storage, type PendingInvite } from './storage';
import { logError } from './errorLog';
import { receivePendingInvite } from './pendingAction';

interface PlayInstallReferrerInfo {
  installReferrer: string;
}

interface PlayInstallReferrerModule {
  getInstallReferrerInfo: (
    cb: (info: PlayInstallReferrerInfo | null, err: unknown) => void,
  ) => void;
}

function loadModule(): PlayInstallReferrerModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    // Indirect require so Metro can't pre-resolve when the native
    // module isn't linked (Expo Go, fresh dev clients pre-rebuild).
    const moduleName = 'react-native-play-install-referrer';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(moduleName) as {
      PlayInstallReferrer?: PlayInstallReferrerModule;
    };
    return mod?.PlayInstallReferrer ?? null;
  } catch {
    return null;
  }
}

export { parseReferrerInvite } from '@/utils/referrerInvite';
import { parseReferrerInvite } from '@/utils/referrerInvite';



/**
 * One-shot read-and-stash. Safe to call on every launch — the
 * `installReferrerConsumed` flag short-circuits subsequent calls.
 *
 * Honours the existing-pending guard: if an invite is already
 * stashed (e.g. the user opened a fresh deep link concurrently with
 * the install referrer arriving), we leave it alone — the deep link
 * represents the user's *current* intent.
 */
let inFlight: Promise<void> | null = null;
export function consumeInstallReferrerIfFresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = recoverReferrer().finally(() => { inFlight = null; });
  return inFlight;
}

async function recoverReferrer(): Promise<void> {
  if (Platform.OS !== 'android' || await storage.getInstallReferrerConsumed()) return;
  const mod = loadModule();
  if (!mod) return; // A later build may have the native module available.
  const result = await new Promise<PlayInstallReferrerInfo | null>((resolve) => {
    let settled = false;
    const finish = (value: PlayInstallReferrerInfo | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 3000);
    try {
      mod.getInstallReferrerInfo((info, err) => {
        // Transient failures and late callbacks cannot consume or overwrite.
        finish(err ? null : info);
      });
    } catch { finish(null); }
  });
  if (!result) return; // Retry on next launch, with no repeated polling.
  try {
    const referrer = result.installReferrer ?? '';
    const unresolved = new URLSearchParams(referrer).get('invite_url');
    const invite = unresolved ? await resolveIncomingInvite(unresolved, 'deferred_deep_link') : parseReferrerInvite(referrer);
    if (invite && await receivePendingInvite(invite, 'deferred_deep_link')) {
      logEvent(AnalyticsEvent.DeferredDeepLinkResolved, {
        channel: 'install_referrer', target_type: invite.type,
        target_id: invite.type === 'app' ? undefined : invite.id,
        has_inviter: !!invite.invitedBy,
      });
    }
    await storage.setInstallReferrerConsumed();
  } catch (err) {
    // A failed stash remains retryable rather than recording successful recovery.
    logError('installReferrerPersist', err, {});
  }
}

export const installReferrerService = {
  consumeInstallReferrerIfFresh,
  parseReferrerInvite,
};

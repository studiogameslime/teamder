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
import { storage, type PendingInvite } from './storage';

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

/**
 * Parse a referrer string into the matching PendingInvite shape.
 * Two supported formats — the older one shipped before invite
 * attribution existed and is still emitted by historical landing-page
 * versions, so we keep it readable indefinitely:
 *
 *   • `invite_<type>_<id>`              — no inviter
 *   • `invite_<type>_<id>_by_<userId>`  — credits `<userId>`
 *
 * Anything else (organic installs, partner tracking, junk) returns
 * null and is ignored.
 */
export function parseReferrerInvite(referrer: string): PendingInvite | null {
  if (!referrer) return null;
  // Try the attributed format first since its prefix is a strict
  // superset; falling back to the legacy short form only if the
  // `_by_` segment isn't present.
  const attributed = /^invite_(session|team)_(.+)_by_([^_]+)$/.exec(referrer);
  if (attributed) {
    const type = attributed[1] === 'session' ? 'session' : 'team';
    const id = safeDecode(attributed[2]);
    const invitedBy = safeDecode(attributed[3]);
    if (!id) return null;
    return invitedBy ? { type, id, invitedBy } : { type, id };
  }
  const legacy = /^invite_(session|team)_(.+)$/.exec(referrer);
  if (legacy) {
    const type = legacy[1] === 'session' ? 'session' : 'team';
    const id = safeDecode(legacy[2]);
    if (!id) return null;
    return { type, id };
  }
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * One-shot read-and-stash. Safe to call on every launch — the
 * `installReferrerConsumed` flag short-circuits subsequent calls.
 *
 * Honours the existing-pending guard: if an invite is already
 * stashed (e.g. the user opened a fresh deep link concurrently with
 * the install referrer arriving), we leave it alone — the deep link
 * represents the user's *current* intent.
 */
export async function consumeInstallReferrerIfFresh(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (await storage.getInstallReferrerConsumed()) return;

  const mod = loadModule();
  if (!mod) {
    // Native module unavailable (Expo Go, iOS, dev client without the
    // pod linked). Mark consumed so we don't retry every launch.
    await storage.setInstallReferrerConsumed();
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // Always set the consumed flag, even on error / empty referrer
      // — the native API only returns a meaningful value once per
      // install, and we don't want to keep retrying forever.
      storage
        .setInstallReferrerConsumed()
        .catch(() => undefined)
        .finally(resolve);
    };
    try {
      mod.getInstallReferrerInfo(async (info, err) => {
        try {
          if (err || !info) {
            if (__DEV__) {
              console.info('[installReferrer] no referrer info', { err });
            }
            return finish();
          }
          const raw = info.installReferrer ?? '';
          if (__DEV__) console.info('[installReferrer] raw referrer →', raw);
          const invite = parseReferrerInvite(raw);
          if (__DEV__) console.info('[installReferrer] parsed →', invite);
          if (!invite) return finish();
          // Existing-pending guard: don't override a fresher deep
          // link that was just stashed by App.tsx's Linking listener.
          const existing = await storage.getPendingInvite();
          if (existing) {
            if (__DEV__) {
              console.info(
                '[installReferrer] skip — pending already set',
                existing,
              );
            }
            return finish();
          }
          await storage.setPendingInvite(invite);
          if (__DEV__) {
            console.info('[installReferrer] stashed pending invite', invite);
          }
        } catch (e) {
          if (__DEV__) console.warn('[installReferrer] parse failed', e);
        } finally {
          finish();
        }
      });
    } catch (e) {
      if (__DEV__) console.warn('[installReferrer] native call threw', e);
      finish();
    }
  });
}

export const installReferrerService = {
  consumeInstallReferrerIfFresh,
  parseReferrerInvite,
};

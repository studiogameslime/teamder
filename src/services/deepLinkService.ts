// deepLinkService — incoming-URL parser + pending-invite stash.
//
// Two URL families both flow through `parseInviteUrl`:
//   1. Custom scheme: teamder://session/<id>
//                     teamder://team/<id>
//   2. Hosting URL:   https://teamder.web.app/session/<id>
//                     https://teamder.web.app/team/<id>
//
// We deliberately do NOT use React Navigation's `linking` prop — the
// app's navigator tree depends on auth state (RootNavigator swaps
// stacks based on hydrate / onboarding / profile completeness), and
// auto-linking would silently fail when the target screen isn't
// mounted yet. Instead we parse here, stash via storage, and let
// RootNavigator consume the stash once the user is fully ready.
//
// Invite attribution:
//   • `?invitedBy=<uid>` is parsed into PendingInvite.invitedBy.
//   • The actual write to the new user's profile happens in
//     userService on fresh-account creation — this file just carries
//     the value through. Unattributed links (no `invitedBy`) still
//     work; the invite navigates as before.
//   • No deferred deep linking after Play Store install handled here
//     — installReferrerService recovers the invite (with its
//     invitedBy_by_<uid> suffix) on first launch.

import * as Linking from 'expo-linking';
import { storage, type PendingInvite } from './storage';

/** All hostnames + custom-scheme prefixes we treat as our invite links. */
const HOSTING_DOMAINS = new Set(['teamder.web.app', 'teamder.firebaseapp.com']);

/** Public hosting origin used when building share URLs. */
const HOSTING_ORIGIN = 'https://teamder.web.app';

/**
 * Parse an invite URL in either supported form. Returns null for any
 * URL we don't recognise — the caller is expected to ignore those.
 */
export function parseInviteUrl(url: string): PendingInvite | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const path = (parsed.path ?? '').replace(/^\//, '');
    const segments = path.split('/').filter((s) => s.length > 0);

    let type: 'session' | 'team' | null = null;
    let id: string | null = null;

    if (parsed.scheme === 'teamder' || parsed.scheme === 'footy') {
      // Custom scheme — `parsed.hostname` carries the type
      // (`teamder://session/abc` → host=session, path=abc).
      const host = parsed.hostname;
      if (host === 'session' || host === 'team') {
        type = host;
        id = segments[0] ?? null;
      } else if (host === undefined && segments.length >= 2) {
        // Defensive: some platforms route the full path under segments
        // with hostname missing.
        if (segments[0] === 'session' || segments[0] === 'team') {
          type = segments[0];
          id = segments[1];
        }
      }
    } else if (parsed.hostname && HOSTING_DOMAINS.has(parsed.hostname)) {
      if (segments[0] === 'session' || segments[0] === 'team') {
        type = segments[0];
        id = segments[1] ?? null;
      }
    }

    if (!type || !id) return null;
    const invitedByRaw = parsed.queryParams?.invitedBy;
    const invitedBy =
      typeof invitedByRaw === 'string' && invitedByRaw.length > 0
        ? invitedByRaw
        : undefined;
    return invitedBy ? { type, id, invitedBy } : { type, id };
  } catch {
    return null;
  }
}

/**
 * Build a public share URL for a session or team. Points at Firebase
 * Hosting (`teamder.web.app`), which renders the landing page that
 * tries the deep link and falls back to the Play Store. When
 * `invitedBy` is provided we append `?invitedBy=<uid>` so the new
 * user's profile picks up an inviter on signup.
 */
export function buildInviteUrl(args: {
  type: 'session' | 'team';
  id: string;
  invitedBy?: string;
}): string {
  const base = `${HOSTING_ORIGIN}/${args.type}/${encodeURIComponent(args.id)}`;
  if (args.invitedBy) {
    return `${base}?invitedBy=${encodeURIComponent(args.invitedBy)}`;
  }
  return base;
}

/**
 * Persist an invite for the post-login consumer in RootNavigator.
 *
 * Set-once contract: if a pending invite already exists in storage we
 * leave it alone. The first invite the app saw on this launch wins.
 * Callers that want a fresh value must explicitly clear first.
 */
export async function stashPendingInvite(invite: PendingInvite): Promise<void> {
  const existing = await storage.getPendingInvite();
  if (existing) {
    if (__DEV__) {
      console.info(
        '[invite] stash skipped — existing pending invite already set',
        existing,
      );
    }
    return;
  }
  await storage.setPendingInvite(invite);
  if (__DEV__) console.info('[invite] stashed pending invite', invite);
}

export const deepLinkService = {
  parseInviteUrl,
  buildInviteUrl,
  stashPendingInvite,
};

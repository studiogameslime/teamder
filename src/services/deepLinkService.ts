// deepLinkService — incoming-URL parser + pending-invite stash.
//
// Two URL families both flow through `parseInviteUrl`:
//   1. Custom scheme: teamder://session/<id>
//                     teamder://team/<id>
//   2. Hosting URL:   https://teamderfc.web.app/session/<id>
//                     https://teamderfc.web.app/team/<id>
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
import { logError } from './errorLog';

/** All hostnames + custom-scheme prefixes we treat as our invite links.
 *  The bare "teamder" subdomain was reserved by another Firebase project
 *  before we owned the brand, so we ship under "teamderfc" (fc =
 *  football club). The plain "teamder.web.app" is kept in the set so
 *  that any pre-existing shared link still parses (returning a usable
 *  PendingInvite) even though we can't actually serve that origin. */
const HOSTING_DOMAINS = new Set([
  'teamderfc.web.app',
  'teamderfc.firebaseapp.com',
  'teamder.web.app',
  'teamder.firebaseapp.com',
]);

/** Public hosting origin used when building share URLs. */
const HOSTING_ORIGIN = 'https://teamderfc.web.app';

const B64_INV: Record<string, number> = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  .split('')
  .forEach((c, i) => {
    B64_INV[c] = i;
  });
/**
 * base64url (no padding) → UTF-8 string. Inverse of Pulse's `encodeSourceToken`
 * (the short `b` source token in tracked links). Self-contained — Hermes has no
 * atob/Buffer. Returns '' on malformed input.
 */
function decodeSourceToken(tok: string): string {
  try {
    const bytes: number[] = [];
    let buf = 0;
    let bits = 0;
    for (const ch of tok) {
      const v = B64_INV[ch];
      if (v === undefined) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buf >> bits) & 0xff);
      }
    }
    let out = '';
    for (let i = 0; i < bytes.length; ) {
      const b0 = bytes[i++];
      if (b0 < 0x80) out += String.fromCharCode(b0);
      else if (b0 < 0xe0) {
        const b1 = bytes[i++];
        out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      } else if (b0 < 0xf0) {
        const b1 = bytes[i++];
        const b2 = bytes[i++];
        out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
      } else {
        const b1 = bytes[i++];
        const b2 = bytes[i++];
        const b3 = bytes[i++];
        const cp =
          (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) -
          0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  } catch {
    return '';
  }
}

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

    const invitedByRaw0 = parsed.queryParams?.invitedBy;
    const invitedBy0 =
      typeof invitedByRaw0 === 'string' && invitedByRaw0.length > 0
        ? invitedByRaw0
        : undefined;

    // Acquisition (UTM) tag — `?s=<source>&c=<campaign>` on any link form,
    // emitted by the Pulse ad-link builder. Carried through so signup can
    // record where the install came from. Independent of `invitedBy`.
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;
    // Source now arrives as a short base64url token `b` (decoded here), with a
    // fallback to the legacy plain `s`. `l` is the per-link attribution id.
    const bTok = str(parsed.queryParams?.b);
    const acq: { source?: string; campaign?: string; linkId?: string } = {
      source:
        (bTok ? decodeSourceToken(bTok) : undefined) ||
        str(parsed.queryParams?.s) ||
        str(parsed.queryParams?.utm_source),
      campaign: str(parsed.queryParams?.c) ?? str(parsed.queryParams?.utm_campaign),
      linkId: str(parsed.queryParams?.l),
    };
    if (!acq.source) delete acq.source;
    if (!acq.campaign) delete acq.campaign;
    if (!acq.linkId) delete acq.linkId;

    // Generic "invite to the app" link (no game/team target) —
    // teamder://app, footy://app, https://<host>/app, or the dedicated
    // acquisition path https://<host>/go. Carries only inviter/source;
    // nothing to navigate to afterwards.
    const isAppScheme =
      (parsed.scheme === 'teamder' || parsed.scheme === 'footy') &&
      (parsed.hostname === 'app' || parsed.hostname === 'go' ||
        segments[0] === 'app' || segments[0] === 'go');
    const isAppHosting =
      parsed.hostname &&
      HOSTING_DOMAINS.has(parsed.hostname) &&
      (segments[0] === 'app' || segments[0] === 'go');
    if (isAppScheme || isAppHosting) {
      // An acquisition link may target a game via `?g=<gameId>` — deep-link
      // to it like a session invite while still recording the source.
      const g = str(parsed.queryParams?.g);
      if (g) {
        return { type: 'session', id: g, ...(invitedBy0 ? { invitedBy: invitedBy0 } : {}), ...acq };
      }
      return { type: 'app', ...(invitedBy0 ? { invitedBy: invitedBy0 } : {}), ...acq };
    }

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
    return { type, id, ...(invitedBy ? { invitedBy } : {}), ...acq };
  } catch (err) {
    logError('parseInviteUrl', err, { url });
    return null;
  }
}

/**
 * Build a public share URL for a session or team. Points at Firebase
 * Hosting (`teamderfc.web.app`), which renders the landing page that
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
 * Build a generic "invite to the app" URL — `${HOSTING_ORIGIN}/app` — that
 * promotes downloading Teamder and lands the user on the home screen (no
 * community/game target). `invitedBy` is carried through so the inviter
 * still gets referral credit on the new user's signup.
 */
export function buildAppInviteUrl(invitedBy?: string): string {
  const base = `${HOSTING_ORIGIN}/app`;
  return invitedBy ? `${base}?invitedBy=${encodeURIComponent(invitedBy)}` : base;
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
  buildAppInviteUrl,
  stashPendingInvite,
};

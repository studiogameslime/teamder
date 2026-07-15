// inviteLinkService — turns any share into a SHORT link.
//
// Instead of `…/session/<20-char id>?invitedBy=<28-char uid>` (~90 chars), we
// store the {type, targetId, invitedBy} in `inviteLinks/{code}` and share
// `https://teamderfc.web.app/i/<code>` (~34 chars). The `serveInviteCode` CF
// resolves the code back to the real target + inviter, so ATTRIBUTION and the
// WhatsApp OG preview are fully preserved — the short link is a pure alias.
//
// Fail-safe: if the doc write fails (offline / rules), we fall back to the LONG
// url the caller already built, so a share is never broken and still attributes.

import { doc, setDoc } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';

const HOSTING_ORIGIN = 'https://teamderfc.web.app';
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 7 base62 chars ≈ 3.5×10¹² space — collisions are astronomically unlikely at
 *  any realistic share volume, so a plain random code needs no dedup/retry. */
function randomCode(len = 7): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

/**
 * Create a short share link for a target. `fallbackLong` is the full URL the
 * caller already built (via deepLinkService) — returned verbatim if the short
 * link can't be created, so the share always works and still credits the inviter.
 */
export async function createShortInviteUrl(args: {
  type: 'session' | 'team' | 'app';
  /** game/community id — omit for the generic 'app' invite. */
  id?: string;
  invitedBy?: string;
  fallbackLong: string;
}): Promise<string> {
  if (USE_MOCK_DATA) return args.fallbackLong;
  try {
    const code = randomCode();
    const db = getFirebase().db;
    await setDoc(doc(db, 'inviteLinks', code), {
      type: args.type,
      targetId: args.id ?? '',
      invitedBy: args.invitedBy ?? '',
      createdAt: Date.now(),
    });
    // Carry the inviter in the URL too, not just inside the Firestore doc. The
    // `serveInviteCode` CF injects the full {type,id,invitedBy} for the deep-link
    // + OG preview, BUT if it cold-starts / the doc is missing, it serves the bare
    // page with no injection → the invited user was NOT credited. With `?invitedBy=`
    // in the URL, invite.html recovers the inviter client-side and still credits
    // them (as a generic app invite), so attribution never depends on the CF.
    const base = `${HOSTING_ORIGIN}/i/${code}`;
    return args.invitedBy
      ? `${base}?invitedBy=${encodeURIComponent(args.invitedBy)}`
      : base;
  } catch (err) {
    logError('createShortInviteUrl', err, { type: args.type });
    return args.fallbackLong;
  }
}

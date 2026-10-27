import { observeCaughtError } from '../utils/errorObservation';
// inviteLinkService — turns any share into a SHORT link.
//
// Instead of `…/session/<20-char id>?invitedBy=<28-char uid>` (~90 chars), we
// store the {type, targetId, invitedBy} in `inviteLinks/{code}` and share
// `https://teamder.co.il/i/<code>` (31 chars). The `serveInviteCode` CF
// resolves the code back to the real target + inviter, so ATTRIBUTION and the
// WhatsApp OG preview are fully preserved — the short link is a pure alias.
//
// Fail-safe: if the doc write fails (offline / rules), we fall back to the LONG
// url the caller already built, so a share is never broken and still attributes.

import { doc, setDoc } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';

import { PUBLIC_LINK_ORIGIN as HOSTING_ORIGIN } from '@/utils/linkDomains';
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
    // The canonical document owns both target and inviter. Current landing
    // pages preserve unresolved codes in clipboard/Play referrer, and native
    // incomingInvite persists them for retry. Repeating the UID no longer
    // helps recovery (unverified query inviters are deliberately not credited).
    // Keep the complete long URL only when the code could not be saved.
    return `${HOSTING_ORIGIN}/i/${code}`;
  } catch (err) {
    observeCaughtError(err, {"source":"src/services/inviteLinkService.ts","handler":"createShortInviteUrl","site":"inviteLinkService:322e4b0ded"});
    logError('createShortInviteUrl', err, { type: args.type });
    return args.fallbackLong;
  }
}

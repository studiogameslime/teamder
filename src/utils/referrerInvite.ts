// Reading a Play Install Referrer string.
//
// Extracted from `installReferrerService` so it can be tested. The service
// imports the native `react-native-play-install-referrer` module, which jest
// cannot parse — and the only part worth testing is this one, which is pure
// string work. Same split the repo already uses for `statsScope`.

import type { PendingInvite } from '@/services/storage';

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseQuery(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split('&')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const k = pair.slice(0, i);
    const v = safeDecode(pair.slice(i + 1));
    if (k && v) out[k] = v;
  }
  return out;
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
  // Generic "invite to the app" — `invite_app_by_<uid>` (no target).
  const appRef = /^invite_app_by_([^_]+)$/.exec(referrer);
  if (appRef) {
    const invitedBy = safeDecode(appRef[1]);
    return invitedBy ? { type: 'app', invitedBy } : { type: 'app' };
  }
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
  // Acquisition (UTM) referrer emitted by the Pulse ad-link landing page,
  // e.g. `utm_source=whatsapp&utm_campaign=summer&g=<gameId>`. Standard
  // querystring form so it interoperates with Play's referrer field.
  if (/(^|&)utm_source=/.test(referrer)) {
    const params = parseQuery(referrer);
    const source = params.utm_source || params.s;
    if (source) {
      const gameId = params.g;
      const campaign = params.utm_campaign || params.c;
      const linkId = params.l; // per-link attribution key
      const base = gameId
        ? ({ type: 'session', id: gameId } as const)
        : ({ type: 'app' } as const);
      // The inviter, when the landing page put one here.
      //
      // It did not use to. The page builds the referrer one of two ways —
      // a UTM string when the link carries a `source`, otherwise
      // `invite_<type>_<id>_by_<uid>` — and the UTM branch had nowhere to
      // put the inviter, so a personal invite sent through a tracked link
      // reached the store with its attribution stripped. The installer then
      // opened the app and saw nothing: reported as "לאחר ההתקנה המשתמש
      // הזה לא ראה את ההזמנה שלי. רק לאחר שסגר את האפליקציה ולחץ על
      // הקישור זה הראה" — the second tap worked because by then the app
      // was installed and the deep link carried the invite directly.
      //
      // Absent on every referrer emitted before this, which is why it is
      // read as optional and never required.
      const invitedBy = params.by || params.invitedBy;
      return {
        ...base,
        source,
        ...(campaign ? { campaign } : {}),
        ...(linkId ? { linkId } : {}),
        ...(invitedBy ? { invitedBy } : {}),
      };
    }
  }
  return null;
}

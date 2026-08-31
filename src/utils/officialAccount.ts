// The Teamder official account.
//
// `teamder` is a reserved SENDER id, not a real account: it has no /users doc
// (one would surface in player lists, search and the user counter) and nobody
// can authenticate as it. The chat rules require `senderId == request.auth.uid`
// on every write, so a message that carries this id can only have come from us
// — which is what makes it safe to derive a verified badge from the id alone.
//
// That property matters. A badge driven by a FIELD (`verified: true`) would be
// worth exactly as much as the write rule guarding that field; a badge driven
// by the sender id cannot be forged at all. Anyone may still name themselves
// "Teamder" and upload our logo — `RESERVED_NAME_RE` below is what stops the
// name, and the badge is what separates the real one from a lookalike that
// slips through.
//
// ⚠️ MIRRORED in functions/src/chatPush.ts (TEAMDER_UID) and in Pulse's
// src/services/teamderChatService.ts. Keep the three in sync.
export const TEAMDER_UID = 'teamder';

/** True for the one identity allowed to wear the verified badge. */
export function isOfficialSender(senderId?: string | null): boolean {
  return senderId === TEAMDER_UID;
}

// Display names nobody but us may use. Deliberately a SUBSTRING match, not an
// exact one: "Teamder Support", "teamder.app" and "צוות טימדר" are all worth
// blocking, and no real person needs any of these words in their name. Covers
// the Latin and Hebrew spellings plus the common Hebrew variant.
//
// ⚠️ MIRRORED in firestore.rules — a client-side check alone is bypassable, so
// the rule is the enforcement and this is the friendly error. Change both.
export const RESERVED_NAME_RE = /teamder|טימדר|טיאמדר|תימדר/i;

/**
 * True when a display name impersonates the brand.
 *
 * An email-shaped name is exempt: signup seeds `name` from the address when
 * there is nothing better, which is how every App Store review account ends up
 * called "appstore.review@teamder.app". An address on screen reads as an
 * address, not as our brand. The residual — someone deliberately picking
 * "teamder@x" — still renders as an address and is not the vector this guards.
 */
export function isReservedName(name: string): boolean {
  const raw = name || '';
  if (raw.includes('@')) return false;
  // Strip whitespace, dots and hyphens so "T e a m d e r" and "team-der" are
  // caught by the same pattern.
  return RESERVED_NAME_RE.test(raw.replace(/[\s._-]/g, ''));
}

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
 * Email-shaped names USED to be exempt here, on the stated grounds that signup
 * seeds `name` from the address when there is nothing better. That was simply
 * not true: every signup path in `userService` seeds `name: fbUser.displayName
 * ?? ''` — the Auth profile name, never the address. Nothing in this codebase
 * has ever put an email into `name`.
 *
 * What the exemption did instead was wave through the one name we would most
 * obviously have wanted to refuse. See `isEmailLikeName` below for who was
 * typing it and what it cost.
 */
export function isReservedName(name: string): boolean {
  const raw = name || '';
  // Strip whitespace, dots and hyphens so "T e a m d e r" and "team-der" are
  // caught by the same pattern.
  return RESERVED_NAME_RE.test(raw.replace(/[\s._-]/g, ''));
}

// An address embedded anywhere in the string, lower-cased first. Deliberately
// not an RFC-grade validator — the job is to recognise "this is an email
// address, not a person's name", and a bare '@' ("עידן @ נחלים", "DJ @Khaled")
// is not that.
//
// ⚠️ MIRRORED in firestore.rules as `nameNotEmail` — the rule is the
// enforcement, this is the friendly error. Change both, and keep the pattern
// identical; `tests/rules/displayName.test.mjs` pins the shared cases.
const EMAIL_NAME_RE = /[^@\s]@[^@\s]+\.[a-z]{2,}/i;

/**
 * True when a display name IS (or contains) an email address.
 *
 * Correct on its own terms — a player shown to a Hebrew club as
 * `someone@gmail.com` is a broken profile, and of 676 accounts live on
 * 19.09.2026 not one real person had chosen such a name.
 *
 * It is also the fix for a machine. Google Play runs a **pre-launch report**
 * robot (Firebase Test Lab) against every release we upload; Play Console
 * hands it the demo credentials from the "App access" page, and it types them
 * into every text input it meets — including the name field on
 * `ProfileSetupScreen`. It then taps onward, joining public clubs and
 * registering for real games. Forty-seven such accounts accumulated between
 * 22.06 and 19.09.2026, all named "appstore.review@teamder.app", all Android,
 * clustering on release days. Two of them PLAYED in a finished game of a real
 * seven-player club and are inside its statistics; a third sat in that club's
 * pending queue 75 seconds after signing up. Real organisers were approving
 * robots.
 *
 * This does not stop the robot running — only unticking the pre-launch report
 * in Play Console does that. It stops the robot completing a profile, which is
 * what turned it into a club member.
 */
export function isEmailLikeName(name: string): boolean {
  return EMAIL_NAME_RE.test(name || '');
}

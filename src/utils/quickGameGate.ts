// Does the quick-create screen have to wait before it can show the form?
//
// One line of `if` used to answer this, twice, in two places in
// GameCreateScreen — and the second copy ran last, so it decided. It tested
// only `quick && !orphanGroup`, which reads as "no group yet, so wait", and
// that is wrong for the two people whose group is never coming:
//
//   • a GUEST. Quick mode is a UI state, not a group. We deliberately do NOT
//     provision the hidden personal group for an anonymous session — it is a
//     real document server-side, and it would belong to a session that may be
//     abandoned. The group is created after sign-in, under the real uid, by
//     `createGameFromValues`. So a guest waiting for one waits forever: the
//     screen showed "מכינים מחזור מהיר…" with no exit but Back.
//
//   • anyone whose provisioning THREW. `orphanFailed` exists so that case can
//     fall through to the retry CTA, and the duplicate gate undid it for any
//     user who happens to administer a club.
//
// It lives here, out of the component, so the answer can be asserted without
// rendering React — the harness has no renderer, and a predicate that only
// exists inside a 900-line screen is a predicate nobody tests.

export interface QuickGameGateState {
  /** Anonymous session. Never allocated a personal group. */
  isGuest: boolean;
  /** Arrived via the "+" chooser's quick option (route param). */
  quick: boolean;
  /** The hidden personal group has been provisioned. */
  hasPersonalGroup: boolean;
  /** `ensurePersonalGroupId` threw; the retry CTA owns the screen now. */
  provisioningFailed: boolean;
}

/**
 * True only while a group is genuinely on its way.
 *
 * The window is the ~1–2s round-trip of `ensurePersonalGroupId`. Holding the
 * form back for it is what stops the community-mode wizard (picker, a club's
 * pre-filled title) from flashing before quick mode snaps in.
 */
export function shouldWaitForPersonalGroup(s: QuickGameGateState): boolean {
  if (!s.quick) return false;
  if (s.isGuest) return false;
  if (s.provisioningFailed) return false;
  return !s.hasPersonalGroup;
}

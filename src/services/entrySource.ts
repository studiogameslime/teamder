// How this launch began — readable by any screen, not just the one that
// resolved it.
//
// ─── Why this module exists ─────────────────────────────────────────────
//
// `App.tsx` already works the answer out exactly once per cold start, across
// all three link sources, and reports it as `entry_source_resolved`. It then
// dropped it on the floor. Every other surface that wanted to say where
// somebody came from had to guess, and `GuestHomeScreen` guessed wrong:
//
//     entry_source: 'organic',   // "a deep link never renders this screen"
//
// It does. `navigatePersonalInvite` addresses `ProfileTab` with
// `initial: false` precisely so the Home sits underneath the landing as a back
// target — so the Home mounts, and reports `organic`, on a launch that came
// from a friend's invitation. Confirmed on a device: a personal-invite cold
// start logged `entry_source_resolved{personal_invite}` and then
// `guest_home_viewed{organic}` eleven seconds apart.
//
// One writer, many readers, no second computation that can drift from the
// first.
//
// ─── Lifetime ───────────────────────────────────────────────────────────
//
// Process-lifetime, matching the fact it records: "this LAUNCH began with X".
// Not persisted — a relaunch is a new launch and resolves its own answer.

/** The closed vocabulary `entry_source_resolved` reports. */
export type EntrySource =
  | 'organic'
  | 'game_link'
  | 'club_link'
  | 'personal_invite'
  /** Resolution has not run yet, or produced nothing recognisable. Reported
   *  as-is rather than defaulted to `organic`: a wrong value that looks
   *  plausible is worse in a funnel than one that admits it does not know. */
  | 'unknown';

let current: EntrySource = 'unknown';

export function setEntrySource(source: EntrySource): void {
  current = source;
}

export function getEntrySource(): EntrySource {
  return current;
}

/** Visible for tests. */
export function resetEntrySource(): void {
  current = 'unknown';
}

// What an edit to a game is worth telling the roster, and what it says.
//
// Two rules, both from the organiser:
//
//   1. Only TIME and PLACE reach the roster. Everything else on the edit form
//      — the title, the notes, the rule chips, the capacity, the duration, who
//      may fill it — is the organiser's business. Pushing those woke fifteen
//      people for a typo, which is how notifications get switched off.
//
//   2. The push states the NEW TIME outright, and for the venue says only that
//      it changed, without naming it. The time is what a player has to
//      re-plan around; the address is something they will read in the game
//      anyway, and spelling it out in a push adds length without adding a
//      decision.
//
// Rule 2 also disposes of a hazard the "old → new" phrasing would have had.
// Edits inside a 60-second window are coalesced into ONE push, so an organiser
// who moves 20:00 → 21:00 → 20:30 produces a single notification. Phrased as a
// transition it would have had to say what the time changed FROM, and the only
// honest answer spans three edits. Stating just the new time is correct
// whatever happened before it.

/** The only fields whose change is worth notifying the roster about. */
export const MATERIAL_EDIT_FIELDS = [
  'startsAt', // the kickoff moved — the one thing a player must re-plan around
  'fieldName', // …or it is somewhere else now
  'fieldAddress',
  'city',
] as const;

export type MaterialEditField = (typeof MATERIAL_EDIT_FIELDS)[number];

/** The venue fields. A change to any of them is one "the place changed". */
const PLACE_FIELDS: readonly MaterialEditField[] = [
  'fieldName',
  'fieldAddress',
  'city',
];

/**
 * What the roster is told. `null` when nothing they care about moved.
 *
 * Deliberately carries the new time as a VALUE and the venue as a mere flag —
 * see rule 2 above. Nothing else from the edit travels.
 */
export interface EditNotice {
  /** New kickoff, when it moved. Absent when only the venue changed. */
  newStartsAt?: number;
  /** True when any venue field changed. The new venue is NOT included. */
  placeChanged?: true;
}

/** Treat null / undefined / '' as the same absence, so clearing an already
 *  empty optional field is not a change. */
const blank = (v: unknown) => v === null || v === undefined || v === '';

/**
 * Which of the notifiable fields actually changed.
 *
 * Compares VALUES against the current game rather than looking at which keys
 * are present: the edit form submits its whole state, so every save carries
 * `startsAt` whether or not the organiser touched it. A key-presence test would
 * have notified on every save, which was the original bug.
 */
export function materialEditChanges(
  patch: Readonly<Record<string, unknown>>,
  existing: Readonly<Record<string, unknown>>,
): MaterialEditField[] {
  const changed: MaterialEditField[] = [];
  for (const field of MATERIAL_EDIT_FIELDS) {
    if (!(field in patch)) continue;
    const next = patch[field];
    const prev = existing[field];
    if (blank(next) && blank(prev)) continue;
    if (next !== prev) changed.push(field);
  }
  return changed;
}

/**
 * The notice to send, or `null` for "say nothing".
 *
 * `existing` supplies the kickoff when the patch didn't move it but the venue
 * did — the push still wants to remind people when the game is.
 */
export function buildEditNotice(
  patch: Readonly<Record<string, unknown>>,
  existing: Readonly<Record<string, unknown>>,
): EditNotice | null {
  const changed = materialEditChanges(patch, existing);
  if (changed.length === 0) return null;

  const notice: EditNotice = {};
  if (changed.includes('startsAt') && typeof patch.startsAt === 'number') {
    notice.newStartsAt = patch.startsAt;
  }
  if (changed.some((f) => PLACE_FIELDS.includes(f))) {
    notice.placeChanged = true;
  }
  // A venue-only change still has a kickoff worth stating.
  return notice;
}

/** Should the roster be told about this edit at all? */
export function shouldNotifyRosterOfEdit(
  patch: Readonly<Record<string, unknown>>,
  existing: Readonly<Record<string, unknown>>,
): boolean {
  return buildEditNotice(patch, existing) !== null;
}

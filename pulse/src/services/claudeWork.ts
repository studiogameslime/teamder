// "בוצע על ידי קלוד" — the handover record Claude leaves on a finished item.
//
// The workflow this exists for: Claude finishes something, writes down what it
// actually changed, attaches proof, and marks the item as done BY CLAUDE. The
// owner then reads that, checks the screenshot, and marks it done himself. Two
// distinct acts, so two distinct states — an item Claude closed is not yet an
// item the owner has accepted.
//
// ⚠️ WHY THIS IS A SEPARATE FIELD AND NOT A `status` VALUE.
//
// Every stream carries its own status vocabulary, and other things count on it:
// `openInboxCounts()` computes open work as `total − countWhereEquals(status,
// 'resolved'|'done')`, and the Teamder side reads these same documents. Writing
// `status: 'done_by_claude'` into `errors` would match no closed-status query,
// so the item would be counted as open by one screen and closed by another —
// the exact trap that already bit us once (a wrong status value leaves an item
// counted as open forever).
//
// Keeping the handover in its OWN fields means:
//   • every existing counter, query and screen behaves exactly as before;
//   • the item legitimately STAYS OPEN until the owner accepts it, which is
//     precisely the review step he asked for;
//   • nothing has to migrate, and an older Pulse build just ignores the fields.
//
// Images follow the convention used everywhere else in Pulse: raw base64 JPEG
// with no `data:` prefix, downscaled before save so a few fit under Firestore's
// ~1MB per-document limit.

import { patchDoc } from './firestoreRest';

export interface ClaudeCompletion {
  /** What was actually fixed / changed. Free text, shown under the item. */
  note: string;
  /** Proof screenshots — raw base64 JPEG, no `data:` prefix. */
  images: string[];
  /** When Claude marked it. 0 when never marked. */
  at: number;
}

/** Read the handover off a raw Firestore doc. Absent → null. */
export function readClaude(d: Record<string, unknown>): ClaudeCompletion | null {
  if (d.claudeStatus !== 'done') return null;
  return {
    note: typeof d.claudeNote === 'string' ? d.claudeNote : '',
    images: Array.isArray(d.claudeImages)
      ? (d.claudeImages.filter((x) => typeof x === 'string') as string[])
      : [],
    at: Number(d.claudeAt ?? 0),
  };
}

/**
 * Mark an item done by Claude, on whatever collection it lives in.
 *
 * `docPath` is the full `collection/id` path, so this works uniformly across
 * tasks / errors / feedback / pulseFeatures / pulseIdeas without any of them
 * needing to know about the others.
 */
export function markDoneByClaude(
  docPath: string,
  note: string,
  images: string[],
  now: number,
): Promise<boolean> {
  return patchDoc(docPath, {
    claudeStatus: 'done',
    claudeNote: note.trim(),
    claudeImages: images,
    claudeAt: now,
  });
}

/** Withdraw the handover — puts the item back to plain open. */
export function clearDoneByClaude(docPath: string): Promise<boolean> {
  return patchDoc(docPath, {
    claudeStatus: '',
    claudeNote: '',
    claudeImages: [],
    claudeAt: 0,
  });
}

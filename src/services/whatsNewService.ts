// whatsNewService — decides whether to show the one-time "מה חדש" modal after
// a version update, and WHICH highlights to show, per user.
//
// Source of truth: the `appConfig/whatsNew` doc (curated in Pulse) —
//   { enabled: boolean, items: [{ version, emoji, title, body }] }
// We show only items whose version is in (seenVersion, currentVersion]. So a
// user who jumped a single version sees only that version's highlights; a user
// who skipped several sees ALL of them in one flat list (newest first), with no
// per-version breakdown. Whether the modal appears at all for a given release
// is decided by us: if we curate no highlight items for that version, nothing
// shows (the baseline just advances silently).
//
// One-time guarantee: the caller (WhatsNewGate) writes seenVersion = current
// the moment it decides to show, so the modal never reappears for that version
// — across relaunches, foregrounding, or closing the app mid-modal.

import { doc, getDoc } from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { getCurrentVersion, compareVersions } from '@/services/updateService';
import { storage } from '@/services/storage';
import { logError, isExpectedDenial } from '@/services/errorLog';
import { mockWhatsNew } from '@/data/mockData';

export interface WhatsNewItem {
  /** App version this highlight belongs to (e.g. "1.0.84"). */
  version: string;
  /** A single emoji shown in the leading tile. */
  emoji: string;
  title: string;
  body: string;
}

export interface WhatsNewDoc {
  enabled: boolean;
  items: WhatsNewItem[];
}

export interface WhatsNewPayload {
  /** The version we're advancing the user to (the running version). */
  version: string;
  /** Highlights to show, newest version first. Never empty. */
  items: WhatsNewItem[];
}

/**
 * Resolve what (if anything) to show the current user. Returns null when the
 * modal should NOT be shown — and in the null cases that represent "seen it" or
 * "nothing to show", advances the local baseline so we don't re-check forever.
 *
 * IMPORTANT: this does NOT itself mark the payload version as seen — the caller
 * marks it right before rendering (write-through) so a crash between resolve and
 * render can't make the modal appear twice.
 */
export async function resolveWhatsNew(): Promise<WhatsNewPayload | null> {
  const current = getCurrentVersion();
  const seen = await storage.getWhatsNewSeenVersion();

  // Fresh install → establish the baseline, never show (they didn't "update").
  // In mock mode we instead pretend the user came from an older version so the
  // modal is demoable/verifiable at launch.
  const seenEffective = seen ?? (USE_MOCK_DATA ? '1.0.80' : null);
  if (!seenEffective) {
    await storage.setWhatsNewSeenVersion(current);
    return null;
  }
  // Already shown for this version (or a newer one) → never again.
  if (compareVersions(seenEffective, current) >= 0) return null;

  const cfg = await fetchWhatsNewDoc();
  if (!cfg || cfg.enabled === false || !Array.isArray(cfg.items)) {
    // No config / globally disabled → advance baseline silently.
    await storage.setWhatsNewSeenVersion(current);
    return null;
  }

  // Highlights strictly newer than what the user last saw, up to the running
  // version. Sorted newest-version-first for a flat, un-grouped list.
  const items = cfg.items
    .filter(
      (it) =>
        it &&
        typeof it.version === 'string' &&
        typeof it.title === 'string' &&
        compareVersions(it.version, seenEffective) > 0 &&
        compareVersions(it.version, current) <= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));

  if (items.length === 0) {
    // Nothing curated for this jump → advance baseline silently.
    await storage.setWhatsNewSeenVersion(current);
    return null;
  }
  return { version: current, items };
}

/** Persist that the modal has been shown for `version` (one-time latch). */
export async function markWhatsNewSeen(version: string): Promise<void> {
  await storage.setWhatsNewSeenVersion(version);
}

async function fetchWhatsNewDoc(): Promise<WhatsNewDoc | null> {
  if (USE_MOCK_DATA) return mockWhatsNew;
  try {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, 'appConfig', 'whatsNew'));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    return {
      enabled: d.enabled !== false,
      items: Array.isArray(d.items) ? (d.items as WhatsNewItem[]) : [],
    };
  } catch (err) {
    // Launch-path read — offline is expected; don't log it as a failure.
    if (!isExpectedDenial(err)) logError('fetchWhatsNew', err, {});
    return null;
  }
}

// draftStore — work in progress that has to survive being interrupted.
//
// The interruption we care about is authentication. A guest fills in the club
// wizard, taps save, and is asked to sign in; on the fallback path in
// `upgradeAnonymous` that replaces the session, which swaps the navigator and
// unmounts the form. Everything they typed lived in `useState` and is gone.
// This is where it goes instead.
//
// ─── Shape decisions ─────────────────────────────────────────────────────
//
// ONE SLOT PER KIND. A person creates one club at a time, so there is no
// "which draft did you mean" question to answer, no unbounded growth, and no
// orphan rows for a sweep to chase. A second draft of the same kind overwrites
// the first, which is also what the person expects.
//
// WRITTEN ON SAVE, NOT ON KEYSTROKE. The moment worth persisting is the one
// where the wall appears. Writing on every character would make the form a
// thing that manages durable state, for no gain: nothing between "started
// typing" and "tried to save" is recoverable in a way the person asked for.
//
// EXPIRY IS LAZY. Checked on read, never on a timer or a sweep. A draft nobody
// comes back for costs a couple of kilobytes until the next read of that slot,
// and that is cheaper than any machinery to collect it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/** Seven days. Long enough to cover "I'll do it this weekend", short enough
 *  that a restored form is still about the thing they had in mind. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftKind = 'club' | 'game' | 'availability';

const KINDS: ReadonlySet<string> = new Set<DraftKind>([
  'club',
  'game',
  'availability',
]);

const APP_VERSION =
  (Constants.expoConfig?.version as string | undefined) ?? 'unknown';

function keyFor(kind: DraftKind): string {
  return `footy.draft.${kind}`;
}

export interface Draft<T = Record<string, unknown>> {
  /** Stable id, referenced by `PendingAction.draftId`. */
  id: string;
  kind: DraftKind;
  values: T;
  createdAt: number;
  updatedAt: number;
  /** The build that wrote it. A draft from an older version may carry a
   *  different field set, which is why `mergeDraftValues` merges onto the
   *  CURRENT defaults rather than trusting the stored object whole. */
  appVersion: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Validate an unknown blob into a `Draft`, or null.
 *
 * `values` is checked only for being a plain object. Field-level validation
 * belongs to `mergeDraftValues`, which knows the current defaults; doing it
 * here would mean this module had to track two form shapes it has no business
 * knowing about.
 */
export function parseDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '') return null;
  if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null;
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) return null;
  if (typeof o.updatedAt !== 'number' || !Number.isFinite(o.updatedAt)) return null;
  if (!o.values || typeof o.values !== 'object' || Array.isArray(o.values)) return null;
  return {
    id: o.id,
    kind: o.kind as DraftKind,
    values: o.values as Record<string, unknown>,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    appVersion: typeof o.appVersion === 'string' ? o.appVersion : 'unknown',
  };
}

export function isExpired(draft: Draft, now: number): boolean {
  return now - draft.updatedAt > DRAFT_TTL_MS;
}

/**
 * Merge stored values onto the current defaults.
 *
 * Three rules, each of which exists because of a real failure mode:
 *
 *   • Only keys PRESENT IN DEFAULTS are copied. A field that has since been
 *     removed from the form cannot come back from a stale draft.
 *   • A key whose default is `undefined` is copied as-is — there is no type to
 *     compare against, and an optional field (`coords`) is legitimately absent.
 *   • Otherwise the stored value must match the default's `typeof` and
 *     array-ness. A field whose type changed between builds is dropped rather
 *     than handed to a form that will then render or submit something
 *     nonsensical.
 *
 * Pure: no clock, no storage, no knowledge of which form this is.
 */
export function mergeDraftValues<T extends Record<string, unknown>>(
  defaults: T,
  stored: Record<string, unknown> | undefined | null,
): T {
  const out: Record<string, unknown> = { ...defaults };
  if (!stored || typeof stored !== 'object') return out as T;
  for (const key of Object.keys(defaults)) {
    if (!(key in stored)) continue;
    const want = (defaults as Record<string, unknown>)[key];
    const got = stored[key];
    if (got === undefined) continue;
    if (want === undefined) {
      out[key] = got;
      continue;
    }
    if (Array.isArray(want) !== Array.isArray(got)) continue;
    if (typeof want !== typeof got) continue;
    out[key] = got;
  }
  return out as T;
}

export interface RestoreResult<T> {
  values: T;
  /**
   * Fields deliberately NOT restored, which the person must supply again.
   *
   * The caller surfaces these; this module names them. Empty in the common
   * case.
   */
  needsAttention: string[];
}

/**
 * Restore a GAME draft.
 *
 * `startsAt` is an absolute timestamp, so a draft opened five days later
 * carries a kick-off that has already happened. We do NOT restore it and we do
 * NOT invent a replacement: the value stays whatever the fresh form would have
 * shown, and `needsAttention` says the person has to pick a time. Guessing a
 * new date here would quietly schedule a game for a day nobody chose, and the
 * submit guard in `GameCreateScreen` (`v.startsAt < Date.now()`) only catches
 * the case where the guess happened to land in the past.
 */
export function restoreGameValues<T extends Record<string, unknown>>(
  defaults: T,
  stored: Record<string, unknown> | undefined | null,
  now: number,
): RestoreResult<T> {
  const merged = mergeDraftValues(defaults, stored);
  const startsAt = (merged as Record<string, unknown>).startsAt;
  if (typeof startsAt === 'number' && startsAt <= now) {
    return {
      values: { ...merged, startsAt: (defaults as Record<string, unknown>).startsAt } as T,
      needsAttention: ['startsAt'],
    };
  }
  return { values: merged, needsAttention: [] };
}

/** Restore any other kind — a straight merge, nothing time-sensitive. */
export function restoreValues<T extends Record<string, unknown>>(
  defaults: T,
  stored: Record<string, unknown> | undefined | null,
): RestoreResult<T> {
  return { values: mergeDraftValues(defaults, stored), needsAttention: [] };
}

// ─── Persistence ──────────────────────────────────────────────────────────

/**
 * Write (or overwrite) the slot for this kind.
 *
 * `createdAt` is preserved across overwrites of the same draft id so "how old
 * is this work" stays answerable; `updatedAt` is what the TTL measures, so
 * editing a draft extends its life, which is the behaviour a person expects.
 */
export async function writeDraft(
  kind: DraftKind,
  id: string,
  values: Record<string, unknown>,
  now: number = Date.now(),
): Promise<Draft> {
  return serializeDraft(async () => {
  const existing = await readRaw(kind);
  const createdAt = existing && existing.id === id ? existing.createdAt : now;
  const draft: Draft = {
    id,
    kind,
    values,
    createdAt,
    updatedAt: now,
    appVersion: APP_VERSION,
  };
  await AsyncStorage.setItem(keyFor(kind), JSON.stringify(draft));
  return draft;
  });
}

let draftQueue: Promise<unknown> = Promise.resolve();
function serializeDraft<T>(fn: () => Promise<T>): Promise<T> {
  const next = draftQueue.then(fn, fn);
  draftQueue = next.catch(() => {});
  return next;
}

/**
 * The draft in this slot, or null.
 *
 * An expired or malformed draft is DELETED here and reported as absent. That
 * makes the read the only collection mechanism the store needs, and means a
 * blob written by a future build can never wedge the slot permanently.
 */
export async function readDraft(
  kind: DraftKind,
  now: number = Date.now(),
): Promise<Draft | null> {
  const draft = await readRaw(kind);
  if (!draft) {
    // Either absent or unreadable. `readRaw` has already removed the latter.
    return null;
  }
  if (isExpired(draft, now)) {
    await discardDraft(kind);
    return null;
  }
  return draft;
}

/**
 * Was there something here that we threw away for being too old?
 *
 * Separate from `readDraft` because the two answers differ for the person:
 * "nothing to continue" is silence, "your draft expired" is a sentence. Does
 * not delete — call `readDraft` for that.
 */
export async function peekExpired(
  kind: DraftKind,
  now: number = Date.now(),
): Promise<boolean> {
  const draft = await readRaw(kind);
  return !!draft && isExpired(draft, now);
}

/** The person chose to throw it away, or it expired. Idempotent. */
export async function discardDraft(kind: DraftKind): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(kind));
  } catch (err) {
    if (__DEV__) console.warn('[draftStore] discard failed', kind, err);
  }
}

/**
 * The work landed — clean up.
 *
 * A distinct name from `discardDraft` on purpose, even though the effect is the
 * same today. These are different events (one is the person giving up, one is
 * the club existing), they are reported differently, and a future change to one
 * must not silently apply to the other.
 */
export async function consumeDraft(kind: DraftKind, expected?: Draft): Promise<void> {
  await serializeDraft(async () => {
    if (expected && JSON.stringify(await readRaw(kind)) !== JSON.stringify(expected)) return;
    await discardDraft(kind);
  });
}

async function readRaw(kind: DraftKind): Promise<Draft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(kind));
    if (!raw) return null;
    let parsed: Draft | null = null;
    try {
      parsed = parseDraft(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      // Malformed — drop it so we stop re-reading a blob we cannot use. A
      // corrupt draft must never be able to throw into a boot path.
      await discardDraft(kind);
      return null;
    }
    return parsed;
  } catch (err) {
    if (__DEV__) console.warn('[draftStore] read failed', kind, err);
    return null;
  }
}

/** Grouped export, matching the house style of `storage` / `gameService`. */
export const draftStore = {
  write: writeDraft,
  read: readDraft,
  peekExpired,
  discard: discardDraft,
  consume: consumeDraft,
  merge: mergeDraftValues,
  restoreValues,
  restoreGameValues,
  parse: parseDraft,
  isExpired,
  keyFor,
  TTL_MS: DRAFT_TTL_MS,
};

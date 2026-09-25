// pendingAction — "what were you trying to do before we interrupted you".
//
// Supersedes `PendingInvite` (see `src/services/storage.ts`) without replacing
// it yet. The old shape could only ever say "open this game" or "open this
// club"; this one can also say "finish creating the club whose draft is in
// slot X", which is what lets a guest fill in a form, sign up, and land back
// on their own work.
//
// ─── Why the old key is still written ────────────────────────────────────
//
// `footy.invite.pending` has THREE readers today, and two of them are easy to
// miss:
//
//   1. the consumer in `src/navigation/RootNavigator.tsx` (navigates),
//   2. `applyInviteAttributionIfFresh` in `src/services/userService.ts`,
//   3. `applyAcquisitionIfFresh`, same file.
//
// (2) and (3) run on every sign-in and write `invitedBy` / `acquisition` onto a
// brand-new user doc. If this module migrated destructively — read the old key,
// write the new one, delete the old — referral attribution would stop working
// in complete silence, with no error anywhere, for every install that had a
// stashed invite. That is the single most expensive thing that could go wrong
// here, so migration is deliberately NON-destructive:
//
//   • `read()` prefers the new key and otherwise DERIVES from the old one,
//     leaving it in place.
//   • `write()` writes the new key AND projects a legacy view onto the old key,
//     so all three readers above keep seeing what they expect.
//   • `clear()` clears both.
//
// The old key stops being written only when its last reader is gone. Until
// then this costs one extra small AsyncStorage write per stash, which is the
// cheapest insurance in the refactor.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  storage,
  type AcquisitionTag,
  type PendingInvite,
} from '@/services/storage';

const KEY = 'footy.pending.action';

/** Bumped when the stored shape changes in a way older code cannot read.
 *  v1 is the legacy `PendingInvite`, which carries no `version` field at all. */
export const PENDING_ACTION_VERSION = 2;

export type { AcquisitionTag };

/** Where the intent was formed. Reported, never routed on. */
export type ActionOrigin =
  /** `Linking.getInitialURL()` or the `url` event. */
  | 'deep_link'
  /** Play Install Referrer (Android) or the clipboard (iOS). */
  | 'deferred_deep_link'
  /** A campaign link — `footy://open/<dest>`, see `src/utils/appLinks.ts`. */
  | 'campaign'
  /** The person tapped something inside the app. */
  | 'in_app';

const ORIGINS: ReadonlySet<string> = new Set([
  'deep_link',
  'deferred_deep_link',
  'campaign',
  'in_app',
]);

/** Kinds that name a document. */
export type TargetedKind =
  | 'open_game'
  | 'open_club'
  | 'join_game'
  | 'join_club'
  /** Applying to fill an empty slot in somebody else's match. Targeted, not
   *  drafted: it names a game and carries no form. Deliberately NOT folded
   *  into `join_game` — a filler application is a different business action.
   *  It goes to a Cloud Function rather than the roster transaction, it is
   *  open to NON-members where a join is not, and it can only ever end in
   *  "an admin will decide". Sharing the kind would make the resumer guess
   *  which of the two the person actually asked for. */
  | 'apply_filler';
/** Kinds that carry work in progress. */
export type DraftedKind = 'create_club' | 'create_game' | 'save_availability';

export type PendingActionKind = TargetedKind | DraftedKind | 'open_invite';

const TARGETED_KINDS: ReadonlySet<string> = new Set<TargetedKind>([
  'open_game',
  'open_club',
  'join_game',
  'join_club',
  'apply_filler',
]);
const DRAFTED_KINDS: ReadonlySet<string> = new Set<DraftedKind>([
  'create_club',
  'create_game',
  'save_availability',
]);

interface Base {
  version: number;
  createdAt: number;
  origin: ActionOrigin;
  /** Referral credit. The field name matches what `userService` writes, on
   *  purpose — this is the value the whole attribution chain keys on. */
  invitedBy?: string;
  acquisition?: AcquisitionTag;
}

/** `targetId` is required by the type, so no consumer has to null-check it. */
export interface TargetedAction extends Base {
  kind: TargetedKind;
  targetId: string;
}

/** The draft itself lives in `draftStore`; this only points at it, which keeps
 *  the stash a few hundred bytes and lets the two expire independently. */
export interface DraftedAction extends Base {
  kind: DraftedKind;
  draftId: string;
  /** `create_game` inside a club — the club the draft belongs to. */
  targetId?: string;
}

/** A personal invite: an inviter, no target, no draft. */
export interface BareAction extends Base {
  kind: 'open_invite';
}

export type PendingAction = TargetedAction | DraftedAction | BareAction;

// ─── Type guards ──────────────────────────────────────────────────────────

export function isTargeted(a: PendingAction): a is TargetedAction {
  return TARGETED_KINDS.has(a.kind);
}

export function isDrafted(a: PendingAction): a is DraftedAction {
  return DRAFTED_KINDS.has(a.kind);
}

/**
 * Kinds a GUEST may consume without an account: they only navigate.
 *
 * Everything else writes, and writing needs a person. Those stay stashed
 * until the contextual auth that completes them exists — dropping them would
 * silently discard what somebody asked for.
 */
export function isOpenKind(kind: PendingActionKind): boolean {
  return kind === 'open_game' || kind === 'open_club' || kind === 'open_invite';
}

// ─── Pure conversion ──────────────────────────────────────────────────────

/**
 * Legacy → new. `now` is a parameter rather than a `Date.now()` call so the
 * conversion stays pure and testable: the legacy shape has no timestamp of its
 * own, and inventing one inside the function makes the result unassertable.
 */
export function fromLegacyInvite(p: PendingInvite, now: number): PendingAction {
  const acquisition: AcquisitionTag | undefined =
    p.source || p.campaign || p.linkId
      ? { source: p.source, campaign: p.campaign, linkId: p.linkId }
      : undefined;
  const base = {
    version: PENDING_ACTION_VERSION,
    createdAt: now,
    origin: 'deep_link' as const,
    ...(p.invitedBy ? { invitedBy: p.invitedBy } : {}),
    ...(acquisition ? { acquisition } : {}),
  };
  if (p.type === 'session') {
    return { ...base, kind: 'open_game', targetId: p.id };
  }
  if (p.type === 'team') {
    return { ...base, kind: 'open_club', targetId: p.id };
  }
  return { ...base, kind: 'open_invite' };
}

/**
 * New → legacy, for the three readers that still expect the old shape.
 *
 * The mapping for a DRAFTED action is the interesting one. `create_club` has no
 * legacy equivalent, but it can still carry an inviter — and dropping the
 * inviter would lose a referral. `type: 'app'` means exactly "credit this
 * inviter, navigate nowhere", which is the correct legacy reading of "they were
 * making a club and somebody sent them here". Without an inviter or an
 * acquisition tag there is nothing to preserve, so the answer is null and the
 * caller clears the old key.
 */
export function toLegacyInvite(a: PendingAction): PendingInvite | null {
  const tag: AcquisitionTag = {
    ...(a.acquisition?.source ? { source: a.acquisition.source } : {}),
    ...(a.acquisition?.campaign ? { campaign: a.acquisition.campaign } : {}),
    ...(a.acquisition?.linkId ? { linkId: a.acquisition.linkId } : {}),
  };
  const credit = {
    ...(a.invitedBy ? { invitedBy: a.invitedBy } : {}),
    ...tag,
  };
  if (a.kind === 'open_game' || a.kind === 'join_game') {
    return { type: 'session', id: a.targetId, ...credit };
  }
  if (a.kind === 'open_club' || a.kind === 'join_club') {
    return { type: 'team', id: a.targetId, ...credit };
  }
  // open_invite, and every drafted kind.
  if (a.invitedBy || tag.source || tag.campaign || tag.linkId) {
    return { type: 'app', ...credit };
  }
  return null;
}

/**
 * Validate an unknown blob into a `PendingAction`, or null.
 *
 * Exported because it is the part worth testing exhaustively. A malformed
 * stash must never throw into a boot path — `read()` below drops it instead.
 */
export function parsePendingAction(raw: unknown): PendingAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  // A future build may write a shape this one cannot read. Refusing it is
  // right; guessing at it is not.
  if (typeof o.version !== 'number' || o.version !== PENDING_ACTION_VERSION) {
    return null;
  }
  if (typeof o.kind !== 'string') return null;
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) return null;
  if (typeof o.origin !== 'string' || !ORIGINS.has(o.origin)) return null;

  const base: Base = {
    version: PENDING_ACTION_VERSION,
    createdAt: o.createdAt,
    origin: o.origin as ActionOrigin,
  };
  // Same defensive cleanup as `storage.getPendingInvite`: a malformed inviter
  // drops out rather than failing the whole read, because the rest of the
  // action is still actionable without somebody to credit.
  if (typeof o.invitedBy === 'string' && o.invitedBy !== '') {
    base.invitedBy = o.invitedBy;
  }
  const acq = o.acquisition;
  if (acq && typeof acq === 'object') {
    const a = acq as Record<string, unknown>;
    const clean: AcquisitionTag = {};
    if (typeof a.source === 'string' && a.source !== '') clean.source = a.source;
    if (typeof a.campaign === 'string' && a.campaign !== '') clean.campaign = a.campaign;
    if (typeof a.linkId === 'string' && a.linkId !== '') clean.linkId = a.linkId;
    if (Object.keys(clean).length) base.acquisition = clean;
  }

  if (TARGETED_KINDS.has(o.kind)) {
    if (typeof o.targetId !== 'string' || o.targetId === '') return null;
    return { ...base, kind: o.kind as TargetedKind, targetId: o.targetId };
  }
  if (DRAFTED_KINDS.has(o.kind)) {
    if (typeof o.draftId !== 'string' || o.draftId === '') return null;
    const out: DraftedAction = {
      ...base,
      kind: o.kind as DraftedKind,
      draftId: o.draftId,
    };
    if (typeof o.targetId === 'string' && o.targetId !== '') out.targetId = o.targetId;
    return out;
  }
  if (o.kind === 'open_invite') {
    return { ...base, kind: 'open_invite' };
  }
  return null;
}

// ─── Persistence ──────────────────────────────────────────────────────────

/**
 * The pending action, or null.
 *
 * Prefers the new key. Falls back to the legacy `PendingInvite` and converts it
 * IN MEMORY, leaving the old key untouched — see the header. `now` is injected
 * for the same reason `fromLegacyInvite` takes it.
 */
export async function readPendingAction(
  now: number = Date.now(),
): Promise<PendingAction | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = parsePendingAction(safeJson(raw));
      if (parsed) return parsed;
      // Unreadable or from a newer build — drop it so we stop re-reading it,
      // then fall through to the legacy key rather than reporting nothing.
      await AsyncStorage.removeItem(KEY);
    }
  } catch (err) {
    if (__DEV__) console.warn('[pendingAction] read failed', err);
  }
  try {
    const legacy = await storage.getPendingInvite();
    return legacy ? fromLegacyInvite(legacy, now) : null;
  } catch (err) {
    if (__DEV__) console.warn('[pendingAction] legacy read failed', err);
    return null;
  }
}

/**
 * Persist an action, and project it onto the legacy key for the readers that
 * have not moved yet.
 *
 * Order matters: the new key is written first, because it is the one that can
 * represent the action fully. If the legacy projection then fails we have lost
 * a referral at worst, not the action itself.
 */
export async function writePendingAction(action: PendingAction): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(action));
  try {
    const legacy = toLegacyInvite(action);
    if (legacy) await storage.setPendingInvite(legacy);
    else await storage.clearPendingInvite();
  } catch (err) {
    if (__DEV__) console.warn('[pendingAction] legacy projection failed', err);
  }
}

/** Remove both keys. Idempotent. */
export async function clearPendingAction(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (err) {
    if (__DEV__) console.warn('[pendingAction] clear failed', err);
  }
  try {
    await storage.clearPendingInvite();
  } catch (err) {
    if (__DEV__) console.warn('[pendingAction] legacy clear failed', err);
  }
}

/**
 * Read and clear in one go — the shape a one-shot consumer wants.
 *
 * A second call returns null. That is the whole contract: the consumer in
 * `RootNavigator` must fire at most once per launch, and making "exactly once"
 * a property of this function rather than of a `useRef` at the call site means
 * a second consumer added later cannot double-navigate.
 */
export async function consumePendingAction(
  now: number = Date.now(),
): Promise<PendingAction | null> {
  const action = await readPendingAction(now);
  if (action) await clearPendingAction();
  return action;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Grouped export, matching the house style of `storage` / `gameService`. */
export const pendingAction = {
  read: readPendingAction,
  write: writePendingAction,
  clear: clearPendingAction,
  consume: consumePendingAction,
  toLegacyInvite,
  fromLegacyInvite,
  parse: parsePendingAction,
  isTargeted,
  isDrafted,
  isOpenKind,
  KEY,
};

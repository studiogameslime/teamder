// Whether to offer notifications, and for what reason.
//
// ─── Why this is one file ────────────────────────────────────────────────
//
// The alternative is every success path inventing its own conditions, and the
// failure mode of that is not a bug in one screen — it is three screens each
// asking at a slightly different moment, and a person who joins a match, joins
// a club and saves availability in the same five minutes being asked three
// times. So: business completions ANNOUNCE a context; this decides; a host in
// the tree presents. No success screen carries a permission condition.
//
// ─── What earns the question ─────────────────────────────────────────────
//
// Only a moment where the answer is obviously useful, and only where the app
// really does send something. That last part is a constraint, not a courtesy:
// the copy names what will arrive, and promising a notification the backend
// does not send is a lie with a long tail. Each context below was checked
// against what `functions/src/index.ts` actually dispatches.
//
// ─── What stops it ───────────────────────────────────────────────────────
//
// A single cooldown and the permission state. Not a growth system — one
// timestamp, one "asked once per context", and a hard stop on anything the OS
// has already answered.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PushPermissionState } from '@/services/pushPermission';

/**
 * The moments that earn the question.
 *
 *   join_game     — `gameReminder`, `gameCanceledOrUpdated`, `spotOpened`,
 *                   `spotOffered`, `gameFillingUp` all go to participants.
 *                   "We will tell you if something changes" is true.
 *   join_club     — `newGameInCommunity` fans out to members subscribed to
 *                   the club. "We will tell you when a new evening opens" is
 *                   true.
 *   availability  — `fillerOpportunity` matches declared days/times and home
 *                   city against matches that need players. True, but ONLY
 *                   when `acceptsFillerPush` is on, which is why the caller
 *                   passes that in rather than this file assuming it.
 *
 * Deliberately NOT here: creating a club or a match. An organiser does get
 * real pushes (`joinRequest`, `gamePlayersJoined`, `playerCancelled`,
 * `gameShortageWarning`) — but a create lands you on the new club or match
 * with a celebration, and stacking a permission sheet on top of that is the
 * bombardment this design is trying to avoid. They will meet the offer at
 * their first join instead.
 */
export type OfferContext = 'join_game' | 'join_club' | 'availability';

/** Per-context "we have already asked" marks, plus one shared cooldown. */
const ASKED_KEY = 'footy.notifOffer.asked';
const LAST_SHOWN_KEY = 'footy.notifOffer.lastShown';

/**
 * How long after a "לא עכשיו" before any context may ask again.
 *
 * Seven days, one number, no per-context tuning. Somebody who declined the
 * sheet has given an answer about this week, not about the product; a week
 * later, at a different moment, asking once more is reasonable. Anything
 * cleverer than a single timestamp is a growth system, and this is not one.
 */
export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfferDecision {
  show: boolean;
  /** Why not, for analytics and for reading the logs later. */
  reason?:
    | 'granted'
    | 'blocked'
    | 'denied'
    | 'unsupported'
    | 'cooldown'
    | 'already_asked'
    | 'context_not_applicable';
  state: PushPermissionState;
}

async function readAsked(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(ASKED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

/**
 * Should the education sheet appear for this context, right now?
 *
 * Reads only. Nothing here changes state — the caller marks the offer as made
 * when it actually shows one, so a decision that never reached a screen does
 * not burn the context.
 */
export async function shouldOffer(
  context: OfferContext,
  opts: { applicable?: boolean; now?: number } = {},
): Promise<OfferDecision> {
  // Imported HERE rather than at module scope, and the reason is structural:
  // `actionCoordinator` reaches this file to announce a completed action, and
  // a static import would drag `notificationsService` — and with it every
  // native notification module — into that import graph. The announcement
  // path must stay free of native code; the permission read is async anyway.
  const { getPushPermissionState } = await import('@/services/pushPermission');
  const state = await getPushPermissionState();

  // Nothing to offer: `granted` already works, and neither `blocked` nor
  // `unsupported` can be changed by a sheet.
  if (state === 'granted') return { show: false, reason: 'granted', state };
  if (state === 'blocked') return { show: false, reason: 'blocked', state };
  if (state === 'unsupported') return { show: false, reason: 'unsupported', state };

  // `denied` DOES continue, and the device run is what settled that. Android
  // cannot reliably say "never asked": expo-notifications reports
  // `status:'denied', canAskAgain:true` for POST_NOTIFICATIONS that has never
  // been requested, so treating denied as a hard stop meant a fresh Android
  // phone was never offered anything at all — the feature would have shipped
  // doing nothing on its main platform.
  //
  // The distinction that actually matters is whether the OS will still show
  // its dialog, and `blocked` above is that line. What stops re-asking
  // somebody who genuinely declined is OUR record — the per-context mark and
  // the cooldown below — which is "not immediately, and at a different
  // moment", exactly what was asked for. On iOS a real decline resolves to
  // `blocked`, so that platform gets the one shot it actually has.

  // The caller's own precondition — availability passes `acceptsFillerPush`
  // here, because a person who turned filler pushes off will not receive the
  // thing the copy promises.
  if (opts.applicable === false) {
    return { show: false, reason: 'context_not_applicable', state };
  }

  const asked = await readAsked();
  if (asked.has(context)) return { show: false, reason: 'already_asked', state };

  const now = opts.now ?? Date.now();
  try {
    const last = await AsyncStorage.getItem(LAST_SHOWN_KEY);
    const at = last ? Number(last) : 0;
    if (Number.isFinite(at) && at > 0 && now - at < COOLDOWN_MS) {
      return { show: false, reason: 'cooldown', state };
    }
  } catch {
    // An unreadable cooldown is not a reason to nag; treat it as elapsed only
    // because the per-context `asked` mark above is the stronger guard.
  }

  return { show: true, state };
}

/** Record that this context has now had its turn. Called when a sheet is
 *  actually presented, not when a decision is computed. */
export async function markOffered(
  context: OfferContext,
  now: number = Date.now(),
): Promise<void> {
  try {
    const asked = await readAsked();
    asked.add(context);
    await AsyncStorage.setItem(ASKED_KEY, JSON.stringify([...asked]));
    await AsyncStorage.setItem(LAST_SHOWN_KEY, String(now));
  } catch {
    // Worst case the sheet appears once more. Not worth failing anything over.
  }
}

/** Visible for tests, and for a sign-out that hands the device to somebody
 *  else — the next person has not been asked anything. */
export async function resetOffers(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([ASKED_KEY, LAST_SHOWN_KEY]);
  } catch {
    // Ignored on purpose.
  }
}

// ─── The seam between business and presentation ───────────────────────────
//
// A business completion says WHAT happened. It does not know whether a sheet
// should appear, must not wait for one, and must not fail because one did.
// So the announcement is a plain synchronous notify with no return value, and
// the host in the tree does the deciding.

type Listener = (context: OfferContext, opts: { applicable?: boolean }) => void;

let listener: Listener | null = null;
/** An announcement that arrived with nobody listening. See below. */
let pending: { context: OfferContext; opts: { applicable?: boolean } } | null = null;

/**
 * Called by the host component when it is ready to present, and with `null`
 * when it is not. A second host replaces the first rather than both receiving
 * — two sheets for one event is the bug that would cause.
 *
 * Registering FLUSHES a queued announcement, and that is the important part.
 * The commonest path in the product is guest → tap join → sign in → the
 * coordinator resumes and completes the join, all inside the same few hundred
 * milliseconds — and the host only becomes active once React has re-rendered
 * with the new session. The emulator run caught exactly that: the join landed
 * ~300ms after sign-in, the host was still inactive, and the announcement went
 * nowhere. Dropping it would mean the one context that matters most for a new
 * person is the one that never asks.
 */
export function setOfferListener(fn: Listener | null): void {
  listener = fn;
  if (!fn || !pending) return;
  const queued = pending;
  pending = null;
  try {
    fn(queued.context, queued.opts);
  } catch {
    // Same contract as announcing: presentation cannot break anything.
  }
}

/**
 * "This person just did the thing." Fire-and-forget, by design.
 *
 * Never awaited by the caller and never throwing: a permission sheet is not
 * part of joining a match, and a join that succeeded must report success even
 * if every line below fails.
 */
export function announceCompleted(
  context: OfferContext,
  opts: { applicable?: boolean } = {},
): void {
  try {
    if (listener) {
      listener(context, opts);
      return;
    }
    // Nobody listening yet. Hold the LAST one only: if two completions land
    // before the host is ready, the most recent is the one the person is
    // looking at, and queueing both would mean two sheets in a row.
    pending = { context, opts };
  } catch {
    // Swallowed deliberately — see above.
  }
}

/** Visible for tests. */
export function __clearPendingAnnouncement(): void {
  pending = null;
}

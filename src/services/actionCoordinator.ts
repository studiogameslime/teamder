// actionCoordinator — the single place that decides whether an action can run
// now or has to wait for an identity, and the single place that runs it.
//
// Every gated action goes through `requestAction`. That is the whole point: one
// behaviour, one set of analytics, one cancel, one resume, one lock. Five
// screens each inventing their own version is how "join" ends up meaning
// something slightly different on the feed than on the game screen.
//
// ─── Exactly once ────────────────────────────────────────────────────────
//
// Three things can plausibly try to resume the same action at the same moment:
// the auth callback that just succeeded, the `onAuthStateChanged` listener
// reacting to the same sign-in, and the consumer effect in RootNavigator when
// `currentUser` flips. All three are correct to try; only one may win.
//
// `inFlight` is that lock. It is keyed by action identity rather than a plain
// boolean so a second, DIFFERENT action is not blocked by the first — and it is
// module state rather than React state because the whole point is to survive
// the component tree being swapped underneath it, which is exactly what a
// sign-in does.

import {
  readPendingAction,
  writePendingAction,
  clearPendingAction,
  isOpenKind,
  type PendingAction,
  type PendingActionKind,
  type ActionOrigin,
} from '@/services/pendingAction';
import { draftStore, type DraftKind } from '@/services/draftStore';
import { useUserStore } from '@/store/userStore';
import { announceOfferFor } from '@/services/actionOfferBridge';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import {
  failureReasonFromCode,
  isPresentButUnreadable,
  type FailureReason,
  type ResumeOutcome,
} from '@/utils/pendingActionMachine';

// ─── What an action does when it finally runs ─────────────────────────────

/**
 * The business call, supplied by the screen that owns it.
 *
 * Returns an outcome rather than throwing for the expected answers, because
 * "you are on the waitlist" and "an admin has to approve you" are RESULTS, not
 * errors — a full game reported as a failure is how somebody who just got in
 * line is told the app is broken.
 */
export type ActionExecutor = () => Promise<ActionResult>;

export interface ActionResult {
  outcome: ResumeOutcome;
  /** True when this is as far as the action goes — clear the stash. False for
   *  a retryable failure, which must keep it. */
  terminal: boolean;
  /** Set when `outcome` could not be reached. */
  reason?: FailureReason;
}

/** Everything the coordinator needs to describe, persist and report one intent. */
export interface ActionRequest {
  kind: PendingActionKind;
  origin?: ActionOrigin;
  /** The document the action is about, when there is one. */
  targetId?: string;
  /** Referral credit riding along, when the intent came from a link. */
  invitedBy?: string;
  /** For a drafted kind: the form values to preserve across the sign-in. */
  draft?: { kind: DraftKind; id: string; values: Record<string, unknown> };
  /** Runs when the person is (or becomes) a real account. */
  execute: ActionExecutor;
}

export type RequestOutcome =
  | { status: 'done'; result: ActionResult }
  /** Persisted and waiting for an identity. The caller shows the auth sheet. */
  | { status: 'needs_auth'; action: PendingAction }
  /** Another attempt at the same action is already running. */
  | { status: 'busy' };

// ─── The lock ─────────────────────────────────────────────────────────────

const inFlight = new Set<string>();

/** Identity of an attempt: the same target and kind is the same attempt. */
function lockKey(kind: PendingActionKind, targetId?: string): string {
  return `${kind}:${targetId ?? '-'}`;
}

/** Visible for tests — module state is per-process by design. */
export function __resetCoordinatorForTests(): void {
  inFlight.clear();
}

// ─── Request ──────────────────────────────────────────────────────────────

/**
 * Ask for an action. Runs it if the person is a real account; otherwise
 * persists the intent (and any draft) and tells the caller to authenticate.
 *
 * Persisting happens BEFORE the sheet opens, not after it succeeds. On the
 * fallback path in `upgradeAnonymous` the session is replaced, which swaps the
 * navigator and unmounts the calling screen — an await after that races the
 * teardown, and the thing being awaited is the only record of what the person
 * wanted.
 */
export async function requestAction(req: ActionRequest): Promise<RequestOutcome> {
  const key = lockKey(req.kind, req.targetId);
  if (inFlight.has(key)) return { status: 'busy' };

  const user = useUserStore.getState().currentUser;
  const isGuest = !user || user.isGuest === true;

  if (!isGuest) {
    inFlight.add(key);
    try {
      const result = await run(req.kind, req.execute);
      if (result.terminal) await clearAll(req);
      // AFTER the outcome is terminal and the stash is cleaned. See
      // `actionOfferBridge` — this announces, it does not present, it is not
      // awaited, and it cannot make a completed join report failure.
      announceOfferFor(req.kind, result);
      return { status: 'done', result };
    } finally {
      inFlight.delete(key);
    }
  }

  // ── The wall ───────────────────────────────────────────────────────────
  const action = buildAction(req);
  try {
    if (req.draft) {
      await draftStore.write(req.draft.kind, req.draft.id, req.draft.values);
      logEvent(AnalyticsEvent.DraftSaved, { kind: req.draft.kind });
    }
    await writePendingAction(action);
    logEvent(AnalyticsEvent.PendingActionSaved, {
      kind: req.kind,
      origin: action.origin,
      has_draft: !!req.draft,
    });
  } catch (err) {
    // Losing the stash is bad; blocking the sign-up over it is worse. The
    // person can still authenticate and redo the action by hand.
    logError('requestActionPersist', err, { kind: req.kind });
  }
  return { status: 'needs_auth', action };
}

function buildAction(req: ActionRequest): PendingAction {
  const base = {
    version: 2,
    createdAt: Date.now(),
    origin: req.origin ?? ('in_app' as ActionOrigin),
    ...(req.invitedBy ? { invitedBy: req.invitedBy } : {}),
  };
  if (req.draft) {
    return {
      ...base,
      kind: req.kind as 'create_club' | 'create_game' | 'save_availability',
      draftId: req.draft.id,
      ...(req.targetId ? { targetId: req.targetId } : {}),
    };
  }
  return {
    ...base,
    kind: req.kind as 'join_game' | 'join_club' | 'open_game' | 'open_club',
    targetId: req.targetId ?? '',
  };
}

// ─── Resume ───────────────────────────────────────────────────────────────

/**
 * Finish whatever was stashed, now that there is an identity.
 *
 * Registered executors rather than a switch: the business logic belongs to the
 * screens that own it, and re-implementing "join a game" here would give the
 * product a second, subtly different join.
 *
 * IDEMPOTENT by two mechanisms together — the lock stops two callers in the
 * same process, and the stash being cleared only on terminal success means a
 * process that died mid-flight finds the action still there and simply tries
 * again.
 */
type Resumer = (action: PendingAction) => Promise<ActionResult>;
const resumers = new Map<PendingActionKind, Resumer>();

/** Called once at boot by the module that owns each action. */
export function registerResumer(kind: PendingActionKind, fn: Resumer): void {
  resumers.set(kind, fn);
}

export async function resumePendingAction(): Promise<
  | { status: 'none' }
  | { status: 'busy' }
  | { status: 'held' }
  /** `kind` rides along because the caller has to TELL somebody what
   *  happened, and "you are on the waitlist" reads differently for a match
   *  than for a club. The outcome alone cannot say which. */
  | { status: 'ran'; kind: PendingActionKind; result: ActionResult }
> {
  const action = await readPendingAction();
  if (!action) return { status: 'none' };

  // Navigate-only kinds are the deep-link consumer's business, not this one's.
  if (isOpenKind(action.kind)) return { status: 'held' };

  const user = useUserStore.getState().currentUser;
  if (!user || user.isGuest === true) return { status: 'held' };

  const key = lockKey(action.kind, targetOf(action));
  if (inFlight.has(key)) return { status: 'busy' };

  const fn = resumers.get(action.kind);
  if (!fn) {
    // A kind nobody claimed. Held rather than cleared — the owner may simply
    // not have mounted yet, and discarding it would be silent data loss.
    if (__DEV__) console.warn('[coordinator] no resumer for', action.kind);
    return { status: 'held' };
  }

  inFlight.add(key);
  logEvent(AnalyticsEvent.PendingActionResumed, {
    kind: action.kind,
    origin: action.origin,
    age_ms: Math.max(0, Date.now() - action.createdAt),
    is_guest: false,
  });
  try {
    const result = await fn(action);
    if (result.terminal) {
      await clearAll({ kind: action.kind, draft: draftRefOf(action) });
      // Same ordering as the direct path above: the resumed join has already
      // happened and its stash is gone before anybody is asked anything.
      announceOfferFor(action.kind, result);
    } else {
      logEvent(AnalyticsEvent.PendingActionFailed, {
        kind: action.kind,
        reason: result.reason ?? 'unknown',
      });
    }
    return { status: 'ran', kind: action.kind, result };
  } finally {
    inFlight.delete(key);
  }
}

// ─── Running one attempt ──────────────────────────────────────────────────

async function run(kind: PendingActionKind, execute: ActionExecutor): Promise<ActionResult> {
  try {
    return await execute();
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    // A target that exists but cannot be read is NOT a failure — the screen has
    // a dedicated view for it. Checked first so it can never be mapped to a
    // generic error.
    if (isPresentButUnreadable(code)) {
      return { outcome: 'navigated', terminal: true };
    }
    const reason = failureReasonFromCode(code);
    const retryable = reason === 'network_unavailable' || reason === 'rate_limited';
    if (!retryable) logError('actionExecute', err, { kind, code });
    return { outcome: 'joined', terminal: !retryable, reason };
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

/**
 * Clear the stash and the draft — ONLY after a terminal business outcome.
 *
 * Not after authentication, not after the profile screen, not after navigation,
 * and not when a network request merely started. Those all succeed while the
 * thing the person actually asked for has not happened yet.
 */
async function clearAll(req: { kind: PendingActionKind; draft?: { kind: DraftKind } }): Promise<void> {
  try {
    await clearPendingAction();
  } catch (err) {
    logError('actionClearPending', err, { kind: req.kind });
  }
  if (req.draft) {
    try {
      await draftStore.consume(req.draft.kind);
    } catch (err) {
      logError('actionConsumeDraft', err, { kind: req.kind });
    }
  }
}

function targetOf(a: PendingAction): string | undefined {
  return 'targetId' in a ? a.targetId : undefined;
}

/** The draft slot a kind owns, so cleanup does not need the original request. */
function draftRefOf(a: PendingAction): { kind: DraftKind } | undefined {
  if (a.kind === 'create_club') return { kind: 'club' };
  if (a.kind === 'create_game') return { kind: 'game' };
  if (a.kind === 'save_availability') return { kind: 'availability' };
  return undefined;
}

export const actionCoordinator = {
  request: requestAction,
  resume: resumePendingAction,
  registerResumer,
};

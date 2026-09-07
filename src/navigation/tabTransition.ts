// What a bottom-tab press should actually DISPATCH — decided here, in one pure
// function, so it can be reasoned about and tested without a navigator.
//
// The crash this exists to stop (audit P0-3).
//
// Every tab press used to `preventDefault()` and dispatch the same thing: a
// navigate carrying `state: { routes: [{ name: root }] }`, which REPLACES the
// target tab's whole nested stack. That is the heaviest operation the navigator
// offers — react-native-screens tears down and re-attaches native views for it
// — and it was issued unconditionally, including for a tab already sitting on
// exactly that root.
//
// Under fast repeated taps the replacements overlap. The "already at root"
// early return could not help, because navigation state has not updated yet
// when the second tap arrives: both taps read the same stale state, both decide
// to reset, and the second reset lands mid-transition. Android then throws
//     java.lang.IllegalStateException: The specified child already has a parent
// from the native view manager, ReactHost tears down, and the user is left on a
// white screen until they force-quit.
//
// Two changes, and neither is a blanket debounce (a timer would only narrow the
// window while leaving the unnecessary work in place):
//
//   1. ONLY reset when there is something to reset. A tab whose stack is
//      already exactly [root] needs a plain tab jump — no nested-state payload,
//      no native re-parenting. Rapid switching between tabs at their roots, the
//      common case and the one people actually trigger the crash with, stops
//      issuing replacements altogether.
//
//   2. Coalesce a transition that is already in flight. A repeat of the SAME
//      target before navigation state reflects it is a duplicate, not a new
//      intent, and is dropped. A press for a DIFFERENT tab is never delayed —
//      this dedupes by identity, not by time.
//
// The window in (2) is bounded by a timeout purely as a failsafe: if a dispatch
// is somehow never reflected in state, the guard must not wedge navigation
// forever.

/** The nested stack state React Navigation reports for one tab. */
export interface TabStackState {
  index?: number;
  routes?: { name: string }[];
}

export type TabPressPlan =
  /** Already there, and focused — do nothing at all. */
  | { action: 'none'; reason: 'already-at-root' | 'duplicate-in-flight' }
  /** Focus the tab; its stack is already exactly [root]. No nested payload. */
  | { action: 'jump' }
  /** Replace the tab's nested stack with exactly [root]. */
  | { action: 'reset'; rootName: string };

/** A dispatch we have issued but not yet seen reflected in navigation state. */
export interface InFlight {
  tabName: string;
  rootName: string;
  at: number;
}

/**
 * Failsafe for the in-flight guard. Long enough to cover a real stack
 * replacement plus its animation, short enough that a dispatch which never
 * lands cannot wedge the tab bar.
 */
export const IN_FLIGHT_TIMEOUT_MS = 600;

/** Is the tab's stack exactly `[rootName]`, sitting at index 0? */
export function isExactlyAtRoot(
  stack: TabStackState | undefined,
  rootName: string,
): boolean {
  const routes = stack?.routes;
  if (!routes || routes.length !== 1) return false;
  if ((stack?.index ?? 0) !== 0) return false;
  return routes[0]?.name === rootName;
}

export function planTabPress(args: {
  tabName: string;
  /** The CONFIGURED root for this tab. */
  rootName: string;
  /** The tab's nested stack state, as navigation currently reports it. */
  stack: TabStackState | undefined;
  /** Is this tab the focused one right now? */
  isFocused: boolean;
  /** The dispatch we issued and have not yet seen take effect, if any. */
  inFlight: InFlight | null;
  now: number;
}): TabPressPlan {
  const { tabName, rootName, stack, isFocused, inFlight, now } = args;

  // A repeat of a transition we have already asked for and not yet seen land.
  // Dropping it is what keeps two stack replacements from overlapping — the
  // condition the native view manager cannot survive. Expires so a dispatch
  // that never lands cannot block the tab bar permanently.
  if (
    inFlight &&
    inFlight.tabName === tabName &&
    inFlight.rootName === rootName &&
    now - inFlight.at < IN_FLIGHT_TIMEOUT_MS
  ) {
    return { action: 'none', reason: 'duplicate-in-flight' };
  }

  const atRoot = isExactlyAtRoot(stack, rootName);

  // Focused and already at root: the press has nothing to express.
  if (atRoot && isFocused) return { action: 'none', reason: 'already-at-root' };

  // At root but not focused: this is a tab SWITCH. Just move focus — replacing
  // a stack that is already [root] with [root] is pure native churn, and it is
  // the churn that crashes.
  if (atRoot) return { action: 'jump' };

  // Genuinely deep in the stack (or on a corrupted/persisted non-root route):
  // the replacement is the point of the press, so issue it.
  return { action: 'reset', rootName };
}

/**
 * Should the recorded in-flight dispatch be considered landed?
 *
 * It has landed once navigation reports the tab focused AND sitting at exactly
 * its root — the state the dispatch was asking for. Clearing on the observed
 * state rather than on a timer is what keeps the guard tied to reality.
 */
export function inFlightSettled(
  inFlight: InFlight | null,
  observed: { tabName: string; stack: TabStackState | undefined; isFocused: boolean },
  now: number,
): boolean {
  if (!inFlight) return true;
  if (now - inFlight.at >= IN_FLIGHT_TIMEOUT_MS) return true;
  return (
    observed.tabName === inFlight.tabName &&
    observed.isFocused &&
    isExactlyAtRoot(observed.stack, inFlight.rootName)
  );
}

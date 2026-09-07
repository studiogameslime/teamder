// Rapid tab tapping must not produce overlapping stack replacements (P0-3).
//
// The production symptom was an Android IllegalStateException — "The specified
// child already has a parent" — thrown by the native view manager when a second
// nested-stack replacement landed while the first was still transitioning,
// followed by a ReactHost teardown and a white screen until force-quit.
//
// These tests drive the decision function with the state navigation actually
// reports, including the crucial detail that made the old "already at root"
// check useless: after a tap, navigation state does NOT update before the next
// tap arrives.

import {
  planTabPress,
  inFlightSettled,
  isExactlyAtRoot,
  IN_FLIGHT_TIMEOUT_MS,
  type InFlight,
  type TabStackState,
} from '@/navigation/tabTransition';

const atRoot = (root: string): TabStackState => ({ index: 0, routes: [{ name: root }] });
const deep = (root: string): TabStackState => ({
  index: 1,
  routes: [{ name: root }, { name: 'MatchDetails' }],
});

const press = (over: Partial<Parameters<typeof planTabPress>[0]> = {}) =>
  planTabPress({
    tabName: 'GameTab',
    rootName: 'GamesList',
    stack: atRoot('GamesList'),
    isFocused: false,
    inFlight: null,
    now: 1_000,
    ...over,
  });

describe('isExactlyAtRoot', () => {
  it('is true only for a stack of exactly [root] at index 0', () => {
    expect(isExactlyAtRoot(atRoot('GamesList'), 'GamesList')).toBe(true);
    expect(isExactlyAtRoot(deep('GamesList'), 'GamesList')).toBe(false);
  });

  it('is false for a length-1 stack whose sole route is NOT the root', () => {
    // The persisted-bad-state case: a deep link left [Friends] as the whole
    // ProfileTab stack. Length 1, but still needs the reset to self-heal.
    expect(isExactlyAtRoot({ index: 0, routes: [{ name: 'Friends' }] }, 'Profile')).toBe(false);
  });

  it('is false for an unloaded / empty stack', () => {
    expect(isExactlyAtRoot(undefined, 'GamesList')).toBe(false);
    expect(isExactlyAtRoot({ routes: [] }, 'GamesList')).toBe(false);
  });
});

describe('a single, ordinary press', () => {
  it('drilled into the stack → replace it with the root', () => {
    expect(press({ stack: deep('GamesList'), isFocused: true }))
      .toEqual({ action: 'reset', rootName: 'GamesList' });
  });

  it('switching to a tab already at its root → JUST move focus', () => {
    // The heart of the fix: no nested-state payload, so no native re-parenting.
    expect(press({ isFocused: false })).toEqual({ action: 'jump' });
  });

  it('already focused and already at root → nothing at all', () => {
    expect(press({ isFocused: true }))
      .toEqual({ action: 'none', reason: 'already-at-root' });
  });

  it('a corrupted single-route stack is still reset, so it self-heals', () => {
    expect(
      press({
        tabName: 'ProfileTab',
        rootName: 'Profile',
        stack: { index: 0, routes: [{ name: 'Friends' }] },
        isFocused: true,
      }),
    ).toEqual({ action: 'reset', rootName: 'Profile' });
  });
});

describe('the crash: taps arriving faster than navigation state updates', () => {
  const flight = (over: Partial<InFlight> = {}): InFlight => ({
    tabName: 'GameTab',
    rootName: 'GamesList',
    at: 1_000,
    ...over,
  });

  it('a second tap on the SAME tab mid-transition is dropped', () => {
    // Note the stale state: the first dispatch has not landed, so `stack` still
    // shows the OLD deep stack. The old code re-read exactly this and issued a
    // second replacement — the overlap that threw.
    expect(
      press({ stack: deep('GamesList'), isFocused: false, inFlight: flight(), now: 1_020 }),
    ).toEqual({ action: 'none', reason: 'duplicate-in-flight' });
  });

  it('ten taps in 200ms yield exactly ONE stack replacement', () => {
    let inflight: InFlight | null = null;
    let resets = 0;
    let jumps = 0;
    for (let i = 0; i < 10; i++) {
      const now = 1_000 + i * 20;
      const plan = planTabPress({
        tabName: 'GameTab',
        rootName: 'GamesList',
        // State never catches up during the burst — the realistic case.
        stack: deep('GamesList'),
        isFocused: false,
        inFlight: inflight,
        now,
      });
      if (plan.action === 'reset') { resets++; inflight = { tabName: 'GameTab', rootName: 'GamesList', at: now }; }
      if (plan.action === 'jump') { jumps++; inflight = { tabName: 'GameTab', rootName: 'GamesList', at: now }; }
    }
    expect(resets).toBe(1);
    expect(jumps).toBe(0);
  });

  it('alternating taps across DIFFERENT tabs are never delayed', () => {
    // Deduping must be by identity, not by time — a real intent to go somewhere
    // else has to be honoured immediately, or the tab bar feels broken.
    const tabs = [
      ['GameTab', 'GamesList'],
      ['CommunitiesTab', 'CommunitiesFeed'],
      ['ChatTab', 'ChatsList'],
      ['ProfileTab', 'Profile'],
    ] as const;
    let inflight: InFlight | null = null;
    let acted = 0;
    for (let i = 0; i < 8; i++) {
      const [tabName, rootName] = tabs[i % tabs.length];
      const now = 1_000 + i * 15;
      const plan = planTabPress({
        tabName, rootName, stack: deep(rootName), isFocused: false, inFlight: inflight, now,
      });
      expect(plan.action).toBe('reset');
      acted++;
      inflight = { tabName, rootName, at: now };
    }
    expect(acted).toBe(8);
  });

  it('the guard expires, so a dispatch that never lands cannot wedge the tab bar', () => {
    const stale = flight({ at: 1_000 });
    expect(
      press({ stack: deep('GamesList'), inFlight: stale, now: 1_000 + IN_FLIGHT_TIMEOUT_MS }),
    ).toEqual({ action: 'reset', rootName: 'GamesList' });
  });
});

describe('the in-flight record is retired against observed state, not a timer', () => {
  const f: InFlight = { tabName: 'GameTab', rootName: 'GamesList', at: 1_000 };

  it('settles once navigation reports the tab focused at exactly its root', () => {
    expect(
      inFlightSettled(f, { tabName: 'GameTab', stack: atRoot('GamesList'), isFocused: true }, 1_100),
    ).toBe(true);
  });

  it('does NOT settle while the old deep stack is still reported', () => {
    expect(
      inFlightSettled(f, { tabName: 'GameTab', stack: deep('GamesList'), isFocused: true }, 1_100),
    ).toBe(false);
  });

  it('does NOT settle while a different tab is focused', () => {
    expect(
      inFlightSettled(f, { tabName: 'ChatTab', stack: atRoot('ChatsList'), isFocused: true }, 1_100),
    ).toBe(false);
  });

  it('settles regardless once the failsafe window elapses', () => {
    expect(
      inFlightSettled(f, { tabName: 'ChatTab', stack: undefined, isFocused: true },
        1_000 + IN_FLIGHT_TIMEOUT_MS),
    ).toBe(true);
  });

  it('nothing in flight is trivially settled', () => {
    expect(inFlightSettled(null, { tabName: 'x', stack: undefined, isFocused: false }, 0)).toBe(true);
  });
});

describe('normal navigation is not regressed', () => {
  it('the full press → settle → press cycle still resets the second time', () => {
    let inflight: InFlight | null = null;
    // 1. Deep in GameTab, tap GameTab → reset.
    let plan = planTabPress({
      tabName: 'GameTab', rootName: 'GamesList', stack: deep('GamesList'),
      isFocused: true, inFlight: inflight, now: 1_000,
    });
    expect(plan.action).toBe('reset');
    inflight = { tabName: 'GameTab', rootName: 'GamesList', at: 1_000 };

    // 2. It lands.
    expect(inFlightSettled(inflight,
      { tabName: 'GameTab', stack: atRoot('GamesList'), isFocused: true }, 1_300)).toBe(true);
    inflight = null;

    // 3. Drill in again, tap again → reset again. No sticky guard.
    plan = planTabPress({
      tabName: 'GameTab', rootName: 'GamesList', stack: deep('GamesList'),
      isFocused: true, inFlight: inflight, now: 5_000,
    });
    expect(plan.action).toBe('reset');
  });
});

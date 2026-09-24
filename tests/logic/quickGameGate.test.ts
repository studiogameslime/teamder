/**
 * The gate that stranded every guest who tapped "מחזור מהיר".
 *
 * Visual QA found the screen sitting on "מכינים מחזור מהיר…" with no way off
 * it but the back button — the whole guest create-game flow, which is what the
 * previous round was for, dead in production. The cause was a duplicated
 * guard: two `if`s testing the same idea, and the one that ran last tested it
 * without the guest exemption the other had been given.
 *
 * So the predicate is one function now, and this is its truth table. The
 * property to hold on to: waiting is only correct while a group is ACTUALLY
 * being provisioned. Every other reason `hasPersonalGroup` is false is a
 * reason it will stay false.
 */

import {
  shouldWaitForPersonalGroup,
  type QuickGameGateState,
} from '@/utils/quickGameGate';

/** A full account that has just tapped quick-create: the only waiting case. */
const PROVISIONING: QuickGameGateState = {
  isGuest: false,
  quick: true,
  hasPersonalGroup: false,
  provisioningFailed: false,
};

const gate = (over: Partial<QuickGameGateState> = {}) =>
  shouldWaitForPersonalGroup({ ...PROVISIONING, ...over });

// ─── the guest ────────────────────────────────────────────────────────────

describe('a guest', () => {
  // The regression. `false` here is the infinite spinner.
  it('never waits — no group is being provisioned for them', () => {
    expect(gate({ isGuest: true })).toBe(false);
  });

  it('still does not wait once they somehow have a group', () => {
    expect(gate({ isGuest: true, hasPersonalGroup: true })).toBe(false);
  });

  it('does not wait outside quick mode either', () => {
    expect(gate({ isGuest: true, quick: false })).toBe(false);
  });
});

// ─── the full account, unchanged ──────────────────────────────────────────

describe('a full account', () => {
  it('waits while the personal group is on its way', () => {
    expect(gate()).toBe(true);
  });

  it('stops waiting the moment it lands', () => {
    expect(gate({ hasPersonalGroup: true })).toBe(false);
  });

  // `orphanFailed` exists so a thrown provisioning falls through to the retry
  // CTA. The duplicate gate undid that for anyone who administers a club —
  // they got the spinner forever instead of the button.
  it('stops waiting when provisioning failed, so the retry CTA can show', () => {
    expect(gate({ provisioningFailed: true })).toBe(false);
  });

  it('does not wait when the wizard was not opened in quick mode', () => {
    expect(gate({ quick: false })).toBe(false);
  });
});

// ─── the whole table ──────────────────────────────────────────────────────

describe('exhaustively', () => {
  // Waiting is a narrow claim: exactly one of the sixteen states justifies it.
  // Stating it this way means a future fifth condition cannot quietly widen it.
  it('waits in exactly one of the sixteen states', () => {
    const waiting: QuickGameGateState[] = [];
    for (const isGuest of [false, true]) {
      for (const quick of [false, true]) {
        for (const hasPersonalGroup of [false, true]) {
          for (const provisioningFailed of [false, true]) {
            const s = { isGuest, quick, hasPersonalGroup, provisioningFailed };
            if (shouldWaitForPersonalGroup(s)) waiting.push(s);
          }
        }
      }
    }
    expect(waiting).toEqual([PROVISIONING]);
  });
});

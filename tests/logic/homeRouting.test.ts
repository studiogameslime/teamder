/**
 * Where each viewer's Home is, and the two files that have to agree about it.
 *
 * The failure this exists for is quiet: a guest starts on the Option A Home
 * (the stack's `initialRouteName`), taps the Home tab they are already on, and
 * the tab-press handler resets the stack to ITS idea of the root — which, in
 * the flat map this replaced, was always `Profile`. One tap and they are on
 * the guest wall, which is the screen the previous round took off the entry
 * path. Nothing errors; they are just somewhere else.
 */

import { homeRouteFor, tabRootFor } from '@/navigation/homeRouting';

// ─── who lands where ──────────────────────────────────────────────────────

describe('the Home a viewer lands on', () => {
  it('sends a guest to the Option A Home', () => {
    expect(homeRouteFor(true)).toBe('GuestHome');
  });

  // Established AND brand-new. ProfileScreen already carries the activation
  // checklist that is the new-account experience; Option A would replace a
  // working one rather than add anything.
  it('leaves every full account on the dashboard', () => {
    expect(homeRouteFor(false)).toBe('Profile');
  });
});

// ─── the two answers agree ────────────────────────────────────────────────

describe('tapping the Home tab', () => {
  it.each([true, false])(
    'resets to the same screen the stack starts on (isGuest=%s)',
    (isGuest) => {
      expect(tabRootFor('ProfileTab', isGuest)).toBe(homeRouteFor(isGuest));
    },
  );

  // The regression, stated directly.
  it('never walks a guest onto the profile wall', () => {
    expect(tabRootFor('ProfileTab', true)).not.toBe('Profile');
  });
});

// ─── the other tabs are untouched ─────────────────────────────────────────

describe('the other tabs', () => {
  it.each([
    ['GameTab', 'GamesList'],
    ['CommunitiesTab', 'CommunitiesFeed'],
    ['ChatTab', 'ChatsList'],
  ])('%s still resets to %s, for guest and member alike', (tab, root) => {
    expect(tabRootFor(tab, true)).toBe(root);
    expect(tabRootFor(tab, false)).toBe(root);
  });

  // Unknown tab → undefined, so the caller falls back to the live first route
  // rather than dispatching a reset to a screen that does not exist.
  it('says nothing about a tab it does not know', () => {
    expect(tabRootFor('SomeFutureTab', true)).toBeUndefined();
  });
});

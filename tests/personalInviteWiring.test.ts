// Guard: the invitation survives the landing.
//
// The bug this round fixed is the kind that leaves no trace. A personal link
// stashes `{invitedBy}` under `footy.invite.pending`; the consumer in
// RootNavigator used to CLEAR that stash the moment it recognised the link;
// and `applyInviteAttributionIfFresh` / `applyAcquisitionIfFresh` read the
// same key at SIGNUP — which, for a guest, happens long afterwards.
//
// So every personal invite opened by somebody without an account was credited
// to nobody. No error, no log, just a referral counter that never moved. The
// audience for a personal invite is precisely people without an account.
//
// There is no renderer here and no AsyncStorage worth faking across four
// modules, so the invariants are read from the sources — the same approach as
// hooksAfterEarlyReturn and guestAuthEntryPoints, and for the same reason.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Code only — these files explain their traps at length, and a guard that
 *  cannot tell prose from a statement fails on the comment documenting the fix. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const NAV = path.join('src', 'navigation', 'RootNavigator.tsx');
const SCREEN = path.join('src', 'screens', 'invite', 'PersonalInviteScreen.tsx');
const STACK = path.join('src', 'navigation', 'ProfileStack.tsx');

// ─── attribution continuity ───────────────────────────────────────────────

describe('a personal invite', () => {
  const navCode = code(NAV);
  /** The `open_invite` branch, from its discriminant to the next `if`. */
  const branch = (() => {
    const start = navCode.indexOf("action.kind === 'open_invite'");
    expect(start).toBeGreaterThan(-1);
    const after = navCode.indexOf("action.kind !== 'open_game'", start);
    return navCode.slice(start, after > -1 ? after : start + 1200);
  })();

  // The regression, stated directly.
  it('is not cleared when its landing opens', () => {
    expect(branch).not.toMatch(/clearPendingAction\s*\(/);
    expect(branch).not.toMatch(/consumePendingAction\s*\(/);
  });

  it('opens the landing instead', () => {
    expect(branch).toContain('navigatePersonalInvite');
  });

  // Navigation and attribution now have separate lifetimes; the latch is what
  // stops the landing reappearing on every launch without touching the stash.
  it('remembers it was shown with its own latch', () => {
    expect(branch).toContain('wasLandingShown');
    expect(branch).toContain('markLandingShown');
  });

  // A navigator that was not ready is a race to retry, not an invitation this
  // device has already seen.
  it('only latches after a navigation that actually happened', () => {
    expect(branch).toMatch(/if\s*\(\s*ok\s*\)\s*await\s+markLandingShown/);
  });

  // `open_invite` covers more than a friend's link: the Play Install Referrer
  // resolves to `{type:'app', source:'google-play'}` on an ORDINARY store
  // install — an acquisition tag with nobody attached. The emulator run showed
  // that opening "הזמינו אותך ל-Teamder" for somebody who had just downloaded
  // the app, which is the product inventing a friend.
  it('needs an actual inviter before it shows anybody a landing', () => {
    expect(branch).toMatch(/if\s*\(\s*!invitedBy\s*\)\s*return/);
  });

  // And that early return must not clear either — the same stash carries the
  // acquisition `source` that `applyAcquisitionIfFresh` reads at signup.
  it('still leaves the acquisition tag alone when it declines to show one', () => {
    const upTo = branch.slice(0, branch.indexOf('wasLandingShown'));
    expect(upTo).not.toMatch(/clearPendingAction|markLandingShown/);
  });

  // The other side of the contract: the signup readers still read the key the
  // consumer no longer clears. If either of these moves, the pair has to be
  // looked at together.
  it('is still what signup reads for attribution', () => {
    const svc = code(path.join('src', 'services', 'userService.ts'));
    expect(svc).toContain('applyInviteAttributionIfFresh');
    expect(svc).toMatch(/storage\.getPendingInvite\(\)/);
  });
});

// ─── the landing's own wiring ─────────────────────────────────────────────

describe('PersonalInviteScreen', () => {
  const src = read(SCREEN);
  const c = code(SCREEN);

  const targets = Array.from(
    new Set([...c.matchAll(/nav\.navigate\(\s*'([A-Za-z]+)'/g)].map((m) => m[1])),
  ).sort();

  it('navigates only where this round wired it', () => {
    expect(targets).toEqual(['CommunityDetailsPublic', 'GuestHome', 'MatchDetails']);
  });

  // `navigate()` on a route the hosting stack does not register is a SILENT
  // no-op, and the `nav as {navigate}` cast hides it from tsc.
  it.each(['CommunityDetailsPublic', 'GuestHome', 'MatchDetails', 'PersonalInvite'])(
    '%s is registered in ProfileStack',
    (route) => {
      expect(read(STACK)).toContain(`name="${route}"`);
    },
  );

  // A non-member sent to the MEMBERS' club screen is a rules denial dressed up
  // as a broken page. The public screen is the one with the join path.
  it('opens clubs through the public screen', () => {
    expect(c).not.toMatch(/navigate\('CommunityDetails'/);
  });
});

// ─── privacy ──────────────────────────────────────────────────────────────

describe('what the landing can read', () => {
  const svc = code(path.join('src', 'services', 'personalInvite.ts'));
  const screen = code(SCREEN);

  // `/users` is gated on isFullAccount(). A guest cannot read it, and trying
  // is a permission error for every invited person on earth.
  it('never reaches for the private user document', () => {
    for (const s of [svc, screen]) {
      expect(s).not.toMatch(/getUserById|docs\.user\(|col\.users\(/);
    }
  });

  it('takes identity from the public mirror', () => {
    expect(svc).toContain('hydratePublicUsers');
  });

  // Everything the screen shows has to come through the one file that argues
  // the boundary, so a future caller cannot quietly widen it from the UI.
  it('reads nothing on its own', () => {
    expect(screen).not.toMatch(/gameService\.|groupService\./);
  });

  it('loads no stats and no availability', () => {
    for (const s of [svc, screen]) {
      expect(s).not.toMatch(/playerStats|availability|listFriends/i);
    }
  });
});

// ─── the auth surface, finally whole ──────────────────────────────────────

describe('EmailAuth from the contextual sheet', () => {
  // It lives in AuthStack, which mounts only when there is NO user — and the
  // sheet is only ever shown to a guest, who has one. Every stack that can
  // raise the sheet has to host the screen, or half the sign-in options are
  // dead in that stack.
  it.each([
    'src/navigation/ProfileStack.tsx',
    'src/navigation/GameStack.tsx',
    'src/navigation/CommunitiesStack.tsx',
  ])('is registered in %s', (stack) => {
    expect(read(stack)).toContain('name="EmailAuth"');
  });

  it('is the same component everywhere, not a copy', () => {
    for (const stack of [
      'src/navigation/ProfileStack.tsx',
      'src/navigation/GameStack.tsx',
      'src/navigation/CommunitiesStack.tsx',
    ]) {
      expect(read(stack)).toContain("from '@/screens/auth/EmailAuthScreen'");
    }
  });
});

// ─── what a guest is not shown ────────────────────────────────────────────

describe('"מה חדש" and a fresh guest', () => {
  const app = code('App.tsx');

  // `buildGuestUser` stamps `onboardingCompleted: true` so an anonymous
  // session skips the post-sign-in profile screen — which had the side effect
  // of opening this gate for guests too, and the sheet landed on top of the
  // Home the first time anybody ever saw it.
  it('does not open for a guest', () => {
    const start = app.indexOf('<WhatsNewGate');
    expect(start).toBeGreaterThan(-1);
    const gate = app.slice(start, app.indexOf('/>', start));
    expect(gate).toContain('!viewerIsGuest');
  });

  // The mechanism, the copy and the one-time latch are untouched; only who it
  // opens for changed.
  it('is otherwise left alone', () => {
    expect(app).toContain('WhatsNewGate');
    expect(read('src/services/whatsNewService.ts')).toContain('markWhatsNewSeen');
  });
});

// Guard: the Home's buttons go somewhere.
//
// `navigate()` on a route the hosting stack does not register is a SILENT
// no-op — no error, no warning, and the `nav as { navigate }` cast every
// screen here uses hides it from the typechecker. This project has been bitten
// by it before ("רשימת השחקנים does nothing" when the club was opened from the
// Profile tab), and GuestHomeScreen is four buttons whose entire job is to
// navigate, sitting in the stack with the longest registration list.
//
// So: every route name this screen navigates to must be registered in
// ProfileStack. Read from the sources, in the spirit of
// hooksAfterEarlyReturn.test.ts — there is no ESLint here, and no renderer in
// this harness to press the buttons with.
//
// The rest of this file pins the structural promises the round was defined by
// and a screenshot cannot prove: that Home introduces no second copy of a form
// it should be reusing, that it adds exactly one server read, and that the
// hero does not wait for that read.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SCREEN = path.join('src', 'screens', 'home', 'GuestHomeScreen.tsx');
const STACK = path.join('src', 'navigation', 'ProfileStack.tsx');

const screenSrc = read(SCREEN);
const stackSrc = read(STACK);

/** Code only — these files explain their traps in prose, and a guard that
 *  cannot tell an explanation from a declaration fails on the comment that
 *  documents the fix. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const screenCode = code(screenSrc);

// ─── every destination exists ─────────────────────────────────────────────

describe('the routes Home navigates to', () => {
  /** `nav.navigate('X', …)` → X. */
  const targets = Array.from(
    new Set(
      [...screenCode.matchAll(/nav\.navigate\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]),
    ),
  ).sort();

  it('is the set this round wired, and nothing snuck in', () => {
    expect(targets).toEqual([
      'AvailabilityEdit',
      'CommunitiesCreate',
      'GameCreate',
      'GameTab',
      'MatchDetails',
      'Profile',
    ]);
  });

  // `GameTab` is the one that leaves this stack on purpose — "all matches" is
  // that tab's whole job — so it is checked against the tab navigator instead.
  const inStack = targets.filter((t) => t !== 'GameTab');

  it.each(inStack)('%s is registered in ProfileStack', (route) => {
    expect(stackSrc).toContain(`name="${route}"`);
  });

  it('GameTab is a real tab', () => {
    expect(read(path.join('src', 'navigation', 'MainTabs.tsx'))).toContain(
      'name="GameTab"',
    );
  });
});

// ─── it reuses the flows, it does not restate them ────────────────────────

describe('Home reuses what already exists', () => {
  // The brief: "לא ליצור form חדש". A form here would be a second place for
  // the create rules to live, and the contextual-auth boundary at Save —
  // rounds 5 to 7 — is wired into the wizards, not into this screen.
  it('defines no form of its own', () => {
    expect(screenCode).not.toMatch(/TextInput/);
    expect(screenCode).not.toMatch(/useAuthenticatedAction/);
  });

  it('shows matches with the feed\'s own card', () => {
    expect(screenSrc).toContain("from '@/components/match/MatchListCard'");
  });

  // Quick mode skips the chooser: Home has already asked the question the
  // chooser asks, and a guest administers no club so the other branch is
  // locked anyway.
  it('opens the game wizard in quick mode', () => {
    expect(screenCode).toMatch(/navigate\('GameCreate',\s*\{\s*quick:\s*true\s*\}\)/);
  });

  // Not a new palette, not a new scale. The round changed hierarchy and
  // composition; every value below comes from the tokens the app ships.
  it('styles from the theme tokens', () => {
    expect(screenSrc).toContain("from '@/theme'");
    expect(screenCode).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

// ─── one read, and the hero does not wait for it ──────────────────────────

describe('what Home costs', () => {
  // The screen a guest used to land on ran four game queries; three of them
  // have no answer for somebody in no club. This runs one.
  it('makes exactly one game-service call', () => {
    const calls = [...screenCode.matchAll(/gameService\.\w+\(/g)].map((m) => m[0]);
    expect(calls).toEqual(['gameService.getOpenGames(']);
  });

  // Discovery is the only thing behind a loading state. If the hero or the
  // two creates were inside it, a slow Firestore would leave a new person
  // looking at a spinner instead of at the reason they opened the app.
  it('renders the hero and the actions outside the discovery branch', () => {
    // Measured inside the JSX, not the whole file — `discovery.status` is also
    // read by the analytics effect above the return, which is not a render
    // branch and would make this pass for the wrong reason.
    const jsx = screenCode.slice(screenCode.indexOf('<ScrollView'));
    const branch = jsx.indexOf("discovery.status === 'loading'");
    expect(branch).toBeGreaterThan(-1);
    const before = jsx.slice(0, branch);
    expect(before).toContain('he.guestHomeTitle');
    expect(before).toContain('he.guestHomeCreateClubCta');
    expect(before).toContain('he.guestHomeCreateGameCta');
  });

  // A failed query is a failed SECTION. Turning the whole screen into an error
  // state would take the create buttons away over a list nobody asked for.
  it('keeps a discovery failure local', () => {
    expect(screenCode).toContain("status: 'error'");
    expect(screenCode).toContain('he.guestHomeDiscoveryRetry');
  });
});

// ─── the things this screen must not do ───────────────────────────────────

describe('what Home does not do', () => {
  // The carousel and the startup wall are both gone; nothing here may bring
  // either back by another name.
  it('does not route to onboarding or sign-in', () => {
    expect(screenCode).not.toMatch(/'Onboarding'|'SignIn'|'EmailAuth'/);
  });

  it('does not sign anybody out', () => {
    expect(screenCode).not.toMatch(/signOut\s*\(/);
  });

  // The brief, twice: not here.
  it('does not ask for push permission', () => {
    expect(screenCode).not.toMatch(/requestPermission|registerPushToken/i);
  });

  // Under forceRTL, `textAlign:'right'` resolves to the visual LEFT — the bug
  // the auth sheet shipped with. Every Hebrew line on this screen goes through
  // the helper instead.
  it('aligns Hebrew with the RTL helper', () => {
    expect(screenSrc).toContain('RTL_LABEL_ALIGN');
    expect(screenCode).not.toMatch(/textAlign:\s*'right'/);
    expect(screenCode).not.toContain('writingDirection');
  });
});

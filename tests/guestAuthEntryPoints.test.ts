// Guard: sign-out is not a way to sign in.
//
// Two guest-facing "register" buttons — the profile card and the player card —
// called `signOut()`, on the theory that ending the anonymous session would
// reveal the auth stack. Before the silent guest existed that was roughly
// true. It is not true now: `signOut` leaves `currentUser` null with
// `guestInitFailed` false, `hydrate` does not run again in the same process,
// and RootNavigator has no branch for that pair — so the app sat on the splash
// until it was force-closed. Visual QA found it by tapping the only control on
// the guest's own tab.
//
// The bug is a CLASS, not two sites: any future guest CTA written the old way
// freezes the app the same way. There is no ESLint here (see
// hooksAfterEarlyReturn.test.ts for the same reasoning), so this reads the
// sources — shallow, but it is the check that would have caught it.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

/** Every screen and component, discovered rather than hand-listed — a list
 *  somebody has to remember to extend protects only the file that already
 *  broke. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

const FILES = [...sourceFiles('src/screens'), ...sourceFiles('src/components')];

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Code only. These files explain the traps they avoid in prose, and a guard
 *  that cannot tell an explanation from a declaration fails on the comment
 *  that documents the fix. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ─── no guest register CTA may sign out ───────────────────────────────────

describe('a guest "register" control', () => {
  /**
   * The marker for a guest-facing register CTA is the analytics event every
   * one of them fires. That is deliberate: it is the thing a new CTA is most
   * likely to copy, so the guard travels with the pattern rather than with a
   * file path.
   */
  const CTA_MARKER = 'GuestRegisterCtaTapped';

  const ctaFiles = FILES.filter((f) => read(f).includes(CTA_MARKER));

  it('exists in the two places visual QA found it', () => {
    // Not a hand-kept list — a canary. If this changes, the sites below were
    // added or moved and the invariant needs looking at with human eyes.
    expect(ctaFiles.sort()).toEqual([
      path.join('src', 'screens', 'players', 'PlayerCardScreen.tsx'),
      path.join('src', 'screens', 'tabs', 'ProfileScreen.tsx'),
    ]);
  });

  it.each(ctaFiles)('does not reach for signOut — %s', (file) => {
    const src = read(file);
    // `deleteOwnAccount` and the settings row legitimately sign out; those
    // live on the FULL-account branch of the same file. So the check is
    // narrow: no signOut inside the block that renders for a guest.
    const guestBlock = src.slice(src.indexOf(CTA_MARKER));
    const nextFewLines = guestBlock.split('\n').slice(0, 12).join('\n');
    expect(nextFewLines).not.toMatch(/signOut\s*\(/);
  });

  it.each(ctaFiles)('opens the contextual auth sheet instead — %s', (file) => {
    const src = read(file);
    expect(src).toContain('useAuthenticatedAction');
    expect(src).toContain('requestAuth()');
    // The sheet has to be mounted on the branch that renders for a guest, or
    // the request opens nothing at all.
    expect(src).toContain('authAction.sheet');
  });
});

// ─── the sheet's own alignment ────────────────────────────────────────────

describe('ContextualAuthSheet', () => {
  const FILE = path.join('src', 'components', 'auth', 'ContextualAuthSheet.tsx');
  const src = code(FILE);

  // Under `I18nManager.forceRTL(true)` — App.tsx — `textAlign:'right'` means
  // "end of paragraph", and the end of an RTL paragraph is the visual LEFT.
  // The sheet was written with `'right'` and rendered every Hebrew line flush
  // left, on the one screen every new person meets. `src/theme/rtl.ts` has
  // said so since before this component existed.
  it('aligns Hebrew with the RTL helper, not a literal', () => {
    expect(src).toContain('RTL_LABEL_ALIGN');
    expect(src).not.toMatch(/textAlign:\s*'right'/);
  });

  it('does not set writingDirection, which double-applies the swap', () => {
    expect(src).not.toContain('writingDirection');
  });

  // SpringSheet's bottom panel is a box from 10% down, not a bottom-anchored
  // row, so a content-sized card lands at the TOP of it — which is where this
  // sheet was rendering, over the header, with the dim showing underneath.
  it('pins its card to the bottom of the panel', () => {
    expect(src).toMatch(/justifyContent:\s*'flex-end'/);
  });

  // Android is edge-to-edge, so a Modal draws under the navigation bar.
  it('pads for the bottom inset', () => {
    expect(src).toContain('useSafeAreaInsets');
    expect(src).toMatch(/insets\.bottom/);
  });
});

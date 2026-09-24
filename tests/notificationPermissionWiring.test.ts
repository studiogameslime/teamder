// Guard: nothing asks the OS for notifications on the way in.
//
// This is the invariant the whole round exists to hold, and it is one edited
// line away from being lost. The OS dialog used to appear on the first launch
// after signing in, before the person had seen a single match — and a dialog
// asked at the wrong moment is answered "no" once, on iOS permanently. There
// is no ESLint here (see hooksAfterEarlyReturn for the same reasoning), so the
// sources are read.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Code only — these files explain the traps they avoid at length. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

// ─── who may raise the OS dialog ──────────────────────────────────────────

describe('the OS permission dialog', () => {
  const ALL = [...sourceFiles('src'), 'App.tsx'];

  /** The one call that prompts. Everything else must use the register-only
   *  variant, which never shows a dialog. */
  const PROMPTING = 'requestAndRegisterPushToken';

  const callers = ALL.filter((f) => {
    const c = code(f);
    // A CALL, not a mention — `errorLog` keeps a Hebrew label keyed by this
    // name and is not a call site. The definition itself lives in the service.
    return (
      new RegExp(`\\.${PROMPTING}\\s*\\(`).test(c) &&
      !f.endsWith(path.join('services', 'notificationsService.ts'))
    );
  }).sort();

  // Not a hand-kept list — a canary. Both are places a person has explicitly
  // asked for notifications: the settings toggle, and the contextual sheet's
  // "אפשר התראות". A third entry means somebody added a prompt somewhere, and
  // that deserves human eyes.
  it('is raised from exactly two places, both user-initiated', () => {
    expect(callers).toEqual([
      path.join('src', 'components', 'notifications', 'NotificationOfferHost.tsx'),
      path.join('src', 'screens', 'profile', 'NotificationsSettingsScreen.tsx'),
    ]);
  });

  it('is never raised from a startup path', () => {
    for (const f of ['App.tsx', path.join('src', 'navigation', 'RootNavigator.tsx')]) {
      expect(code(f)).not.toContain(PROMPTING);
    }
  });

  // Boot still REGISTERS for somebody who granted months ago — FCM rotates
  // tokens, so skipping the refresh would quietly break their existing
  // notifications. Not asking is not the same as not registering.
  it('still refreshes the token of somebody who already granted', () => {
    expect(code(path.join('src', 'navigation', 'RootNavigator.tsx'))).toContain(
      'registerPushTokenIfPermitted',
    );
  });

  // A guest has no account to hang a token on, and an anonymous session must
  // not trigger the dialog (App Store 5.1.1).
  it('skips guests at boot', () => {
    const nav = code(path.join('src', 'navigation', 'RootNavigator.tsx'));
    const at = nav.indexOf('registerPushTokenIfPermitted');
    expect(nav.slice(Math.max(0, at - 700), at)).toMatch(/isGuest/);
  });
});

// ─── the profile confirmation stays two fields ────────────────────────────

describe('post-sign-in onboarding', () => {
  const screen = code(path.join('src', 'screens', 'onboarding', 'PostSignInOnboardingScreen.tsx'));

  it('has nothing to do with notifications', () => {
    expect(screen).not.toMatch(/requestAndRegisterPushToken|getPushPermission|notifOffer/);
  });
});

// ─── business first, question second ──────────────────────────────────────

describe('the announcement', () => {
  const coord = code(path.join('src', 'services', 'actionCoordinator.ts'));

  // Ordering is the correctness of this feature: the outcome is terminal, the
  // stash is cleared, and only THEN is anybody asked anything. A permission
  // sheet is never part of the transaction.
  it('comes after the stash is cleared, on both completion paths', () => {
    const hits = [...coord.matchAll(/announceOfferFor\(/g)].map((m) => m.index ?? -1);
    expect(hits).toHaveLength(2);
    for (const at of hits) {
      const before = coord.slice(Math.max(0, at - 400), at);
      expect(before).toMatch(/clearAll\(/);
    }
  });

  // Fire-and-forget by contract. An awaited announcement could make a join
  // that succeeded report failure.
  it('is never awaited', () => {
    expect(coord).not.toMatch(/await\s+announceOfferFor/);
  });
});

// ─── the sheet itself ─────────────────────────────────────────────────────

describe('the education sheet', () => {
  const sheet = read(
    path.join('src', 'components', 'notifications', 'NotificationEducationSheet.tsx'),
  );
  const c = code(path.join('src', 'components', 'notifications', 'NotificationEducationSheet.tsx'));

  // Both round-7 lessons, applied from the start rather than after QA.
  it('sits at the bottom and reads right-to-left', () => {
    expect(c).toMatch(/justifyContent:\s*'flex-end'/);
    expect(sheet).toContain('RTL_LABEL_ALIGN');
    expect(c).not.toMatch(/textAlign:\s*'right'/);
    expect(c).not.toContain('writingDirection');
  });

  it('pads for the bottom inset', () => {
    expect(c).toMatch(/insets\.bottom/);
  });

  // "לא עכשיו" closes and does nothing else — no dialog, no navigation.
  it('never prompts from the secondary action', () => {
    const host = code(
      path.join('src', 'components', 'notifications', 'NotificationOfferHost.tsx'),
    );
    const at = host.indexOf("action === 'not_now'");
    expect(at).toBeGreaterThan(-1);
    const branch = host.slice(at, at + 220);
    expect(branch).not.toMatch(/requestAndRegisterPushToken|navigate\(/);
  });

  // Settings only ever from an explicit tap.
  it('opens settings only on the settings action', () => {
    const host = code(
      path.join('src', 'components', 'notifications', 'NotificationOfferHost.tsx'),
    );
    const hits = [...host.matchAll(/openAppSettings\(\)/g)];
    expect(hits).toHaveLength(1);
    const at = hits[0].index ?? 0;
    expect(host.slice(Math.max(0, at - 260), at)).toMatch(/action === 'settings'/);
  });
});

// ─── one interruption at a time ───────────────────────────────────────────

describe('two one-time sheets', () => {
  // Caught on the emulator with both on screen at once. The offer stands down
  // while "מה חדש" owns the screen; because the announcement is QUEUED rather
  // than dropped, it still arrives the moment the host registers again.
  it('do not stack', () => {
    const app = code('App.tsx');
    const at = app.indexOf('<NotificationOfferHost');
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, app.indexOf('/>', at))).toContain('!whatsNewOpen');
    expect(app).toContain('onVisibilityChange={setWhatsNewOpen}');
  });

  it('and the queue is what makes standing down safe', () => {
    const offer = code(path.join('src', 'services', 'notificationOffer.ts'));
    // `setOfferListener` delivers anything held when a host registers.
    const at = offer.indexOf('export function setOfferListener');
    expect(offer.slice(at, at + 400)).toMatch(/pending/);
  });
});

// ─── round 9 is untouched ─────────────────────────────────────────────────

describe('the personal-invite attribution', () => {
  // This round must not go near the invite stash, the landing latch, or
  // acquisition. Stated as a test because "I did not touch it" is not a thing
  // a future change inherits.
  const NEW_FILES = [
    path.join('src', 'services', 'notificationOffer.ts'),
    path.join('src', 'services', 'actionOfferBridge.ts'),
    path.join('src', 'services', 'pushPermission.ts'),
    path.join('src', 'components', 'notifications', 'NotificationOfferHost.tsx'),
    path.join('src', 'components', 'notifications', 'NotificationEducationSheet.tsx'),
  ];

  it.each(NEW_FILES)('%s does not touch invite state', (file) => {
    const c = code(file);
    expect(c).not.toMatch(/invitedBy|inviteLanding|PendingInvite|acquisition/i);
    expect(c).not.toMatch(/clearPendingAction|markLandingShown/);
  });
});

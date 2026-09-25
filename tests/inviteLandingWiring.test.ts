// Guard: the three things the invite landing got wrong, pinned so they stay
// fixed — and pinned in BOTH copies of the page, which is the other half of
// the problem.
//
// `public/invite.html` is served by Hosting for /session, /app and /go;
// `functions/templates/invite.html` is what `serveInviteCode` renders for a
// short /i/ code. They are the same page and they drift, so every assertion
// below runs against both.
//
//   1. A short code that resolved to NOTHING rendered as an ordinary Teamder
//      landing. The "this link is no longer available" line exists on the
//      page and was shown only when the URL SHAPE was /session or /team — a
//      dead /i/ code produced a clean 200 and told the person nothing.
//   2. The primary CTA branched iOS-or-else, so a Mac was sent to Google Play.
//   3. The public pages read the canonical /users document to get one display
//      name, on a page anybody can open.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAGES = [
  path.join('public', 'invite.html'),
  path.join('functions', 'templates', 'invite.html'),
];

// ─── 1. a dead invite says so ─────────────────────────────────────────────

describe('an invite code that resolves to nothing', () => {
  it.each(PAGES)('shows the unavailable note — %s', (page) => {
    const src = read(page);
    // the note element and its copy still exist
    expect(src).toContain('id="ctxNote"');
    expect(src).toContain('הקישור כבר לא זמין');
    // and a resolved-to-generic response now passes the code through, so the
    // note fires for /i/<dead> exactly as it does for a dead /session link
    expect(src).toMatch(/toGeneric\(wasGameLink\|\|wasCommLink\|\|!!code\)/);
  });

  it.each(PAGES)('still shows it for a dead /session or /team link — %s', (page) => {
    // The original two conditions must survive the new one.
    expect(read(page)).toMatch(/wasGameLink\|\|wasCommLink/);
  });
});

// ─── 2. the desktop is not sent to an Android store ───────────────────────

describe('the primary CTA', () => {
  it.each(PAGES)('knows Android from a desktop — %s', (page) => {
    const src = read(page);
    expect(src).toMatch(/var isAndroid=\/Android\/i\.test/);
    expect(src).toMatch(/var isIOS=\/iPhone\|iPad\|iPod\/i\.test/);
  });

  it.each(PAGES)('sends a desktop to neither store — %s', (page) => {
    const src = read(page);
    expect(src).toContain('if(!isAndroid&&!isIOS)');
    // it reveals the buttons that are already on the page instead
    expect(src).toContain('id="stores"');
    expect(src).toMatch(/getElementById\('stores'\)/);
  });

  // The guard is only useful if it runs BEFORE the Play Store redirect.
  it.each(PAGES)('guards before the Play fallback — %s', (page) => {
    const src = read(page);
    const at = src.indexOf('function primary()');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n', at + 2000) + 1);
    const guard = body.indexOf('!isAndroid&&!isIOS');
    const play = body.indexOf('var store=storeHref');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(play);
  });

  // Both stores stay offered on the page itself, for every visitor.
  it.each(PAGES)('keeps both store buttons — %s', (page) => {
    const src = read(page);
    expect(src).toContain('play.google.com/store/apps/details');
    expect(src).toContain('apps.apple.com/app/');
  });
});

// ─── 3. public pages read the public mirror ───────────────────────────────

describe('the server-rendered pages', () => {
  const fns = read(path.join('functions', 'src', 'index.ts'));

  /** One function's body, so a match cannot leak in from its neighbours. */
  const bodyOf = (name: string) => {
    const at = fns.indexOf(`export const ${name}`);
    expect(at).toBeGreaterThan(-1);
    const next = fns.indexOf('\nexport const ', at + 10);
    return fns.slice(at, next > -1 ? next : undefined);
  };

  it.each(['serveInviteCode', 'getInvitePreview'])(
    'resolves the inviter name from usersPublic — %s',
    (name) => {
      const body = bodyOf(name);
      expect(body).toContain("collection('usersPublic')");
    },
  );

  // These run as admin and bypass the rules, so the narrow collection has to
  // be chosen deliberately — there is nothing to stop the wide one.
  it.each(['serveInviteCode', 'getInvitePreview'])(
    'never reaches the canonical user document for it — %s',
    (name) => {
      const body = bodyOf(name);
      expect(body).not.toMatch(/collection\('users'\)\s*\n?\s*\.doc\(invit/);
      expect(body).not.toMatch(/collection\('users'\)\.doc\(inviter/);
    },
  );

  it('serveCommunityPage never reads user documents at all', () => {
    expect(bodyOf('serveCommunityPage')).not.toContain("collection('users')");
  });
});

// ─── 4. the link surface itself ───────────────────────────────────────────

describe('the declared link surface', () => {
  const aasa = JSON.parse(
    read(path.join('public', '.well-known', 'apple-app-site-association')),
  );
  const paths: string[] = aasa.applinks.details[0].paths;

  it('covers every https shape the app can actually route', () => {
    // parseInviteUrl handles exactly these four.
    expect(paths).toEqual(expect.arrayContaining(['/session/*', '/team/*', '/app', '/go']));
  });

  // The app has no branch for either, so claiming them would open the app on
  // a path it cannot route. Both are resolved server-side on purpose.
  it('leaves the server-resolved shapes out', () => {
    expect(paths).not.toContain('/i/*');
    expect(paths).not.toContain('/c/*');
  });

  it('agrees with the app id the project builds', () => {
    expect(aasa.applinks.details[0].appID).toContain('com.studiogameslime.soccerapp');
  });
});

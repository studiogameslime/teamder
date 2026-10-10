/**
 * Every URL shape Teamder has ever put in front of a person, and where it goes.
 *
 * Links live forever. A share sent months ago is still in somebody's WhatsApp,
 * and the only way to know a route still works is to assert it — the routing
 * table is spread across `parseInviteUrl` (invite shapes), `parseAppLink`
 * (campaign shapes) and firebase.json's rewrites, and no single file shows
 * what the set is.
 *
 * The three shapes that are NOT here are deliberate: `/i/*` and `/c/*` are
 * resolved on the SERVER — the app has no branch for either, and must not
 * pretend to — and `/open/*` exists only as a custom scheme.
 */

jest.mock('expo-linking', () => ({
  parse: (url: string) => {
    // Enough of expo-linking's shape for the cases below: scheme, hostname,
    // path and query. The real one is native; this is the pure part.
    const m = /^([a-z]+):\/\/(.*)$/i.exec(url);
    if (!m) return { scheme: null, hostname: null, path: null, queryParams: {} };
    const scheme = m[1].toLowerCase();
    let rest = m[2];
    const q = rest.indexOf('?');
    const query = q >= 0 ? rest.slice(q + 1) : '';
    if (q >= 0) rest = rest.slice(0, q);
    const segs = rest.split('/').filter(Boolean);
    const queryParams: Record<string, string> = {};
    for (const pair of query.split('&')) {
      if (!pair) continue;
      const [k, v = ''] = pair.split('=');
      queryParams[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    // http(s) puts the host in the authority; a custom scheme does too.
    const hostname = segs.length ? segs[0] : null;
    const path = segs.slice(1).join('/');
    return { scheme, hostname, path, queryParams };
  },
}));
jest.mock('@/services/storage', () => ({ storage: {} }));
jest.mock('@/services/errorLog', () => ({ logError: () => {} }));

import { parseInviteUrl } from '@/services/deepLinkService';
import { parseAppLink } from '@/utils/appLinks';

const HOST = 'https://teamderfc.web.app';

// ─── 1–4. game ────────────────────────────────────────────────────────────

describe('a game link', () => {
  it('resolves to that exact game', () => {
    expect(parseInviteUrl(`${HOST}/session/g123`)).toMatchObject({
      type: 'session',
      id: 'g123',
    });
  });

  it('works through the custom scheme too', () => {
    expect(parseInviteUrl('footy://session/g123')).toMatchObject({
      type: 'session',
      id: 'g123',
    });
    expect(parseInviteUrl('teamder://session/g123')).toMatchObject({
      type: 'session',
      id: 'g123',
    });
  });

  it('carries the inviter when the link has one', () => {
    expect(parseInviteUrl(`${HOST}/session/g123?invitedBy=u1`)).toMatchObject({
      type: 'session',
      id: 'g123',
      invitedBy: 'u1',
    });
  });

  // A game id that no longer exists is not this layer's problem: the parser
  // hands on an intent, and the screen reports what the server says. What it
  // must NOT do is invent a different destination.
  it('does not invent a destination when the id is missing', () => {
    expect(parseInviteUrl(`${HOST}/session`)).toBeNull();
    expect(parseInviteUrl(`${HOST}/session/`)).toBeNull();
  });
});

// ─── 5–8. club ────────────────────────────────────────────────────────────

describe('a club link', () => {
  it('resolves to that exact club', () => {
    expect(parseInviteUrl(`${HOST}/team/c9`)).toMatchObject({
      type: 'team',
      id: 'c9',
    });
  });

  it('works through the custom scheme', () => {
    expect(parseInviteUrl('footy://team/c9')).toMatchObject({ type: 'team', id: 'c9' });
  });

  it('does not invent a destination when the id is missing', () => {
    expect(parseInviteUrl(`${HOST}/team`)).toBeNull();
  });

  // /c/{id} is the SERVER-rendered showcase. The app has no branch for it and
  // must not grow one silently — if it ever should open in the app, that is a
  // deliberate change to both the parser and the AASA, not an accident.
  it('opens the community showcase alias in the app', () => {
    expect(parseInviteUrl(`${HOST}/c/c9`)).toEqual({type:'team',id:'c9'});
  });
});

// ─── 9–12. personal invite ────────────────────────────────────────────────

describe('a personal invite', () => {
  // Same reasoning as /c/*: a short code means nothing to the client until
  // `serveInviteCode` has resolved it, so the parser declining is correct.
  it('leaves the short code to the server', () => {
    expect(parseInviteUrl(`${HOST}/i/abc123`)).toBeNull();
  });

  // …but the generic app link it resolves TO must keep the inviter.
  it('keeps the inviter on the generic app link', () => {
    expect(parseInviteUrl(`${HOST}/app?invitedBy=u7`)).toMatchObject({
      type: 'app',
      invitedBy: 'u7',
    });
  });

  it('is still a valid link with no inviter at all', () => {
    const out = parseInviteUrl(`${HOST}/app`);
    expect(out).toMatchObject({ type: 'app' });
    expect(out?.invitedBy).toBeUndefined();
  });

  it('carries acquisition tags alongside the inviter', () => {
    expect(parseInviteUrl(`${HOST}/app?invitedBy=u7&s=ig&c=spring&l=L1`)).toMatchObject({
      type: 'app',
      invitedBy: 'u7',
      source: 'ig',
      campaign: 'spring',
      linkId: 'L1',
    });
  });
});

// ─── 13–15. generic + campaign ────────────────────────────────────────────

describe('the generic entry points', () => {
  it('/app opens the app with no target', () => {
    expect(parseInviteUrl(`${HOST}/app`)).toMatchObject({ type: 'app' });
  });

  it('/go is the acquisition twin of /app', () => {
    expect(parseInviteUrl(`${HOST}/go`)).toMatchObject({ type: 'app' });
    expect(parseInviteUrl('footy://go')).toMatchObject({ type: 'app' });
  });

  // `?g=` is how an acquisition link still lands on a specific match.
  it('/go targets a game when the link names one', () => {
    expect(parseInviteUrl(`${HOST}/go?g=g55`)).toMatchObject({
      type: 'session',
      id: 'g55',
    });
  });

  // /open/* is a CAMPAIGN shape and has only ever existed as a custom scheme.
  // Hosting returns 404 for the https form, and that is correct rather than a
  // gap: nothing has ever emitted one.
  it('/open/* is a campaign destination, not an invite', () => {
    expect(parseAppLink('footy://open/games')).toMatchObject({ dest: 'games' });
    expect(parseAppLink('footy://open/create-community?role=organiser')).toMatchObject({
      dest: 'create-community',
      role: 'organiser',
    });
    // and it is not an invite
    expect(parseInviteUrl('footy://open/games')).toBeNull();
  });

  it('refuses a destination it does not know', () => {
    expect(parseAppLink('footy://open/nonsense')).toBeNull();
  });

  it('refuses a host that is not ours', () => {
    expect(parseAppLink('https://evil.example/open/games')).toBeNull();
    expect(parseInviteUrl('https://evil.example/session/g1')).toBeNull();
  });
});

// ─── 16–20. intent, not action ────────────────────────────────────────────

describe('opening a link is navigation, never a write', () => {
  // The whole point of the split: a link says WHERE to go. Joining is a
  // separate decision the person makes after they have seen the place.
  it('produces a navigation intent and nothing resembling a join', () => {
    for (const url of [
      `${HOST}/session/g1`,
      `${HOST}/team/c1`,
      `${HOST}/app?invitedBy=u1`,
    ]) {
      const out = parseInviteUrl(url);
      expect(out).not.toBeNull();
      expect(Object.keys(out as object)).not.toContain('kind');
      expect(JSON.stringify(out)).not.toMatch(/join_|create_|apply_filler/);
    }
  });

  // An inviter is attribution. It has never been, and must never become, a
  // capability: nothing downstream may read it as permission.
  it('treats the inviter as attribution only', () => {
    const out = parseInviteUrl(`${HOST}/team/c1?invitedBy=u9`);
    expect(out).toMatchObject({ type: 'team', id: 'c1', invitedBy: 'u9' });
    // no membership, no role, no grant rides along
    expect(JSON.stringify(out)).not.toMatch(/member|admin|role|grant|token/i);
  });
});

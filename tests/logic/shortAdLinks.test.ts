import { createShortAdLink, buildShortAdLink } from '../../pulse/src/services/shortAdLinks';
import { shortCodeFromPath, readTrackedAdLink, renderTrackedAdLink } from '../../functions/src/shortAdLinkPage';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const template = fs.readFileSync(path.join(__dirname, '../../public/invite.html'), 'utf8');
function landing(source: string, search = '', campaign = '', gameId = '') {
  const context = { window: {} as any, URLSearchParams,
    location: { pathname: '/play/K7m4Q2a8', search },
    navigator: { userAgent: 'Android', sendBeacon: jest.fn() },
    localStorage: { setItem: jest.fn() },
    document: { getElementById: jest.fn(() => ({ href: '', addEventListener: jest.fn() })), querySelectorAll: jest.fn(() => []) },
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'), escape, decodeURIComponent, encodeURIComponent };
  vm.createContext(context);
  const html = renderTrackedAdLink(template, { source, campaign, gameId, shortCode: 'K7m4Q2a8' });
  const init = html.match(/<script>window.__INVITE__=([\s\S]*?);<\/script>/)![0].replace(/^<script>|<\/script>$/g, '');
  vm.runInContext(init, context);
  const start = html.indexOf('(function(){');
  const stop = html.indexOf('  var V=', start);
  vm.runInContext(html.slice(start, stop) + 'window.result={query:appQuery(),deep:deepLink(),clipboard:clipUrl(),store:storeHref};})();', context);
  return context;
}

describe('short campaign links', () => {
  it('retries a collision atomically, preserving the existing campaign', async () => {
    const writes: Array<{ path: string; fields: any }> = [];
    const writer = jest.fn(async (path: string, fields: any) => { writes.push({ path, fields }); return writes.length === 1 ? 'conflict' as const : 'created' as const; });
    let calls = 0;
    const result = await createShortAdLink({ name: 'מודעה', source: 'facebook' }, writer, () => ++calls <= 8 ? 0 : .5);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writes[0].path).not.toBe(writes[1].path);
    expect(result.url).toBe(buildShortAdLink(writes[1].fields.shortCode));
    expect(writes[1].fields.source).toBe('facebook');
  });
  it('never returns a shareable URL after a failed save', async () => {
    expect(await createShortAdLink({ name: '', source: 'instagram' }, async () => 'error')).toEqual({ ok: false, url: '' });
  });
  it('rejects an empty platform before writing', async () => {
    const writer = jest.fn();
    await expect(createShortAdLink({ name: '', source: ' ' }, writer)).rejects.toThrow();
    expect(writer).not.toHaveBeenCalled();
  });
  it('fails after five collisions instead of overwriting a link', async () => {
    const writer = jest.fn(async () => 'conflict' as const);
    await expect(createShortAdLink({ name: '', source: 'facebook' }, writer, () => 0)).rejects.toThrow();
    expect(writer).toHaveBeenCalledTimes(5);
  });
  it.each(['/play/../users', '/play/a/b', '/play/short', '/play/K7m4Q2a8/more', '/play/<script>'])('rejects an invalid path %s', (p) => expect(shortCodeFromPath(p)).toBeNull());
  it('rejects deleted, legacy and mismatched documents', () => {
    expect(readTrackedAdLink(undefined, 'K7m4Q2a8')).toBeNull();
    expect(readTrackedAdLink({ source: 'facebook' }, 'K7m4Q2a8')).toBeNull();
    expect(readTrackedAdLink({ shortCode: 'another', source: 'facebook' }, 'K7m4Q2a8')).toBeNull();
  });
  it.each(['facebook', 'instagram'])('keeps %s attribution through the page, installed app, Play install and iOS clipboard', (source) => {
    const ctx = landing(source, '?s=whatsapp&l=fake', 'קמפיין א', 'game-one');
    const result = ctx.window.result;
    const query = new URLSearchParams(result.query);
    expect(query.get('s')).toBe(source);
    expect(query.get('l')).toBe('K7m4Q2a8');
    expect(query.get('c')).toBe('קמפיין א');
    expect(query.get('g')).toBe('game-one');
    expect(result.deep).toBe('footy://go' + result.query);
    expect(result.clipboard).toBe('https://teamderfc.web.app/go' + result.query);
    const ref = new URLSearchParams(new URL(result.store).searchParams.get('referrer')!);
    expect(ref.get('utm_source')).toBe(source);
    expect(ref.get('l')).toBe('K7m4Q2a8');
    expect(ctx.navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });
  it('escapes script injection without changing the saved source', () => {
    const attack = '</script><script>alert(1)</script>';
    const ctx = landing(attack);
    expect(ctx.window.__INVITE__.source).toBe(attack);
    expect(new URLSearchParams(ctx.window.result.query).get('s')).toBe(attack);
  });
});

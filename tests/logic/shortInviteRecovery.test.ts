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

import { resolveInviteUrl } from '@/services/deepLinkService';
let originalFetch: typeof fetch;
beforeEach(()=>{ originalFetch=globalThis.fetch; });
afterEach(()=>{globalThis.fetch=originalFetch;jest.useRealTimers();});
test('short club URL recovers target, canonical inviter and tracking',async()=>{
 globalThis.fetch=jest.fn(async()=>({ok:true,text:async()=>'<script>window.__INVITE__={"type":"team","id":"club1","invitedBy":"sender"};</script>'})) as any;
 expect(await resolveInviteUrl('https://teamderfc.web.app/i/Ab123xy?s=whatsapp&l=campaign-link')).toEqual({type:'team',id:'club1',invitedBy:'sender',source:'whatsapp',linkId:'campaign-link'});
});
test('foreign URLs never cause a fetch',async()=>{
 globalThis.fetch=jest.fn() as any;
 expect(await resolveInviteUrl('https://evil.example/i/Ab123xy')).toBeNull();
 expect(globalThis.fetch).not.toHaveBeenCalled();
});
test.each(['<script>window.__INVITE__={"type":"team"};</script>','<script>window.__INVITE__={"type":"evil","id":"x"};</script>','<script>alert("wrong")</script>'])('unusable payload is ignored without evaluating scripts',async html=>{
 globalThis.fetch=jest.fn(async()=>({ok:true,text:async()=>html})) as any;
 expect(await resolveInviteUrl('https://teamderfc.web.app/i/Ab123xy')).toBeNull();
});
test('unresponsive short URL resolves within four seconds',async()=>{
 jest.useFakeTimers();globalThis.fetch=jest.fn(()=>new Promise(()=>{})) as any;
 const pending=resolveInviteUrl('https://teamderfc.web.app/i/Ab123xy');
 await jest.advanceTimersByTimeAsync(4000);
 expect(await pending).toBeNull();
 expect((globalThis.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
});

test.each(['/app?code=Ab123xy&g=wrong&invitedBy=forged&s=facebook','/go?code=Ab123xy&g=wrong&s=facebook','/i/Ab123xy?g=wrong&s=facebook'])('canonical personal invite overrides aliases without losing attribution: %s',async path=>{
 globalThis.fetch=jest.fn(async()=>({ok:true,text:async()=>JSON.stringify({type:'app',invitedBy:'sender'})})) as any;
 expect(await resolveInviteUrl('https://teamderfc.web.app'+path)).toEqual({type:'app',invitedBy:'sender',source:'facebook'});
});
test('encoded query aliases cannot overwrite canonical resolution',async()=>{
 globalThis.fetch=jest.fn(async()=>({ok:true,text:async()=>JSON.stringify({type:'app',invitedBy:'sender'})})) as any;
 expect(await resolveInviteUrl('https://teamderfc.web.app/i/Ab123xy?%67=wrong&%69nvitedBy=forged')).toEqual({type:'app',invitedBy:'sender'});
});

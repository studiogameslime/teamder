import { receivePendingInvite } from '@/services/pendingAction';
// Regression cases for delayed invitations, transient native failures and landing round trips.
import { useEntryStore } from '@/store/entryStore';
import { consumeInstallReferrerIfFresh } from '@/services/installReferrerService';
import { parseReferrerInvite } from '@/utils/referrerInvite';
import fs from 'fs';
import vm from 'vm';
import { geocodeCity } from '@/services/geocodeService';

let mockPending: any = null;
(globalThis as any).__DEV__ = false;
let mockConsumed = false;
let mockNative: (cb: any) => void;
const mockRead = jest.fn();
jest.mock('@/services/pendingAction', () => ({readPendingAction: async () => mockPending,receivePendingInvite:jest.fn(async()=>true)}));
jest.mock('@/services/incomingInvite',()=>({resolveIncomingInvite:jest.fn(async()=>null)}));
jest.mock('@/services/errorLog', () => ({logError: jest.fn()}));
jest.mock('@/services/analyticsService', () => ({AnalyticsEvent:{DeferredDeepLinkResolved:'resolved'},logEvent:jest.fn()}));
jest.mock('@/services/storage', () => ({storage:{
 getEntryOrganicCompleted:async()=>false,
 getPendingInvite:async()=>null,
 setPendingInvite:async()=>{},
 setPendingInviteIfAbsent:async()=>true,
 setEntryOrganicCompleted:async()=>{},
 getInstallReferrerConsumed:async()=>mockConsumed,
 setInstallReferrerConsumed:async()=>{mockConsumed=true;},
}}));
jest.mock('react-native', () => ({Platform:{OS:'android'}}));
jest.mock('react-native-play-install-referrer', () => ({PlayInstallReferrer:{getInstallReferrerInfo:(cb:any)=>{mockRead();mockNative(cb);}}}));

beforeEach(()=>{mockPending=null;mockConsumed=false;mockRead.mockClear();(receivePendingInvite as jest.Mock).mockClear();useEntryStore.setState({organicCompleted:null,invite:null});});


test('late referral refreshes entry without replacing a user choice', async()=>{
 await useEntryStore.getState().hydrate();
 await useEntryStore.getState().chooseIntent('find_game');
 mockPending={version:2,kind:'open_invite',invitedBy:'sender',origin:'deep_link',createdAt:Date.now()};
 await useEntryStore.getState().refreshInvite();
 expect(useEntryStore.getState().invite).toEqual({kind:'referral',invitedBy:'sender'});
 expect(useEntryStore.getState().suppressAutoConsume).toBe(true);
 expect(useEntryStore.getState().pendingIntent).toBe('find_game');
});
test('temporary native error remains retryable; successful empty read is consumed', async()=>{
 mockNative=cb=>cb(null,{code:'SERVICE_UNAVAILABLE'});
 await consumeInstallReferrerIfFresh();
 expect(mockConsumed).toBe(false);
 mockNative=cb=>cb({installReferrer:''},null);
 await consumeInstallReferrerIfFresh();
 expect(mockConsumed).toBe(true);expect(mockRead).toHaveBeenCalledTimes(2);
});
test('missing native callback times out and its late reply is ignored', async()=>{
 jest.useFakeTimers();
 let callback:any;
 mockNative=cb=>{callback=cb;};
 const pending=consumeInstallReferrerIfFresh();
 await Promise.resolve();await Promise.resolve();
 await jest.advanceTimersByTimeAsync(3000);await pending;
 callback({installReferrer:'invite_team_old'},null);
 expect(mockConsumed).toBe(false);
 jest.useRealTimers();
});
test.each(['/team/club-audit','/session/game-audit','/app'])('tracked landing preserves target and inviter: %s',pathname=>{
 const html=fs.readFileSync('public/invite.html','utf8');
 const start=html.indexOf('(function(){',html.indexOf('<script>'));
 const stop=html.indexOf('  var isIOS=',start);
 const context:any={location:{pathname,search:'?invitedBy=sender&s=whatsapp&c=summer&l=link-key'},window:{__INVITE__:{}},URLSearchParams,encodeURIComponent,decodeURIComponent,escape,atob,localStorage:{setItem(){}},navigator:{userAgent:'Android',sendBeacon(){}},document:{getElementById:()=>({addEventListener(){}})}};
 vm.runInNewContext(html.slice(start,stop)+'window.result=storeHref;})();',context);
 const r=new URL(context.window.result).searchParams.get('referrer')!;
 const invite=parseReferrerInvite(r);
 expect(invite).toMatchObject({type:pathname.split('/')[1],invitedBy:'sender',source:'whatsapp',campaign:'summer',linkId:'link-key'});
 if(pathname!='/app')expect(invite).toHaveProperty('id',pathname.split('/')[2]);
});
test('city lookup returns without blocking even when fetch ignores abort', async()=>{
 jest.useFakeTimers();const original=globalThis.fetch;
 (globalThis as any).fetch=jest.fn(()=>new Promise(()=>{}));
 try {
  const pending=geocodeCity('timeout-city');
  await jest.advanceTimersByTimeAsync(4000);
  expect(await pending).toBeNull();
  expect((globalThis.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
 } finally {globalThis.fetch=original;jest.useRealTimers();}
});

test('successful native personal referrer goes through the authoritative ingress before consumption',async()=>{
 mockNative=cb=>cb({installReferrer:'target_type=app&by=sender&utm_source=instagram&l=tracked'},null);
 await consumeInstallReferrerIfFresh();
 expect(receivePendingInvite).toHaveBeenCalledWith({type:'app',invitedBy:'sender',source:'instagram',linkId:'tracked'},'deferred_deep_link');
 expect(mockConsumed).toBe(true);
});

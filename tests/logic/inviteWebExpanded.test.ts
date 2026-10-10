/** Runs real landing scripts with controlled browser surfaces; no production network. */
import fs from 'fs';
import vm from 'vm';

const flush = async () => { for (let n=0;n<15;n++) await Promise.resolve(); };
type Options = { ua?:string; touch?:number; injected?:any; preview?:any; pending?:boolean; previewPending?:boolean; scrolled?:boolean; copy?:'success'|'fail'|'slow'; confirm?:boolean; canonical?:any };
function landing(path:string, options:Options={}, file='public/invite.html') {
 const nodes=new Map<string,any>(), writes:string[]=[], beacons:string[]=[], requests:string[]=[], disk=new Map<string,string>(), timers=new Map<number,Function>();
 let timerId=0, resolvePreview:Function=()=>{};
 const make=(id='')=>{
  const classes=new Set<string>(), events=new Map<string,Function[]>();
  const element:any={id,style:{},textContent:'',innerHTML:'',href:'',src:'',children:[],disabled:false,
   classList:{add:(...v:string[])=>v.forEach(x=>classes.add(x)),remove:(...v:string[])=>v.forEach(x=>classes.delete(x)),contains:(v:string)=>classes.has(v)},
   addEventListener:(name:string,fn:Function)=>events.set(name,[...(events.get(name)||[]),fn]),removeEventListener:()=>{},
   appendChild:(child:any)=>{element.children.push(child);if(child.id)nodes.set(child.id,child);},
   setAttribute:(name:string,value:string)=>{element[name]=value;},removeAttribute:(name:string)=>{delete element[name];},
   getBoundingClientRect:()=>({top:1000,bottom:700}),scrollIntoView:jest.fn(),offsetTop:100,
   click:async()=>{let prevented=false;const event={preventDefault:jest.fn(()=>{prevented=true;})};for(const fn of events.get('click')||[]) await fn(event);if(element.href&&!prevented)location.href=element.href;await flush();}};
  if(id)nodes.set(id,element); return element;
 };
 for(const id of ['ctaBtn','stickyBtn','hdrBtn','stores','storeAndroid','title','subtitle','badgeTxt','finalTitle','heroShot','ctxCard','ctxTitle','ctxTags','ctxNote','prob','railBall','download','sticky','ios','android'])make(id);
 const apple=make('apple'); apple.href='https://apps.apple.com/app/id6775178022';
 nodes.get('storeAndroid').href='https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp';
 const url=new URL(path,'https://teamderfc.web.app');let href=url.href;
 const location:any={pathname:url.pathname,search:url.search,hash:url.hash,replace:jest.fn((s:string)=>{href=new URL(s,url).href;})};
 Object.defineProperty(location,'href',{get:()=>href,set:(s:string)=>{href=s;}});
 const docEvents=new Map<string,Function>(), windowEvents=new Map<string,Function>();
 const document:any={body:{scrollHeight:3000},hidden:false,referrer:'',
  getElementById:(id:string)=>nodes.get(id)||null,createElement:()=>make(),
  addEventListener:(name:string,fn:Function)=>docEvents.set(name,fn),removeEventListener:(name:string)=>docEvents.delete(name),
  querySelector:(selector:string)=>selector==='.hero'?{getBoundingClientRect:()=>({bottom:options.scrolled?-10:700})}:nodes.get(selector.replace('#','')),
  querySelectorAll:(selector:string)=>selector.includes('apps.apple.com')?[apple]:selector==='.step'?[]:[]};
 const fetchMock=jest.fn((request:string)=>{requests.push(request);const d=options.preview;
  if(request.startsWith('/i/')){const resolved=options.canonical||(d?{type:d.type==='community'?'team':d.type==='game'?'session':'app',id:d.id,invitedBy:d.invitedBy||'',clickTracked:false}:{type:'app',invitedBy:''});return options.pending?new Promise(r=>{resolvePreview=()=>r({ok:true,json:async()=>resolved});}):Promise.resolve({ok:true,json:async()=>resolved});}
  if(request.startsWith('/invite-preview'))return options.previewPending?new Promise(()=>{}):Promise.resolve({ok:true,json:async()=>d??{type:'generic'}});
  return Promise.resolve({ok:true,json:async()=>({})});});
 const window:any={__INVITE__:options.injected||{},confirm:jest.fn(()=>options.confirm??true),matchMedia:()=>({matches:true}),scrollY:0,innerHeight:800,addEventListener:(n:string,fn:Function)=>windowEvents.set(n,fn),removeEventListener:(n:string)=>windowEvents.delete(n)};
 const navigator:any={userAgent:options.ua??'Android Chrome/120',maxTouchPoints:options.touch??0,sendBeacon:(s:string)=>beacons.push(s),clipboard:{writeText:jest.fn((s:string)=>{writes.push(s);return options.copy==='fail'?Promise.reject(new Error('denied')):options.copy==='slow'?new Promise(()=>{}):Promise.resolve();})}};
 const context:any={window,document,location,navigator,console,URL,URLSearchParams,Intl,Date,Promise,encodeURIComponent,decodeURIComponent,escape,
  atob:(s:string)=>{if(/[^A-Za-z0-9+/=]/.test(s))throw new Error('bad base64');return Buffer.from(s,'base64').toString('binary');},
  localStorage:{setItem:(k:string,v:string)=>disk.set(k,v),getItem:(k:string)=>disk.get(k)||null},
  fetch:fetchMock,setTimeout:(fn:Function)=>{timers.set(++timerId,fn);return timerId;},clearTimeout:(id:number)=>timers.delete(id),
  IntersectionObserver:class {observe(){}unobserve(){}}};
 window.location=location;window.document=document;
 const html=fs.readFileSync(file,'utf8');const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
 for(const script of scripts)vm.runInNewContext(script,context,{filename:file});
 return {nodes,writes,beacons,requests,disk,window,navigator,location,context,pagehide:()=>windowEvents.get('pagehide')?.(),visibility:()=>{document.hidden=true;docEvents.get('visibilitychange')?.();},resolve:async()=>{resolvePreview();await flush();},tick:async()=>{for(const [id,fn]of [...timers]){timers.delete(id);fn();}await flush();},click:async(id='ctaBtn')=>nodes.get(id).click()};
}
function referrer(href:string){const ref=new URL(href).searchParams.get('referrer');return Object.fromEntries(new URLSearchParams(ref||''));}

describe('landing invitation transport — original script',()=>{
 test.each(['/app','/go','/get','/'])('%s keeps all attribution values in Android store transport',async path=>{
  const h=landing(path+'?invitedBy=sender&s=facebook&c=summer&l=link&g=target');await flush();
  const node=h.nodes.get('storeAndroid')||h.nodes.get('android');
  // /get and / use the invitation-aware contract when metadata is supplied.
  const candidate=node.href.includes('referrer=')?node.href:h.location.href;
  expect(referrer(candidate)).toMatchObject({by:'sender',utm_source:'facebook',utm_campaign:'summer',l:'link',g:'target'});
 });
 test.each(['session','team'])('%s preserves explicit target and metadata',async type=>{
  const h=landing('/'+type+'/target?invitedBy=sender&s=facebook&l=link');await flush();
  expect(referrer(h.nodes.get('storeAndroid').href)).toMatchObject({target_type:type,target_id:'target',by:'sender',l:'link'});
 });
 test('encoded Unicode source survives referrer transport',async()=>{
  const value='עברית + ⚽';const b=Buffer.from(value).toString('base64url');const h=landing('/app?b='+b+'&c='+encodeURIComponent('אב & ג'));await flush();
  expect(referrer(h.nodes.get('storeAndroid').href)).toMatchObject({utm_source:value,utm_campaign:'אב & ג'});
 });
 test('bad base64 falls back to source',async()=>{const h=landing('/app?b=*&s=facebook');await flush();expect(referrer(h.nodes.get('storeAndroid').href).utm_source).toBe('facebook');});
 test('encoded target is decoded exactly once',async()=>{const h=landing('/team/'+encodeURIComponent('club id'));await flush();expect(referrer(h.nodes.get('storeAndroid').href).target_id).toBe('club id');});
 test.each(['ctaBtn','stickyBtn','hdrBtn'])('Android %s opens target then falls back preserving metadata',async id=>{
  const h=landing('/team/club?invitedBy=sender&s=instagram&l=link');await flush();await h.click(id);
  expect(h.location.href).toContain('footy://team/club');await h.tick();
  expect(referrer(h.location.href)).toMatchObject({target_type:'team',target_id:'club',by:'sender',utm_source:'instagram',l:'link'});
 });
 test('successful app handoff cancels fallback',async()=>{const h=landing('/team/club');await h.click();h.visibility();await h.tick();
  expect(h.location.href).toContain('footy://team/club');
 });
 test.each(['ctaBtn','stickyBtn','hdrBtn','apple'])('iPhone %s copies target before App Store',async id=>{
  const h=landing('/session/game?invitedBy=sender&s=facebook&l=link',{ua:'iPhone Safari'});await flush();await h.click(id);if(id!=='apple')await h.tick();
  expect(h.writes[0]).toContain('/session/game?');expect(new URL(h.writes[0]).searchParams.get('invitedBy')).toBe('sender');expect(h.location.href).toContain('apps.apple.com');
 });
 test('iPad desktop UA uses iOS copy and store',async()=>{const h=landing('/team/club',{ua:'Macintosh Safari',touch:5});await flush();await h.click();await h.tick();expect(h.writes).toHaveLength(1);expect(h.location.href).toContain('apps.apple.com');});
 test('desktop primary reveals both stores without scheme navigation',async()=>{const h=landing('/team/club',{ua:'Windows Chrome'});await h.click();expect(h.nodes.get('stores').scrollIntoView).toHaveBeenCalled();expect(h.location.href).toContain('https://teamderfc');});
 test('clipboard denial with refusal keeps user on original invitation',async()=>{const h=landing('/team/club',{ua:'iPhone',copy:'fail',confirm:false});await h.click('apple');expect(h.window.confirm).toHaveBeenCalled();expect(h.location.href).toContain('teamderfc');});
 test('clipboard denial with approval opens store and explains recovery',async()=>{const h=landing('/team/club',{ua:'iPhone',copy:'fail',confirm:true});await h.click('apple');expect(h.window.confirm.mock.calls[0][0]).toContain('לקישור המקורי');expect(h.location.href).toContain('apps.apple.com');});
 test('slow clipboard is bounded and does not silently claim success',async()=>{const h=landing('/team/club',{ua:'iPhone',copy:'slow',confirm:false});void h.click('apple');await flush();await h.tick();expect(h.window.confirm).toHaveBeenCalled();expect(h.location.href).toContain('teamderfc');});
 test('resolved code updates inviter plus target in every transport',async()=>{const h=landing('/app?code=short',{preview:{type:'community',id:'club',invitedBy:'sender',communityName:'בדיקה'}});await flush();expect(referrer(h.nodes.get('storeAndroid').href)).toMatchObject({target_id:'club',by:'sender'});});
 test('personal code transports inviter rather than display name',async()=>{const h=landing('/app?code=short',{preview:{type:'personal',invitedBy:'sender',inviterName:'אלירן'}});await flush();expect(referrer(h.nodes.get('storeAndroid').href).by).toBe('sender');});
 test('early iPhone store click waits for unresolved short-code preview',async()=>{const h=landing('/app?code=short',{ua:'iPhone',pending:true,preview:{type:'community',id:'club',invitedBy:'sender'}});void h.click();await flush();expect(h.location.href).not.toContain('apps.apple.com');await h.resolve();await flush();expect(h.location.href).toContain('footy://team/club');await h.tick();expect(h.writes[0]).toContain('/team/club');expect(h.writes[0]).toContain('invitedBy=sender');});
 test('expired game preserves original installed CTA target plus source',async()=>{const h=landing('/i/code?s=facebook',{ua:'iPhone',injected:{type:'session',id:'game',invitedBy:'sender'},preview:{type:'game',id:'game',status:'finished',communityId:'club',communityName:'בדיקה'}});await flush();await h.click();expect(h.location.href).toContain('footy://session/game');expect(h.location.href).toContain('s=facebook');});
 test('direct finished session retains its original target',async()=>{const h=landing('/session/game',{preview:{type:'game',id:'game',status:'finished',communityId:'club'}});await flush();expect(referrer(h.nodes.get('storeAndroid').href).target_id).toBe('game');});
 test('iPhone primary uses target action for its smart link',async()=>{const h=landing('/team/club',{ua:'iPhone',preview:{type:'community',id:'club',communityName:'מועדון'}});await flush();expect(h.nodes.get('ctaBtn').textContent).toBe('לפרטי המועדון');});
 test('preview personal name stays literal text, no HTML assignment',async()=>{const name='<em>בדיקה</em>';const h=landing('/app?code=short',{preview:{type:'personal',inviterName:name,invitedBy:'sender'}});await flush();expect(h.nodes.get('title').textContent).toContain(name);expect(h.nodes.get('title').innerHTML).toBe('');});
 test('server-counted short page does not count same inviter again in beacon',async()=>{const h=landing('/i/code',{injected:{type:'app',invitedBy:'sender',clickTracked:true},preview:{type:'personal',invitedBy:'sender'}});await flush();expect(h.beacons.filter(url=>url.includes('inviter=sender'))).toHaveLength(0);});
 test('long personal URL measures click once',async()=>{const h=landing('/app?invitedBy=sender');await flush();expect(h.beacons.filter(url=>url.includes('inviter=sender'))).toHaveLength(1);});
 test('code alias waits for canonical inviter before measuring a visit',async()=>{const h=landing('/app?code=code&invitedBy=forged',{pending:true,preview:{type:'personal',invitedBy:'canonical'}});expect(h.beacons).toHaveLength(0);await h.resolve();expect(h.beacons).toHaveLength(1);expect(h.beacons[0]).toContain('inviter=canonical');expect(h.beacons[0]).not.toContain('forged');});
 test.each(['Android Chrome/120','iPhone Safari','Macintosh Safari','Windows Chrome'])('actual /get script retains invitation metadata for %s',async ua=>{
  const h=landing('/get?invitedBy=sender&s=facebook&c=summer&l=link&g=game',{ua,touch:ua.includes('Macintosh')?5:0},'public/get.html');await flush();
  const params=new URL(h.location.href).searchParams;
  const data=params.has('referrer')?referrer(h.location.href):Object.fromEntries(params);
  expect(data.by||data.invitedBy).toBe('sender');expect(data.utm_source||data.s).toBe('facebook');expect(data.l).toBe('link');expect(data.g).toBe('game');
 });
 test('resolved target opens even when optional presentation preview hangs',async()=>{const h=landing('/app?code=short',{previewPending:true,preview:{type:'community',id:'club',invitedBy:'sender'}});void h.click();await flush();expect(h.location.href).toContain('footy://team/club');await h.tick();expect(referrer(h.location.href)).toMatchObject({target_id:'club',by:'sender'});});
 test('early installed-app CTA waits for canonical code target',async()=>{const h=landing('/app?code=short',{ua:'iPhone',pending:true,preview:{type:'community',id:'club',invitedBy:'sender'}});void h.click();await flush();expect(h.location.href).not.toContain('footy://app');await h.resolve();await flush();expect(h.location.href).toContain('footy://team/club');});
 test('actual generic /get Android still opens store directly',async()=>{const h=landing('/get',{},'public/get.html');await flush();expect(h.location.href).toContain('play.google.com');});
 test('actual generic /get iPad opens Apple store directly',async()=>{const h=landing('/get',{ua:'Macintosh Safari',touch:5},'public/get.html');await flush();expect(h.location.href).toContain('apps.apple.com');});
 test('actual home script forwards tracked invitations without losing metadata',async()=>{const h=landing('/?invitedBy=sender&s=facebook&l=link',{},'public/index.html');await flush();expect(new URL(h.location.href).pathname).toBe('/app');expect(new URL(h.location.href).searchParams.get('invitedBy')).toBe('sender');expect(new URL(h.location.href).searchParams.get('l')).toBe('link');});
 test('canonical code without inviter drops forged query inviter',async()=>{const h=landing('/app?code=short&invitedBy=forged',{preview:{type:'community',id:'club',invitedBy:''}});await flush();expect(referrer(h.nodes.get('storeAndroid').href).by).toBeUndefined();});
 test('early Android store anchor waits for canonical resolution',async()=>{const h=landing('/app?code=short',{pending:true,preview:{type:'community',id:'club',invitedBy:'sender'}});void h.click('storeAndroid');await flush();expect(h.location.href).not.toContain('play.google.com');await h.resolve();await flush();expect(referrer(h.location.href)).toMatchObject({target_id:'club',by:'sender'});});
 test('offline short alias passes unresolved URL to Android referrer',async()=>{const h=landing('/app?code=short&invitedBy=untrusted&s=facebook',{pending:true});void h.click('storeAndroid');await flush();await h.tick();await flush();const ref=referrer(h.location.href);expect(ref.by).toBeUndefined();expect(ref.invite_url).toContain('/i/short');expect(ref.utm_source).toBe('facebook');});
 test('offline short alias copies canonical unresolved URL on iPhone',async()=>{const h=landing('/app?code=short&s=facebook',{ua:'iPhone',pending:true});void h.click();await flush();await h.tick();await flush();expect(h.writes[0]).toContain('/i/short');expect(h.writes[0]).toContain('s=facebook');});
 test('visible sticky CTA is available to accessibility tools',async()=>{const h=landing('/app',{scrolled:true});await flush();expect(h.nodes.get('sticky').classList.contains('show')).toBe(true);expect(h.nodes.get('sticky')['aria-hidden']).toBe('false');expect(h.nodes.get('stickyBtn').tabIndex).toBe(0);});
 test('hidden sticky CTA cannot steal keyboard focus',async()=>{const h=landing('/app');await flush();expect(h.nodes.get('sticky')['aria-hidden']).toBe('true');expect(h.nodes.get('stickyBtn').tabIndex).toBe(-1);});
});

test.each(['public/invite.html','functions/templates/invite.html'])('Pulse campaign context survives app/store links and cannot be overridden: %s', async file => {
 const h=landing('/play/U5tUXbaG?s=forged&l=wrong&c=forged&g=wrong', {injected:{type:'go',source:'facebook',campaign:'',gameTarget:'',linkId:'U5tUXbaG'}},file);
 await flush();
 const store=new URL(h.nodes.get('storeAndroid').href);
 const ref=new URLSearchParams(store.searchParams.get('referrer')!);
 expect(ref.get('utm_source')).toBe('facebook');
 expect(ref.get('l')).toBe('U5tUXbaG');
 expect(ref.get('c')).toBeNull();
 expect(ref.get('g')).toBeNull();
 expect(h.beacons).toHaveLength(1);
 expect(h.beacons[0]).toContain('s=facebook');
 expect(h.beacons[0]).toContain('l=U5tUXbaG');
 await h.click();
 expect(h.location.href).toBe('footy://go?s=facebook&l=U5tUXbaG');
});


describe('direct previews and canonical targets',()=>{
 test.each(['public/invite.html','functions/templates/invite.html','public/index.html'])('generic root opens the app and has no stuck invitation loader: %s',async file=>{
  const h=landing('/',{},file);await flush();await h.click();expect(h.location.href).toBe('footy://app');expect(h.window.__LANDING_PREVIEW__).toEqual({type:'generic'});
 });
 test.each(['/session/round','/team/club','/c/club'])('direct target requests its public preview without a short code: %s',async path=>{
  const game=path.includes('session');const h=landing(path+'?invitedBy=sender',{preview:{type:game?'game':'community',id:game?'round':'club',communityName:'מועדון'}});await flush();
  const req=h.requests.find(r=>r.startsWith('/invite-preview'))!;const q=new URL(req,'https://teamderfc.web.app').searchParams;
  expect(q.get('type')).toBe(game?'session':'team');expect(q.get('id')).toBe(game?'round':'club');expect(q.get('invitedBy')).toBe('sender');expect(h.window.__LANDING_PREVIEW__.id).toBe(game?'round':'club');
 });
 test('direct personal invitation renders public inviter and does not need a code',async()=>{
  const h=landing('/app?invitedBy=sender',{preview:{type:'personal',inviterName:'אלירן',inviterAvatarUrl:'/avatars/avatar-01.jpg'}});await flush();
  expect(h.nodes.get('title').textContent).toContain('אלירן');expect(h.requests[0]).toContain('type=app');expect(h.window.__INVITE__.invitedBy).toBe('sender');
 });
 test('preview cannot replace a direct invitation with another target',async()=>{
  const h=landing('/session/original',{preview:{type:'game',id:'wrong'}});await flush();await h.click();expect(h.location.href).toBe('footy://session/original');expect(h.window.__LANDING_PREVIEW__).toEqual({type:'generic'});
 });
 test('preview cannot replace a resolved canonical target',async()=>{
  const h=landing('/i/short',{canonical:{type:'team',id:'canonical'},preview:{type:'game',id:'wrong'}});await flush();await h.click();expect(h.location.href).toBe('footy://team/canonical');expect(h.window.__LANDING_PREVIEW__).toEqual({type:'generic'});
 });
 test('canonical personal code drops a forged g target from Android and app transport',async()=>{
  const h=landing('/app?code=short&g=wrong&s=facebook',{preview:{type:'personal',invitedBy:'sender'}});await flush();await h.click();
  expect(h.location.href).toBe('footy://app?invitedBy=sender&s=facebook');expect(referrer(h.nodes.get('storeAndroid').href).g).toBeUndefined();
 });
 test('legitimate direct campaign g survives and requests the game preview',async()=>{
  const h=landing('/go?g=round&s=facebook',{preview:{type:'game',id:'round'}});await flush();await h.click();expect(h.location.href).toBe('footy://go?s=facebook&g=round');expect(h.requests[0]).toContain('type=session&id=round');
 });
 test('unresolved raw short code keeps its URL in Android store transport',async()=>{
  const h=landing('/i/offline?s=facebook',{pending:true});void h.click('storeAndroid');await flush();await h.tick();expect(referrer(h.location.href).invite_url).toBe('https://teamderfc.web.app/i/offline?s=facebook');
 });
 test('unresolved raw short code warns on clipboard failure before iOS store',async()=>{
  const h=landing('/i/offline',{pending:true,ua:'iPhone',copy:'fail',confirm:false});void h.click();await flush();await h.tick();await flush();expect(h.window.confirm).toHaveBeenCalled();expect(h.location.href).toContain('/i/offline');
 });
 test('presentation hook runs after legacy rendering finishes',async()=>{
  const h=landing('/session/round',{previewPending:true,preview:{type:'game',id:'round'}});h.window.renderLandingContext=(d:any)=>{h.nodes.get('ctxTags').innerHTML='presentation';};await h.tick();
  expect(h.nodes.get('ctxTags').innerHTML).toBe('presentation');
 });
 test('hung direct preview is bounded without changing the invitation target',async()=>{
  const h=landing('/team/club',{previewPending:true});await h.tick();expect(h.window.__LANDING_PREVIEW__).toEqual({type:'generic'});await h.click();expect(h.location.href).toBe('footy://team/club');
 });
});

test.each(['public/c/index.html','functions/templates/community.html'])('legacy c page uses the shared invitation transport and preserves public showcase guard: %s',async file=>{
 const h=landing('/c/club?invitedBy=sender&s=facebook',{preview:{type:'community',id:'club'}},file);await flush();expect(h.requests[0]).toContain('showcase=1');await h.click();expect(h.location.href).toBe('footy://team/club?invitedBy=sender&s=facebook');
});

test('optional personal preview cards get canonical inviter and every acquisition field without a wrong game override',async()=>{
 const h=landing('/app?code=short&invitedBy=forged&g=wrong&s=facebook&c=summer&l=link',{preview:{type:'personal',invitedBy:'sender'}});await flush();
 expect(h.window.getLandingShareQuery()).toBe('?invitedBy=sender&s=facebook&c=summer&l=link');
});

describe('smart primary app opening',()=>{
 test.each(['public/invite.html','functions/templates/invite.html','public/index.html','public/c/index.html','functions/templates/community.html'])('iPhone opens first and falls back to the store with the canonical invitation: %s',async file=>{
  const h=landing('/session/round?invitedBy=sender&s=facebook&l=link',{ua:'iPhone Safari'},file);await flush();await h.click();
  expect(h.location.href).toBe('footy://session/round?invitedBy=sender&s=facebook&l=link');expect(h.writes).toHaveLength(0);
  await h.tick();expect(h.writes[0]).toBe('https://teamderfc.web.app/session/round?invitedBy=sender&s=facebook&l=link');expect(h.location.href).toContain('apps.apple.com');
 });
 test.each(['Android Chrome','iPhone Safari'])('installed handoff prevents a later store redirect on returning: %s',async ua=>{
  const h=landing('/team/club',{ua});await h.click();h.visibility();await h.tick();await h.tick();expect(h.location.href).toBe('footy://team/club');expect(h.writes).toHaveLength(0);
 });
 test('pagehide also cancels store fallback',async()=>{const h=landing('/app',{ua:'iPhone'});await h.click();h.pagehide();await h.tick();expect(h.location.href).toBe('footy://app');});
 test('double tap produces only one iPhone fallback and one invitation copy',async()=>{const h=landing('/team/club',{ua:'iPhone'});await h.click();await h.click();await h.tick();expect(h.writes).toHaveLength(1);expect(h.location.href).toContain('apps.apple.com');});
 test('generic iPhone install does not ask for clipboard or invitation confirmation',async()=>{const h=landing('/',{ua:'iPhone',copy:'fail',confirm:false});await h.click();expect(h.location.href).toBe('footy://app');await h.tick();expect(h.location.href).toContain('apps.apple.com');expect(h.writes).toHaveLength(0);expect(h.window.confirm).not.toHaveBeenCalled();});
});

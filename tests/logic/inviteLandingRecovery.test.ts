import fs from 'fs';
import vm from 'vm';
function element(){return {href:'',handlers:{} as Record<string,Function>,addEventListener(n:string,fn:Function){this.handlers[n]=fn;},appendChild:jest.fn(),classList:{remove:jest.fn()}};}
function context(pathname:string){
 const elements=new Map<string,ReturnType<typeof element>>();
 const apple=element();let complete!:()=>void;
 const copy=jest.fn(()=>new Promise<void>(r=>{complete=r;}));
 const c:any={location:{pathname,search:'?invitedBy=sender&s=whatsapp&c=summer&l=track',href:'original'},window:{__INVITE__:{},confirm:jest.fn(()=>true)},URLSearchParams,encodeURIComponent,decodeURIComponent,escape,atob,Promise,setTimeout,clearTimeout,localStorage:{setItem(){}},navigator:{userAgent:'iPhone Safari',sendBeacon(){},clipboard:{writeText:copy}},document:{getElementById(id:string){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelectorAll:()=>[apple],createElement:element}};
 return {c,elements,apple,copy,finishCopy:()=>complete()};
}
test.each(['public/invite.html','functions/templates/invite.html'])('all iPhone store clicks await invitation copy: %s',async file=>{
 const html=fs.readFileSync(file,'utf8');const start=html.indexOf('(function(){',html.indexOf('<script>'));const stop=html.indexOf('  var V={',start);
 const {c,apple,copy,finishCopy}=context('/team/club');
 vm.runInNewContext(html.slice(start,stop)+'})();',c);
 apple.handlers.click({preventDefault(){}});
 for(let n=0;n<15;n++)await Promise.resolve();
 expect(copy).toHaveBeenCalledWith('https://teamderfc.web.app/team/club?invitedBy=sender&s=whatsapp&c=summer&l=track');
 expect(c.location.href).toBe('original');
 finishCopy();
 for(let n=0;n<15;n++)await Promise.resolve();
 expect(c.location.href).toContain('apps.apple.com');
});
test.each(['public/c/index.html','functions/templates/community.html'])('community uses the same tested store transport as invitations: %s', file => {
 const html=fs.readFileSync(file,'utf8');const canonical=fs.readFileSync('public/invite.html','utf8');
 expect(html).toBe(canonical);
 // The behavioral /c store-handoff matrix is in inviteWebExpanded.test.ts.
 expect(html).toContain("parts[0]==='c'");
 expect(html).toContain("showcase=1");
});

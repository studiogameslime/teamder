import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function execute(source:string, extra:Record<string,unknown>) {
 const module={exports:{} as any};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URL,Date,console,...extra});return module.exports;
}
const fields=execute(fs.readFileSync('functions/src/invitePreviewFields.ts','utf8'),{});
const source=fs.readFileSync('functions/src/index.ts','utf8');
const previewStart=source.indexOf('export const getInvitePreview');
const previewEnd=source.indexOf('\n);',previewStart)+4;
const previewJs=ts.transpileModule(source.slice(previewStart,previewEnd),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function preview(query:Record<string,unknown>, data:Record<string,any>={}, future:any[]=[]){
 const reads:string[]=[], filters:any[]=[];let output:any;
 const db={collection:(name:string)=>{
  const q:any={doc:(id:string)=>({get:async()=>{reads.push(name+'/'+id);const value=data[name+'/'+id];return {id,exists:value!==undefined,data:()=>value};}}),
   where:(...args:any[])=>{filters.push(args);return q;},orderBy:(...args:any[])=>{filters.push(['orderBy',...args]);return q;},limit:(n:number)=>{filters.push(['limit',n]);return q;},get:async()=>({docs:future.map(g=>({id:g.id,data:()=>g}))})};return q;
 }};
 const module={exports:{} as any};vm.runInNewContext(previewJs,{module,exports:module.exports,db,...fields,Date,console,onRequest:(_options:any,handler:any)=>handler});
 const fn=module.exports.getInvitePreview;
 await fn({query},{set:()=>{},json:(value:any)=>{output=JSON.parse(JSON.stringify(value));}});return {output,reads,filters};
}

test('direct game preview returns only display data and usersPublic identity',async()=>{
 const now=Date.now();const {output,reads}=await preview({type:'session',id:'game',invitedBy:'sender'},{
  'games/game':{title:'מחזור',startsAt:now+60000,status:'open',maxPlayers:10,players:['secret1','secret2'],guests:[{}, {waitlisted:true},{canceled:true}],pendingPromotion:{uid:'secret3'},format:'5v5',fieldType:'grass',visibility:'public',groupId:'club',notes:'secret',adminRatings:{secret:5}},
  'groupsPublic/club':{name:'מועדון',city:'עיר',memberCount:9},
  'usersPublic/sender':{name:'אלירן',avatarId:'a22',photoUrl:'https://example.com/photo.jpg',phone:'private',fcmToken:'private'},
 });
 expect(output).toMatchObject({type:'game',id:'game',format:'5v5',surface:'דשא טבעי',maxPlayers:10,availableSpots:6,registrationClosed:false,inviterName:'אלירן',inviterPhotoUrl:'https://example.com/photo.jpg',inviterAvatarUrl:'/avatars/avatar-01.jpg'});
 expect(Object.keys(output).sort()).toEqual(['type','id','gameTitle','startsAt','communityName','communityId','communityCity','communityMembersCount','status','maxPlayers','availableSpots','format','surface','isPublic','registrationClosed','inviterName','inviterPhotoUrl','inviterAvatarUrl'].sort());
 expect(reads.some(r=>r.startsWith('users/'))).toBe(false);expect(JSON.stringify(output)).not.toContain('secret');
});
test.each(['scheduled','locked','active','finished','cancelled'])('non-open status is never advertised as joinable: %s',async status=>{
 const {output}=await preview({type:'session',id:'g'},{'games/g':{status}});expect(output.registrationClosed).toBe(true);
});
test('scheduled open time and unavailable optional fields are represented truthfully',async()=>{
 const future=Date.now()+86400000;const {output}=await preview({type:'session',id:'g'},{'games/g':{status:'open',registrationOpensAt:future,format:'5v4',fieldType:'unknown',maxPlayers:0}});
 expect(output).toMatchObject({registrationClosed:true,registrationOpensAt:future});expect(output).not.toHaveProperty('format');expect(output).not.toHaveProperty('surface');expect(output).not.toHaveProperty('availableSpots');
});
test('canonical code owns both target and inviter regardless of query values',async()=>{
 const {output,reads}=await preview({code:'short',type:'session',id:'wrong',invitedBy:'forged'},{'inviteLinks/short':{type:'team',targetId:'club',invitedBy:'sender'},'groupsPublic/club':{name:'אמיתי',coverImageId:'c13'},'usersPublic/sender':{name:'מזמין'}});
 expect(output).toMatchObject({type:'community',id:'club',inviterName:'מזמין',communityCover:'/covers/daylight-team.jpg'});expect(reads).not.toContain('usersPublic/forged');expect(reads).not.toContain('games/wrong');
});
test.each([{type:'session',id:'../g'},{type:'team',id:['a']},{type:'team',id:'x/y'},{code:'bad/code'}])('invalid identifiers do not reach document paths: %p',async query=>{
 const {output,reads}=await preview(query);expect(output).toEqual({type:'generic'});expect(reads).toEqual([]);
});
test('legacy c preview keeps its showcase existence guard',async()=>{
 const {output,reads}=await preview({type:'team',id:'club',showcase:'1'},{'groupsPublic/club':{name:'לא לפרסום'}});expect(output).toEqual({type:'generic'});expect(reads).toEqual(['communityShowcase/club']);
});
test.each([{hidden:true},{isPersonal:true}])('hidden or personal clubs are never exposed: %p',async hidden=>{
 const {output}=await preview({type:'team',id:'club'},{'groupsPublic/club':{name:'פרטי',...hidden}});expect(output).toEqual({type:'generic'});
});
test('personal cards are built only from real future public rounds and open public clubs',async()=>{
 const {output,filters}=await preview({type:'app',invitedBy:'sender'},{'usersPublic/sender':{name:'מזמין'},'groupsPublic/club':{name:'מועדון',isOpen:true,coverPhotoUrl:'https://example.com/club.jpg'}},[{id:'round',startsAt:Date.now()+60000,players:['sender'],groupId:'club'}]);
 expect(output).toMatchObject({type:'personal',inviterName:'מזמין',community:{id:'club',name:'מועדון',coverUrl:'https://example.com/club.jpg'},nextGame:{id:'round'}});
 expect(filters).toEqual(expect.arrayContaining([['visibility','==','public'],['status','==','open'],['limit',50]]));
});
test('personal invitation without activity does not invent optional cards',async()=>{
 const {output}=await preview({type:'app',invitedBy:'sender'},{'usersPublic/sender':{name:'מזמין'}});expect(output).toEqual({type:'personal',inviterName:'מזמין'});
});
test('a public round does not expose its closed parent club in optional personal cards',async()=>{
 const {output}=await preview({type:'app',invitedBy:'sender'},{'usersPublic/sender':{name:'מזמין'},'groupsPublic/club':{name:'סגור',isOpen:false}},[{id:'round',startsAt:Date.now()+60000,players:['sender'],groupId:'club'}]);expect(output).not.toHaveProperty('community');expect(output.nextGame.id).toBe('round');
});
test('avatar and cover identifiers cannot inject arbitrary paths or unsafe URLs',()=>{
 expect(fields.publicInviterFields({name:'  שם ',avatarId:'../../secret',photoUrl:'javascript:alert(1)'})).toEqual({inviterName:'שם'});
 expect(fields.publicInviterFields({avatarId:'a10'})).toEqual({inviterAvatarUrl:'/avatars/avatar-24.jpg'});
 expect(fields.publicCover({coverPhotoUrl:'javascript:alert(1)',coverImageId:'c13'},'club')).toBe('/covers/daylight-team.jpg');
});
test('published avatar and cover allowlists point at real exact bundled assets',()=>{
 const avatarSrc=fs.readFileSync('src/data/avatars.ts','utf8');
 for(const m of avatarSrc.matchAll(/id: '(a\d+)'[^\n]*require\('\.\.\/assets\/images\/avatars\/([^']+)'\)/g)){
  const url=fields.publicInviterFields({avatarId:m[1]}).inviterAvatarUrl;expect(url).toBe('/avatars/'+m[2]);expect(fs.readFileSync('public'+url)).toEqual(fs.readFileSync('src/assets/images/avatars/'+m[2]));
 }
 const coverSrc=fs.readFileSync('src/data/coverImages.ts','utf8');
 for(const m of coverSrc.matchAll(/id: '(c\d+)'[^\n]*require\('\.\.\/assets\/images\/groupImages\/([^']+)'\)/g)){
  const url=fields.publicCover({coverImageId:m[1]},'club');expect(url).toBe('/covers/'+m[2]);expect(fs.readFileSync('public'+url)).toEqual(fs.readFileSync('src/assets/images/groupImages/'+m[2]));
 }
});

test('personal invitation without a public inviter identity falls back instead of rendering an empty personal card',async()=>{
 const {output,filters}=await preview({type:'app',invitedBy:'missing'});expect(output).toEqual({type:'generic'});expect(filters).toEqual([]);
});

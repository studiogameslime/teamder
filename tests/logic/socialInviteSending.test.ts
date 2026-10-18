import fs from 'fs';import vm from 'vm';import ts from 'typescript';
function fixture(){
 const source=ts.createSourceFile('profile.tsx',fs.readFileSync('src/components/social/SocialPlayerProfile.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let handler='';const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='send')handler=n.initializer!.getText(source);ts.forEachChild(n,visit);};visit(source);
 let resolve!:(v:any)=>void,reject!:(e:Error)=>void;const response=new Promise((r,j)=>{resolve=r;reject=j;});
 const state={currentUser:{id:'me'}};
 const ctx:any={exports:{},preview:undefined,sent:[],sendingRef:{current:false},me:{id:'me'},userId:'other',currentTarget:{current:'other'},useUserStore:{getState:()=>state},setSending:jest.fn(),setSent:jest.fn(),socialPlayersService:{inviteToClub:jest.fn(()=>response)},notificationsService:{inviteToGame:jest.fn(()=>response)},toast:{success:jest.fn(),error:jest.fn(),info:jest.fn()}};
 vm.runInNewContext(ts.transpileModule('exports.run='+handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 return {...ctx,run:ctx.exports.run,resolve,reject,state};
}
test.each(['club','game'] as const)('sending %s starts loading immediately and prevents duplicate requests',async kind=>{
 const f=fixture(),pending=f.run(kind,'target');expect(f.setSending).toHaveBeenCalledWith(`${kind}:target`);
 await f.run(kind,'target');expect(kind==='club'?f.socialPlayersService.inviteToClub:f.notificationsService.inviteToGame).toHaveBeenCalledTimes(1);
 f.resolve({invited:true});await pending;expect(f.setSending).toHaveBeenLastCalledWith(null);expect(f.sendingRef.current).toBe(false);expect(f.toast.success).toHaveBeenCalled();
});
test('failed send clears loading and allows retry without recording success',async()=>{
 const f=fixture(),pending=f.run('club','target');f.reject(new Error('offline'));await pending;
 expect(f.setSent).not.toHaveBeenCalled();expect(f.toast.error).toHaveBeenCalled();expect(f.sendingRef.current).toBe(false);
});
test('an old account response does not announce or record success',async()=>{
 const f=fixture(),pending=f.run('club','target');f.state.currentUser={id:'new'};f.resolve({invited:true});await pending;
 expect(f.toast.success).not.toHaveBeenCalled();expect(f.setSent).not.toHaveBeenCalled();
});

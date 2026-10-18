import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture() {
  const source=ts.createSourceFile('screen.tsx',fs.readFileSync('src/components/social/ReceivedInvitations.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let handler='';const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='accept')handler=n.initializer!.getText(source);ts.forEachChild(n,visit);};visit(source);
  let resolve!:(value:any)=>void,reject!:(error:Error)=>void;
  const pending=new Promise((r,j)=>{resolve=r;reject=j;});
  const context:any={exports:{},me:{id:'me'},accepting:{current:false},epoch:{current:1},useUserStore:{getState:()=>({currentUser:{id:'me'}})},
    setAcceptingId:jest.fn(),acceptReceivedInvitation:jest.fn(()=>pending),setItems:jest.fn(),setRetry:jest.fn(),
    notificationsService:{markRead:jest.fn(async()=>{})},navigateInvite:jest.fn(()=>true),toast:{success:jest.fn(),error:jest.fn(),info:jest.fn()}};
  vm.runInNewContext(ts.transpileModule('exports.run='+handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {...context,run:context.exports.run,resolve,reject};
}
const item={id:'notice',type:'inviteToGame',targetId:'round'};
test('tap shows loading immediately, joins only once and navigates only after confirmation',async()=>{
  const f=fixture(),run=f.run(item);
  expect(f.setAcceptingId).toHaveBeenCalledWith('notice');expect(f.navigateInvite).not.toHaveBeenCalled();
  await f.run(item);expect(f.acceptReceivedInvitation).toHaveBeenCalledTimes(1);
  f.resolve({type:'session',id:'round',status:'waitlist',isMember:true});await run;
  expect(f.navigateInvite).toHaveBeenCalledWith({type:'session',id:'round',status:'waitlist',isMember:true});
  expect(f.toast.success).toHaveBeenCalledWith('נכנסת לרשימת ההמתנה למחזור');
  const rows=[item,{...item,id:'duplicate'}, {...item,id:'other',targetId:'other'}];
  expect(f.setItems.mock.calls[0][0](rows)).toEqual([rows[2]]);
  expect(f.accepting.current).toBe(false);
});
test('failed acceptance stays on the inbox and permits retry',async()=>{
  const f=fixture(),run=f.run(item);f.reject(new Error('GAME_JOIN_REJECTED'));await run;
  expect(f.navigateInvite).not.toHaveBeenCalled();expect(f.setItems).not.toHaveBeenCalled();
  expect(f.toast.error).toHaveBeenCalled();expect(f.setRetry).toHaveBeenCalled();expect(f.accepting.current).toBe(false);
});
test('leaving the screen during the join never forces navigation back',async()=>{
  const f=fixture(),run=f.run(item);f.epoch.current++;
  f.resolve({type:'session',id:'round',status:'players',isMember:true});await run;
  expect(f.navigateInvite).not.toHaveBeenCalled();expect(f.toast.success).not.toHaveBeenCalled();
});

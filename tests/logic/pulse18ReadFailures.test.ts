import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

function method(file:string, name:string, context:Record<string,unknown>) {
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body='';
 const walk=(node:ts.Node)=>{if(ts.isMethodDeclaration(node)&&node.name.getText(source)===name)body=`async function ${node.getText(source).replace(/^async\s+/,'')}`;if(ts.isFunctionDeclaration(node)&&node.name?.text===name)body=node.getText(source).replace(/^export\s+/,'');ts.forEachChild(node,walk);};walk(source);
 if(!body)throw Error(name);
 return vm.runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}

test('deleting an absent photo succeeds silently; real storage failures stay visible',async()=>{
 const logError=jest.fn(),observeCaughtError=jest.fn(),deleteObject=jest.fn().mockRejectedValue({code:'storage/object-not-found'});
 const remove=method('src/services/photoService.ts','deleteUserPhoto',{USE_MOCK_DATA:false,getFirebase:()=>({storage:{}}),storageRef:jest.fn(),AVATAR_PATH:(uid:string)=>uid,deleteObject,logError,observeCaughtError});
 await remove('player');expect(logError).not.toHaveBeenCalled();expect(observeCaughtError).not.toHaveBeenCalled();
 deleteObject.mockRejectedValue({code:'storage/unauthorized'});await remove('player');expect(logError).toHaveBeenCalledTimes(1);expect(observeCaughtError).toHaveBeenCalledTimes(1);
});

test('available players returns the first examined page, including its non-empty cursor',async()=>{
 const playerReadCall=jest.fn().mockResolvedValue({players:[],cursor:'next'});
 const page=method('src/services/userService.ts','findAvailablePlayersPage',{USE_MOCK_DATA:false,playerReadCall,setTimeout,clearTimeout});
 await expect(page('game')).resolves.toEqual({players:[],cursor:'next'});expect(playerReadCall).toHaveBeenCalledTimes(1);
 await expect(page('game','next')).rejects.toThrow('AVAILABLE_PLAYERS_CURSOR_STALLED');
});

test('an unresponsive availability call becomes a retryable failure after 15 seconds',async()=>{
 jest.useFakeTimers();
 try {
  const page=method('src/services/userService.ts','findAvailablePlayersPage',{USE_MOCK_DATA:false,playerReadCall:()=>new Promise(()=>{}),setTimeout,clearTimeout});
  const pending=page('game');const assertion=expect(pending).rejects.toThrow('AVAILABLE_PLAYERS_TIMEOUT');
  jest.advanceTimersByTime(15000);await assertion;expect(jest.getTimerCount()).toBe(0);
 } finally {jest.useRealTimers();}
});

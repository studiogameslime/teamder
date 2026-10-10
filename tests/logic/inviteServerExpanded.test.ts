import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
function server(data: any = { type:'app',targetId:'',invitedBy:'' }, exists=true) {
 const source=fs.readFileSync('functions/src/index.ts','utf8').replace(/\r\n/g,'\n');
 const at=source.indexOf('export const serveInviteCode');
 const begin=source.indexOf('  async (req, res) => {',at);
 const end=source.indexOf('\n  },\n);',begin);
 const js=ts.transpileModule('('+source.slice(begin,end)+'\n  })',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const writes=jest.fn(async()=>{}),aggregate=jest.fn(async()=>{});
 const db={collection:()=>({doc:()=>({get:async()=>({exists,data:()=>data,ref:{set:writes}}),set:writes})})};
 const firestore:any=()=>db;firestore.FieldValue={increment:(n:number)=>n};
 const run=vm.runInNewContext(js,{db,admin:{firestore},Date,JSON,console,bumpLinkClickAggregate:aggregate,loadTemplate:()=>'<html><head></head><body></body></html>',INVITE_TEMPLATE_PATH:'local',injectMeta:(html:string)=>html});
 let body:any='',status=0;const headers:Record<string,string>={};
 const res={set:(key:string,value:string)=>{headers[key]=value;return res;},status:(n:number)=>{status=n;return res;},json:(d:any)=>{body=d;return res;},send:(d:string)=>{body=d;return res;}};
 return {run:async(query:Record<string,string>={})=>{await run({path:'/i/code',query},res);return {body,status,headers};},writes,aggregate};
}
test('short-code payload never terminates its script through stored text',async()=>{
 const text='</script><em id="proof">בדיקה</em><script>';
 const s=server({type:'app',targetId:text,invitedBy:''});
 const {body}=await s.run();
 expect(body).toContain('window.__INVITE__=');
 expect(body).not.toContain(text);
 const payload=/window\.__INVITE__=(.*?);<\/script>/.exec(body)!;
 expect(JSON.parse(payload[1])).toMatchObject({id:text,clickTracked:true});
 expect(body).toContain('\\u003c');
});
test('native resolution is read-only and returns canonical empty inviter',async()=>{
 const s=server({type:'app',targetId:'',invitedBy:''});
 const result=await s.run({resolve:'1'});
 expect(result.status).toBe(200);expect(result.body).toEqual({type:'app',id:'',invitedBy:''});
 expect(s.writes).not.toHaveBeenCalled();expect(s.aggregate).not.toHaveBeenCalled();
});
test('missing native code is explicit and never increments a counter',async()=>{
 const s=server(undefined,false);const result=await s.run({resolve:'1'});
 expect(result.status).toBe(404);expect(s.writes).not.toHaveBeenCalled();
});
test('landing visit has one owner and disables caches that suppress later visits',async()=>{
 const s=server();const result=await s.run();
 expect(result.headers['Cache-Control']).toBe('no-store');expect(s.writes).toHaveBeenCalledTimes(1);
 expect(s.aggregate).toHaveBeenCalledTimes(1);
});

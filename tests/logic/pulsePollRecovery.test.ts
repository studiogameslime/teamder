import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

test('a failed download source retains its last confirmed value while the other source refreshes',async()=>{
 const previous={reviews:[],ratings:[],revenue:null,analytics:null,users:[],appStats:null,downloads:{ios:{total:7},android:{total:8}}};
 const save=jest.fn(),empty=async()=>null;
 const imports:any={
  './teamderChatService':{TEAMDER_UID:'teamder'},'../config':{config:{appName:'test'}},
  './appStoreConnect':{fetchAppStoreRating:empty,fetchAppStoreReviews:async()=>[]},
  './googlePlay':{fetchPlayRating:empty,fetchPlayReviews:async()=>[]},
  './admob':{fetchRevenue:empty},'./analytics':{fetchAnalytics:empty},
  './downloads':{fetchAppleDownloads:async()=>{throw Error('provider offline');},fetchPlayDownloads:async()=>({total:9})},
  './chatMonitorService':{listChatReports:async()=>[],listRecentChatMessages:async()=>[]},
  './store':{seedIfFirstRun:async()=>true,getSnapshot:async()=>previous,saveSnapshot:save},
 };
 const module={exports:{} as any};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('pulse/src/services/poller.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {module,exports:module.exports,require:(name:string)=>imports[name]??{},setTimeout,clearTimeout,console:{warn:()=>{}}});
 const result=await module.exports.runPoll({silent:true});
 expect(result.snapshot.downloads).toEqual({ios:{total:7},android:{total:9}});
 expect(save).toHaveBeenCalledWith(result.snapshot);
});

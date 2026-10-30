import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

test('a failed download source retains its last confirmed value while the other source refreshes',async()=>{
 const previous={reviews:[],ratings:[],revenue:null,analytics:null,users:[],appStats:null,downloads:{ios:{total:7},android:{total:8}}};
 const save=jest.fn(),empty=async()=>null;
 const imports:any={
  './errorObservation':{observeCaughtError:jest.fn()},
  './teamderChatService':{TEAMDER_UID:'teamder'},'../config':{config:{appName:'test'}},
  './appStoreConnect':{fetchAppStoreRating:empty,fetchAppStoreReviews:async()=>[]},
  './googlePlay':{fetchPlayRating:empty,fetchPlayReviews:async()=>[]},
  './admob':{fetchRevenue:empty},'./analytics':{fetchAnalytics:empty},
  './downloads':{fetchAppleDownloads:async()=>{throw Error('provider offline');},fetchPlayDownloads:async()=>({total:9})},
  './chatMonitorService':{listChatReports:async()=>[],listRecentChatMessages:async()=>[]},
  './store':{seedIfFirstRun:async()=>true,getSnapshot:async()=>previous,saveSnapshot:save},
 };
 const module={exports:{} as any};
 ((vm.runInNewContext as any).diagnosticOriginal ?? vm.runInNewContext)(ts.transpileModule(fs.readFileSync('pulse/src/services/poller.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {module,exports:module.exports,require:(name:string)=>imports[name]??{},setTimeout,clearTimeout,console:{warn:()=>{}}});
 const result=await module.exports.runPoll({silent:true});
 expect(result.snapshot.downloads).toEqual({ios:{total:7},android:{total:9}});
 expect(save).toHaveBeenCalledWith(result.snapshot);
});

function reviewFixture() {
 const previous={reviews:[{id:'old-apple',source:'appstore',createdAt:'2026-10-25'},{id:'old-play',source:'googleplay',createdAt:'2026-10-24'}],ratings:[{source:'appstore',total:7},{source:'googleplay',total:8}],downloads:null};
 const apple=jest.fn(),play=jest.fn().mockResolvedValue([{id:'new-play',source:'googleplay',createdAt:'2026-10-28'}]);
 const appleRating=jest.fn(),playRating=jest.fn().mockResolvedValue({source:'googleplay',total:9});
 const observe=jest.fn(),save=jest.fn(),empty=async()=>null;
 const imports:any={
  './errorObservation':{observeCaughtError:observe},'./teamderChatService':{TEAMDER_UID:'teamder'},'../config':{config:{appName:'test'}},
  './appStoreConnect':{fetchAppStoreRating:appleRating,fetchAppStoreReviews:apple},'./googlePlay':{fetchPlayRating:playRating,fetchPlayReviews:play},
  './admob':{fetchRevenue:empty},'./analytics':{fetchAnalytics:empty},'./downloads':{fetchAppleDownloads:empty,fetchPlayDownloads:empty},
  './chatMonitorService':{listChatReports:async()=>[],listRecentChatMessages:async()=>[]},
  './store':{seedIfFirstRun:async()=>true,getSnapshot:async()=>previous,saveSnapshot:save},
 };
 const module={exports:{} as any};
 ((vm.runInNewContext as any).diagnosticOriginal ?? vm.runInNewContext)(ts.transpileModule(fs.readFileSync('pulse/src/services/poller.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {module,exports:module.exports,require:(name:string)=>imports[name]??{},setTimeout,clearTimeout,console:{warn:()=>{}}});
 return{...module.exports,previous,apple,play,appleRating,playRating,observe,save};
}
test('one failed store preserves its own reviews and rating while the healthy store refreshes',async()=>{
 const f=reviewFixture();f.apple.mockRejectedValue(Error('provider offline'));f.appleRating.mockRejectedValue(Error('provider offline'));
 const {snapshot}=await f.runPoll({silent:true});
 expect(snapshot.reviews.map((r:any)=>r.id)).toEqual(['new-play','old-apple']);
 expect(snapshot.ratings).toEqual([{source:'appstore',total:7},{source:'googleplay',total:9}]);
 expect(f.observe).toHaveBeenCalledTimes(2);
});
test('successful empty review responses clear stale reviews instead of resurrecting them',async()=>{
 const f=reviewFixture();f.apple.mockResolvedValue([]);f.play.mockResolvedValue([]);
 const {snapshot}=await f.runPoll({silent:true});expect(snapshot.reviews).toEqual([]);
});
test('a timed-out source retains its own data and names the source in the error',async()=>{
 jest.useFakeTimers();try {
  const f=reviewFixture();f.apple.mockReturnValue(new Promise(()=>{}));f.appleRating.mockResolvedValue({source:'appstore',total:10});
  const pending=f.runPoll({silent:true});await jest.advanceTimersByTimeAsync(12000);
  expect((await pending).snapshot.reviews.map((r:any)=>r.id)).toEqual(['new-play','old-apple']);
  expect(f.observe).toHaveBeenCalledWith(expect.objectContaining({code:'poll/source-timeout',source:'appstore reviews'}),expect.any(Object));
 }finally{jest.useRealTimers();}
});

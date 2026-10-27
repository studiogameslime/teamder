const mockGet=jest.fn(),mockDocs=jest.fn();
const mockAuth={currentUser:{uid:'admin'} as {uid:string}|null};
jest.mock('../src/services/groupService',()=>({groupService:{get:(...a:unknown[])=>mockGet(...a)}}));
jest.mock('../src/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({auth:mockAuth})}));
jest.mock('../src/firebase/firestore',()=>({docs:{game:(id:string)=>id}}));
jest.mock('../src/firebase/authRace',()=>({withAuthRaceRetry:(fn:()=>unknown)=>fn()}));
jest.mock('firebase/firestore',()=>({collection:(id:string)=>id,query:(id:string)=>id,limit:jest.fn(),getDocs:(...a:unknown[])=>mockDocs(...a)}));
import {loadManagerClubResults} from '../src/services/managerClubResultsService';
import type {Game,Group} from '../src/types';
const now=2e12,group={id:'g',adminIds:['admin'],playerIds:[]} as unknown as Group;
const games=Array.from({length:12},(_,i)=>({id:'g'+i,groupId:'g',status:'finished',startsAt:now-i-1} as Game));
beforeEach(()=>{jest.clearAllMocks();mockAuth.currentUser={uid:'admin'};mockGet.mockResolvedValue(group);mockDocs.mockResolvedValue({docs:[{id:'r',data:()=>({scoreA:1,scoreB:0})}]});});
it('gates access before reads and again after async reads',async()=>{
 mockGet.mockResolvedValue({...group,adminIds:[]});await expect(loadManagerClubResults(group,games,'admin',now)).rejects.toThrow('manager-access-revoked');expect(mockDocs).not.toHaveBeenCalled();
 mockGet.mockResolvedValueOnce(group).mockResolvedValueOnce({...group,adminIds:[]});await expect(loadManagerClubResults(group,games,'admin',now)).rejects.toThrow('manager-access-revoked');
});
it('reads at most ten completed club rounds and preserves failures and missing scores',async()=>{
 mockDocs.mockImplementation(async(id:string)=>{if(id==='g0')throw Error('offline');return {docs:[{id:'r',data:()=>({scoreB:0})}]};});
 const result=await loadManagerClubResults(group,games,'admin',now);expect(mockDocs).toHaveBeenCalledTimes(10);expect(result.g0.unavailable).toBe(true);expect(result.g1.rows[0].scoreA).toBeNaN();
});
it('rejects identity changes instead of publishing a previous account snapshot',async()=>{
 mockDocs.mockImplementation(async()=>{mockAuth.currentUser={uid:'other'};return {docs:[]};});
 await expect(loadManagerClubResults(group,games,'admin',now)).rejects.toThrow('manager-session-changed');
});
it('marks capped reads as truncated',async()=>{
 mockDocs.mockResolvedValue({docs:Array.from({length:501},(_,i)=>({id:'r'+i,data:()=>({scoreA:0,scoreB:0})}))});
 const result=await loadManagerClubResults(group,games,'admin',now);expect(result.g0.rows).toHaveLength(500);expect(result.g0.truncated).toBe(true);
});

function resultRequest() {
 let resolve!:(value:{docs:any[]})=>void,reject!:(reason:unknown)=>void;
 const promise=new Promise<{docs:any[]}>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
const flushResults=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
it('keeps four result reads active while preserving failed rounds and the ten-round limit',async()=>{
 const requests=Array.from({length:10},resultRequest);
 mockDocs.mockImplementation((id:string)=>requests[Number(id.slice(1))].promise);
 const pending=loadManagerClubResults(group,games,'admin',now);
 await flushResults();expect(mockDocs.mock.calls.map(([id])=>id)).toEqual(['g0','g1','g2','g3']);
 requests[3].resolve({docs:[]});await flushResults();expect(mockDocs).toHaveBeenCalledTimes(5);
 requests[4].reject(Error('offline'));await flushResults();expect(mockDocs).toHaveBeenCalledTimes(6);
 for(let i=5;i<10;i++){requests[i].resolve({docs:[]});await flushResults();}
 expect(mockDocs).toHaveBeenCalledTimes(10);
 requests.slice(0,3).forEach(request=>request.resolve({docs:[{id:'r',data:()=>({scoreA:2,scoreB:1})}]}));
 const results=await pending;
 expect(results.g4).toEqual({rows:[],unavailable:true,truncated:false});
 expect(results.g0.rows).toEqual([{id:'r',scoreA:2,scoreB:1}]);
 expect(Object.keys(results)).toHaveLength(10);expect(mockGet).toHaveBeenCalledTimes(2);
});
it('stops queued result reads after an account switch',async()=>{
 const requests=Array.from({length:4},resultRequest);
 mockDocs.mockImplementation((id:string)=>requests[Number(id.slice(1))].promise);
 const pending=loadManagerClubResults(group,games,'admin',now);
 const rejected=expect(pending).rejects.toThrow('manager-session-changed');
 await flushResults();expect(mockDocs).toHaveBeenCalledTimes(4);
 mockAuth.currentUser={uid:'other'};
 requests.forEach(request=>request.resolve({docs:[]}));
 await rejected;expect(mockDocs).toHaveBeenCalledTimes(4);
});

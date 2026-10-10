const mockGroupGet=jest.fn();
const mockUsers=jest.fn();
const mockDocs=jest.fn();
const mockScores=jest.fn();
const mockQuery=jest.fn((c:unknown,..._constraints:unknown[])=>c);
const mockAuth={currentUser:{uid:'admin'} as {uid:string}|null};
jest.mock('../src/services/groupService',()=>({groupService:{get:(...a:unknown[])=>mockGroupGet(...a),hydrateUsers:(...a:unknown[])=>mockUsers(...a)}}));
jest.mock('../src/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({auth:mockAuth,db:{},functions:{}})}));
jest.mock('../src/firebase/firestore',()=>({col:{games:()=> 'games'},docs:{group:()=> 'group'}}));
jest.mock('../src/firebase/authRace',()=>({withAuthRaceRetry:(fn:()=>unknown)=>fn()}));
jest.mock('firebase/firestore',()=>({getDocs:(...a:unknown[])=>mockDocs(...a),query:(c:unknown,...args:unknown[])=>mockQuery(c,...args),where:(...a:unknown[])=>['where',...a],orderBy:(...a:unknown[])=>['orderBy',...a],limit:(n:number)=>['limit',n],collection:(_:unknown,c:string)=>c,onSnapshot:jest.fn()}));
jest.mock('firebase/functions',()=>({httpsCallable:()=>async()=>({data:{sentAt:{a:123}}})}));
jest.mock('../src/services/gameEveningScores',()=>({getGameEveningScores:(...a:unknown[])=>mockScores(...a)}));
jest.mock('../src/data/mockData',()=>({mockGamesV2:[]}));
import {loadManagerDashboard,managerLoadErrorMessage} from '../src/services/managerDashboardService';
const group={id:'g',adminIds:['admin'],playerIds:['a'],internalRating:true};
beforeEach(()=>{
 jest.clearAllMocks();mockAuth.currentUser={uid:'admin'};
 mockGroupGet.mockResolvedValue(group);mockUsers.mockResolvedValue([{id:'a',name:'א'}]);mockScores.mockResolvedValue({a:8});
 mockDocs.mockImplementation(async(collection:string)=>({docs:collection==='games'?[{data:()=>({id:'past',groupId:'g',status:'finished',startsAt:Date.now()-86400000,players:['a'],waitlist:[]})},{data:()=>({id:'next',groupId:'g',status:'open',startsAt:Date.now()+86400000,players:[],waitlist:[]})}]:[]}));
});
it('gates non-admins before querying histories, users, equipment or scores',async()=>{
 await expect(loadManagerDashboard('g','a')).rejects.toThrow('manager-access-denied');
 expect(mockDocs).not.toHaveBeenCalled();expect(mockUsers).not.toHaveBeenCalled();expect(mockScores).not.toHaveBeenCalled();
});
it('uses the existing club history index and preserves newest-first server results',async()=>{
 const result=await loadManagerDashboard('g','admin');
 expect(mockQuery).toHaveBeenCalledWith('games',['where','groupId','==','g'],
   ['where','status','in',['scheduled','open','locked','active','finished','cancelled']],
   ['orderBy','startsAt','desc'],['limit',201]);
 expect(result.games.map(g=>g.id)).toEqual(['past','next']);
});
it('does not blame manager permissions for index or network failures',()=>{
 expect(managerLoadErrorMessage(new Error('The query requires an index'))).not.toContain('הרשאת');
 expect(managerLoadErrorMessage(new Error('manager-access-denied'))).toContain('למנהלי');
 expect(managerLoadErrorMessage(new Error('manager-session-changed'))).toContain('החשבון');
});
it('throws history failures rather than presenting empty success',async()=>{
 mockDocs.mockImplementation(async(c:string)=>{if(c==='games')throw new Error('offline');return {docs:[]};});
 await expect(loadManagerDashboard('g','admin')).rejects.toThrow('offline');
});
it('marks unavailable equipment instead of interpreting failure as zero activity',async()=>{
 const original=mockDocs.getMockImplementation()!;
 mockDocs.mockImplementation((c:string)=>c==='communityPlayerEvents'?Promise.reject(new Error('offline')):original(c));
 expect((await loadManagerDashboard('g','admin')).equipmentUnavailable).toBe(true);
});
it('marks incomplete scores so the screen withholds recommendations',async()=>{
 mockScores.mockRejectedValue(new Error('offline'));
 const result=await loadManagerDashboard('g','admin');
 expect(result.scoresIncomplete).toBe(true);expect(result.scores).toEqual({});
});
it('fetches available sealed scores even when internal ratings are off',async()=>{
 mockGroupGet.mockResolvedValue({...group,internalRating:false});
 const data=await loadManagerDashboard('g','admin');expect(mockScores).toHaveBeenCalledWith('past');expect(data.scores.past).toEqual({a:8});
});
it('does not drop older scores after the twentieth completed round and preserves successes after a failed read',async()=>{
 mockDocs.mockImplementation(async(c:string)=>({docs:c==='games'?Array.from({length:21},(_,i)=>({data:()=>({id:'past-'+i,groupId:'g',status:'finished',startsAt:Date.now()-(i+1)*86400000,players:['a'],waitlist:[]})})):[]}));
 mockScores.mockImplementation(async(id:string)=>{if(id==='past-1')throw Error('offline');return {a:7};});
 const data=await loadManagerDashboard('g','admin');
 expect(mockScores).toHaveBeenCalledTimes(21);expect(data.scoresIncomplete).toBe(true);expect(data.scores['past-20']).toEqual({a:7});expect(Object.keys(data.scores)).toHaveLength(20);
});
it('rejects an account change while data loads',async()=>{
 mockScores.mockImplementation(async()=>{mockAuth.currentUser={uid:'other'};return {a:8};});
 await expect(loadManagerDashboard('g','admin')).rejects.toThrow('manager-session-changed');
});
it('rechecks admin membership after asynchronous reads',async()=>{
 mockGroupGet.mockResolvedValueOnce(group).mockResolvedValueOnce({...group,adminIds:[]});
 await expect(loadManagerDashboard('g','admin')).rejects.toThrow('manager-access-revoked');
});


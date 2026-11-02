const mockClubGet=jest.fn(),mockGetAll=jest.fn(),mockTxGet=jest.fn();
const mockTx={get:(ref:any)=>mockTxGet(ref),set:jest.fn(),create:jest.fn()};
function mockRef(kind:string,id:string):any{return{kind,id,get:()=>mockClubGet(),collection:(name:string)=>({doc:(key:string)=>mockRef(name,key)})}}
const mockDb={doc:(path:string)=>{const [kind,id]=path.split('/');return mockRef(kind,id)},collection:(kind:string)=>({doc:(id:string)=>mockRef(kind,id)}),getAll:(...refs:any[])=>mockGetAll(...refs),runTransaction:(fn:any)=>fn(mockTx)};
jest.mock('firebase-admin/firestore',()=>({getFirestore:()=>mockDb}),{virtual:true});
jest.mock('../functions/src/observedFunctions',()=>({onCall:(_:unknown,handler:unknown)=>handler,onDocumentWritten:(_:unknown,handler:unknown)=>handler,HttpsError:class extends Error{constructor(public code:string,message:string){super(message)}}}));
import {getManagerRoundHistory,onManagerRoundChanged} from '../functions/src/managerRoundHistory';
const call=getManagerRoundHistory as unknown as (r:any)=>Promise<any>,trigger=onManagerRoundChanged as unknown as (r:any)=>Promise<any>;
beforeEach(()=>{jest.clearAllMocks();mockClubGet.mockResolvedValue({data:()=>({adminIds:['admin']})});mockGetAll.mockImplementation(async(...refs:any[])=>refs.map(ref=>({id:ref.id,data:()=>ref.kind==='games'?{groupId:'club',startsAt:100}:{schema:1,groupId:'club',startsAt:100}})));mockTxGet.mockResolvedValue({exists:false})});
it.each([{}, {auth:{uid:'guest',token:{firebase:{sign_in_provider:'anonymous'}}}}])('denies unauthenticated or anonymous requests before reads',async auth=>{
 await expect(call({...auth,data:{groupId:'club',gameIds:['g']}})).rejects.toMatchObject({code:'unauthenticated'});expect(mockClubGet).not.toHaveBeenCalled();expect(mockGetAll).not.toHaveBeenCalled();
});
it('gates a non-manager before metrics reads',async()=>{
 mockClubGet.mockResolvedValue({data:()=>({adminIds:[]})});
 await expect(call({auth:{uid:'other'},data:{groupId:'club',gameIds:['g']}})).rejects.toMatchObject({code:'permission-denied'});expect(mockGetAll).not.toHaveBeenCalled();
});
it('checks canonical games and rechecks management after reading metrics',async()=>{
 mockGetAll.mockImplementation(async(...refs:any[])=>refs.map(ref=>({id:ref.id,data:()=>ref.kind==='games'?{groupId:'foreign',startsAt:100}:{schema:1,groupId:'club',startsAt:100}})));
 expect((await call({auth:{uid:'admin'},data:{groupId:'club',gameIds:['g']}})).rows).toEqual([]);expect(mockClubGet).toHaveBeenCalledTimes(2);
 mockClubGet.mockResolvedValueOnce({data:()=>({adminIds:['admin']})}).mockResolvedValueOnce({data:()=>({adminIds:[]})});
 await expect(call({auth:{uid:'admin'},data:{groupId:'club',gameIds:['g']}})).rejects.toMatchObject({code:'permission-denied'});
});
it('rejects invalid IDs and oversized histories before access',async()=>{
 for(const gameIds of [['bad/path'],Array(201).fill('g')])await expect(call({auth:{uid:'admin'},data:{groupId:'club',gameIds}})).rejects.toMatchObject({code:'invalid-argument'});
 expect(mockClubGet).not.toHaveBeenCalled();
});
it('makes trigger redelivery idempotent with a transactional event receipt',async()=>{
 const event={id:'event-1',params:{gameId:'g'},data:{before:{exists:false},after:{exists:true,id:'g',updateTime:{toMillis:()=>1000},data:()=>({groupId:'club',startsAt:100000,createdAt:1000,players:[],waitlist:[],maxPlayers:2})}}};
 mockTxGet.mockImplementation(async(ref:any)=>({exists:ref.kind==='events'||ref.kind==='games',data:()=>undefined}));
 await trigger(event);expect(mockTx.create).not.toHaveBeenCalled();expect(mockTx.set).not.toHaveBeenCalled();
 mockTxGet.mockImplementation(async(ref:any)=>({exists:ref.kind==='games',data:()=>undefined}));await trigger(event);expect(mockTx.set).toHaveBeenCalledTimes(1);expect(mockTx.create).toHaveBeenCalledTimes(1);
});

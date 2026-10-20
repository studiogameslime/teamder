jest.mock('../../pulse/src/config',()=>({config:{firebase:{projectId:'test'}}}));
jest.mock('../../pulse/src/capabilities',()=>({has:{firebase:()=>true}}));
jest.mock('../../pulse/src/services/cache',()=>({cached:(_k:string,fn:()=>unknown)=>fn(),invalidate:jest.fn()}));
jest.mock('../../pulse/src/services/auth',()=>({googleAccessToken:jest.fn().mockResolvedValue('fixture')}));
jest.mock('../../pulse/src/services/adminTransport',()=>({pulseFetch:jest.fn()}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({getDoc:jest.fn(),queryEquals:jest.fn(),queryArrayContains:jest.fn(),listAll:jest.fn()}));
import { getDoc,queryEquals,queryArrayContains,listAll } from '../../pulse/src/services/firestoreRest';
import { fetchUserActivity } from '../../pulse/src/services/firebase';
import { fetchUserRecords,userRecord,USER_SOURCES } from '../../pulse/src/services/userDetails';
import { mapAuthRecord,fetchUserAuthRecord } from '../../pulse/src/services/userAuth';
import { pulseFetch } from '../../pulse/src/services/adminTransport';
beforeEach(()=>{jest.clearAllMocks();(getDoc as jest.Mock).mockImplementation(async(path:string)=>path==='users/person'?{id:'person',name:'שחקן',createdAt:10,lastSeenAt:20,availability:{homeCity:'חיפה'},friends:['friend'],stats:{assists:4},futureField:{value:5},fcmTokens:['do-not-expose']}:null);(queryEquals as jest.Mock).mockResolvedValue([]);(queryArrayContains as jest.Mock).mockResolvedValue([])});
test('single card preserves stored fields and reuses targeted relation reads without any full collection scan',async()=>{
 (queryArrayContains as jest.Mock).mockImplementation(async(c:string)=>c==='games'?[{id:'round',title:'מחזור',createdBy:'person',startsAt:30}]:[{id:'club',name:'מועדון',adminIds:['person']}]);
 (queryEquals as jest.Mock).mockImplementation(async(c:string)=>c==='feedback'?[{id:'report',message:'דיווח',userId:'person',status:'new'}]:[]);
 const result=await fetchUserActivity('person');
 expect(result.record).toMatchObject({lastSeenAt:20,stats:{assists:4},futureField:{value:5},fcmTokens:'מוסתר'});
 expect(result.related?.games).toHaveLength(1);expect(result.related?.groups).toHaveLength(1);
 expect(result.related?.reports[0]).toMatchObject({id:'report',message:'דיווח'});
 expect(listAll).not.toHaveBeenCalled();expect(getDoc).toHaveBeenCalledTimes(2);
 const feedbackCall=(queryEquals as jest.Mock).mock.calls.find(c=>c[0]==='feedback');expect(feedbackCall?.[4]).not.toContain('image');
});
test('failed relation is explicitly reported, a missing user rejects, and capped results remain qualified',async()=>{
 (queryEquals as jest.Mock).mockRejectedValue(new Error('offline'));
 (queryArrayContains as jest.Mock).mockResolvedValue(Array.from({length:200},(_,i)=>({id:String(i)})));
 const result=await fetchUserActivity('person');expect(result.failedSources).toContain('דיווחים');expect(result.limitedSources).toContain('מחזורים');
 (getDoc as jest.Mock).mockResolvedValue(null);await expect(fetchUserActivity('missing')).rejects.toThrow('PULSE_USER_NOT_FOUND');
});
test.each(Object.entries(USER_SOURCES))('related source %s is bounded and scoped to the current user',async(key,spec)=>{
 await fetchUserRecords('person',key as keyof typeof USER_SOURCES);
 expect(queryEquals).toHaveBeenCalledWith(spec.collection,spec.field,'person',100);expect(listAll).not.toHaveBeenCalled();
});
test('inspector removes credentials including token-keyed device maps, while preserving useful metadata',()=>{
 const result=userRecord({fcmTokens:['secret-value'],devices:{'secret-map-key':{appVersion:'1.2',accessToken:'secret-value'}},nested:{passwordHash:'secret-value'},image:'secret-image',custom:{field:42}});
 expect(JSON.stringify(result)).not.toContain('secret-value');expect(JSON.stringify(result)).not.toContain('secret-map-key');expect(JSON.stringify(result)).not.toContain('secret-image');expect(result).toMatchObject({custom:{field:42},devices:[{appVersion:'1.2'}]});
});
test('authentication metadata allowlist never exposes hash or salt and requires successful pagination',async()=>{
 const raw={localId:'person',email:'x@example.com',emailVerified:true,disabled:false,passwordHash:'secret-hash',salt:'secret-salt',lastLoginAt:'123',providerUserInfo:[{providerId:'google.com',rawId:'provider-id',accessToken:'secret-token'}]};
 const record=mapAuthRecord(raw);expect(record).toMatchObject({id:'person',emailVerified:true,lastLoginAt:123});expect(JSON.stringify(record)).not.toContain('secret-');
 (pulseFetch as jest.Mock).mockResolvedValueOnce({ok:true,json:async()=>({users:[raw],nextPageToken:'next'})}).mockResolvedValueOnce({ok:false,status:503});
 await expect(fetchUserAuthRecord('person')).rejects.toThrow('PULSE_AUTH_503');expect(listAll).not.toHaveBeenCalled();
});

test('created rounds and clubs remain visible even if the creator is not a participant or admin',async()=>{
 (queryEquals as jest.Mock).mockImplementation(async(collection:string,field:string)=>collection==='games' && field==='createdBy'?[{id:'created-round',createdBy:'person'}]:collection==='groups' && field==='creatorId'?[{id:'created-club',creatorId:'person'}]:[]);
 const result=await fetchUserActivity('person');expect(result.related?.games[0]).toMatchObject({id:'created-round',role:'יוצר'});expect(result.related?.groups[0]).toMatchObject({id:'created-club',role:'יוצר'});
});

jest.mock('../../pulse/src/config',()=>({config:{firebase:{projectId:'test'}}}));
jest.mock('../../pulse/src/services/auth',()=>({googleAccessToken:jest.fn().mockResolvedValue('fixture')}));
jest.mock('../../pulse/src/services/adminTransport',()=>({pulseFetch:jest.fn()}));
jest.mock('../../pulse/src/services/readMeter',()=>({recordRead:jest.fn()}));
import {pulseFetch} from '../../pulse/src/services/adminTransport';
import {queryDocumentPage,getDoc} from '../../pulse/src/services/firestoreRest';
const doc=(id:string,at=100)=>({document:{name:`projects/test/databases/(default)/documents/users/${id}`,fields:{name:{stringValue:id},lastSeenAt:{integerValue:String(at)}}}});
beforeEach(()=>jest.clearAllMocks());
test('server paging reads twenty and uses both activity and id at timestamp ties',async()=>{
 (pulseFetch as jest.Mock).mockResolvedValueOnce({ok:true,json:async()=>Array.from({length:20},(_,i)=>doc(String(i).padStart(2,'0')))}).mockResolvedValueOnce({ok:true,json:async()=>[doc('next',99)]});
 const first=await queryDocumentPage('users',{orderField:'lastSeenAt',limit:20,fields:['name','lastSeenAt']});
 expect(first.rows).toHaveLength(20);expect((pulseFetch as jest.Mock).mock.calls).toHaveLength(1);
 const second=await queryDocumentPage('users',{orderField:'lastSeenAt',limit:20,cursor:first.next});expect(second.rows[0].id).toBe('next');expect(second.next).toBeUndefined();
 const query=JSON.parse((pulseFetch as jest.Mock).mock.calls[1][1].body).structuredQuery;
 expect(query.limit).toBe(20);expect(query.orderBy).toEqual([{field:{fieldPath:'lastSeenAt'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}]);
 expect(query.startAt).toEqual({before:false,values:[{integerValue:'100'},{referenceValue:doc('19').document.name}]});
});
test('a rejected query rejects rather than claiming an empty final page',async()=>{
 (pulseFetch as jest.Mock).mockResolvedValue({ok:false,status:503});await expect(queryDocumentPage('users',{orderField:'lastSeenAt'})).rejects.toThrow('503');
});
test('single player lookups request only projected fields, not push tokens',async()=>{
 (pulseFetch as jest.Mock).mockResolvedValue({ok:true,status:200,json:async()=>doc('person').document});await getDoc('users/person',['name','discipline']);
 const url=(pulseFetch as jest.Mock).mock.calls[0][0];expect(url).toContain('mask.fieldPaths=name');expect(url).toContain('mask.fieldPaths=discipline');
});
test('a child history query is bounded to the chosen game and uses root runQuery',async()=>{
 const {queryChildDocuments}=await import('../../pulse/src/services/firestoreRest');
 const prefix='projects/test/databases/(default)/documents/games/game1/roundHistory/';
 (pulseFetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>[{document:{name:prefix+'round-1',fields:{scoreA:{integerValue:'2'}}}},{document:{name:'projects/test/databases/(default)/documents/games/other/roundHistory/round-1',fields:{}}}]});
 const rows=await queryChildDocuments('games/game1','roundHistory',500);expect(rows).toEqual([{id:'round-1',scoreA:2}]);
 const [url,request]=(pulseFetch as jest.Mock).mock.calls[0];expect(url).toMatch(/documents:runQuery$/);
 const query=JSON.parse(request.body).structuredQuery;expect(query.from).toEqual([{collectionId:'roundHistory',allDescendants:true}]);expect(query.limit).toBe(500);expect(query.where.compositeFilter.filters[0].fieldFilter.value.referenceValue).toContain('/games/game1');
});

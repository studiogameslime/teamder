jest.mock('../../pulse/src/services/cache',()=>({cached:(_key:string,fn:()=>unknown)=>fn()}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({queryDocumentPage:jest.fn()}));
jest.mock('../../pulse/src/services/firebase',()=>({mapUser:(d:any)=>({...d,isTest:d.name==='test',deleted:d.name==='deleted'}),fetchUsersWithAuth:jest.fn()}));
import {queryDocumentPage} from '../../pulse/src/services/firestoreRest';
import {fetchUsersWithAuth} from '../../pulse/src/services/firebase';
import {fetchUserPage} from '../../pulse/src/services/userPages';
beforeEach(()=>jest.clearAllMocks());
test('opening a page does not load all auth/users, and retains the physical cursor after hidden accounts',async()=>{
 const next={values:[{integerValue:'100'}]};(queryDocumentPage as jest.Mock).mockResolvedValue({rows:[{id:'a',name:'player',lastSeenAt:100},{id:'b',name:'test'}],next});
 const page=await fetchUserPage();expect(page.rows).toHaveLength(1);expect(page.next).toBe(next);expect(page.rows[0].lastActiveAt).toBe(100);expect(fetchUsersWithAuth).not.toHaveBeenCalled();expect(queryDocumentPage).toHaveBeenCalledWith('users',expect.objectContaining({orderField:'lastSeenAt',limit:20}));
});
test('prefix search is bounded and executed on the server',async()=>{
 (queryDocumentPage as jest.Mock).mockResolvedValue({rows:[]});await fetchUserPage({search:'daniel@'});
 expect(queryDocumentPage).toHaveBeenCalledWith('users',expect.objectContaining({orderField:'email',limit:20,where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'email'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:'daniel@'}}},{fieldFilter:{field:{fieldPath:'email'},op:'LESS_THAN_OR_EQUAL',value:{stringValue:'daniel@\uf8ff'}}}]}}}));
});

test('explicit all-account browsing includes legacy, test and deleted accounts without scanning',async()=>{
 (queryDocumentPage as jest.Mock).mockResolvedValue({rows:[{id:'a',name:'test'},{id:'b',name:'deleted'}]});
 const result=await fetchUserPage({legacy:true});expect(result.rows).toHaveLength(2);expect(queryDocumentPage).toHaveBeenCalledWith('users',expect.objectContaining({orderField:'__name__',limit:20}));
});

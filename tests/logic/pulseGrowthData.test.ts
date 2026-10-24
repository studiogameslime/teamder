jest.mock('../../pulse/src/services/cache',()=>({cached:(_key:string,fn:()=>unknown)=>fn()}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({getDoc:jest.fn(),listAll:jest.fn(),queryDocumentPage:jest.fn(),queryEquals:jest.fn()}));
jest.mock('../../pulse/src/services/errorObservation',()=>({observeSettledErrors:(results:unknown)=>results}));
import {fetchGrowthData,fetchGrowthJourney,GROWTH_LIMIT,GROWTH_USER_FIELDS} from '../../pulse/src/services/growthData';
import {listAll,queryDocumentPage,queryEquals} from '../../pulse/src/services/firestoreRest';
beforeEach(()=>jest.clearAllMocks());
test('the overview reads three bounded, projected sources and never fetches journey events or pictures for each person',async()=>{
 (queryDocumentPage as jest.Mock).mockResolvedValue({rows:[{id:'person'}],next:{values:[]}});(listAll as jest.Mock).mockResolvedValue([]);
 const result=await fetchGrowthData();
 expect(queryDocumentPage).toHaveBeenCalledWith('users',expect.objectContaining({orderField:'createdAt',limit:100,fields:GROWTH_USER_FIELDS}));
 expect(listAll).toHaveBeenCalledTimes(2);expect(listAll).toHaveBeenCalledWith('groups',GROWTH_LIMIT,expect.any(Array));expect(queryEquals).not.toHaveBeenCalled();
 expect(result.users?.limited).toBe(true);expect(result.failed).toEqual([]);
 for(const call of (listAll as jest.Mock).mock.calls)expect(call[2].some((name:string)=>/image|photo|token|password|^notes$/.test(name))).toBe(false);
});
test('one source failure is explicit while the other sources remain available',async()=>{
 (queryDocumentPage as jest.Mock).mockResolvedValue({rows:[]});(listAll as jest.Mock).mockImplementation(async(name:string)=>{if(name==='games')throw new Error('offline');return [{id:'group'}]});
 const result=await fetchGrowthData();expect(result.failed).toEqual(['games']);expect(result.games).toBeNull();expect(result.groups?.rows).toEqual([{id:'group'}]);
});
test('journey reads are lazy, limited and keyed to the exact account',async()=>{
 (queryEquals as jest.Mock).mockResolvedValue([]);await fetchGrowthJourney('original-id');
 expect(queryEquals).toHaveBeenCalledWith('onboardingActivity','uid','original-id',2000,expect.arrayContaining(['uid','sessionId','occurredAt']));
});

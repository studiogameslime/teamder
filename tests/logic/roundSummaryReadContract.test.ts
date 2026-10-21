const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockOnSnapshot = jest.fn();
jest.mock('firebase/firestore', () => ({ doc: (...args: any[]) => args, collection:(...args:any[])=>args, query:(...args:any[])=>args, where:(...args:any[])=>args, limit:(n:number)=>['limit',n], onSnapshot:(...args:any[])=>mockOnSnapshot(...args), getDocs:(...args:any[])=>mockGetDocs(...args), getDoc: (...args: any[]) => mockGetDoc(...args) }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: 'db' }) }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn(), isExpectedDenial: (error: any) => error.code === 'permission-denied' }));
jest.mock('@/data/mockRoundSummary', () => ({ mockRoundSummary: jest.fn(), mockEveningStats: jest.fn() }));
import { roundSummaryService } from '@/services/roundSummaryService';
import { logError } from '@/services/errorLog';

beforeEach(() => { jest.clearAllMocks(); });

test('a club-scoped absent summary is a successful empty query and does not read a nonexistent document',async()=>{
  mockGetDocs.mockResolvedValueOnce({empty:true,docs:[]});
  await expect(roundSummaryService.get('not-sealed','club')).resolves.toBeNull();
  expect(mockGetDoc).not.toHaveBeenCalled();
  expect(mockGetDocs).toHaveBeenCalledWith([['db','roundSummaries'],['groupId','==','club'],['gameId','==','not-sealed'],['limit',1]]);
});
test('a failed club-scoped query remains a failure',async()=>{
  const error=Object.assign(Error('offline'),{code:'unavailable'});mockGetDocs.mockRejectedValueOnce(error);
  await expect(roundSummaryService.get('g','club')).rejects.toBe(error);
});
test('an empty offline cache is not proof that an evening has no summary',async()=>{
 mockGetDocs.mockResolvedValueOnce({empty:true,docs:[],metadata:{fromCache:true}});
 await expect(roundSummaryService.get('g','club')).rejects.toMatchObject({code:'unavailable'});
});
test('a missing-summary watch ignores empty cache snapshots and accepts the later server seal',()=>{
 const accept=jest.fn(),fail=jest.fn(),unsubscribe=jest.fn();mockOnSnapshot.mockReturnValueOnce(unsubscribe);
 expect(roundSummaryService.watch('g','club',accept,fail)).toBe(unsubscribe);
 const callback=mockOnSnapshot.mock.calls[0][1];
 callback({empty:true,metadata:{fromCache:true}});expect(accept).not.toHaveBeenCalled();
 callback({empty:true,metadata:{fromCache:false}});expect(accept).toHaveBeenLastCalledWith(null);
 callback({empty:false,metadata:{fromCache:false},docs:[{data:()=>({gameId:'g',groupId:'club',stats:{goals:2}})}]});
 expect(accept).toHaveBeenLastCalledWith(expect.objectContaining({gameId:'g',stats:{goals:2},events:[]}));
 const error = new Error('listener unavailable');
 mockOnSnapshot.mock.calls[0][2](error);
 expect(fail).toHaveBeenCalledTimes(1);expect(fail).toHaveBeenCalledWith(error);
});

test('existing summary preserves totals, coverage and identities while normalising optional arrays', async () => {
  const data = { gameId: 'owned-evening', groupId: 'club', stats: { goals: 3, assists: 2, rounds: 2 }, coverage: { hasRoundHistory: true }, pairHighlight: { userIds: ['one', 'two'] } };
  mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => data });
  const result = await roundSummaryService.get('owned-evening');
  expect(mockGetDoc).toHaveBeenCalledWith(['db', 'roundSummaries', 'owned-evening']);
  expect(result).toMatchObject({ ...data, events: [], leaders: {}, teamHighlights: { best: [], worst: [] }, pairHighlight: { ...data.pairHighlight, breakdown: [] } });
});

test('a successfully absent document alone yields null', async () => {
  mockGetDoc.mockResolvedValueOnce({ exists: () => false });
  await expect(roundSummaryService.get('missing')).resolves.toBeNull(); expect(logError).not.toHaveBeenCalled();
});

test.each(['unavailable', 'permission-denied'])('a %s read throws the original failure rather than claiming missing data', async code => {
  const error = Object.assign(Error('failed read'), { code }); mockGetDoc.mockRejectedValueOnce(error);
  await expect(roundSummaryService.get('owned-evening')).rejects.toBe(error);
  expect(logError).toHaveBeenCalledTimes(code === 'permission-denied' ? 0 : 1);
});

test('an empty id does not make an SDK request', async () => {
  await expect(roundSummaryService.get('')).resolves.toBeNull(); expect(mockGetDoc).not.toHaveBeenCalled();
});

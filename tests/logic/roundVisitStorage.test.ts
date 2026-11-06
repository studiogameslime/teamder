jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn()}));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readRoundVisit, saveRoundVisit } from '@/services/roundVisitService';
import { roundVisit } from '@/utils/roundVisit';
const memory=new Map<string,string>();
beforeEach(()=>{jest.clearAllMocks();memory.clear();jest.mocked(AsyncStorage.getItem).mockImplementation(async key=>memory.get(key)??null);jest.mocked(AsyncStorage.setItem).mockImplementation(async(key,value)=>{memory.set(key,value);});});
const facts=roundVisit({startsAt:100,fieldName:'מגרש',fieldAddress:'כתובת',city:'עיר',fieldLat:1,fieldLng:2});
test('local history is isolated by account and round and never stores a roster or profile',async()=>{
  await saveRoundVisit('one','a',facts);expect(await readRoundVisit('one','a')).toEqual(facts);expect(await readRoundVisit('two','a')).toBeNull();expect(await readRoundVisit('one','b')).toBeNull();
  expect(Object.keys(JSON.parse([...memory.values()][0]).a).sort()).toEqual(['startsAt','fieldName','fieldAddress','city','lat','lng'].sort());
});
test('concurrent acknowledgements retain both rounds and bound memory to the latest sixty visits',async()=>{
  await Promise.all(Array.from({length:65},(_,i)=>saveRoundVisit('one',`r${i}`,facts)));
  expect(await readRoundVisit('one','r4')).toBeNull();expect(await readRoundVisit('one','r5')).toEqual(facts);expect(await readRoundVisit('one','r64')).toEqual(facts);
  expect(Object.keys(JSON.parse([...memory.values()][0]))).toHaveLength(60);
});
test('corrupt or unavailable local memory suppresses change claims and does not block later saves',async()=>{
  memory.set('footy.roundVisits.v1.one','not json');expect(await readRoundVisit('one','a')).toBeNull();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(Error('disk'));await expect(saveRoundVisit('one','a',facts)).rejects.toThrow('disk');
  await saveRoundVisit('one','b',facts);expect(await readRoundVisit('one','b')).toEqual(facts);
});

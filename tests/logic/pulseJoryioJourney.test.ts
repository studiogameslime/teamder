jest.mock('../../pulse/src/services/cache',()=>({cached:(_key:string,load:()=>unknown)=>load()}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({getDoc:jest.fn()}));
import { parseJourneySnapshot, journeyReach, fetchJourneySnapshot } from '../../pulse/src/services/joryioJourneys';
import { getDoc } from '../../pulse/src/services/firestoreRest';
const valid=()=>({schemaVersion:1,source:'https://api-eu1.joryio.com/api',journeyId:'j1',name:'מסע',status:'draft',syncedAt:1000,syncMode:'manual',range:'all_time',entries:0,steps:[{id:'a',label:'הודעה',type:'in_app_message',entered:0,proceeded:0}]});
test('zero entries are known, while unavailable delivery metrics stay unknown',()=>{
 const data=parseJourneySnapshot(valid());expect(data.entries).toBe(0);expect(data.steps[0].entered).toBe(0);expect(data.steps[0].displayed).toBeNull();
 expect(journeyReach(0,0)).toBe('אין מכנה לחישוב');expect(journeyReach(5,10)).toBe('50% מהכניסות למסע');
});
test.each([null,{...valid(),source:'https://hippomation-backend.fly.dev/api'},{...valid(),syncedAt:0},{...valid(),steps:[...valid().steps,...valid().steps]}])('rejects absent, non-production, undated and duplicate data',raw=>expect(()=>parseJourneySnapshot(raw)).toThrow());
test('invalid counters cannot masquerade as zero',()=>{
 const data=parseJourneySnapshot({...valid(),entries:'10',steps:[{...valid().steps[0],entered:-1,displayed:Infinity,clicked:true}]});
 expect(data.entries).toBeNull();expect(data.steps[0].entered).toBeNull();expect(data.steps[0].displayed).toBeNull();expect(data.steps[0].clicked).toBeNull();
});
test('missing snapshot propagates an explicit error',async()=>{
 (getDoc as jest.Mock).mockResolvedValue(null);await expect(fetchJourneySnapshot()).rejects.toThrow();
});

import { dmDay, dmStatus, validateDmText, type DmRequest } from '../../functions/src/dmPolicy';
const r:DmRequest={from:'a',to:'b',text:'שלום',status:'pending',messageId:'m',createdAt:1};
const options={blocked:false,friends:false,approved:false,accepts:true,request:r};
test('private decline is indistinguishable from pending for sender, including closed privacy',()=>{
  expect(dmStatus('a',options)).toBe('waiting');
  expect(dmStatus('a',{...options,accepts:false,request:{...r,status:'declined'}})).toBe('waiting');
  expect(dmStatus('b',{...options,request:{...r,status:'declined'}})).toBe('declined');
});
test('block always wins; approval and friendship override closed privacy or historical request',()=>{
  expect(dmStatus('a',{...options,blocked:true,approved:true,friends:true})).toBe('unavailable');
  expect(dmStatus('a',{...options,accepts:false,approved:true})).toBe('open');
  expect(dmStatus('a',{...options,accepts:false,friends:true,request:{...r,status:'cancelled'}})).toBe('open');
});
test('cancelled sender cannot resend; former recipient can initiate under current privacy',()=>{
  expect(dmStatus('a',{...options,request:{...r,status:'cancelled'}})).toBe('cancelled');
  expect(dmStatus('b',{...options,request:{...r,status:'cancelled'}})).toBe('compose');
  expect(dmStatus('b',{...options,accepts:false,request:{...r,status:'cancelled'}})).toBe('unavailable');
});
test.each([
  ['2026-11-02T21:59:59.999Z','2026-11-02'],['2026-11-02T22:00:00Z','2026-11-03'],
  ['2026-07-01T20:59:59Z','2026-07-01'],['2026-07-01T21:00:00Z','2026-07-02'],
  ['2026-03-27T00:30:00Z','2026-03-27'],['2026-10-24T23:30:00Z','2026-10-25'],
])('calendar day uses Israeli timezone including daylight transitions %s',(time,day)=>expect(dmDay(Date.parse(time))).toBe(day));
test('text is bounded before trimming and rejects empty input',()=>{
  expect(validateDmText(' א ')).toBe('א');expect(validateDmText('א'.repeat(1000))).toHaveLength(1000);
  for(const value of ['א'.repeat(1001),' ',null,{}])expect(()=>validateDmText(value)).toThrow('INVALID_DM_TEXT');
});

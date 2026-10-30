import {measureRoundChange, type MeasuredRound} from '../../functions/src/managerRoundMeasurement';
const initial:MeasuredRound={groupId:'club',startsAt:100000000,createdAt:1000000,registrationOpensAt:2000000,players:[],waitlist:[],maxPlayers:2,cancelDeadlineHours:1};
it('requires creation observed before opening for complete historical claims',()=>{
 expect(measureRoundChange(undefined,undefined,initial,'g',1000000)?.complete).toBe(true);
 expect(measureRoundChange(undefined,initial,initial,'g',3000000)?.complete).toBe(false);
 expect(measureRoundChange(undefined,undefined,{...initial,registrationOpensAt:undefined,createdAt:undefined},'g',1000000)?.complete).toBe(false);
});
it('counts a cancellation once per changed timestamp and preserves it through rejoining',()=>{
 let row=measureRoundChange(undefined,undefined,initial,'g',1000000)!;
 const cancelled={...initial,cancellations:{a:99900000}};
 row=measureRoundChange(row,initial,cancelled,'g',99900000)!;
 expect(row.cancellations.a).toEqual({total:1,late:1,unknownDeadline:0});
 row=measureRoundChange(row,cancelled,{...cancelled,players:['b']},'g',99900001)!;
 expect(row.cancellations.a.total).toBe(1);
 row=measureRoundChange(row,cancelled,initial,'g',99900002)!;
 row=measureRoundChange(row,initial,{...initial,cancellations:{a:99900003}},'g',99900003)!;
 expect(row.cancellations.a.total).toBe(2);
});
it('admin removal is not a cancellation; unknown deadlines remain unknown',()=>{
 const before={...initial,players:['a']};
 const row=measureRoundChange(undefined,before,{...initial,cancelDeadlineHours:undefined,cancellations:{b:99900000}},'g',99900000)!;
 expect(row.cancellations.a).toBeUndefined();expect(row.cancellations.b).toMatchObject({total:1,late:0,unknownDeadline:1});
});
it('counts waitlist promotions, active guests and earliest full time under out-of-order delivery',()=>{
 let row=measureRoundChange(undefined,undefined,initial,'g',1000000)!;
 row=measureRoundChange(row,{...initial,waitlist:['a']},{...initial,players:['a'],guests:[{}]},'g',5000000)!;
 expect(row.promotions).toBe(1);expect(row.firstFullAt).toBe(5000000);
 row=measureRoundChange(row,initial,{...initial,players:['a','a'],guests:[{}, {waitlisted:true}]},'g',4000000)!;
 expect(row.firstFullAt).toBe(4000000);
 expect(row.waitlistAtStart?.at).toBe(5000000);
});
it('rejects scope edits as complete history and does not let delayed old scope replace new scope',()=>{
 const row=measureRoundChange(undefined,undefined,initial,'g',1000000)!;
 const edited={...initial,startsAt:initial.startsAt!+10000};
 const updated=measureRoundChange(row,initial,edited,'g',5000000)!;
 expect(updated.complete).toBe(false);
 expect(measureRoundChange(updated,initial,initial,'g',3000000)).toEqual(updated);
 expect(measureRoundChange(row,initial,{...initial,maxPlayers:3},'g',4000000)?.complete).toBe(false);
});

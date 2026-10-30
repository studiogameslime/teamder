import {managerActiveCards, managerArrivals, managerNewcomers, managerPlayerHistory, managerRetention, managerRoster, uniqueManagerAttention, managerPlayerRating} from '../../src/utils/managerWorkspace';
import {managerHistoryView} from '../../src/utils/managerHistoryView';
import type {Game, Group, CommunityPlayerEvent} from '../../src/types';
import type {ManagerHistoryRow} from '../../src/services/managerHistoryService';
const day=86400000, now=2_000_000_000_000;
const group={id:'club',adminIds:['admin'],playerIds:['a','b'],joinedAt:{admin:now-100*day,a:now-100*day,b:now-3*day}} as unknown as Group;
const round=(id:string,days:number,more:Partial<Game>={}):Game=>({id,groupId:'club',startsAt:now-days*day,status:'finished',players:['a'],waitlist:[],guests:[],maxPlayers:2,...more} as Game);
const history=Array.from({length:10},(_,i)=>round(String(i),10-i));
it('does not list a returning member twice as both missing and returning',()=>{
 expect(uniqueManagerAttention([{userId:'a',missed:3},{userId:'b',missed:4}],[{userId:'a'}])).toEqual([{userId:'b',missed:4}]);
});
it('keeps a stored manager rating independent of missing performance scores and handles disabled or invalid ratings',()=>{
 expect(managerPlayerRating({...group,internalRating:true,adminRatings:{a:4}},'a')).toBe(4);
 expect(managerPlayerRating({...group,internalRating:false,adminRatings:{a:4}},'a')).toBeNull();
 expect(managerPlayerRating({...group,internalRating:true,adminRatings:{a:NaN}},'a')).toBeNull();
});
it('uses unique non-cancelled registrations and active guests for a complete upcoming partition',()=>{
 const next=round('next',-1,{status:'scheduled',players:['a','a','b','outside'],cancellations:{b:now-1},waitlist:['b'],guests:[{id:'g'},{id:'waiting',waitlisted:true}] as Game['guests']});
 const result=managerRoster(group,[...history,next],now);
 expect(result).toMatchObject({nextMembers:1,external:1,guests:1,total:3,vacancies:0});
 expect(result.missing.some(m=>m.userId==='a')).toBe(false);
});
it('shows scheduled rounds before opening and keeps their missing members and gear distinct',()=>{
 const next=round('next',-1,{status:'scheduled',registrationOpensAt:now+1000,players:[]});
 const result=managerRoster({...group,ballHolderIds:['a','a'],jerseysHolderIds:['b']},[...history,next],now);
 expect(result.upcoming?.id).toBe('next');expect(result.missing.map(m=>m.userId)).toContain('a');
 expect(result.gear).toHaveLength(2);expect(result.missingGear).toHaveLength(2);
});
it('does not invent occupancy from missing capacities, and names current membership scope',()=>{
 const rows=[round('1',1,{players:['a','external']}),round('2',2,{maxPlayers:0,players:['a']})];
 expect(managerRoster(group,rows,now)).toMatchObject({registrations:3,memberRegistrations:2,outsideRegistrations:1,occupancyPercent:null});
 expect(managerRoster(group,[rows[0]],now).occupancyPercent).toBe(100);
});
it('counts newcomer first and repeat only in completed opportunities, separating future registration',()=>{
 const rows=[round('1',1,{players:['b']}),round('2',2,{players:['b']}),round('old',4,{players:['b']}),round('future',-1,{status:'open',players:['b']})];
 expect(managerNewcomers(group,rows,now)).toMatchObject({first:1,repeat:1,rows:[{userId:'b',completed:2,opportunities:2,next:true}]});
 expect(managerNewcomers({...group,joinedAt:{}},rows,now).rows).toEqual([]);
});
it('compares two equal four-round windows only after eight eligible rounds',()=>{
 const rows=history.map((r,i)=>({...r,players:i===0||i===5?['a']:[]}));
 const result=managerRetention(group,rows,now);
 const mature=result.rows.find(r=>r.mature>0)!;
 expect(mature).toMatchObject({mature:2,first:1,continued:1});
 expect(result.rows.find(r=>r.mature===0)?.members).toBe(1);
 expect(managerRetention(group,rows,now,true).rows.every(r=>r.mature===0)).toBe(true);
});
it('does not invent earlier absences when membership date and prior involvement are unknown',()=>{
 expect(managerPlayerHistory({...group,joinedAt:{}},history,'b',now)).toEqual([]);
 const result=managerPlayerHistory({...group,joinedAt:{a:now-3*day}},history,'a',now);
 expect(result.map(r=>r.game.id)).toEqual(['7','8','9']);
});
it('cards use snapshot expiry, current club scope, master switch and revoked state',()=>{
 const ev=(id:string,type:'red'|'yellow',more:Partial<CommunityPlayerEvent>={}):CommunityPlayerEvent=>({id,groupId:'club',userId:'a',type,at:now-day,...more});
 const events=[ev('active','red',{expiresAt:null}),ev('expired','red',{expiresAt:now-1}),ev('revoked','yellow',{revoked:true}),ev('foreign','red',{groupId:'other'}),ev('legacy','yellow')];
 expect(managerActiveCards({...group,cardsEnabled:true,redCardValidityDays:1,yellowCardValidityDays:2},events,now).map(e=>e.id).sort()).toEqual(['active','legacy']);
 expect(managerActiveCards(group,events,now)).toEqual([]);
});
it('arrival coverage never interprets missing reports, guests, duplicates or cancellations as attendance',()=>{
 const g=round('last',1,{players:['a','a','b','outside'],cancellations:{b:now-1},arrivals:{a:'late'},guests:[{id:'g'}] as Game['guests']});
 expect(managerArrivals(group,[g],now)).toMatchObject({total:2,covered:1,counts:{arrived:0,late:1,no_show:0,unknown:1}});
});
it('history summaries exclude incomplete and foreign rounds, retain zero measurements and use the filled denominator',()=>{
 const g=history.slice(0,3);
 const row=(i:number,more:Partial<ManagerHistoryRow>={}):ManagerHistoryRow=>({gameId:g[i].id,groupId:'club',startsAt:g[i].startsAt,opensAt:g[i].startsAt-day,complete:true,observedAt:now,firstFullAt:i===0?g[i].startsAt-day+3600000:null,promotions:0,waitlistAtStart:{at:g[i].startsAt-100,count:0},cancellations:{},...more});
 const result=managerHistoryView([row(0,{promotions:2}),row(1,{cancellations:{a:{total:3,late:1,unknownDeadline:1}}}),row(2,{complete:false,promotions:99})],g);
 expect(result).toMatchObject({covered:2,of:3,filled:1,medianMs:3600000,promotions:2,waiting:0,waitingCovered:2,total:3,late:1,unknownDeadline:1});
 expect(managerHistoryView([row(0,{groupId:'other'})],g).covered).toBe(0);
});

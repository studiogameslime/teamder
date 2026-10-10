import { equipmentCounts, managerOverview, ratingAdvice, ratingSeries, registrationState } from '../../src/utils/managerDashboard';
import { clubReminderEligibility } from '../../functions/src/clubRegistrationReminder';
import { managerDashboardDemo } from '../../src/data/managerDashboardDemo';
import type { CommunityPlayerEvent, Game, Group, User } from '../../src/types';
const now=2_000_000_000_000,day=86400000;
const group={id:'g',adminIds:['admin'],playerIds:['a','b'],internalRating:true,adminRatings:{a:3.5,b:4},joinedAt:{}} as unknown as Group;
const game=(i:number,more:Partial<Game>={}):Game=>({id:`g${i}`,groupId:'g',status:'finished',startsAt:now-(10-i)*7*day,players:['a'],waitlist:[],maxPlayers:20,matches:[],...more} as Game);
const games=Array.from({length:10},(_,i)=>game(i));
const scores=(values:number[],uid='a')=>Object.fromEntries(games.slice(-values.length).map((g,i)=>[g.id,{[uid]:values[i]}]));
describe('manager dashboard evidence and club boundaries',()=>{
 it('shows real scores without an admin rating, with fewer than five scores or without a recommendation',()=>{
  const noRating={...group,internalRating:false,adminRatings:{}};
  const rows=ratingSeries(noRating,games,scores([7,7]));
  expect(rows).toHaveLength(1);expect(rows[0].rating).toBeNull();expect(rows[0].points.map(p=>p.score)).toEqual([7,7]);
  expect(ratingAdvice(noRating,games,scores([7,7]))).toEqual([]);
  expect(ratingSeries(group,games,scores([7,7,7,7,7]))[0].points).toHaveLength(5);
 });
 it('requires seven registrations among ten recent eligible rounds and ignores older attendance',()=>{
  const rows=Array.from({length:14},(_,i)=>game(i,{startsAt:now-(15-i)*day,players:i<11?['a']:[]}));
  const eligible={...group,joinedAt:{a:now-20*day}};
  expect(managerOverview(eligible,rows,now).members.find(m=>m.userId==='a')).toMatchObject({regular:true,count:7,sample:10});
  rows[10]={...rows[10],players:[]};
  expect(managerOverview(eligible,rows,now).members.find(m=>m.userId==='a')).toMatchObject({regular:false,count:6,sample:10});
 });
 it('creates advice from five real scores, distinguishes rating /5 from scores /10',()=>{
  const result=ratingAdvice(group,games,scores([6,6.5,7,7.5,8]));
  expect(result[0]).toMatchObject({userId:'a',rating:3.5,direction:'up',delta:1.5});
  expect(result[0].points.map(p=>p.score)).toEqual([6,6.5,7,7.5,8]);
 });
 it('handles many upward/downward recommendations rather than limiting to one',()=>{
  const g={...group,playerIds:['a','b','c','d'],adminRatings:{a:3,b:4,c:3,d:4}};
  const maps=Object.fromEntries(games.slice(-5).map((r,i)=>[r.id,{a:6+i*.5,b:9-i*.5,c:5+i*.5,d:8-i*.5}]));
  const rows=ratingAdvice(g,games,maps);
  expect(rows.filter(r=>r.direction==='up')).toHaveLength(2);expect(rows.filter(r=>r.direction==='down')).toHaveLength(2);
 });
 it('recognises sustained improvement or decline despite a plateau and small correction',()=>{
  expect(ratingAdvice(group,games,scores([6.7,6.7,6.9,8.3,8]))[0]).toMatchObject({direction:'up'});
  expect(ratingAdvice(group,games,scores([8.3,8.3,8.1,6.7,7]))[0]).toMatchObject({direction:'down'});
  expect(ratingAdvice(group,games,scores([7,7,7.2,7,10]))).toEqual([]);
 });
 it('counts all eligible history separately from regularity and resets consecutive absence on registration',()=>{
  const history=Array.from({length:14},(_,i)=>game(i,{startsAt:now-(15-i)*day,players:i===12?['a']:[]}));
  const view=managerOverview({...group,joinedAt:{a:now-20*day}},history,now);
  expect(view.members.find(m=>m.userId==='a')).toMatchObject({sample:10,totalSample:14,totalRegistered:1,missed:1});
  expect(view.absent.some(m=>m.userId==='a')).toBe(false);
 });
 it('ignores insufficient, invalid, flat and one-outlier data',()=>{
  expect(ratingAdvice(group,games,scores([6,7,8,9]))).toEqual([]);
  expect(ratingAdvice(group,games,scores([7,7,7,7,10]))).toEqual([]);
  expect(ratingAdvice(group,games,scores([7,7,7,7,7]))).toEqual([]);
  expect(ratingAdvice(group,games,scores([6,6.5,NaN,7.5,8]))).toEqual([]);
 });
 it('does not count unknown scores as zero or take other club / cancelled / unverified scores',()=>{
  const rows=games.slice(-5).map((g,i)=>({...g,groupId:i===0?'other':'g'}));
  expect(ratingAdvice(group,rows,scores([6,6.5,7,7.5,8]))).toEqual([]);
  expect(ratingAdvice(group,rows.map(g=>({...g,groupId:'g',status:'cancelled'} as Game)),scores([6,6.5,7,7.5,8]))).toEqual([]);
  expect(ratingAdvice(group,rows.map(g=>({...g,groupId:'g',endedBy:'auto'})),scores([6,6.5,7,7.5,8]))).toEqual([]);
 });
 it('requires internal ratings, a valid current rating and does not raise a player beyond 5',()=>{
  expect(ratingAdvice({...group,internalRating:false},games,scores([6,6.5,7,7.5,8]))).toEqual([]);
  expect(ratingAdvice({...group,adminRatings:{a:5}},games,scores([6,6.5,7,7.5,8]))).toEqual([]);
 });
 it('regularity uses the last ten completed rounds, never attendance confirmation',()=>{
  const next=game(10,{id:'next',status:'open',startsAt:now+day,players:['b','external'],guests:[{id:'x',name:'אורח',addedBy:'admin',createdAt:now}]});
  const view=managerOverview(group,[...games,next],now);
  expect(view.members.find(m=>m.userId==='a')).toMatchObject({regular:true,count:10,sample:10});
  expect(view.missing.map(m=>m.userId)).toEqual(['a']);
  expect(view.clubCount).toBe(1);expect(view.externalCount).toBe(1);expect(view.guests).toBe(1);expect(view.total).toBe(3);
  expect(view.regularCount+view.newCount+view.occasionalCount).toBe(view.clubCount);
 });
 it('separates registered, waiting, pending, cancelled, rejected and no response',()=>{
  const g=game(0,{players:['a'],waitlist:['b'],pending:['c'],cancellations:{d:now},rejectedPlayerIds:['e']});
  expect(['a','b','c','d','e','f'].map(id=>registrationState(g,id))).toEqual(['registered','waitlist','pending','cancelled','rejected','none']);
 });
 it('shows a formerly regular player after two missing rounds, others after three',()=>{
  const rows=Array.from({length:12},(_,i)=>game(i,{startsAt:now-(13-i)*day,players:i<10&&i!==1&&i!==2&&i!==3?['a']:[]}));
  const view=managerOverview(group,rows,now);
  expect(view.absent.find(m=>m.userId==='a')).toMatchObject({missed:2,wasRegular:true});
  const belowThreshold=rows.map((g,i)=>i===4?{...g,players:[]}:g);
  expect(managerOverview(group,belowThreshold,now).absent.find(m=>m.userId==='a')).toBeUndefined();
  expect(view.absent.find(m=>m.userId==='b')).toBeUndefined();
  const knownMember=managerOverview({...group,joinedAt:{b:now-100*day}},rows,now);
  expect(knownMember.absent.find(m=>m.userId==='b')).toMatchObject({missed:12});
 });
 it('does not blame new members for rounds before joining',()=>{
  const view=managerOverview({...group,joinedAt:{b:now-day}},games,now);
  expect(view.absent.find(m=>m.userId==='b')).toBeUndefined();
 });
 it('counts own cancellations only, uses the deadline and excludes abandoned evenings',()=>{
  const rows=[game(1,{cancellations:{a:game(1).startsAt-2*3600000},cancelDeadlineHours:12}),game(2,{cancellations:{a:game(2).startsAt-13*3600000},cancelDeadlineHours:12}),game(3,{adminRemovals:{a:now}}),game(4,{status:'cancelled',cancellations:{a:now}})];
  expect(managerOverview(group,rows,now).members.find(m=>m.userId==='a')).toMatchObject({cancellations:2,late:1});
 });
 it('equipment deduplicates same round/item/holder, excludes returns, revocations and wrong clubs',()=>{
  const ev=(id:string,more:Partial<CommunityPlayerEvent>={}):CommunityPlayerEvent=>({id,groupId:'g',userId:'a',type:'ball',at:now-day,gameId:'g1',...more});
  const rows=[ev('1'),ev('2'),ev('3',{returned:true}),ev('4',{groupId:'other'}),ev('5',{type:'jerseys'}),ev('6',{revoked:true}),ev('7',{gameId:undefined}),ev('8',{at:now-100*day,gameId:'old'})];
  expect(equipmentCounts(group,rows,now-30*day,now).find(r=>r.userId==='a')).toEqual({userId:'a',ball:2,jerseys:1});
 });
 it('QA fixture contains four upward and three downward recommendations',()=>{
  const ids=Array.from({length:9},(_,i)=>`p${i}`);
  const demo=managerDashboardDemo({...group,adminIds:[ids[0]],playerIds:ids} as Group,ids.map(id=>({id,name:id,createdAt:0}) as User));
  const all=ratingAdvice(demo.group,demo.games,demo.scores);
  expect(all.filter(a=>a.direction==='up')).toHaveLength(4);expect(all.filter(a=>a.direction==='down')).toHaveLength(3);
 });
});
describe('club reminder canonical server gate',()=>{
 const g={status:'open',startsAt:now+day,players:[],waitlist:[],pending:[]};
 it('allows admin to remind a current member only',()=>{
  expect(clubReminderEligibility('admin','a',g,group,now)).toBe('ok');
  expect(clubReminderEligibility('a','b',g,group,now)).toBe('permission-denied');
  expect(clubReminderEligibility('admin','outsider',g,group,now)).toBe('permission-denied');
  expect(clubReminderEligibility(undefined,'a',g,group,now)).toBe('unauthenticated');
 });
 it.each(['players','waitlist','pending','rejectedPlayerIds'])('does not remind someone in %s',key=>{
  expect(clubReminderEligibility('admin','a',{...g,[key]:['a']},group,now)).toBe('failed-precondition');
 });
 it('does not remind cancelled, locked, not-open-yet or already-started rounds, nor self',()=>{
  for(const patch of [{cancellations:{a:now}},{status:'locked'},{registrationOpensAt:now+day},{startsAt:now-day}])
   expect(clubReminderEligibility('admin','a',{...g,...patch},group,now)).toBe('failed-precondition');
  expect(clubReminderEligibility('admin','admin',g,group,now)).toBe('failed-precondition');
 });
});

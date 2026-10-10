import { clubBalance, clubRoundNumbers, managerClubInsights, managerNeedsAttention } from '../../src/utils/managerClubInsights';
import type { Game,Group } from '../../src/types';
const now=2_000_000_000_000,day=86400000;
const group={id:'g',adminIds:['admin'],playerIds:['a','b'],joinedAt:{a:now-100*day,b:now-8*day}} as unknown as Group;
const history=(count:number)=>Array.from({length:count},(_,i)=>({id:`g${i}`,groupId:'g',status:'finished',startsAt:now-(count-i)*day,players:['a'],waitlist:[],maxPlayers:2,guests:[]} as unknown as Game));
it('uses ten completed club rounds and only compares equally sized ten-round windows',()=>{
 const rows=history(21);rows.push({...rows[0],id:'foreign',groupId:'other'},{...rows[0],id:'cancelled',status:'cancelled'},{...rows[0],id:'unverified',endedBy:'auto'});
 const result=managerClubInsights(group,rows,now);
 expect(result.recent).toHaveLength(10);expect(result.recent[0].id).toBe('g20');expect(result.previous).toHaveLength(10);expect(result.average).toBe(1);expect(result.previousAverage).toBe(1);
 expect(managerClubInsights(group,history(19),now).previousAverage).toBeNull();
 expect(managerClubInsights(group,[],now)).toMatchObject({average:null,previousAverage:null,unique:0,full:0});
});
it('deduplicates accounts, excludes cancelled registration, counts active guests only, not waiting',()=>{
 const rows=history(1);rows[0]={...rows[0],players:['a','a','b'],cancellations:{b:now-1},waitlist:['c'],guests:[{id:'x'},{id:'y',waitlisted:true}] as Game['guests']};
 expect(managerClubInsights(group,rows,now)).toMatchObject({unique:1,average:2,full:1});
});
it('shows a recent return only after three absences with an earlier known registration',()=>{
 const rows=history(8).map((g,i)=>({...g,players:i<4||i===7?['a']:[]}));
 expect(managerClubInsights(group,rows,now).returned).toEqual([expect.objectContaining({userId:'a',gap:3,upcoming:false})]);
 rows[6].players=['a'];expect(managerClubInsights(group,rows,now).returned).toEqual([]);
 expect(managerClubInsights(group,history(8).map((g,i)=>({...g,players:i===7?['a']:[]})),now).returned).toEqual([]);
});
it('detects upcoming returns but not waiting or old returns or absences before club joining',()=>{
 const rows=history(10).map((g,i)=>({...g,players:i<7?['a']:[]}));
 const next={...rows[0],id:'next',status:'open',startsAt:now+day,players:['a']} as Game;
 expect(managerClubInsights(group,[...rows,next],now).returned[0]).toMatchObject({userId:'a',gap:3,upcoming:true});
 expect(managerClubInsights(group,[...rows,{...next,players:[],waitlist:['a']}],now).returned).toEqual([]);
 expect(managerClubInsights({...group,joinedAt:{a:now-2*day}},[...rows,next],now).returned).toEqual([]);
 const old=history(12).map((g,i)=>({...g,players:i<4||i===7?['a']:[]}));
 expect(managerClubInsights(group,old,now).returned).toEqual([]);
});
it('newcomers need a known recent join date and completed or upcoming registrations after joining',()=>{
 const rows=history(12).map(g=>({...g,players:['b']}));
 const result=managerClubInsights({...group,joinedAt:{b:now-3*day,admin:now+day,a:NaN}},rows,now);
 expect(result.newcomers).toEqual([expect.objectContaining({userId:'b',completed:3,next:false})]);
 expect(result.newcomerRegistered).toBe(1);
 expect(managerClubInsights({...group,joinedAt:{}},rows,now).newcomers).toEqual([]);
 expect(managerClubInsights(group,[],now).newcomers[0]).toMatchObject({userId:'b',completed:0,next:false});
 const later={...history(1)[0],id:'later',startsAt:now+2*day,status:'open',players:['b']} as Game;
 const first={...later,id:'first',startsAt:now+day,players:[]};
 expect(managerClubInsights(group,[first,later],now).newcomers[0]).toMatchObject({userId:'b',completed:0,next:true});
 expect(managerClubInsights(group,[{...later,status:'active',startsAt:now-1}],now).newcomerRegistered).toBe(1);
});
it('balance uses recorded score before penalties, skips invalid scores, deduplicates and distinguishes missing from failure',()=>{
 const rows=history(4);
 const result=clubBalance(rows,{
  g0:{rows:[{id:'draw',scoreA:1,scoreB:1},{id:'draw',scoreA:1,scoreB:1},{id:'close',scoreA:2,scoreB:1},{id:'wide',scoreA:0,scoreB:3},{id:'bad',scoreA:NaN,scoreB:0},{id:'negative',scoreA:-1,scoreB:0}],unavailable:false,truncated:false},
  g1:{rows:[],unavailable:true,truncated:false},g2:{rows:[],unavailable:false,truncated:false},g3:{rows:[{id:'draw',scoreA:0,scoreB:0}],unavailable:false,truncated:true}
 });
 expect(result).toEqual({draws:2,oneGoal:1,wide:1,total:4,covered:2,unavailable:2,missing:1,invalid:2,closePercent:75});
 expect(clubBalance([],{}).closePercent).toBeNull();
});

it('round numbers use sealed counts, preserve known zeros and exclude missing counts from the denominator',()=>{
 const games=history(5);
 games[0].committedRoundCount=8;games[1].committedRoundCount=0;games[2].committedRoundCount=NaN;
 const results={g0:{rows:[],unavailable:true,truncated:false},g1:{rows:[],unavailable:false,truncated:false},g2:{rows:[{id:'a',scoreA:NaN,scoreB:NaN},{id:'a',scoreA:0,scoreB:0},{id:'b',scoreA:NaN,scoreB:0}],unavailable:false,truncated:false},g3:{rows:[],unavailable:false,truncated:false}};
 const view=clubRoundNumbers(games,results);
 expect(view.rounds.map(r=>r.count)).toEqual([8,0,2,null,null]);
 expect(view).toMatchObject({total:10,covered:3,missing:2,average:10/3,maximum:8});expect(view.busiest.map(r=>r.game.id)).toEqual(['g0']);
});
it('round numbers do not invent completeness from capped reads and show every tied maximum',()=>{
 const games=history(4);games[0].committedRoundCount=8;games[1].committedRoundCount=8;games[2].committedRoundCount=-1;
 const entry={rows:Array.from({length:4},(_,i)=>({id:String(i),scoreA:0,scoreB:0})),unavailable:false,truncated:true};
 const result=clubRoundNumbers(games,{g0:entry,g2:entry});
 expect(result.rounds.map(r=>r.count)).toEqual([8,8,null,null]);expect(result.busiest).toHaveLength(2);
 expect(clubRoundNumbers([{...games[0],committedRoundCount:2}],{g0:entry}).rounds[0].count).toBeNull();
 expect(clubRoundNumbers([],{})).toMatchObject({average:null,maximum:null,total:0,covered:0});
});
it('attention separates topic count from items and filters club, date, membership and valid ratings',()=>{
 const g={...group,pendingPlayerIds:['x','x','a','y'],internalRating:true,adminRatings:{admin:5,a:0,b:NaN}};
 const base=history(1)[0];
 const unverified={...base,id:'u',endedBy:'auto' as const,startsAt:now-5*day};
 const view=managerNeedsAttention(g,[unverified,unverified,{...unverified,id:'old',startsAt:now-91*day},{...unverified,id:'foreign',groupId:'other'},{...unverified,id:'played',playVerified:true},{...unverified,id:'future',startsAt:now+day}],now);
 expect(view.pending).toEqual(['x','y']);expect(view.unverified.map(r=>r.id)).toEqual(['u']);expect(view.unrated).toEqual(['a','b']);expect(view.topics).toBe(3);
 expect(managerNeedsAttention({...g,internalRating:false},[],now).unrated).toEqual([]);
 expect(managerNeedsAttention({...g,pendingPlayerIds:[],adminRatings:{admin:1,a:2,b:5}},[],now).topics).toBe(0);
});

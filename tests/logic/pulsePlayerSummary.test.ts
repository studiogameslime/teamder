import fs from 'fs';
import path from 'path';
import { playerRoundFacts, playerSummary } from '../../pulse/src/services/playerSummary';
import type { UserActivity } from '../../pulse/src/types';
import { isAttendedGame } from '../../src/utils/playedGames';
const uid='person';
test('waiting and approval are not registrations; creator is not automatically a player',()=>{
 expect(playerRoundFacts({players:[],waitlist:[uid]},uid).registration).toBe('waiting');
 expect(playerRoundFacts({players:[],pending:[uid]},uid).registration).toBe('pending');
 expect(playerRoundFacts({createdBy:uid},uid)).toMatchObject({registration:'none',managed:true,attended:false});
});
test('attendance follows the app policy: missing arrival counts, explicit absence does not',()=>{
 expect(playerRoundFacts({status:'finished',players:[uid]},uid).attended).toBe(true);
 expect(playerRoundFacts({status:'finished',endedBy:'auto',arrivals:{[uid]:'arrived'}},uid).attended).toBe(false);
 expect(playerRoundFacts({status:'finished',endedBy:'admin',players:[uid],arrivals:{[uid]:'late'}},uid).attended).toBe(true);
 expect(playerRoundFacts({status:'cancelled',arrivals:{[uid]:'arrived'}},uid).attended).toBe(false);
});

test('Pulse agrees with canonical attendance across statuses, roster, arrival, time and evening evidence',()=>{
 const now=1_800_000_000_000;
 for(const status of ['finished','cancelled','live','open'])
 for(const players of [[uid],[],undefined])
 for(const arrival of [undefined,'arrived','late','no_show'])
 for(const startsAt of [undefined,now-1,now,now+1])
 for(const evidence of [{},{endedBy:'admin' as const},{endedBy:'auto' as const},{endedBy:'auto' as const,playVerified:true},{endedBy:'auto' as const,committedRoundCount:2},{endedBy:'admin' as const,playVerified:false}]) {
  const game={status,players,startsAt,arrivals:arrival?{[uid]:arrival}:undefined,...evidence};
  expect(playerRoundFacts(game,uid,now).attended).toBe(isAttendedGame(game,uid,now));
  expect(playerRoundFacts(game,'',now).attended).toBe(false);
 }
});

test('one played evening counts once regardless of mini-games, and waiting or creator-only rounds do not count',()=>{
 const game={status:'finished',endedBy:'admin' as const,committedRoundCount:12,players:[uid]};
 const rows=[game,{...game,players:[],waitlist:[uid]},{...game,players:[],createdBy:uid}].map((g,index)=>({id:String(index),at:1,status:g.status,title:'מחזור',role:'',detail:playerRoundFacts(g,uid)}));
 expect(playerSummary({related:{games:rows,groups:[],reports:[],referred:[]}} as unknown as UserActivity).attended).toHaveLength(1);
});
test('next confirmed registration excludes waitlist, cancelled, past, and creator-only rounds',()=>{
 const game=(id:string,at:number,registration:string,status='open')=>({id,at,title:id,status,role:'',detail:{registration}});
 const data={related:{games:[game('later',50,'registered'),game('wait',15,'waiting'),game('cancelled',12,'registered','cancelled'),game('past',5,'registered'),game('next',20,'registered'),game('creator',11,'none')],groups:[{id:'old-founder',detail:{member:false,manager:false}},{id:'manager',detail:{manager:true}},{id:'member',detail:{member:true}}],reports:[],referred:[]}} as unknown as UserActivity;
 const result=playerSummary(data,10);
 expect(result.registered.map(g=>g.id)).toEqual(['next','later']);expect(result.future).toHaveLength(3);
 expect(result.clubs).toHaveLength(2);expect(result.managing).toHaveLength(1);
 expect(playerSummary({...data,failedSources:['מחזורים']},10).partial).toBe(true);
});

test('standalone Pulse mirror stays identical to the canonical evening policy',()=>{expect(fs.readFileSync(path.join(process.cwd(),'pulse/src/services/eveningPlayed.ts'),'utf8')).toBe(fs.readFileSync(path.join(process.cwd(),'src/utils/eveningPlayed.ts'),'utf8'));});

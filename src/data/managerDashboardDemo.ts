/** Demonstration data only. Imported exclusively by the mock service branch. */
import type { Game, Group, User, CommunityPlayerEvent } from '@/types';
import type { ManagerData } from '@/services/managerDashboardService';
import { mockGamesV2 } from '@/data/mockData';
export function managerDashboardDemo(source:Group, sourceUsers:User[]):ManagerData {
 const now=Date.now(),day=86400000;
 const ids=sourceUsers.slice(0,9).map(u=>u.id);
 const names=['דניאל כהן','רועי מזרחי','אלירן צברי','יואב סבן','איתי לוי','מתן לוי','אור כהן','עומר ישראלי','ניר ישראלי'];
 const users=sourceUsers.map((u,i)=>({...u,name:names[i]??u.name,photoUrl:undefined,avatarId:['a22','a07','a25','a26','a27','a28','a29','a30','a31'][i%9]}));
 const group={...source,name:'כדורגל אנשים טובים',internalRating:true,adminRatings:Object.fromEntries(ids.map((id,i)=>[id,[3.5,4,3,3.5,4,4.5,3.5,3,3][i]])),joinedAt:{[ids[8]]:now-12*day}};
 const curves=[[6.8,7.2,7.6,8,8.6],[7.1,7.4,7.2,8.1,8.5],[5.8,6.1,6.6,7,7.8],[6.5,6.8,7.2,7.8,8.1],[8.2,7.8,7.4,6.9,6.5],[8.2,7.8,7.6,7,6.7],[7.8,7.5,7,6.6,6.2]];
 const games:Game[]=Array.from({length:12},(_,i)=>({id:`manager-demo-${i}`,groupId:group.id,title:'מחזור הדגמה',status:'finished',startsAt:now-(12-i)*7*day,players:ids.filter((_,j)=>(j!==7||i<9)&&(j!==8||i===11)),waitlist:[],maxPlayers:20,cancellations:i===10?{[ids[7]]:now-15*day}:{},cancelDeadlineHours:12,matches:[]} as unknown as Game));
 const scores:ManagerData['scores']={};
 games.slice(-5).forEach((g,i)=>{scores[g.id]=Object.fromEntries(ids.slice(0,7).map((id,j)=>[id,curves[j][i]]));});
 scores[games[11].id][ids[8]]=7.2;
 games.slice(-2).forEach((g,i)=>{scores[g.id][ids[7]]=6.8+i*.2;});
 games.push({id:'manager-demo-next',groupId:group.id,title:'המחזור הקרוב',status:'open',startsAt:now+2*day,players:ids.slice(2,8),waitlist:[ids[8]],maxPlayers:20,matches:[]} as unknown as Game);
 const unverified=mockGamesV2.find(g=>g.groupId===group.id&&g.id==='gv2-unverified');
 if(unverified)games.push({...unverified,matches:[]} as Game);
 delete group.adminRatings[ids[8]];
 const events:CommunityPlayerEvent[]=[];
 ids.forEach((id,j)=>{for(let i=0;i<[6,1,0,3,2,0,1,0,0][j];i++)events.push({id:`demo-ball-${j}-${i}`,groupId:group.id,userId:id,type:'ball',at:now-(i+1)*7*day,gameId:games[11-i].id});
 for(let i=0;i<[2,4,0,2,1,0,0,0,0][j];i++)events.push({id:`demo-jersey-${j}-${i}`,groupId:group.id,userId:id,type:'jerseys',at:now-(i+1)*7*day,gameId:games[11-i].id});});
 return {group,users,games,scores,events,truncated:false,scoresIncomplete:false,equipmentUnavailable:false};
}

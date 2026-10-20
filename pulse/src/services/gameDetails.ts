import { getDoc, queryEquals, queryChildDocuments, type FsDoc } from './firestoreRest';
import { cached } from './cache';
import { toRow, type GameRow } from './gamesService';
export interface RoundPlayer {id:string;name:string;city?:string;bucket:string;guest:boolean;arrival?:string;joinedAt?:number;rating?:number;ratingCount?:number;ratingSource?:string;failed?:boolean;ratingUnknown?:boolean;record:Record<string,unknown>}
export interface RoundDetails {game:FsDoc;row:GameRow;group:FsDoc|null;players:RoundPlayer[];matches:FsDoc[];cards:FsDoc[];history:FsDoc[];stats:FsDoc[];summary:FsDoc|null;retroGoals:FsDoc[];failedSources:string[];limitedSources:string[]}
export const record=(v:unknown):Record<string,any>=>v && typeof v==='object' && !Array.isArray(v)?v as Record<string,any>:{};
export function rosterIds(game:Record<string,any>):{id:string;bucket:string}[]{
 const entries=new Map<string,string>();
 for(const [field,bucket] of [['players','רשום'],['pending','ממתין לאישור'],['waitlist','ברשימת המתנה']] as const){for(const player of Array.isArray(game[field])?game[field]:[]){const id=typeof player==='string'?player:player?.userId ?? player?.id;if(typeof id==='string' && id && !entries.has(id))entries.set(id,bucket)}}
 for(const id of Array.isArray(game.participantIds)?game.participantIds:[])if(typeof id==='string' && !entries.has(id))entries.set(id,'משתתף — מצב לא תועד');
 for(const field of ['cancellations','adminRemovals'])for(const id of Object.keys(record(game[field])))if(!entries.has(id))entries.set(id,field==='cancellations'?'ביטל הרשמה':'הוסר בידי מנהל');
 return [...entries].map(([id,bucket])=>({id,bucket}));
}
export function playerRating(group:Record<string,any>|null,id:string,summary:Record<string,any>|null):Pick<RoundPlayer,'rating'|'ratingCount'|'ratingSource'>{
 if(group?.internalRating===true){const value=record(group.adminRatings)[id];return typeof value==='number' && value>=1 && value<=5?{rating:value,ratingSource:group.hideInternalRating?'דירוג מנהל פרטי':'דירוג מנהל'}:{}}
 return summary && typeof summary.average==='number' && Number.isFinite(summary.average) && summary.average>=1 && summary.average<=5 && summary.count>0?{rating:summary.average,ratingCount:summary.count,ratingSource:'דירוג חברים'}:{};
}
async function concurrentMap<T,R>(rows:T[],fn:(row:T)=>Promise<R>):Promise<R[]>{const out:R[]=new Array(rows.length);let index=0;await Promise.all(Array.from({length:Math.min(6,rows.length)},async()=>{while(index<rows.length){const i=index++;out[i]=await fn(rows[i])}}));return out}
export function fetchRoundDetails(id:string,force=false):Promise<RoundDetails>{
 if(!id || id.includes('/'))return Promise.reject(new Error('PULSE_INVALID_GAME_ID'));
 return cached(`round-details:${id}`,async()=>{
  const game=await getDoc(`games/${id}`);if(!game)throw new Error('PULSE_GAME_NOT_FOUND');
  const failedSources:string[]=[];const limitedSources:string[]=[];
  const safe=async<T>(name:string,p:Promise<T>,fallback:T)=>{try{return await p}catch{failedSources.push(name);return fallback}};
  const [group,matches,events,history,stats,summary,retroGoals]=await Promise.all([
   typeof game.groupId==='string'?safe('פרטי המועדון',getDoc(`groups/${game.groupId}`),null):Promise.resolve(null),
   safe('משחקים במחזור',queryEquals('rounds','gameId',id,500),[] as FsDoc[]),
   typeof game.groupId==='string'?safe('כרטיסי מועדון',queryEquals('communityPlayerEvents','groupId',game.groupId,500),[] as FsDoc[]):Promise.resolve([] as FsDoc[]),
   safe('היסטוריית המשחקים',queryChildDocuments(`games/${id}`,'roundHistory',500),[] as FsDoc[]),
   safe('נתוני שחקנים במחזור',queryEquals('gamePlayerStats','gameId',id,500),[] as FsDoc[]),
   safe('סיכום המחזור',getDoc(`roundSummaries/${id}`),null),
   safe('תיקוני שערים',queryChildDocuments(`games/${id}`,'retroGoals',500),[] as FsDoc[]),
  ]);
  if(history.length===500)limitedSources.push('היסטוריית המשחקים');if(stats.length===500)limitedSources.push('נתוני שחקנים במחזור');if(retroGoals.length===500)limitedSources.push('תיקוני שערים');
  if(matches.length===500)limitedSources.push('משחקים במחזור');if(events.length===500)limitedSources.push('כרטיסי מועדון');
  const players=await concurrentMap(rosterIds(game),async entry=>{
   let failed=false;
   const doc=await getDoc(`users/${entry.id}`,['name','availability.homeCity','discipline','stats']).catch(()=>{failed=true;return null});
   let rating:FsDoc|null=null;let ratingUnknown=!!game.groupId && !group;
   if(group && group.internalRating!==true)rating=await getDoc(`groups/${group.id}/ratings/${entry.id}`).catch(()=>{ratingUnknown=true;failedSources.push(`דירוג ${entry.id}`);return null});
   return {...entry,name:typeof doc?.name==='string'?doc.name:entry.id,city:record(doc?.availability).homeCity,guest:false,arrival:record(game.arrivals)[entry.id],joinedAt:record(game.joinedAt)[entry.id],...playerRating(group,entry.id,rating),failed:failed || !doc,ratingUnknown,record:(doc ?? {}) as Record<string,unknown>};
  });
  if(players.some(p=>p.failed))failedSources.push('פרטי שחקנים');
  const guests:RoundPlayer[]=(Array.isArray(game.guests)?game.guests:[]).map((g:any,index:number)=>({id:g.id ?? `guest:${index}`,name:g.name ?? 'אורח',bucket:'אורח',guest:true,record:g,...(typeof (g.estimatedRating ?? g.rating)==='number'?{rating:g.estimatedRating ?? g.rating,ratingSource:'דירוג אורח'}:{})}));
  const ids=new Set(players.map(p=>p.id));
  const cards=events.filter(e=>ids.has(e.userId) && ['yellow','red'].includes(e.type));
  for(const p of players){const discipline=record(p.record.discipline);for(const event of Array.isArray(discipline.events)?discipline.events:[]){if(event.gameId===id && ['yellow','red'].includes(event.type))cards.push({...event,id:`legacy:${event.id}`,userId:p.id,at:event.createdAt,source:'מחזור'})}}
  const row=toRow(game);row.communityName=group?.name ?? null;
  return {game,row,group,players:[...players,...guests],matches:matches.sort((a,b)=>(a.createdAt ?? a.at ?? 0)-(b.createdAt ?? b.at ?? 0)),cards:cards.sort((a,b)=>(b.at ?? 0)-(a.at ?? 0)),history:history.sort((a,b)=>(a.at ?? 0)-(b.at ?? 0)),stats,summary,retroGoals,failedSources,limitedSources};
 },{force,ttl:60000});
}

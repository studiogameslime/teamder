import { queryDocumentPage, type DocumentPageCursor } from './firestoreRest';
import { mapUser } from './firebase';
import { cached } from './cache';
export const USER_PAGE_SIZE=20;
export type UserPageFilter='all'|'online'|'inactive7'|'inactive30';
export interface UserPageOptions {cursor?:DocumentPageCursor;search?:string;filter?:UserPageFilter;since?:number;legacy?:boolean;now?:number;force?:boolean}
const fields=['name','email','availability.homeCity','createdAt','lastSeenAt','qa','updatedAt','platform'];
const condition=(fieldPath:string,op:string,value:unknown)=>({fieldFilter:{field:{fieldPath},op,value}});
export function fetchUserPage(options:UserPageOptions={}) {
 const {force,...key}=options;
 return cached(`user-page:${JSON.stringify(key)}`,async()=>{
  const search=options.search?.trim() ?? '';
  const searchField=search.includes('@')?'email':'name';
  const filters:unknown[]=[];
  if(search){filters.push(condition(searchField,'GREATER_THAN_OR_EQUAL',{stringValue:search}),condition(searchField,'LESS_THAN_OR_EQUAL',{stringValue:search+'\uf8ff'}));}
  else if(!options.legacy){
   const now=options.now ?? Date.now();
   const cutoff=options.filter==='online'?now-5*60000:options.since;
   if(cutoff)filters.push(condition('lastSeenAt','GREATER_THAN_OR_EQUAL',{integerValue:String(cutoff)}));
   if(options.filter==='inactive7' || options.filter==='inactive30')filters.push(condition('lastSeenAt','LESS_THAN',{integerValue:String(now-(options.filter==='inactive7'?7:30)*86400000)}));
  }
  const page=await queryDocumentPage('users',{orderField:search?searchField:options.legacy?'__name__':'lastSeenAt',direction:search || options.legacy?'ASCENDING':'DESCENDING',cursor:options.cursor,limit:USER_PAGE_SIZE,fields,where:filters.length===1?filters[0]:filters.length?{compositeFilter:{op:'AND',filters}}:undefined});
  const rows=page.rows.map(doc=>({...mapUser(doc),lastActiveAt:typeof doc.lastSeenAt==='number'?doc.lastSeenAt:undefined})).filter(u=>options.legacy || (!u.isTest && !u.deleted));
  return {...page,rows,order:search?'name' as const:'activity' as const};
 },{force,ttl:60000});
}

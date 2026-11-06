import { ExpectedCallableError } from './expectedCallableError';
import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { createHash } from 'node:crypto';
import { getFirestore, FieldPath, FieldValue, Filter } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from './observedFunctions';
import { didEveningHappen } from './eveningPlayed';
import { socialPairSummary } from './socialPairSummary';
import {dmStatus,type DmRequest} from './dmPolicy';
import { directoryReadyPath, indexedNamePage, normalizeSocialSearch } from './socialDirectory';
export { normalizeSocialSearch } from './socialDirectory';

type Data = Record<string, any>;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
const text = (v: unknown, max = 120): string => typeof v === 'string' ? v.slice(0, max).trim() : '';
const number = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
export function socialPrivacy(user: Data) {
  return { discoverable: user.socialPrivacy?.discoverable !== false, statistics: ['everyone', 'onlyMe'].includes(user.socialPrivacy?.statistics) ? user.socialPrivacy.statistics as string : 'friends' };
}
export function statisticsAllowed(viewerId: string, targetId: string, target: Data, viewer: Data) {
  const privacy = socialPrivacy(target).statistics;
  return viewerId === targetId || privacy === 'everyone' || privacy === 'friends' && strings(target.friends).includes(viewerId) && strings(viewer.friends).includes(targetId);
}
/** No contact details, geo coordinates, admin ratings or tokens cross this projection. */
export function socialIdentity(id: string, u: Data, viewer: Data, commonClubCount = 0, sharedRounds = 0) {
  const a = u.availability ?? {};
  const availabilitySlots: Record<string, string[]> = {};
  for (const [day, slots] of Object.entries(a.availabilitySlots ?? {})) {
    if (/^[0-6]$/.test(day)) availabilitySlots[day] = strings(slots).filter(t => ['morning', 'noon', 'evening'].includes(t));
  }
  return { id, name: text(u.name, 60), ...(text(u.photoUrl, 2048) ? { photoUrl: text(u.photoUrl, 2048) } : {}), ...(text(u.avatarId, 80) ? { avatarId: text(u.avatarId, 80) } : {}),
    city: text(a.homeCity || a.preferredCity), friend: strings(viewer.friends).includes(id) && strings(u.friends).includes(viewer.id), commonClubCount, sharedRounds,
    availability: { preferredDays: Array.isArray(a.preferredDays) ? a.preferredDays.filter((d: unknown) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6) : [], preferredTimes: strings(a.preferredTimes).filter(t => ['morning', 'noon', 'evening'].includes(t)), ...(a.availabilitySlots ? { availabilitySlots } : {}), isAvailableForInvites: a.isAvailableForInvites !== false } };
}
export function socialMatches(u: Data, opts: Data): boolean {
  if (opts.text && !normalizeSocialSearch(u.name).includes(normalizeSocialSearch(opts.text))) return false;
  if (opts.city && !normalizeSocialSearch(u.city).includes(normalizeSocialSearch(opts.city))) return false;
  if (opts.friendsOnly && !u.friend) return false;
  if (opts.day !== undefined || opts.time) {
    const a = u.availability;
    if (!a || a.isAvailableForInvites === false) return false;
    if(a.availabilitySlots){
      const slots=opts.day===undefined?Object.values(a.availabilitySlots).flat():strings(a.availabilitySlots[String(opts.day)]);
      return opts.time ? slots.includes(opts.time) : slots.length>0;
    }
    const days=a.preferredDays ?? [], times=a.preferredTimes ?? [];
    return !!(days.length || times.length) && (opts.day===undefined || !days.length || days.includes(opts.day))
      && (!opts.time || !times.length || times.includes(opts.time));
  }
  return true;
}
async function session(request: CallableRequest, operation: string, cap = 100, readDirectory = false) {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new ExpectedCallableError('unauthenticated', 'Full account required');
  const db = getFirestore();
  const ref = db.collection('serverRateLimits').doc(`${uid}_social_${operation}`);
  const result = await db.runTransaction(async tx => {
    const [snap,limit,index] = await tx.getAll(db.collection('users').doc(uid),ref,...(readDirectory?[db.doc(directoryReadyPath)]:[]));
    if (!snap.exists || snap.data()?.isGuest === true) throw new HttpsError('unauthenticated', 'Account missing');
    const data = limit.data() ?? {};
    const start = Date.now() - number(data.start) < 60000 ? number(data.start) : Date.now();
    const count = start === data.start ? number(data.count) : 0;
    if (count >= cap) throw new HttpsError('resource-exhausted', 'Please wait before retrying');
    tx.set(ref, { start, count: count + 1 });
    return {user:{ ...snap.data(), id: uid } as Data, directoryGeneration:index?.get('ready')===true?number(index.get('generation')):null};
  });
  return { uid, db, ...result };
}
function validId(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 128 || /[\/\x00-\x1f]/.test(v)) throw new HttpsError('invalid-argument', 'Invalid id');
  return v;
}

/** Legacy roster/chat readers need identity, never the private user payload. */
export const getPlayerIdentities = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const { db } = await session(request, 'identities', 240);
  if (!Array.isArray(request.data?.userIds) || request.data.userIds.length > 100) throw new HttpsError('invalid-argument', 'Up to 100 ids');
  const ids = [...new Set<string>(request.data.userIds.map(validId))];
  if (!ids.length) return [];
  const docs = await db.getAll(...ids.map(id => db.doc(`users/${id}`)));
  return docs.filter(d => d.exists && !d.data()?.isGuest).map(d => identity(d.id, d.data()!));
});

function identity(id: string, u: Data) {
  const p = socialIdentity(id, u, {});
  return { id, name: p.name, ...(p.avatarId ? { avatarId: p.avatarId } : {}), ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}), createdAt: milliseconds(u.createdAt) };
}
function milliseconds(v: any): number { return typeof v?.toMillis === 'function' ? v.toMillis() : number(v); }

/** Referral attribution belongs only to its inviter, not a directory query. */
export const getMyPlayerReferrals = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const { uid, db } = await session(request, 'referrals', 60);
  if (request.data?.userId !== uid) throw new HttpsError('permission-denied', 'Owner only');
  const q = db.collection('users').where('invitedBy', '==', uid);
  if (request.data?.countOnly === true) return { count: (await q.count().get()).data().count };
  let page = q.orderBy(FieldPath.documentId()).limit(100);
  if (request.data?.cursor) page = page.startAfter(validId(request.data.cursor));
  const snap = await page.get();
  return { rows: snap.docs.map(d => {
    const u = d.data(), p = identity(d.id, u);
    return { id:p.id, name:p.name, ...(p.avatarId ? {avatarId:p.avatarId}:{}), ...(p.photoUrl ? {photoUrl:p.photoUrl}:{}),
      invitedAt:milliseconds(u.invitedAt), ...(['session','team'].includes(u.invitedByType) ? {invitedByType:u.invitedByType}:{}),
      ...(text(u.invitedByTargetId,128) ? {invitedByTargetId:text(u.invitedByTargetId,128)}:{}) };
  }), cursor: snap.size === 100 ? snap.docs[snap.size-1].id : null };
});

/** Coordinates stay on the server; only organisers can match a real round. */
export const findAvailableSocialPlayers = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const {uid,db} = await session(request,'available',30);
  const gameId=validId(request.data?.gameId);
  const g=(await db.doc(`games/${gameId}`).get()).data();
  if(!g) throw new HttpsError('not-found','Round missing');
  const club=g.groupId ? (await db.doc(`groups/${validId(g.groupId)}`).get()).data() : undefined;
  if(g.createdBy!==uid && !strings(club?.adminIds).includes(uid)) throw new HttpsError('permission-denied','Manager required');
  const at=milliseconds(g.startsAt);
  if(!at || ['finished','cancelled','canceled'].includes(g.status)) throw new HttpsError('failed-precondition','Round unavailable');
  const date=new Date(at), day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',weekday:'short'}).format(date));
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',hourCycle:'h23'}).format(date));
  const window=hour>=7&&hour<12?'morning':hour>=12&&hour<18?'noon':'evening';
  const excluded=new Set([uid,...strings(g.players),...strings(g.waitlist),...strings(g.pending),...strings(g.pendingPlayerIds),...strings(club?.playerIds),...strings(club?.adminIds)]);
  let query=db.collection('users').orderBy(FieldPath.documentId()).limit(250);
  if(request.data?.cursor) query=query.startAfter(validId(request.data.cursor));
  const pool=await query.get();
  const result:Data[]=[];
  const eligible: FirebaseFirestore.QueryDocumentSnapshot[]=[];
  for(const d of pool.docs){
    const u=d.data(), a=u.availability;
    if(excluded.has(d.id)||u.isGuest||!socialPrivacy(u).discoverable||!a||a.isAvailableForInvites===false)continue;
    if(a.availabilitySlots){ if(!strings(a.availabilitySlots[String(day)]).includes(window))continue; }
    else { if(Array.isArray(a.preferredDays)&&a.preferredDays.length&&!a.preferredDays.includes(day))continue;
      if(strings(a.preferredTimes).length&&!strings(a.preferredTimes).includes(window))continue; }
    const lat=g.fieldLat??club?.lat,lng=g.fieldLng??club?.lng;
    if([lat,lng,a.homeCityLat,a.homeCityLng].every(v=>typeof v==='number'&&Number.isFinite(v))){
      const rad=(v:number)=>v*Math.PI/180, deltaLat=rad(a.homeCityLat-lat),deltaLng=rad(a.homeCityLng-lng);
      const h=Math.sin(deltaLat/2)**2+Math.cos(rad(lat))*Math.cos(rad(a.homeCityLat))*Math.sin(deltaLng/2)**2;
      if(6371*2*Math.asin(Math.sqrt(Math.min(1,h)))>(number(a.availabilityRadiusKm)||20))continue;
    }else if(club?.city&&(a.homeCity||a.preferredCity)&&normalizeSocialSearch(club.city)!==normalizeSocialSearch(a.homeCity||a.preferredCity))continue;
    eligible.push(d);
  }
  for(let i=0;i<eligible.length;i+=50){
    const batch=eligible.slice(i,i+50);
    const blocks=await db.getAll(...batch.flatMap(d=>[db.doc(`users/${uid}/blocked/${d.id}`),db.doc(`users/${d.id}/blocked/${uid}`)]));
    for(const [j,d] of batch.entries()){
      if(blocks[2*j].exists || blocks[2*j+1].exists)continue;
      const u=d.data(), a=u.availability;
      result.push({...identity(d.id,u),availability:{preferredCity:text(a.homeCity||a.preferredCity)}});
      if(result.length===50)return {players:result,cursor:pool.size===250 || d.id!==pool.docs[pool.size-1].id ? d.id : null};
    }
  }
  return {players:result,cursor:pool.size===250 ? pool.docs[249].id : null};
});
async function blocked(a: string, b: string, tx?: FirebaseFirestore.Transaction) {
  const db = getFirestore();
  const refs=[db.doc(`users/${a}/blocked/${b}`),db.doc(`users/${b}/blocked/${a}`)];
  const docs = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
  return docs.some(d => d.exists);
}
export async function assertSocialContact(a: string, b: string, tx?: FirebaseFirestore.Transaction) {
  if (await blocked(a,b,tx)) throw new HttpsError('permission-denied','Contact blocked');
}
export const checkSocialMessaging = onCall({enforceAppCheck: ENFORCE_APP_CHECK},async request=>{
  const {uid,user,db}=await session(request,'message',120);
  const targetId=validId(request.data?.userId);
  await assertSocialContact(uid,targetId);
  const target=(await db.doc(`users/${targetId}`).get()).data();
  const approved=(await db.doc(`dmConversations/${[uid,targetId].sort().join('__')}`).get()).data()?.messagingApproved===true;
  if(!target||target.isGuest===true||!approved&&(!strings(user.friends).includes(targetId)||!strings(target.friends).includes(uid)))throw new HttpsError('permission-denied','Approved conversation required');
  return {allowed:true};
});

export const sendSocialFriendRequest = onCall({enforceAppCheck: ENFORCE_APP_CHECK},async request=>{
  const {uid,db}=await session(request,'friend',20);
  const targetId=validId(request.data?.userId);
  if(uid===targetId)throw new HttpsError('invalid-argument','Self request');
  const meRef=db.doc(`users/${uid}`),otherRef=db.doc(`users/${targetId}`);
  const mine=db.doc(`friendRequests/${uid}__${targetId}`),theirs=db.doc(`friendRequests/${targetId}__${uid}`);
  return db.runTransaction(async tx=>{
    const [me,other,outgoing,incoming,blockA,blockB]=await Promise.all([tx.get(meRef),tx.get(otherRef),tx.get(mine),tx.get(theirs),tx.get(db.doc(`users/${uid}/blocked/${targetId}`)),tx.get(db.doc(`users/${targetId}/blocked/${uid}`))]);
    if(!me.exists||!other.exists||other.data()?.isGuest)throw new HttpsError('not-found','Player missing');
    if(blockA.exists||blockB.exists)throw new HttpsError('permission-denied','Contact blocked');
    if(strings(me.data()?.friends).includes(targetId)&&strings(other.data()?.friends).includes(uid))return {status:'friends'};
    if(outgoing.data()?.status==='declined')throw new HttpsError('failed-precondition','Request declined');
    if(incoming.data()?.status==='pending'){
      tx.update(theirs,{status:'accepted',updatedAt:Date.now()});
      if(outgoing.exists)tx.update(mine,{status:'accepted',updatedAt:Date.now()});
      tx.set(db.doc(`notifications/social-accepted-${theirs.id}`),{type:'friendRequestAccepted',recipientId:targetId,payload:{fromUserId:uid,fromName:text(me.data()?.name)},createdAt:Date.now(),delivered:false});
      tx.update(meRef,{friends:FieldValue.arrayUnion(targetId)});tx.update(otherRef,{friends:FieldValue.arrayUnion(uid)});
      return {status:'friends'};
    }
    if(outgoing.data()?.status==='pending')return {status:'outgoing'};
    tx.set(mine,{id:mine.id,fromUserId:uid,toUserId:targetId,status:'pending',createdAt:Date.now()});
    return {status:'outgoing'};
  });
});
async function clubsFor(uid: string) {
  return getFirestore().collection('groups').where(Filter.or(Filter.where('playerIds', 'array-contains', uid), Filter.where('adminIds', 'array-contains', uid))).get();
}
function clubView(id: string, g: Data) {
  return { id, name: text(g.name), city: text(g.city), isOpen: g.isOpen === true, ...(text(g.coverImageId) ? { coverImageId: text(g.coverImageId) } : {}), ...(text(g.coverPhotoUrl, 2048) ? { coverPhotoUrl: text(g.coverPhotoUrl, 2048) } : {}) };
}

type SearchContext = { common: Map<string,number>; shared: Map<string,number> };
async function searchContext(db: FirebaseFirestore.Firestore, uid: string): Promise<SearchContext> {
  const [clubs,games] = await Promise.all([clubsFor(uid),db.collection('games').where('participantIds','array-contains',uid).get()]);
  const common=new Map<string,number>(), shared=new Map<string,number>();
  for(const doc of clubs.docs) {
    const g=doc.data();
    for(const id of new Set([...strings(g.playerIds),...strings(g.adminIds)]))common.set(id,(common.get(id)??0)+1);
  }
  for(const doc of games.docs) {
    const g=doc.data(), roster=strings(g.players);
    if(g.status!=='finished' || number(g.startsAt)>=Date.now() || !roster.includes(uid) || g.arrivals?.[uid]==='no_show' || !didEveningHappen(g))continue;
    for(const id of new Set(roster))if(g.arrivals?.[id]!=='no_show')shared.set(id,(shared.get(id)??0)+1);
  }
  return {common,shared};
}
const pageSize=40;
type SearchCandidates={docs:FirebaseFirestore.DocumentSnapshot[];cursor:string|null};
async function candidatePage(db:FirebaseFirestore.Firestore, user:Data, opts:Data, context:()=>Promise<SearchContext>, generation:number|null):Promise<SearchCandidates> {
  const upgraded=opts.searchVersion===2, name=normalizeSocialSearch(opts.text??'');
  const cursor=opts.cursor;
  const readIds=async(ids:string[])=>ids.length?db.getAll(...ids.map(id=>db.collection('users').doc(id))):[];
  if(upgraded && (opts.friendsOnly || (!name && !opts.city && opts.day===undefined && !opts.time && !opts.filtered))) {
    const friends=new Set(strings(user.friends)), c=opts.friendsOnly?null:await context();
    const preferred=new Set(opts.friendsOnly?friends:[...friends,...c!.shared.keys(),...c!.common.keys()]);
    preferred.delete(user.id);
    const regional=[...preferred].sort((a,b)=>(c?.shared.get(b)??0)-(c?.shared.get(a)??0) ||
      (c?.common.get(b)??0)-(c?.common.get(a)??0) || Number(friends.has(b))-Number(friends.has(a)) || a.localeCompare(b));
    if((!cursor || cursor.startsWith('p:')) && (regional.length || opts.friendsOnly || cursor)) {
      const offset=Number(cursor?.slice(2)??0);
      if(!Number.isSafeInteger(offset)||offset<0)throw new HttpsError('invalid-argument','Invalid page');
      const ids=regional.slice(offset,offset+pageSize);
      if(!opts.friendsOnly && ids.length<pageSize){
        const [first,ordinary]=await Promise.all([readIds(ids),db.collection('users').orderBy(FieldPath.documentId()).limit(pageSize).get()]);
        const docs=[...first];
        for(const d of ordinary.docs){
          if(!preferred.has(d.id) && d.id!==user.id)docs.push(d);
          if(docs.length===pageSize)return {docs,cursor:'r:'+d.id};
        }
        return {docs,cursor:ordinary.size===pageSize?'r:'+ordinary.docs[pageSize-1].id:null};
      }
      return {docs:await readIds(ids),cursor:offset+ids.length<regional.length?'p:'+(offset+ids.length):opts.friendsOnly?null:'r:'};
    }
    let q=db.collection('users').orderBy(FieldPath.documentId()).limit(pageSize);
    if(cursor && !cursor.startsWith('r:'))throw new HttpsError('invalid-argument','Invalid page');
    if(cursor?.slice(2))q=q.startAfter(validId(cursor.slice(2)));
    const page=await q.get();
    return {docs:page.docs.filter(d=>!preferred.has(d.id)),cursor:page.size===pageSize?'r:'+page.docs[pageSize-1].id:null};
  }
  if(upgraded && name && generation!==null && (!cursor || cursor.startsWith('i:'))){
    const page=await indexedNamePage(db,name,cursor?validId(cursor.slice(2)):undefined,generation,pageSize);
    return {docs:await readIds(page.ids),cursor:page.cursor};
  }
  let q=db.collection('users').orderBy(FieldPath.documentId()).limit(pageSize);
  if(cursor)q=q.startAfter(validId(upgraded && (cursor.startsWith('s:')||cursor.startsWith('i:'))?cursor.slice(2):cursor));
  const page=await q.get();
  return {docs:page.docs,cursor:page.size===pageSize?(upgraded?'s:':'')+page.docs[pageSize-1].id:null};
}

export const searchSocialPlayers = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const opts = request.data ?? {};
  const { uid, user, db, directoryGeneration } = await session(request, 'search', 90,opts.searchVersion===2 && !!opts.text && !opts.friendsOnly);
  if (typeof opts.text !== 'undefined' && (typeof opts.text !== 'string' || opts.text.length > 60) || typeof opts.city !== 'undefined' && (typeof opts.city !== 'string' || opts.city.length > 120)) throw new HttpsError('invalid-argument', 'Invalid search');
  if (opts.day !== undefined && (!Number.isInteger(opts.day) || opts.day < 0 || opts.day > 6)) throw new HttpsError('invalid-argument', 'Invalid day');
  if (opts.time !== undefined && !['morning', 'noon', 'evening'].includes(opts.time)) throw new HttpsError('invalid-argument', 'Invalid time');
  if(opts.cursor && (typeof opts.cursor!=='string'||opts.cursor.length>140))throw new HttpsError('invalid-argument','Invalid page');
  let pending:Promise<SearchContext>|undefined;
  const context=()=>pending??=(searchContext(db,uid));
  const {docs,cursor}=await candidatePage(db,user,opts,context,directoryGeneration);
  const candidates=docs.flatMap(doc=>{
    const u=doc.data();
    if(!u || doc.id===uid || u.isGuest || !socialPrivacy(u).discoverable || !text(u.name))return [];
    const player=socialIdentity(doc.id,u,user);
    return socialMatches(player,opts)?[player]:[];
  });
  if(!candidates.length)return {players:[],cursor};
  const includeRelationship=opts.searchVersion===2;
  const refs=candidates.flatMap(p=>[
    db.doc(`users/${uid}/blocked/${p.id}`),db.doc(`users/${p.id}/blocked/${uid}`),
    ...(includeRelationship && !p.friend?[db.doc(`friendRequests/${uid}__${p.id}`),db.doc(`friendRequests/${p.id}__${uid}`)]:[]),
  ]);
  const [c,checks]=await Promise.all([context(),db.getAll(...refs)]);
  const checked=new Map(checks.map(d=>[d.ref.path,d]));
  const players=candidates.flatMap(p=>{
    if(checked.get(`users/${uid}/blocked/${p.id}`)?.exists || checked.get(`users/${p.id}/blocked/${uid}`)?.exists)return [];
    const out=checked.get(`friendRequests/${uid}__${p.id}`)?.get('status'), incoming=checked.get(`friendRequests/${p.id}__${uid}`)?.get('status');
    const relationship=p.friend?'friends':out==='pending'?'outgoing':incoming==='pending'?'incoming':out==='declined'?'rejected':'none';
    return [{...p,commonClubCount:c.common.get(p.id)??0,sharedRounds:c.shared.get(p.id)??0,...(includeRelationship?{relationship}:{})}];
  });
  const term=normalizeSocialSearch(opts.text??'');
  const rank=(name:string)=>!term?0:normalizeSocialSearch(name)===term?2:Number(normalizeSocialSearch(name).startsWith(term));
  players.sort((a,b)=>rank(b.name)-rank(a.name) || b.sharedRounds-a.sharedRounds || b.commonClubCount-a.commonClubCount || Number(b.friend)-Number(a.friend) || a.name.localeCompare(b.name,'he'));
  return {players,cursor};
});

export const setSocialPrivacy = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const { uid, db } = await session(request, 'privacy', 20);
  const p = request.data;
  if (typeof p?.discoverable !== 'boolean' || !['everyone', 'friends', 'onlyMe'].includes(p.statistics)) throw new HttpsError('invalid-argument', 'Invalid privacy');
  await db.doc(`users/${uid}`).update({ socialPrivacy: { discoverable: p.discoverable, statistics: p.statistics }, updatedAt: Date.now() });
  return { discoverable: p.discoverable, statistics: p.statistics };
});

export const getSocialPlayerProfile = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const { uid, user: viewer, db } = await session(request, 'profile', 90);
  const targetId = validId(request.data?.userId);
  const card=request.data?.view==='card', summary=request.data?.view==='summary';
  const pairId=[uid,targetId].sort().join('__');
  const [target,blockA,blockB,conv,privateState]=await db.getAll(db.doc(`users/${targetId}`),
    db.doc(`users/${uid}/blocked/${targetId}`),db.doc(`users/${targetId}/blocked/${uid}`),
    ...(card?[db.doc(`dmConversations/${pairId}`),db.doc(`dmRequestState/${pairId}`)]:[]));
  if (!target.exists || target.data()?.isGuest || blockA.exists || blockB.exists) throw new HttpsError('not-found', 'Player unavailable');
  const u = target.data()!;
  const canSeeStatistics = statisticsAllowed(uid, targetId, u, viewer);
  if(card){
    const player=socialIdentity(targetId,u,viewer);
    const access=dmStatus(uid,{blocked:false,friends:player.friend,approved:conv?.get('messagingApproved')===true,
      accepts:u.dmRequestPolicy==='everyone',request:privateState?.data() as DmRequest|undefined});
    return {player,canSeeStatistics,statisticsVisibility:socialPrivacy(u).statistics,detailsPending:true,
      messaging:access==='compose'?'request':access==='unavailable' && !conv?.exists?'unavailable':'conversation',
      clubs:[],statistics:null,together:null};
  }
  const [clubs, games, pair, statisticRows, ownUpcoming] = await Promise.all([clubsFor(targetId), db.collection('games').where('participantIds', 'array-contains', targetId).get(), db.doc(`pairStats/${pairId}`).get(), canSeeStatistics && !summary ? readStatisticsRows(targetId) : null,
    summary?db.collection('games').where('createdBy','==',uid).where('startsAt','>',Date.now()).select('status').get():null]);
  const played = games.docs.filter(d => { const g = d.data(); return g.status === 'finished' && number(g.startsAt) < Date.now() && strings(g.players).includes(targetId) && g.arrivals?.[targetId] !== 'no_show' && didEveningHappen(g); });
  const shared = played.filter(d => strings(d.data().players).includes(uid) && d.data().arrivals?.[uid] !== 'no_show').length;
  const common = clubs.docs.filter(d => strings(d.data().playerIds).includes(uid) || strings(d.data().adminIds).includes(uid)).length;
  const p = pair.data();
  const gamesTogether = number(p?.sameTeam), wins = number(p?.winsTogether), losses = number(p?.lossesTogether);
  const together = p && ['sameTeam','winsTogether','lossesTogether'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0) && gamesTogether >= wins + losses ? { rounds: shared, games: gamesTogether, wins, losses, ties: gamesTogether - wins - losses } : null;
  const registered=games.docs.filter(d=>{const g=d.data();return g.status==='finished'&&number(g.startsAt)<Date.now()&&strings(g.players).includes(targetId)&&didEveningHappen(g);}).length;
  const statistics = statisticRows ? await readStatistics(targetId, u, played, registered, statisticRows) : null;
  const sharedDates = played.filter(d => strings(d.data().players).includes(uid) && d.data().arrivals?.[uid] !== 'no_show').map(d => number(d.data().startsAt));
  return { ...(summary?{canInviteCreated:ownUpcoming?.docs.some(d=>d.get('status')==='open')??false,cardStats:canSeeStatistics?{attendedGames:played.length,goals:number(u.stats?.goals),assists:number(u.stats?.assists)}:null}:{}), player: socialIdentity(targetId, u, viewer, common, shared), clubs: clubs.docs.filter(d => !d.data().isPersonal && !d.data().deletedAt).map(d => ({ ...clubView(d.id, d.data()), isCommon: strings(d.data().playerIds).includes(uid) || strings(d.data().adminIds).includes(uid) })), canSeeStatistics, statisticsVisibility: socialPrivacy(u).statistics, statistics, together, pairSummary: socialPairSummary(uid, targetId, p, sharedDates) };
});

async function readStatisticsRows(uid: string) {
  const db = getFirestore();
  return Promise.all([
    db.collection('eveningStandings').where('userId', '==', uid).get(), db.collection('gamePlayerStats').where('userId', '==', uid).get(),
    db.collection('pairStats').where('a', '==', uid).get(), db.collection('pairStats').where('b', '==', uid).get(),
  ]);
}
async function readStatistics(uid: string, u: Data, played: FirebaseFirestore.QueryDocumentSnapshot[], registered: number, records: Awaited<ReturnType<typeof readStatisticsRows>>) {
  const db = getFirestore();
  const [standings, rows, asA, asB] = records;
  const playedIds = new Set(played.map(d => d.id));
  const co: Record<string, number> = {};
  for (const d of played) for (const id of strings(d.data().players)) if (id !== uid && d.data().arrivals?.[id] !== 'no_show') co[id] = (co[id] ?? 0) + 1;
  const top = (map: Record<string, number>) => { const entry = Object.entries(map).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))[0]; return entry && entry[1] > 0 ? {uid:entry[0],count:entry[1]} : null; };
  const maps = { wins: {} as Record<string,number>, victim: {} as Record<string,number>, nemesis: {} as Record<string,number>, to: {} as Record<string,number>, from: {} as Record<string,number> };
  const mostPlayedWith = top(co);
  let regularPartnerResults = null;
  for (const d of [...asA.docs, ...asB.docs]) {
    const x = d.data(), isA = x.a === uid, other = isA ? x.b : x.a;
    if (typeof other !== 'string') continue;
    maps.wins[other] = number(x.winsTogether); maps.victim[other] = number(isA ? x.winsA : x.winsB); maps.nemesis[other] = number(isA ? x.winsB : x.winsA);
    maps.to[other] = number(isA ? x.assistsAToB : x.assistsBToA); maps.from[other] = number(isA ? x.assistsBToA : x.assistsAToB);
    if (other === mostPlayedWith?.uid && ['sameTeam','winsTogether','lossesTogether'].every(k=>typeof x[k]==='number'&&Number.isFinite(x[k])&&x[k]>=0) && number(x.sameTeam) > 0 && number(x.sameTeam) >= number(x.winsTogether) + number(x.lossesTogether)) regularPartnerResults = { games: number(x.sameTeam), wins: number(x.winsTogether), losses: number(x.lossesTogether), ties: number(x.sameTeam)-number(x.winsTogether)-number(x.lossesTogether), winRate: Math.round(number(x.winsTogether)/number(x.sameTeam)*100) };
  }
  const recent = [...played].sort((a,b)=>number(a.data().startsAt)-number(b.data().startsAt) || a.id.localeCompare(b.id)).slice(-5);
  const scoreMap = new Map(standings.docs.map(d=>[d.data().gameId,d.data().score]));
  const points = recent.flatMap(d=> { const score=scoreMap.get(d.id); return typeof score==='number' && Number.isFinite(score) && score>=0 && score<=10 ? [{gameId:d.id,at:number(d.data().startsAt),score}] : []; });
  const results = { wins:0,losses:0,ties:0,games:0,rounds:0 };
  let bestGoals: number|null=null,bestAssists: number|null=null,recordedRounds=0;
  const validRecorded = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  for(const d of rows.docs) {
    const r=d.data();if(!playedIds.has(r.gameId))continue;
    if(validRecorded(r.goals))bestGoals=Math.max(bestGoals??0,r.goals);
    if(validRecorded(r.assists))bestAssists=Math.max(bestAssists??0,r.assists);
    if(validRecorded(r.goals)||validRecorded(r.assists))recordedRounds++;
    const g=r.rounds,w=r.wins===undefined?0:r.wins,l=r.losses===undefined?0:r.losses;
    if(![g,w,l].every(v=>validRecorded(v)&&Number.isInteger(v))||g<=0||w+l>g)continue;
    results.games+=g;results.wins+=w;results.losses+=l;results.ties+=g-w-l;results.rounds++;
  }
  const goals=number(u.stats?.goals),assists=number(u.stats?.assists);
  const stats={attendedGames:played.length,totalRegistered:registered,attendanceRate:registered?Math.round(played.length/registered*100):0,goals,assists,goalsPerEvening:played.length?Math.round(goals/played.length*10)/10:0,distinctPlayers:Object.keys(co).length,mostPlayedWith,regularPartnerResults,mostWinsWith:top(maps.wins),biggestVictim:top(maps.victim),nemesis:top(maps.nemesis),mostAssistedTo:top(maps.to),mostAssistedBy:top(maps.from),highlights:{points,recentCount:recent.length,bestGoals,bestAssists,recordedRounds,incomplete:false,results:results.rounds?results:null}};
  const ids=[...new Set([stats.mostPlayedWith,stats.mostWinsWith,stats.biggestVictim,stats.nemesis,stats.mostAssistedTo,stats.mostAssistedBy].flatMap(x=>x?[x.uid]:[]))];
  const people:Record<string,unknown>={};
  if(ids.length)for(const d of await db.getAll(...ids.map(id=>db.doc(`users/${id}`))))if(d.exists){const p=socialIdentity(d.id,d.data()!,{});people[d.id]={id:p.id,name:p.name,...(p.avatarId?{avatarId:p.avatarId}:{}),...(p.photoUrl?{photoUrl:p.photoUrl}:{})};}
  return {stats,people,pen:Object.fromEntries(['penTaken','penScored','penInPlayTaken','penInPlayScored','penFaced','penSaved','ownGoals','ties'].map(k=>[k,number(u.stats?.[k])]))};
}

/** Invitation notification only. Existing join flow retains member approval. */
export const inviteSocialPlayerToClub = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const {uid,user,db}=await session(request,'invite',20);
  const groupId=validId(request.data?.groupId),targetId=validId(request.data?.userId);
  return sendClubInvitation(db,uid,user,groupId,targetId,true);
});

export async function sendClubInvitation(db: ReturnType<typeof getFirestore>, uid: string, user: Data, groupId: string, targetId: string, managerOnly = false) {
  validId(groupId);validId(targetId);
  if(uid===targetId)throw new HttpsError('failed-precondition','Player unavailable');
  const gref=db.doc(`groups/${groupId}`),targetRef=db.doc(`users/${targetId}`);
  const marker=db.doc(`serverRateLimits/socialClubInvite_${createHash('sha256').update(JSON.stringify([groupId,targetId])).digest('hex')}`);
  const result=await db.runTransaction(async tx=>{
    const [gs,us,last,rejections,contactBlocked]=await Promise.all([tx.get(gref),tx.get(targetRef),tx.get(marker),tx.get(db.collection('joinRequests').where('groupId','==',groupId).where('userId','==',targetId).where('status','==','rejected')),blocked(uid,targetId,tx)]);const g=gs.data();
    if(contactBlocked)throw new HttpsError('failed-precondition','Player unavailable');
    if(!g||!us.exists||us.data()?.isGuest)throw new HttpsError('not-found','Not found');
    const manager=strings(g.adminIds).includes(uid);
    if(managerOnly?!manager:![...strings(g.adminIds),...strings(g.playerIds)].includes(uid))throw new HttpsError('permission-denied','Manager or member required');
    if(g.isPersonal||g.deletedAt)throw new HttpsError('failed-precondition','Club unavailable');
    if([...strings(g.playerIds),...strings(g.adminIds)].includes(targetId))return {invited:false,reason:'already_member'};
    if(strings(g.pendingPlayerIds).includes(targetId))return {invited:false,reason:'pending'};
    if(!rejections.empty)return {invited:false,reason:'rejected'};
    const prior=g.approvedInvites?.[targetId];
    const alreadyApproved=number(prior?.expiresAt)>Date.now()&&strings(g.adminIds).includes(prior?.inviterId);
    if(Date.now()-number(last.data()?.createdAt)<86400000&&(!manager||alreadyApproved))return {invited:false,reason:'already_invited'};
    tx.set(marker,{createdAt:Date.now()});
    const expiresAt=Date.now()+7*86400000;
    if(manager)tx.update(gref,{approvedInvites:{...(g.approvedInvites??{}),[targetId]:{inviterId:uid,expiresAt}},updatedAt:Date.now()});
    tx.create(db.collection('notifications').doc(),{type:'groupInvitation',recipientId:targetId,payload:{groupId,groupName:text(g.name),inviterId:uid,inviterName:text(user.name),invitationOnly:true,managerApproved:manager,expiresAt},createdAt:Date.now(),delivered:false});
    return {invited:true};
  });
  return result;
}

/** Canonical, atomic join without a member cap. A manager invitation substitutes approval. */
export const joinSocialClub = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const {uid,db}=await session(request,'joinClub',30),groupId=validId(request.data?.groupId);
  const ref=db.collection('groups').doc(groupId);
  return db.runTransaction(async tx=>{
    const [snap,requests,notices]=await Promise.all([tx.get(ref),tx.get(db.collection('joinRequests').where('groupId','==',groupId).where('userId','==',uid)),tx.get(db.collection('notifications').where('recipientId','==',uid))]);
    const g=snap.data();if(!g||g.deletedAt||g.isPersonal)throw new HttpsError('not-found','Club unavailable');
    const players=strings(g.playerIds),admins=strings(g.adminIds),pending=strings(g.pendingPlayerIds);
    if([...players,...admins].includes(uid))return {status:'joined'};
    if(requests.docs.some(d=>d.get('status')==='rejected'))throw new HttpsError('failed-precondition','GROUP_JOIN_REJECTED');
    // Legacy manager invitations are trusted only from canonical, recipient-
    // bound notification documents, while the inviter is still a manager.
    const legacy=notices.docs.map(d=>d.data()).filter(n=>n.type==='groupInvitation'&&n.payload?.groupId===groupId&&admins.includes(n.payload?.inviterId)&&
      (number(n.payload?.expiresAt)||milliseconds(n.createdAt)+7*86400000)>Date.now()).sort((a,b)=>milliseconds(b.createdAt)-milliseconds(a.createdAt))[0];
    const grant=g.approvedInvites?.[uid]??(legacy?{inviterId:legacy.payload.inviterId,expiresAt:number(legacy.payload.expiresAt)||milliseconds(legacy.createdAt)+7*86400000}:undefined);
    let approved=!!grant&&number(grant.expiresAt)>Date.now()&&admins.includes(grant.inviterId);
    if(approved){
      const [a,b]=await Promise.all([tx.get(db.doc(`users/${uid}/blocked/${grant.inviterId}`)),tx.get(db.doc(`users/${grant.inviterId}/blocked/${uid}`))]);
      if(a.exists||b.exists)throw new HttpsError('permission-denied','Invitation unavailable');
    }
    if(g.isOpen||approved){
      tx.update(ref,{playerIds:FieldValue.arrayUnion(uid),pendingPlayerIds:FieldValue.arrayRemove(uid),updatedAt:Date.now()});
      requests.docs.filter(d=>d.get('status')==='pending').forEach(d=>tx.update(d.ref,{status:'approved',decidedAt:Date.now(),decidedBy:approved?grant.inviterId:uid,updatedAt:Date.now()}));
      return {status:'joined'};
    }
    if(!pending.includes(uid))tx.update(ref,{pendingPlayerIds:FieldValue.arrayUnion(uid),updatedAt:Date.now()});
    if(!requests.docs.some(d=>d.get('status')==='pending')){
      const r=db.collection('joinRequests').doc();tx.create(r,{id:r.id,groupId,userId:uid,status:'pending',createdAt:Date.now()});
    }
    return {status:'pending'};
  });
});

/** Recipient-only inbox; resolves stale targets without exposing private club data. */
export const getReceivedInvitations = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const {uid,db}=await session(request,'receivedInvitations',60);
  const snap=await db.collection('notifications').where('recipientId','==',uid).get();
  const rows=snap.docs.filter(d=>['groupInvitation','inviteToGame'].includes(d.get('type')));
  const contacts=new Map<string,Promise<boolean>>();
  const blockedInviter=(id:unknown)=>{
    if(typeof id!=='string'||!id||id.length>128||id.includes('/'))return false;
    if(!contacts.has(id))contacts.set(id,blocked(uid,id));
    return contacts.get(id)!;
  };
  return Promise.all(rows.map(async notice=>{
    const data=notice.data(),p=data.payload??{},club=data.type==='groupInvitation';
    const targetId=club?p.groupId:p.gameId;
    if(typeof targetId!=='string'||!targetId||targetId.includes('/'))return {id:notice.id,data:{...data,invitationStatus:'unavailable'}};
    const target=(await db.collection(club?'groups':'games').doc(targetId).get()).data();
    let state='available';
    if(!target||target.deletedAt||target.isPersonal&&club)state='unavailable';
    else if((club?[...strings(target.playerIds),...strings(target.adminIds)]:[...strings(target.players),...strings(target.waitlist)]).includes(uid))state='joined';
    else if(await blockedInviter(p.inviterId||data.createdByUid))state='unavailable';
    else if(number(p.expiresAt)>0&&number(p.expiresAt)<=Date.now())state='expired';
    else if(strings(club?target.pendingPlayerIds:target.pending).includes(uid))state='pending';
    else if(!club&&(!['open','scheduled'].includes(target.status)||target.liveMatch?.phase==='live'||number(target.startsAt)+3600000<Date.now()))state='unavailable';
    else if(!club&&target.status==='scheduled')state='scheduled';
    return {id:notice.id,data:{...data,invitationStatus:state}};
  }));
});

import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { createHash } from 'crypto';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { retainOccurrences } from './diagnosticOccurrences';

export function clientErrorFields(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpsError('invalid-argument','Invalid error');
  const d=data as Record<string,unknown>, out:Record<string,unknown>={};
  for (const [key,max] of Object.entries({operation:80,title:200,lastMessage:2000,lastCode:100,lastStack:1500,lastTrail:6000,lastJournal:60000,lastScreen:80,platform:16,osVersion:100,appVersion:100})) {
    if (typeof d[key]==='string') out[key]=(d[key] as string).slice(0,max);
  }
  if (!out.operation) throw new HttpsError('invalid-argument','Operation required');
  out.category=['silent','crash','action'].includes(String(d.category))?d.category:'action';
  if(d.lastContext && typeof d.lastContext==='object' && !Array.isArray(d.lastContext)) {
    const json=JSON.stringify(d.lastContext);
    if(json.length<=4000)out.lastContext=JSON.parse(json);
  }
  out.lastContext ??= {};
  return out;
}

export function errorFingerprint(fields: Record<string,unknown>): string {
  const message=String(fields.lastMessage??'').replace(/[0-9a-f]{6,}/gi,'#').replace(/\d+/g,'#').slice(0,200);
  return createHash('sha256').update(`${fields.operation}|${message}`).digest('hex').slice(0,32);
}

// Anonymous Firebase sessions are legitimate during onboarding. No client gets
// to set another user's identity, moderation state, timestamps or arbitrary fields.
export const recordClientError=onCall({enforceAppCheck: ENFORCE_APP_CHECK},async request=>{
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','Session required');
  const fields=clientErrorFields(request.data), db=getFirestore(), now=Date.now();
  const fingerprint=errorFingerprint(fields);
  const count=request.data?.count;
  if(!Number.isInteger(count)||count<1||count>1000000)throw new HttpsError('invalid-argument','Invalid count');
  const ref=db.doc(`errors/${fingerprint}`), limit=db.doc(`serverRateLimits/${uid}_diagnostics`);
  const deliveryId = request.data?.deliveryId;
  if (deliveryId !== undefined && (typeof deliveryId !== 'string' || !/^[a-z0-9-]{10,100}$/.test(deliveryId))) throw new HttpsError('invalid-argument','Invalid delivery id');
  const receipt = deliveryId ? db.doc(`serverRateLimits/${uid}_diagnostic_${deliveryId}`) : undefined;
  await db.runTransaction(async tx=>{
    if (receipt && (await tx.get(receipt)).exists) return;
    const [existing,quota]=await Promise.all([tx.get(ref),tx.get(limit)]);
    const previous=quota.data()??{}, start=typeof previous.start==='number'&&now-previous.start<3600000?previous.start:now;
    const used=start===previous.start&&typeof previous.count==='number'?previous.count:0;
    if(used>=1000)throw new HttpsError('resource-exhausted','Diagnostic rate limit');
    tx.set(limit,{start,count:used+1,expiresAt:Timestamp.fromMillis(now+86400000)});
    // Only server-constructed evidence fields are retained. Identity always comes from auth.
    const incoming=Array.isArray(request.data?.occurrences)?request.data.occurrences.slice(0,3):[];
    const samples=incoming.flatMap((sample:unknown)=>{
      if(!sample||typeof sample!=='object')return [];
      const s=sample as Record<string,unknown>;
      if(typeof s.id!=='string'||!/^[a-z0-9-]{10,100}$/.test(s.id)||typeof s.capturedAt!=='number'||!Number.isFinite(s.capturedAt))return [];
      const safe=clientErrorFields({...s,operation:fields.operation,category:fields.category});
      // The journal is already bounded by the client; reject oversized samples rather than truncating JSON.
      if(typeof safe.lastJournal==='string'&&safe.lastJournal.length>20000)delete safe.lastJournal;
      return [{...safe,id:s.id,capturedAt:s.capturedAt,userId:uid,receivedAt:now}];
    });
    if(!samples.length)samples.push({...fields,id:deliveryId??`${now.toString(36)}-legacy`,capturedAt:now,userId:uid,receivedAt:now});
    const occurrences=retainOccurrences(existing.data()?.occurrences,samples);
    tx.set(ref,{...fields,occurrences,fingerprint,lastUserId:uid,lastSeen:FieldValue.serverTimestamp(),count:FieldValue.increment(count),
      ...(!existing.exists?{status:'new',firstSeen:FieldValue.serverTimestamp()}:{}),
    },{merge:true});
    if (receipt) tx.set(receipt, {fingerprint, expiresAt: Timestamp.fromMillis(now + 30 * 86400000)});
  });
  return {accepted:true};
});

import { cached } from './cache';
import { config } from '../config';
import { googleAccessToken } from './auth';
import { pulseFetch } from './adminTransport';

/** Explicit allowlist: account metadata only, never password hashes, salts or credentials. */
export function mapAuthRecord(u: Record<string, any>): Record<string, unknown> {
  const number = (v: unknown) => v != null && Number.isFinite(Number(v)) ? Number(v) : undefined;
  const refresh = typeof u.lastRefreshAt === 'string' ? Date.parse(u.lastRefreshAt) : undefined;
  return {
    id:u.localId,name:u.displayName,email:u.email,phoneNumber:u.phoneNumber,emailVerified:u.emailVerified,disabled:u.disabled,
    createdAt:number(u.createdAt),lastLoginAt:number(u.lastLoginAt),lastActiveAt:refresh && Number.isFinite(refresh) ? refresh : undefined,
    sessionsValidSince:u.validSince ? Number(u.validSince)*1000 : undefined,
    providers:Array.isArray(u.providerUserInfo) ? u.providerUserInfo.map((p:Record<string,unknown>)=>({providerId:p.providerId,id:p.rawId ?? p.federatedId,email:p.email,name:p.displayName})) : [],
  };
}
/** The existing admin policy permits batchGet, not per-account lookup. Shared, explicit sync only. */
export function fetchAuthRecords(force=false): Promise<Record<string,unknown>[]> {
  return cached('user-auth-records',async()=>{
    const token=await googleAccessToken('https://www.googleapis.com/auth/cloud-platform');
    const rows:Record<string,unknown>[]=[];const seen=new Set<string>();let page='';
    do {
      if(seen.has(page))throw new Error('PULSE_AUTH_PAGINATION_LOOP');seen.add(page);
      const res=await pulseFetch(`https://identitytoolkit.googleapis.com/v1/projects/${config.firebase.projectId}/accounts:batchGet?maxResults=500${page?`&nextPageToken=${encodeURIComponent(page)}`:''}`,{headers:{Authorization:`Bearer ${token}`}});
      if(!res.ok)throw new Error(`PULSE_AUTH_${res.status}`);
      const data=await res.json();for(const u of data.users ?? [])rows.push(mapAuthRecord(u));page=data.nextPageToken ?? '';
    }while(page);
    return rows;
  },{force});
}
export async function fetchUserAuthRecord(uid:string,force=false){return (await fetchAuthRecords(force)).find(row=>row.id===uid) ?? null;}

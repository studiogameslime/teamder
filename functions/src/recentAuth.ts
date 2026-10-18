import { HttpsError } from 'firebase-functions/v2/https';

/** Refreshing an ID token does not refresh auth_time; only reauthentication does. */
export function requireRecentAuth(authTime: unknown, now=Date.now()): void {
  const seconds=now/1000;
  if(typeof authTime!=='number'||!Number.isFinite(authTime)||authTime<=0||seconds-authTime>300||authTime-seconds>60)
    throw new HttpsError('failed-precondition','AUTH_REQUIRES_RECENT_LOGIN');
}

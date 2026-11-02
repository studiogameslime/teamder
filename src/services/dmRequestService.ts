import { observedListener } from '../utils/errorObservation';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from '@/services/diagnosticCallable';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { useUserStore } from '@/store/userStore';
import { StaleSessionError } from './staleSession';
import { subscribeUserSession } from './userSessionListeners';
import type { User } from '@/types';

export type DmStatus = 'open'|'compose'|'incoming'|'declined'|'waiting'|'cancelled'|'unavailable';
export type DmAccess = { status: DmStatus; convId: string; other: Pick<User,'id'|'name'|'avatarId'|'photoUrl'> };
export type DmRequestEntry = { convId: string; userId: string; user: DmAccess['other']; status: 'incoming'|'declined'|'waiting'|'cancelled'; text: string; messageId: string; createdAt: number; seenAt: number };
type Action = 'status'|'send'|'accept'|'decline'|'cancel'|'seen';
export function dmOperationId(): string { return `dm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`; }

async function call<T>(name: string, data: unknown, owner: string): Promise<T> {
  const { auth, functions } = getFirebase();
  const assertOwner = () => {
    if (auth.currentUser?.uid !== owner || useUserStore.getState().currentUser?.id !== owner) throw new StaleSessionError(owner, auth.currentUser?.uid ?? '');
    if (auth.currentUser.isAnonymous) throw new Error('dm: full account required');
  };
  assertOwner();
  const result = await withAuthRaceRetry(() => { assertOwner(); return httpsCallable(functions, name)(data); });
  assertOwner();
  return result.data as T;
}
export const dmRequestService = {
  async action(owner: string, userId: string, action: Action, text?: string, operationId?: string): Promise<DmAccess> {
    if (USE_MOCK_DATA && action === 'status') {
      const me=useUserStore.getState().currentUser;
      if(me?.id!==owner)throw new StaleSessionError(owner,me?.id??'');
      const { socialDemoPlayers }=require('@/dev/socialPlayersFixture') as typeof import('@/dev/socialPlayersFixture');
      const p=socialDemoPlayers.find(p=>p.id===userId);
      return {status:me.friends?.includes(userId)?'open':'compose',convId:[owner,userId].sort().join('__'),other:p?{id:p.id,name:p.name,avatarId:p.avatarId,photoUrl:p.photoUrl}:{id:userId,name:'שחקן'}};
    }
    if (USE_MOCK_DATA) throw Object.assign(new Error('dm: demo is read only'), { code: 'chat/demo-read-only' });
    return call('dmRequestAction', { userId, action, ...(text !== undefined ? { text } : {}), ...(action !== 'status' ? { operationId: operationId ?? dmOperationId() } : {}) }, owner);
  },
  async savePrivacy(owner: string, policy: 'everyone'|'friends') {
    if (!USE_MOCK_DATA) await call('setDmRequestPrivacy', { policy }, owner);
    if (useUserStore.getState().currentUser?.id !== owner) throw new StaleSessionError(owner, useUserStore.getState().currentUser?.id ?? '');
    useUserStore.setState(s => ({ currentUser: s.currentUser ? { ...s.currentUser, dmRequestPolicy: policy, dmRequestPolicySource: 'explicit', dmFriendsOnly: policy === 'friends' } : null }));
  },
  subscribe(owner: string, next: (rows: DmRequestEntry[]) => void, error: (e: unknown) => void) {
    if (USE_MOCK_DATA) { next([]); return () => {}; }
    const { auth, db } = getFirebase();
    return subscribeUserSession(owner, () => auth.currentUser?.uid === owner && useUserStore.getState().currentUser?.id === owner,
      active => onSnapshot(collection(db, 'users', owner, 'dmRequests'), snap => {
        if (active()) next(snap.docs.map(d => ({ ...d.data(), convId: d.id } as DmRequestEntry)).sort((a,b) => b.createdAt-a.createdAt));
      }, observedListener(e => { if(active()) error(e); }, {"source":"src/services/dmRequestService.ts","handler":"subscribe","site":"dmRequestService.ts:snapshot:41"})), error);
  },
};

export function dmErrorMessage(error: unknown): string {
  const e = error as { code?: string; details?: { reason?: string } };
  if (e.details?.reason === 'dm-daily-limit') return 'הגעת למכסה של חמש בקשות היום. אפשר לשלוח בקשות נוספות אחרי חצות.';
  if (String(e.code).includes('permission-denied') || String(e.code).includes('failed-precondition')) return 'אי אפשר לשלוח הודעה כרגע. נסו לרענן את השיחה.';
  if (e.code === 'chat/demo-read-only') return 'זו תצוגת הדגמה בלבד. לא נשלחה הודעה.';
  return 'הפעולה לא הושלמה. בדקו את החיבור ונסו שוב.';
}

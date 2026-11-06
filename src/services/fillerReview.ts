import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { httpsCallable } from './diagnosticCallable';
import type { Game } from '@/types';

export type FillerRound = Pick<Game, 'id' | 'status' | 'startsAt' | 'acceptsFillers' | 'players' | 'waitlist' | 'pending'>;

export function acceptsFillerApplications(game: FillerRound, now = Date.now()): boolean {
  return game.acceptsFillers === true && game.status === 'open' && game.startsAt > now;
}

export function actionableFillerIds(game: FillerRound, ids: string[]): string[] {
  const handled = new Set([...game.players, ...game.waitlist, ...(game.pending ?? [])]);
  return [...new Set(ids)].filter(id => !handled.has(id));
}

// The caller supplies a round it manages. Club admins can read the original
// collection. Other creators can check applications addressed to them (or
// older personal notices) without gaining direct access to the collection.
export async function pendingFillerIds(gameId: string, isClubAdmin: boolean): Promise<string[]> {
  if (USE_MOCK_DATA) return [];
  const { db, functions } = getFirebase();
  if (!isClubAdmin) {
    const read = httpsCallable<{ gameId: string }, { ids: string[] }>(functions, 'getMyRoundFillerNotices');
    return (await read({ gameId })).data.ids;
  }
  const result = await getDocs(query(collection(db, 'games', gameId, 'fillerInterests'), where('status', '==', 'pending')));
  return result.docs.sort((a, b) => (Number(b.get('createdAt')) || 0) - (Number(a.get('createdAt')) || 0)).map(doc => doc.id);
}

export async function decideFiller(gameId: string, candidateUid: string, approve: boolean) {
  const { functions } = getFirebase();
  const reply = await httpsCallable<{ gameId: string; candidateUid: string }, { bucket?: 'players' | 'waitlist'; alreadyHandled?: boolean; declined?: boolean }>(
    functions, approve ? 'approveFiller' : 'declineFiller',
  )({ gameId, candidateUid });
  const { AnalyticsEvent, logEvent } = require('./analyticsService') as typeof import('./analyticsService');
  if (approve && (reply.data.bucket === 'players' || reply.data.bucket === 'waitlist')) {
    logEvent(AnalyticsEvent.FillerReviewDecided, { decision: 'approved', bucket: reply.data.bucket });
  } else if (!approve && reply.data.declined === true) {
    logEvent(AnalyticsEvent.FillerReviewDecided, { decision: 'declined' });
  }
  return reply;
}

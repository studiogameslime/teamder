import { httpsCallable } from 'firebase/functions';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';

/** A sealed evening score, never championship points or a club's latest score. */
export async function getGameEveningScores(gameId: string): Promise<Record<string, number>> {
  if (USE_MOCK_DATA) return gameId === 'gv2-7' ? { p1: 8.9, p2: 7.8, p3: 8.2, p7: 9.4 } : {};
  const response = await httpsCallable<{ gameId: string }, { scores: Record<string, number> }>(
    getFirebase().functions, 'getGameEveningScores',
  )({ gameId });
  const scores: Record<string, number> = Object.create(null);
  for (const [uid, value] of Object.entries(response.data.scores)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10) scores[uid] = value;
  }
  return scores;
}

import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { col } from '@/firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { didEveningHappen } from '@/utils/eveningPlayed';
import { isAttendedGame } from '@/utils/playedGames';
import type { LeaderHistoryRow, LeaderMetric } from '@/utils/leaderChronology';

export class LeaderHistoryCancelledError extends Error {
  constructor() { super('Leader history is no longer current'); this.name = 'LeaderHistoryCancelledError'; }
}

/** Optional display enrichment. Bounded, four reads in flight, no new rollups. */
export async function readLeaderHistory(groupId: string, window: { from?: number; to?: number }, isCurrent: () => boolean): Promise<LeaderHistoryRow[]> {
  if (USE_MOCK_DATA) return [];
  const games = await getDocs(query(col.games(), where('groupId', '==', groupId), limit(501)));
  if (!isCurrent()) throw new LeaderHistoryCancelledError();
  if (games.size > 500) throw new Error('LEADER_HISTORY_LIMIT');
  const held = games.docs.map(d => d.data()).filter(g => didEveningHappen(g) &&
    g.startsAt >= (window.from ?? 0) && g.startsAt <= (window.to ?? Infinity));
  const history: LeaderHistoryRow[] = [];
  let next = 0;
  const worker = async () => {
    while (isCurrent() && next < held.length) {
      const game = held[next++];
      const stats = await getDocs(query(collection(getFirebase().db, 'gamePlayerStats'), where('gameId', '==', game.id), limit(501)));
      if (stats.size > 500) throw new Error('LEADER_HISTORY_PLAYER_LIMIT');
      const players = new Map<string, Partial<Record<LeaderMetric | 'rounds', number>>>();
      for (const d of stats.docs) {
        const data = d.data();
        if (typeof data.userId !== 'string') continue;
        const values: Partial<Record<LeaderMetric | 'rounds', number>> = {};
        for (const key of ['goals', 'assists', 'wins', 'cleanSheets', 'penScored', 'penSaved', 'ownGoals', 'rounds'] as const) {
          if (data[key] !== undefined && (!Number.isFinite(data[key]) || data[key] < 0)) throw new Error('LEADER_HISTORY_INVALID');
          values[key] = data[key] ?? 0;
        }
        players.set(data.userId, values);
      }
      for (const uid of game.players ?? []) if (isAttendedGame(game, uid)) {
        players.set(uid, { ...players.get(uid), games: 1 });
      }
      for (const [uid, values] of players) history.push({ gameId: game.id, at: game.startsAt, uid, values });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, held.length) }, worker));
  if (!isCurrent()) throw new LeaderHistoryCancelledError();
  return history;
}

import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { col } from '@/firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { useUserStore } from '@/store/userStore';
import { userService } from './userService';
import { StaleSessionError } from './staleSession';
import { ownPlayerRounds, recordedRoundStats } from '@/utils/ownPlayerCard';
import type { Game } from '@/types';

function assertOwner(uid: string) {
  const current = useUserStore.getState().currentUser;
  if (!uid || current?.id !== uid || current.isGuest) throw new StaleSessionError(uid, current?.id ?? '');
}

export const ownPlayerCardService = {
  async load(uid: string) {
    assertOwner(uid);
    const [user, games] = await Promise.all([
      userService.getUserById(uid),
      USE_MOCK_DATA
        ? Promise.resolve((require('@/data/mockData') as typeof import('@/data/mockData')).mockGamesV2)
        : getDocs(query(col.games(), where('participantIds', 'array-contains', uid)))
          .then(snap => snap.docs.map(document => document.data()) as Game[]),
    ]);
    assertOwner(uid);
    if (!user) throw new Error('OWN_PLAYER_NOT_FOUND');
    return { user, ...ownPlayerRounds(games, uid) };
  },
  async lastStats(uid: string, gameId: string) {
    assertOwner(uid);
    if (USE_MOCK_DATA) return recordedRoundStats();
    const snap = await getDocs(query(collection(getFirebase().db, 'gamePlayerStats'),
      where('gameId', '==', gameId), where('userId', '==', uid), limit(1)));
    assertOwner(uid);
    return recordedRoundStats(snap.docs[0]?.data());
  },
};

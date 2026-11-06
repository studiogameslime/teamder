import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { col } from '@/firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { useUserStore } from '@/store/userStore';
import { userService } from './userService';
import { StaleSessionError } from './staleSession';
import { ownPlayerRounds, recordedRoundStats } from '@/utils/ownPlayerCard';
import { observeCaughtError } from '@/utils/errorObservation';
import type { Game } from '@/types';

export type OwnPlayerRoundData = ReturnType<typeof ownPlayerRounds>;
type LoadOptions = { onRounds?: (rounds: OwnPlayerRoundData) => void };

function assertOwner(uid: string) {
  const current = useUserStore.getState().currentUser;
  if (!uid || current?.id !== uid || current.isGuest) throw new StaleSessionError(uid, current?.id ?? '');
}

export const ownPlayerCardService = {
  async load(uid: string, options?: LoadOptions) {
    assertOwner(uid);
    let failed = false;
    const profile = userService.getUserById(uid).then(user => {
      assertOwner(uid);
      if (!user) throw new Error('OWN_PLAYER_NOT_FOUND');
      if (user.id !== uid || user.isGuest) throw new StaleSessionError(uid, user.id);
      return user;
    });
    const rounds = (USE_MOCK_DATA
        ? Promise.resolve((require('@/data/mockData') as typeof import('@/data/mockData')).mockGamesV2)
        : getDocs(query(col.games(), where('participantIds', 'array-contains', uid)))
          .then(snap => snap.docs.map(document => document.data()) as Game[]))
      .then(games => {
        assertOwner(uid);
        const value = ownPlayerRounds(games, uid);
        // Rounds and their recorded personal stats need not wait for a slow
        // profile read. Lifetime profile counters still await the fresh user.
        if (!failed) options?.onRounds?.(value);
        return value;
      });
    try {
      const [user, value] = await Promise.all([profile, rounds]);
      assertOwner(uid);
      return { user, ...value };
    } catch (error) {
      failed = true;
      if (!(error instanceof StaleSessionError)) observeCaughtError(error, {
        source: 'src/services/ownPlayerCardService.ts', handler: 'load', site: 'ownPlayerCard:profile-and-rounds',
      });
      throw error;
    }
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

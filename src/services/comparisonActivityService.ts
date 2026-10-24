import { httpsCallable } from 'firebase/functions';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { useUserStore } from '@/store/userStore';
import { StaleSessionError } from './staleSession';
import type { StatsScope } from '@/utils/statsScope';
import type { ComparisonActivityPage, ComparisonRange } from '@/types/comparisonActivity';

async function call<T>(name: string, data: object, expectedUid: string): Promise<T> {
  const { auth, functions } = getFirebase();
  const check = () => {
    const me = useUserStore.getState().currentUser;
    if (!expectedUid || me?.id !== expectedUid || me.isGuest || auth.currentUser?.uid !== expectedUid || auth.currentUser.isAnonymous) {
      throw new StaleSessionError(expectedUid, auth.currentUser?.uid ?? '');
    }
  };
  check();
  const result = await withAuthRaceRetry(() => {
    check();
    return httpsCallable(functions, name)({ ...data, expectedUid });
  });
  check();
  return result.data as T;
}

export const comparisonActivityService = {
  async record(args: { expectedUid: string; targetId: string; groupId: string; visitId: string; scope: StatsScope }): Promise<void> {
    if (USE_MOCK_DATA) return;
    const { expectedUid, ...data } = args;
    await call('recordPlayerComparison', data, expectedUid);
  },
  async list(expectedUid: string, range: ComparisonRange, cursor?: string | null): Promise<ComparisonActivityPage> {
    if (USE_MOCK_DATA) {
      const me = useUserStore.getState().currentUser;
      if (!expectedUid || me?.id !== expectedUid || me.isGuest) throw new StaleSessionError(expectedUid, me?.id ?? '');
      return (require('@/dev/comparisonActivityFixture') as typeof import('@/dev/comparisonActivityFixture')).comparisonActivityFixture(range);
    }
    return call('getMyComparisonActivity', { range, ...(cursor ? { cursor } : {}) }, expectedUid);
  },
};

import { observeCaughtError } from '../utils/errorObservation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LOCAL_DEMO_KEY,
  parseLocalDemoSnapshot,
  freshLocalDemoSnapshot,
} from '@/utils/localDemoPersistence';

let restoration: Promise<void> | undefined;

/** Restores before user hydration exposes screens or subscribes to clubs. */
export function restoreLocalDemoRound(): Promise<void> {
  if (!__DEV__ || process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK !== '1' ||
      process.env.EXPO_PUBLIC_QA_ROUTES !== '1') return Promise.resolve();
  if (restoration) return restoration;
  restoration = restore().catch(error => {
    observeCaughtError(error, {"source":"src/dev/localDemoPersistence.ts","handler":"restoreLocalDemoRound","site":"localDemoPersistence:c78721e8fe"}); restoration = undefined; throw error; });
  return restoration;
}

async function restore(): Promise<void> {
  // Lazy imports keep this out of the normal app boot and avoid service cycles.
  const { USE_MOCK_DATA } = require('@/firebase/config') as typeof import('@/firebase/config');
  if (!USE_MOCK_DATA) return;
  const saved = parseLocalDemoSnapshot(await AsyncStorage.getItem(LOCAL_DEMO_KEY));
  if (!saved) return;
  const snapshot = freshLocalDemoSnapshot(saved, Date.now());
  const { mockGamesV2, mockRoundHistory } = require('@/data/mockData') as typeof import('@/data/mockData');
  const { mockGroup } = require('@/data/mockUsers') as typeof import('@/data/mockUsers');
  const { groupService } = require('@/services/groupService') as typeof import('@/services/groupService');
  const index = mockGamesV2.findIndex(game => game.id === snapshot.game.id);
  const group = await groupService.get(snapshot.group.id);
  if (index < 0 || !group || !group.adminIds.includes(snapshot.game.createdBy!)) {
    throw new Error('LOCAL_DEMO_TARGET_MISSING');
  }
  // Migrate the first checkpoint as well: no allocations, colours or results on disk.
  await AsyncStorage.setItem(LOCAL_DEMO_KEY, JSON.stringify(snapshot));
  await AsyncStorage.multiRemove([
    `manual-allocation:p7:${snapshot.game.id}`,
    `match-opening:p7:${snapshot.game.id}`,
  ]);
  mockGamesV2[index] = snapshot.game;
  mockRoundHistory[snapshot.game.id] = snapshot.history;
  Object.assign(group, snapshot.group);
  Object.assign(mockGroup, snapshot.group);

}

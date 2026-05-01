// Thin wrapper over AsyncStorage so callers don't need to know whether we're
// in mock mode or real mode (keys/values are identical either way).

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  ONBOARDING_DONE: 'footy.onboarding.done',
  AUTH_USER: 'footy.auth.user',           // stringified User
  CURRENT_GROUP: 'footy.group.current',   // GroupId
  HINT_CREATE_GAME_SEEN: 'footy.hint.createGame.seen',
} as const;

export const storage = {
  async getOnboardingDone(): Promise<boolean> {
    const v = await AsyncStorage.getItem(KEYS.ONBOARDING_DONE);
    return v === 'true';
  },
  async setOnboardingDone(v: boolean): Promise<void> {
    await AsyncStorage.setItem(KEYS.ONBOARDING_DONE, String(v));
  },

  async getAuthUserJson(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.AUTH_USER);
  },
  async setAuthUserJson(json: string | null): Promise<void> {
    if (json === null) await AsyncStorage.removeItem(KEYS.AUTH_USER);
    else await AsyncStorage.setItem(KEYS.AUTH_USER, json);
  },

  async getCurrentGroupId(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.CURRENT_GROUP);
  },
  async setCurrentGroupId(id: string | null): Promise<void> {
    if (id === null) await AsyncStorage.removeItem(KEYS.CURRENT_GROUP);
    else await AsyncStorage.setItem(KEYS.CURRENT_GROUP, id);
  },

  async getHintCreateGameSeen(): Promise<boolean> {
    return (await AsyncStorage.getItem(KEYS.HINT_CREATE_GAME_SEEN)) === '1';
  },
  async setHintCreateGameSeen(): Promise<void> {
    await AsyncStorage.setItem(KEYS.HINT_CREATE_GAME_SEEN, '1');
  },
};

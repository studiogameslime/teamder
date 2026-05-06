// Thin wrapper over AsyncStorage so callers don't need to know whether we're
// in mock mode or real mode (keys/values are identical either way).

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  ONBOARDING_DONE: 'footy.onboarding.done',
  AUTH_USER: 'footy.auth.user',           // stringified User
  CURRENT_GROUP: 'footy.group.current',   // GroupId
  HINT_CREATE_GAME_SEEN: 'footy.hint.createGame.seen',
  // Per-uid latch set after the account-deletion sweep has notified
  // game admins. Prevents a deleteOwnAccount retry from re-pushing
  // the same "X deleted account" notification to every admin again.
  // Cleared once the auth-delete actually succeeds.
  DELETE_SWEEP_NOTIFIED: 'footy.deleteSweep.notified',
  // Stash for an invite link (teamder://session/<id> or /team/<id>) the
  // user opened before they were authenticated. RootNavigator consumes
  // this after the post-sign-in onboarding completes.
  PENDING_INVITE: 'footy.invite.pending',
  // Set once installReferrerService has read the Play Install Referrer
  // for this install — the API only delivers the referrer once per
  // install, and we additionally cache "we've looked" so subsequent
  // launches don't re-attempt the native call.
  INSTALL_REFERRER_CONSUMED: 'footy.installReferrer.consumed',
} as const;

/**
 * What we persist when an invite URL arrives before the user is ready
 * to navigate. Discriminated union by `type` so the consumer side can
 * route without re-validating the payload shape. `invitedBy` is
 * optional — links shared before the attribution feature shipped (or
 * by other surfaces) won't carry it, and the consumer treats missing
 * as "no inviter to credit".
 */
export type PendingInvite =
  | { type: 'session'; id: string; invitedBy?: string }
  | { type: 'team'; id: string; invitedBy?: string };

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

  async wasDeleteSweepNotified(uid: string): Promise<boolean> {
    if (!uid) return false;
    const raw = await AsyncStorage.getItem(KEYS.DELETE_SWEEP_NOTIFIED);
    return raw === uid;
  },
  async setDeleteSweepNotified(uid: string): Promise<void> {
    if (!uid) return;
    await AsyncStorage.setItem(KEYS.DELETE_SWEEP_NOTIFIED, uid);
  },
  async clearDeleteSweepNotified(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.DELETE_SWEEP_NOTIFIED);
  },

  async getPendingInvite(): Promise<PendingInvite | null> {
    const raw = await AsyncStorage.getItem(KEYS.PENDING_INVITE);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PendingInvite;
      if (
        !parsed ||
        (parsed.type !== 'session' && parsed.type !== 'team') ||
        typeof parsed.id !== 'string'
      ) {
        await AsyncStorage.removeItem(KEYS.PENDING_INVITE);
        return null;
      }
      // Drop a malformed invitedBy (anything not a non-empty string)
      // rather than failing the whole read — the rest of the invite
      // is still actionable without an inviter to credit.
      if (typeof parsed.invitedBy !== 'string' || parsed.invitedBy === '') {
        delete (parsed as { invitedBy?: string }).invitedBy;
      }
      return parsed;
    } catch {
      await AsyncStorage.removeItem(KEYS.PENDING_INVITE);
      return null;
    }
  },
  async setPendingInvite(invite: PendingInvite): Promise<void> {
    await AsyncStorage.setItem(KEYS.PENDING_INVITE, JSON.stringify(invite));
  },
  async clearPendingInvite(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.PENDING_INVITE);
  },

  async getInstallReferrerConsumed(): Promise<boolean> {
    return (await AsyncStorage.getItem(KEYS.INSTALL_REFERRER_CONSUMED)) === '1';
  },
  async setInstallReferrerConsumed(): Promise<void> {
    await AsyncStorage.setItem(KEYS.INSTALL_REFERRER_CONSUMED, '1');
  },
};

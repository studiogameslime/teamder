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
  // Last time we surfaced the in-app store-review prompt (ms epoch).
  // Combined with a 90-day cool-down before the next ask, on top of
  // the OS-level rate limit. Stored once per device — shared across
  // the user's accounts so we don't prompt on a borrowed phone.
  STORE_REVIEW_LAST_SHOWN: 'footy.storeReview.lastShown',
  // Stash for an invite link (teamder://session/<id> or /team/<id>) the
  // user opened before they were authenticated. RootNavigator consumes
  // this after the post-sign-in onboarding completes.
  PENDING_INVITE: 'footy.invite.pending',
  // Set once installReferrerService has read the Play Install Referrer
  // for this install — the API only delivers the referrer once per
  // install, and we additionally cache "we've looked" so subsequent
  // launches don't re-attempt the native call.
  INSTALL_REFERRER_CONSUMED: 'footy.installReferrer.consumed',
  // iOS-only counterpart to INSTALL_REFERRER_CONSUMED. Apple has no
  // install-referrer API, so the landing page copies the invite URL to
  // the clipboard and clipboardInviteService reads it once on first
  // launch. This latch ensures we only ever look (and only ever show
  // the system paste prompt) a single time per install.
  CLIPBOARD_INVITE_CONSUMED: 'footy.clipboardInvite.consumed',
  // App-open ad frequency state — `{ lastShownAt, day, countToday }`.
  // Powers the cross-session cooldown + daily cap in adsService so a
  // user who opens the app many times a day isn't hit with an app-open
  // ad on every launch.
  APP_OPEN_AD_STATE: 'footy.appOpenAd.state',
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
  | { type: 'team'; id: string; invitedBy?: string }
  // Generic "invite to the app" — no game/team target. Carries only the
  // inviter so referral attribution still lands; the consumer doesn't
  // navigate anywhere (the user just arrives on the home screen).
  | { type: 'app'; invitedBy?: string };

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

  async getStoreReviewLastShownAt(): Promise<number> {
    const raw = await AsyncStorage.getItem(KEYS.STORE_REVIEW_LAST_SHOWN);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },
  async setStoreReviewLastShownAt(ms: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.STORE_REVIEW_LAST_SHOWN, String(ms));
  },

  async getPendingInvite(): Promise<PendingInvite | null> {
    const raw = await AsyncStorage.getItem(KEYS.PENDING_INVITE);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PendingInvite;
      const validShape =
        parsed &&
        ((parsed.type === 'app') ||
          ((parsed.type === 'session' || parsed.type === 'team') &&
            typeof (parsed as { id?: unknown }).id === 'string'));
      if (!validShape) {
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

  async getClipboardInviteConsumed(): Promise<boolean> {
    return (await AsyncStorage.getItem(KEYS.CLIPBOARD_INVITE_CONSUMED)) === '1';
  },
  async setClipboardInviteConsumed(): Promise<void> {
    await AsyncStorage.setItem(KEYS.CLIPBOARD_INVITE_CONSUMED, '1');
  },

  async getAppOpenAdState(): Promise<{
    lastShownAt: number;
    day: string;
    countToday: number;
  }> {
    const raw = await AsyncStorage.getItem(KEYS.APP_OPEN_AD_STATE);
    const empty = { lastShownAt: 0, day: '', countToday: 0 };
    if (!raw) return empty;
    try {
      const p = JSON.parse(raw) as Partial<{
        lastShownAt: number;
        day: string;
        countToday: number;
      }>;
      return {
        lastShownAt: Number(p.lastShownAt) || 0,
        day: typeof p.day === 'string' ? p.day : '',
        countToday: Number(p.countToday) || 0,
      };
    } catch {
      return empty;
    }
  },
  async setAppOpenAdState(state: {
    lastShownAt: number;
    day: string;
    countToday: number;
  }): Promise<void> {
    await AsyncStorage.setItem(KEYS.APP_OPEN_AD_STATE, JSON.stringify(state));
  },
};

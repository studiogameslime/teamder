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
  AVAIL_NUDGE_LAST_SHOWN: 'footy.availNudge.lastShown',
  // Stash for an invite link (teamder://session/<id> or /team/<id>) the
  // user opened before they were authenticated. RootNavigator consumes
  // this after the post-sign-in onboarding completes.
  PENDING_INVITE: 'footy.invite.pending',
  INVITE_ATTRIBUTION: 'footy.invite.attribution',
  INVITE_NEW_USER: 'footy.invite.newUser',
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
  // Timestamp of the last presence ping (platform + lastSeenAt write).
  // Throttles the per-launch write to ~once/6h.
  PRESENCE_PING_AT: 'footy.presence.pingAt',
  // Per-campaign popup impression ledger — `{ [campaignId]: lastSeenMs }`.
  // Drives the client-side frequency cap before the modal is shown.
  CAMPAIGN_SEEN: 'footy.campaign.seen',
  // Highest app version the "מה חדש" modal has already been shown for on
  // THIS device. Written the moment we decide to show (write-through), so the
  // modal is strictly one-time per version — it never reappears on relaunch /
  // foreground, even if the user closes the app mid-modal.
  WHATS_NEW_SEEN_VERSION: 'footy.whatsNew.seenVersion',
  // Has this DEVICE finished the organic first-run entry experience
  // (Welcome → Intent)?
  //
  // The name is the specification. It is NOT "has seen a screen" and NOT
  // "arrived once from a link" — it is "this device no longer needs to be
  // asked what it came for". Two things satisfy that and nothing else does:
  //
  //   • somebody picked an intent, so we know;
  //   • a full account has existed on this phone, so the pitch is behind them
  //     (this is what stops a sign-out from greeting a two-year user with a
  //     first-run pitch).
  //
  // A deep link deliberately does NOT set it. Arriving at a match from a
  // friend's link, looking, and closing the app tells us nothing about what
  // this person wants from Teamder — the link is a bypass FOR THAT ENTRY, not
  // an answer. See `entryGate.ts`, which computes the bypass per launch.
  //
  // Deliberately a NEW key rather than `footy.onboarding.done`: that one
  // belongs to the retired pre-sign-in carousel and every existing install
  // already carries it `true`, so reusing it would hide the new flow from the
  // entire user base on upgrade.
  ENTRY_ORGANIC_COMPLETED: 'footy.entry.organicCompleted',
  // How long the last successful cold boot took on THIS device, in ms.
  //
  // The launch screen's progress bar animates against it. There is no way to
  // know in advance how long a boot will take, but the previous boot on the
  // same phone, on the same network, is a far better estimate than a guess —
  // and it self-corrects: a slow device settles on a slow bar, a fast one on
  // a fast bar. Smoothed across runs so a single outlier does not swing it.
  BOOT_DURATION_MS: 'footy.boot.durationMs',
} as const;

/**
 * What we persist when an invite URL arrives before the user is ready
 * to navigate. Discriminated union by `type` so the consumer side can
 * route without re-validating the payload shape. `invitedBy` is
 * optional — links shared before the attribution feature shipped (or
 * by other surfaces) won't carry it, and the consumer treats missing
 * as "no inviter to credit".
 */
// Acquisition (UTM) attribution carried alongside any invite shape: a
// tracked ad/share link records WHERE the install came from. `source` is
// the channel label (whatsapp / facebook / …), `campaign` an optional tag.
// Independent of `invitedBy` (a link can have a source but no inviter).
export interface AcquisitionTag {
  source?: string;
  campaign?: string;
  /** The specific tracked-link id (`al_…`) the install came from, for
   *  per-link attribution (distinguishes many links of the same source). */
  linkId?: string;
}

export type PendingInvite =
  | ({ type: 'session'; id: string; invitedBy?: string } & AcquisitionTag)
  | ({ type: 'team'; id: string; invitedBy?: string } & AcquisitionTag)
  // Generic "invite to the app" — no game/team target. Carries only the
  // inviter so referral attribution still lands; the consumer doesn't
  // navigate anywhere (the user just arrives on the home screen).
  | ({ type: 'app'; invitedBy?: string } & AcquisitionTag);

let inviteWrites: Promise<unknown> = Promise.resolve();
function serializeInviteWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = inviteWrites.then(operation, operation);
  inviteWrites = result.catch(() => {});
  return result;
}

const inviteListeners = new Set<() => void>();
async function rememberAttribution(invite: PendingInvite): Promise<void> {
  if (!invite.invitedBy && !invite.source) return;
  const raw = await AsyncStorage.getItem(KEYS.INVITE_ATTRIBUTION);
  let record: { referral?: PendingInvite; acquisition?: PendingInvite; userId?: string; invite?: PendingInvite } = {};
  try { if (raw) record = JSON.parse(raw); } catch { /* replace unreadable record */ }
  // Upgrade the local legacy record, without changing already chosen axes.
  if (record.invite?.invitedBy && !record.referral) record.referral = record.invite;
  if (record.invite?.source && !record.acquisition) record.acquisition = record.invite;
  delete record.invite;
  // First known inviter and first known acquisition are independent. A plain
  // Play install cannot lock out a later recovered referral. Never mix campaign
  // fields from a different touch into an already complete acquisition.
  if (!record.referral && invite.invitedBy) record.referral = invite;
  if (!record.acquisition && invite.source) record.acquisition = invite;
  await AsyncStorage.setItem(KEYS.INVITE_ATTRIBUTION, JSON.stringify(record));
}

export function subscribePendingInvite(listener: () => void): () => void {
  inviteListeners.add(listener);
  return () => { inviteListeners.delete(listener); };
}
function notifyPendingInvite() {
  for (const listener of inviteListeners) listener();
}

export const storage = {
  /**
   * Last cold-boot duration, clamped to a sane band.
   *
   * Returns null on a first run or a bad read, and the caller falls back to a
   * default. The clamp matters: a boot that took 40s because the phone was in
   * a lift must not leave every future launch with a bar that crawls.
   */
  async getBootDurationMs(): Promise<number | null> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.BOOT_DURATION_MS);
      const n = raw ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return null;
      return Math.min(9000, Math.max(700, n));
    } catch {
      return null;
    }
  },
  /** Blend the new measurement into the stored one, 60/40 toward history. */
  async recordBootDurationMs(ms: number): Promise<void> {
    try {
      if (!Number.isFinite(ms) || ms <= 0) return;
      const prev = await this.getBootDurationMs();
      const next = prev == null ? ms : prev * 0.6 + ms * 0.4;
      await AsyncStorage.setItem(
        KEYS.BOOT_DURATION_MS,
        String(Math.round(Math.min(9000, Math.max(700, next)))),
      );
    } catch {
      // Best-effort. A failure costs one less-accurate bar, nothing else.
    }
  },

  // Organic first-run entry — see ENTRY_ORGANIC_COMPLETED above for what the
  // flag means. Reads default to `false` on a failure: showing Welcome once
  // too often is a small annoyance, skipping it forever is the feature not
  // existing.
  async getEntryOrganicCompleted(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(KEYS.ENTRY_ORGANIC_COMPLETED)) === '1';
    } catch {
      return false;
    }
  },
  async setEntryOrganicCompleted(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS.ENTRY_ORGANIC_COMPLETED, '1');
    } catch {
      // Best-effort. A failure costs a repeated Welcome, never a lost account.
    }
  },
  /** Visible for tests and for a QA reset of the entry flow. */
  async clearEntryOrganicCompleted(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEYS.ENTRY_ORGANIC_COMPLETED);
    } catch {
      // Ignored on purpose.
    }
  },

  async getOnboardingDone(): Promise<boolean> {
    const v = await AsyncStorage.getItem(KEYS.ONBOARDING_DONE);
    return v === 'true';
  },
  async setOnboardingDone(v: boolean): Promise<void> {
    await AsyncStorage.setItem(KEYS.ONBOARDING_DONE, String(v));
  },

  // "מה חדש" one-time latch — the last app version the modal was shown for.
  // null on a fresh install (never shown).
  async getWhatsNewSeenVersion(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.WHATS_NEW_SEEN_VERSION);
  },
  async setWhatsNewSeenVersion(version: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.WHATS_NEW_SEEN_VERSION, version);
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

  /** Last time the "mark your available days" popup was shown (snooze guard). */
  async getAvailNudgeLastShownAt(): Promise<number> {
    const raw = await AsyncStorage.getItem(KEYS.AVAIL_NUDGE_LAST_SHOWN);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },
  async setAvailNudgeLastShownAt(ms: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.AVAIL_NUDGE_LAST_SHOWN, String(ms));
  },

  async registerFreshInviteUser(userId: string, createdAt: number): Promise<void> {
    await serializeInviteWrite(async () => {
    if (Date.now() - createdAt > 24 * 60 * 60 * 1000 || createdAt > Date.now() + 60000) return;
    const raw = await AsyncStorage.getItem('footy.invite.unresolved');
    const creditRaw = await AsyncStorage.getItem(KEYS.INVITE_ATTRIBUTION);
    try {
      const pending = raw ? JSON.parse(raw) : null;
      const credit = creditRaw ? JSON.parse(creditRaw) : null;
      if (credit?.userId && credit.userId !== userId) return;
      if (!pending && !credit?.referral && !credit?.acquisition) return;
      await AsyncStorage.setItem(KEYS.INVITE_NEW_USER, JSON.stringify({ userId, createdAt, url: pending?.url ?? '', expiresAt: Date.now() + 24 * 60 * 60 * 1000, resolved: !pending }));
    } catch { /* best-effort registration metadata */ }
    });
  },
  async markInviteAttributionResolved(url: string): Promise<void> {
    await serializeInviteWrite(async () => {
      const raw = await AsyncStorage.getItem(KEYS.INVITE_NEW_USER);
      if (!raw) return;
      const ticket = JSON.parse(raw);
      if (ticket.url !== url || ticket.expiresAt < Date.now()) return;
      await AsyncStorage.setItem(KEYS.INVITE_NEW_USER, JSON.stringify({ ...ticket, resolved: true }));
    });
  },
  async getFreshInviteUser(userId: string): Promise<{ createdAt: number } | null> {
    const raw = await AsyncStorage.getItem(KEYS.INVITE_NEW_USER);
    if (!raw) return null;
    try {
      const ticket = JSON.parse(raw);
      return ticket.userId === userId && ticket.resolved === true && ticket.expiresAt >= Date.now() ? { createdAt: ticket.createdAt } : null;
    } catch { return null; }
  },
  async rememberInviteAttribution(invite: PendingInvite): Promise<void> {
    await serializeInviteWrite(() => rememberAttribution(invite));
  },
  async getInviteAttribution(userId: string, axis: 'referral' | 'acquisition' | 'combined' = 'combined'): Promise<PendingInvite | null> {
    // Upgrade compatibility: capture the old stash before a navigator removes it.
    const legacy = await storage.getPendingInvite();
    if (legacy) await storage.rememberInviteAttribution(legacy);
    return serializeInviteWrite(async () => {
      const raw = await AsyncStorage.getItem(KEYS.INVITE_ATTRIBUTION);
      if (!raw) return null;
      try {
        const record = JSON.parse(raw);
        if (record.userId && record.userId !== userId) return null;
        if (!record.userId) {
          record.userId = userId;
          await AsyncStorage.setItem(KEYS.INVITE_ATTRIBUTION, JSON.stringify(record));
        }
        const referral = record.referral ?? (record.invite?.invitedBy ? record.invite : null);
        const acquisition = record.acquisition ?? (record.invite?.source ? record.invite : null);
        if (axis === 'referral') return referral;
        if (axis === 'acquisition') return acquisition;
        if (!referral && !acquisition) return null;
        return { ...(acquisition ?? {}), ...(referral ?? {}),
          ...(acquisition?.source ? { source: acquisition.source, campaign: acquisition.campaign, linkId: acquisition.linkId } : {}) } as PendingInvite;
      } catch { return null; }
    });
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
            typeof (parsed as { id?: unknown }).id === 'string' &&
            (parsed as { id: string }).id.trim().length > 0));
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
      // Same defensive cleanup for the acquisition tag.
      const p = parsed as { source?: unknown; campaign?: unknown };
      if (typeof p.source !== 'string' || p.source === '') delete p.source;
      if (typeof p.campaign !== 'string' || p.campaign === '') delete p.campaign;
      return parsed;
    } catch {
      await AsyncStorage.removeItem(KEYS.PENDING_INVITE);
      return null;
    }
  },
  async setPendingInvite(invite: PendingInvite): Promise<void> {
    await serializeInviteWrite(async () => {
      await rememberAttribution(invite);
      await AsyncStorage.setItem(KEYS.PENDING_INVITE, JSON.stringify(invite));
      notifyPendingInvite();
    });
  },
  async setPendingInviteIfAbsent(invite: PendingInvite): Promise<boolean> {
    return serializeInviteWrite(async () => {
      if (await storage.getPendingInvite()) return false;
      await rememberAttribution(invite);
      await AsyncStorage.setItem(KEYS.PENDING_INVITE, JSON.stringify(invite));
      notifyPendingInvite();
      return true;
    });
  },
  async clearPendingInvite(): Promise<void> {
    await serializeInviteWrite(async () => {
      await AsyncStorage.removeItem(KEYS.PENDING_INVITE);
      notifyPendingInvite();
    });
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

  async getPresencePingAt(): Promise<number | null> {
    const raw = await AsyncStorage.getItem(KEYS.PRESENCE_PING_AT);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  },
  async setPresencePingAt(ts: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.PRESENCE_PING_AT, String(ts));
  },

  // Local impression ledger for popup campaigns — `{ [campaignId]: { c, t } }`
  // where `c` = times shown, `t` = last-shown ms. Drives the client-side
  // frequency cap (maxImpressions + cooldownHours) before a modal renders.
  async getCampaignSeen(): Promise<Record<string, { c: number; t: number }>> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.CAMPAIGN_SEEN);
      if (!raw) return {};
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? (p as Record<string, { c: number; t: number }>) : {};
    } catch {
      return {};
    }
  },
  async recordCampaignSeen(campaignId: string, ts: number): Promise<void> {
    const cur = await this.getCampaignSeen();
    const prev = cur[campaignId];
    cur[campaignId] = { c: (prev?.c ?? 0) + 1, t: ts };
    await AsyncStorage.setItem(KEYS.CAMPAIGN_SEEN, JSON.stringify(cur));
  },
};

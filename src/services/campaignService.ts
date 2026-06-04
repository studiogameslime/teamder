// App-side consumer of POPUP campaigns authored in Pulse (the management
// app) and stored in `campaigns/{id}`. Push-type campaigns are sent
// server-side (functions/src/adminUserPush.ts) and never read here.
//
// Flow: on home mount we fetch active popups, evaluate the campaign's
// segment against the current user CLIENT-SIDE (same SegmentFilters shape
// Pulse previews with), apply the per-user frequency cap, and return the
// single best campaign to show. Impressions are recorded locally.

import { collection, getDocs, query, where } from 'firebase/firestore';
import { Platform } from 'react-native';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { storage } from './storage';
import { groupService } from './groupService';
import { logError } from './errorLog';
import type { User } from '@/types';

export type CampaignActionType =
  | 'openCommunity'
  | 'openGame'
  | 'openProfile'
  | 'openUrl'
  | 'openScreen'
  | 'dismiss';

export interface CampaignAction {
  type: CampaignActionType;
  value?: string;
}

// Must stay in sync with pulse/src/services/segments.ts + the server matcher.
interface SegmentFilters {
  city?: string;
  provider?: 'google' | 'apple';
  platform?: 'ios' | 'android';
  games?: 'never' | 'min';
  minGames?: number;
  group?: 'in' | 'notin';
  newDays?: number;
  inactiveDays?: number;
  hasPush?: boolean;
  invited?: boolean;
}

export interface PopupCampaign {
  id: string;
  popupTitle: string;
  popupBody: string;
  buttonText: string;
  action: CampaignAction;
  maxImpressions: number;
  cooldownHours: number;
}

const DAY = 24 * 60 * 60 * 1000;

interface CurrentCtx {
  user: User;
  inGroup: boolean;
  provider?: 'google' | 'apple';
  now: number;
}

function matchSegment(f: SegmentFilters, c: CurrentCtx): boolean {
  const u = c.user;
  const city = u.availability?.homeCity ?? (u as { city?: string }).city;
  const attended = u.stats?.attended ?? 0;
  const createdAt = u.createdAt ?? 0;
  const lastSeen = (u as { lastSeenAt?: number }).lastSeenAt ?? createdAt;
  const hasPush = Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0;

  if (f.city && (city ?? '').trim() !== f.city.trim()) return false;
  if (f.provider && c.provider !== f.provider) return false;
  if (f.platform && Platform.OS !== f.platform) return false;
  if (f.games === 'never' && attended > 0) return false;
  if (f.games === 'min' && attended < (f.minGames ?? 1)) return false;
  if (f.group === 'in' && !c.inGroup) return false;
  if (f.group === 'notin' && c.inGroup) return false;
  if (f.newDays && c.now - createdAt > f.newDays * DAY) return false;
  if (f.inactiveDays && c.now - lastSeen < f.inactiveDays * DAY) return false;
  if (f.hasPush === true && !hasPush) return false;
  if (f.hasPush === false && hasPush) return false;
  if (f.invited === true && !u.invitedBy) return false;
  return true;
}

function readAction(raw: Record<string, unknown>): CampaignAction {
  const a = raw.action as { type?: string; value?: string } | undefined;
  const t = (a?.type ?? 'dismiss') as CampaignActionType;
  return { type: t, value: a?.value };
}

/**
 * Return the single best popup campaign to show right now, or null. Never
 * throws — any failure degrades to "no popup".
 */
export async function getEligiblePopup(user: User): Promise<PopupCampaign | null> {
  if (USE_MOCK_DATA || !user) return null;
  try {
    const { db, auth } = getFirebase();
    const snap = await getDocs(
      query(collection(db, 'campaigns'), where('type', '==', 'popup'), where('status', '==', 'active')),
    );
    if (snap.empty) return null;

    const now = Date.now();
    const provRaw = auth.currentUser?.providerData?.[0]?.providerId;
    const provider = provRaw === 'google.com' ? 'google' : provRaw === 'apple.com' ? 'apple' : undefined;

    // inGroup only matters if some active campaign segments on it — but the
    // query is cheap and cached, so just resolve it once.
    let inGroup = false;
    try {
      inGroup = (await groupService.listForUser(user.id)).length > 0;
    } catch {
      /* best-effort — treat as not-in-group */
    }

    const ctx: CurrentCtx = { user, inGroup, provider, now };
    const seen = await storage.getCampaignSeen();

    // Candidates: in their active window, segment matches, under cap.
    const candidates = snap.docs
      .map((d) => ({ id: d.id, raw: d.data() as Record<string, unknown> }))
      .filter(({ id, raw }) => {
        const startAt = Number(raw.startAt ?? 0);
        const endAt = Number(raw.endAt ?? Number.MAX_SAFE_INTEGER);
        if (now < startAt || now > endAt) return false;
        if (!matchSegment((raw.segment as SegmentFilters) ?? {}, ctx)) return false;
        const rec = seen[id];
        const maxImp = Number(raw.maxImpressions ?? 1);
        const cooldown = Number(raw.cooldownHours ?? 24) * 60 * 60 * 1000;
        if (rec) {
          if (rec.c >= maxImp) return false;
          if (now - rec.t < cooldown) return false;
        }
        return true;
      });

    if (!candidates.length) return null;
    // Newest first — most recent campaign wins if several are eligible.
    candidates.sort((a, b) => Number(b.raw.createdAt ?? 0) - Number(a.raw.createdAt ?? 0));
    const { id, raw } = candidates[0];
    return {
      id,
      popupTitle: String(raw.popupTitle ?? ''),
      popupBody: String(raw.popupBody ?? ''),
      buttonText: String(raw.buttonText ?? 'הבנתי'),
      action: readAction(raw),
      maxImpressions: Number(raw.maxImpressions ?? 1),
      cooldownHours: Number(raw.cooldownHours ?? 24),
    };
  } catch (err) {
    logError('getEligiblePopup', err, { uid: user?.id });
    if (__DEV__) console.warn('[campaignService] getEligiblePopup failed', err);
    return null;
  }
}

export async function markPopupSeen(campaignId: string): Promise<void> {
  try {
    await storage.recordCampaignSeen(campaignId, Date.now());
  } catch {
    /* non-fatal */
  }
}

export type CampaignEvent = 'open' | 'impression' | 'click' | 'dismiss';

/**
 * Report an engagement event to the campaign's metrics counters (powers
 * the Pulse per-campaign report). Best-effort, fire-and-forget.
 *   open       → push notification tapped
 *   impression → popup shown
 *   click      → popup button tapped (action taken)
 *   dismiss    → popup closed without acting
 */
export async function trackCampaignEvent(campaignId: string, event: CampaignEvent): Promise<void> {
  if (USE_MOCK_DATA || !campaignId) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { functions } = getFirebase();
    await httpsCallable(functions, 'trackCampaignEvent')({ campaignId, event });
  } catch (err) {
    if (__DEV__) console.warn('[campaignService] trackCampaignEvent failed', err);
  }
}

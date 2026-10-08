// Campaign authoring from Pulse. Writes a `campaigns/{id}` doc that the
// soccer backend (push) or app (popup) consumes. Server-side rate limits are
// the real guard; fetchPushRate powers the UI courtesy guard.

import { patchDoc, listAll, getDoc, deleteDoc, type FsDoc } from './firestoreRest';
import type { SegmentDef } from './segments';
import { cached } from './cache';

export type CampaignType = 'push' | 'popup';
export type ActionType =
  | 'openCommunity'
  | 'openGame'
  | 'openProfile'
  | 'openUrl'
  | 'openScreen'
  | 'dismiss';

export const ACTION_LABEL: Record<ActionType, string> = {
  openCommunity: 'פתח קהילה',
  openGame: 'פתח משחק',
  openProfile: 'פתח פרופיל',
  openUrl: 'פתח קישור',
  openScreen: 'פתח מסך',
  dismiss: 'רק סגור',
};

export interface CampaignInput {
  type: CampaignType;
  segment: SegmentDef;
  // push
  title?: string;
  body?: string;
  sendAt?: number;
  // popup
  popupTitle?: string;
  popupBody?: string;
  buttonText?: string;
  action?: { type: ActionType; value?: string };
  maxImpressions?: number;
  cooldownHours?: number;
  endAt?: number;
}

// No two pushes may be scheduled within this window of each other — guards
// against "push on push". A user only gets one/day anyway, but firing two
// broadcasts at the same moment is never intended.
export const CONFLICT_WINDOW_MS = 5 * 60 * 1000;

export interface CreateResult {
  ok: boolean;
  error?: string;
}

export async function createCampaign(c: CampaignInput): Promise<CreateResult> {
  const sendAt = c.type === 'push' ? c.sendAt ?? Date.now() : Date.now();

  // Validation: reject a push that collides in time with an already-queued
  // push (whether scheduled or about to send now).
  if (c.type === 'push') {
    const existing = await fetchCampaigns().catch(() => [] as FsDoc[]);
    const clash = existing.find(
      (e) =>
        e.type === 'push' &&
        e.status === 'queued' &&
        Math.abs(Number(e.sendAt ?? 0) - sendAt) < CONFLICT_WINDOW_MS,
    );
    if (clash) {
      return { ok: false, error: 'כבר קיים פוש מתוזמן בערך לאותו זמן. בחר זמן אחר.' };
    }
  }

  const id = `c_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
  const doc: Record<string, unknown> = {
    type: c.type,
    status: c.type === 'push' ? 'queued' : 'active',
    segment: c.segment,
    createdAt: Date.now(),
  };
  if (c.type === 'push') {
    doc.title = c.title ?? '';
    doc.body = c.body ?? '';
    doc.sendAt = sendAt;
  } else {
    doc.popupTitle = c.popupTitle ?? '';
    doc.popupBody = c.popupBody ?? '';
    doc.buttonText = c.buttonText ?? '';
    doc.action = c.action ?? { type: 'dismiss' };
    doc.maxImpressions = c.maxImpressions ?? 1;
    doc.cooldownHours = c.cooldownHours ?? 24;
    doc.startAt = Date.now();
    doc.endAt = c.endAt ?? Date.now() + 30 * 86400000;
  }
  const ok = await patchDoc(`campaigns/${id}`, doc);
  return { ok, error: ok ? undefined : 'יצירת הקמפיין נכשלה' };
}

// Send a one-off TEST of the current content to a single user, bypassing
// segment + schedule + rate caps. Push → delivered server-side; popup →
// shown to that user on next app open.
export async function sendTestCampaign(c: CampaignInput, userId: string, userName?: string): Promise<boolean> {
  const id = `c_test_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
  // Clean up this user's PRIOR test campaigns first. Each send creates a new
  // doc; without cleanup they pile up and the app resurfaces a different old
  // preview on every launch ("the popup keeps coming back"). Best-effort.
  try {
    const all = await listAll('campaigns');
    await Promise.all(
      all
        .filter((d) => d.isTest === true && d.testUserId === userId)
        .map((d) => deleteDoc(`campaigns/${d.id}`)),
    );
  } catch {
    /* non-fatal — proceed to create the new test */
  }
  const doc: Record<string, unknown> = {
    type: c.type,
    status: c.type === 'push' ? 'queued' : 'active',
    testUserId: userId,
    isTest: true,
    name: `טסט · ${userName ?? userId}`,
    segment: { combinator: 'all', rules: [] },
    createdAt: Date.now(),
  };
  if (c.type === 'push') {
    doc.title = c.title ?? '';
    doc.body = c.body ?? '';
    doc.sendAt = Date.now();
  } else {
    doc.popupTitle = c.popupTitle ?? '';
    doc.popupBody = c.popupBody ?? '';
    doc.buttonText = c.buttonText ?? '';
    doc.action = c.action ?? { type: 'dismiss' };
    // Show the test popup ONCE (like a real popup) — send another test to
    // preview again.
    doc.maxImpressions = 1;
    doc.cooldownHours = 24;
    doc.startAt = Date.now();
    doc.endAt = Date.now() + 7 * 86400000;
  }
  return patchDoc(`campaigns/${id}`, doc);
}

export async function fetchCampaigns(force = false): Promise<FsDoc[]> {
  return cached('campaigns', async () => {
    const docs = await listAll('campaigns');
    return docs.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
  }, { force });
}

// ── Per-campaign results ──────────────────────────────────────────
// Reads the funnel the server + app write back onto campaigns/{id}:
//   push  → matchedUsers (segment size) → metrics.delivered (sent) → metrics.opens (tapped)
//   popup → metrics.impressions (shown) → metrics.clicks (CTA tapped) / dismisses
export interface CampaignStats {
  type: CampaignType;
  status: string;
  isTest: boolean;
  // push
  matched: number; // users the segment matched at send time
  delivered: number; // pushes actually sent (after per-user daily cap)
  opens: number; // push notifications tapped
  openRate: number; // opens / delivered (0..1)
  // popup
  impressions: number; // popup shown
  clicks: number; // CTA tapped
  dismisses: number; // closed without acting
  ctr: number; // clicks / impressions (0..1)
}

export function campaignStats(doc: FsDoc): CampaignStats {
  const m = (doc.metrics ?? {}) as Record<string, number>;
  const delivered = Number(m.delivered ?? 0);
  const opens = Number(m.opens ?? 0);
  const impressions = Number(m.impressions ?? 0);
  const clicks = Number(m.clicks ?? 0);
  return {
    type: (doc.type as CampaignType) ?? 'push',
    status: String(doc.status ?? ''),
    isTest: doc.isTest === true,
    matched: Number(doc.matchedUsers ?? 0),
    delivered,
    opens,
    openRate: delivered > 0 ? opens / delivered : 0,
    impressions,
    clicks,
    dismisses: Number(m.dismisses ?? 0),
    ctr: impressions > 0 ? clicks / impressions : 0,
  };
}

export interface PushRate {
  hour: number;
  day: number;
  lastAt: number;
}

export async function fetchPushRate(): Promise<PushRate> {
  const doc = await getDoc('adminConfig/pushRate');
  const sends: number[] = ((doc?.sends as number[]) ?? []).map(Number);
  const now = Date.now();
  return {
    hour: sends.filter((t) => now - t < 3600000).length,
    day: sends.filter((t) => now - t < 86400000).length,
    lastAt: sends.length ? Math.max(...sends) : 0,
  };
}

// Mirrors the server limits (must match functions/src/adminUserPush.ts).
// Strict by design: at most ONE broadcast push per day.
export const LIMITS = { perHour: 1, perDay: 1, minIntervalMin: 12 * 60 };

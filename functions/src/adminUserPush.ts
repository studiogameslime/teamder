// Admin → users campaign engine. Pulse writes a campaign doc to
// `campaigns/{id}`; this module sends the PUSH-type ones (popup-type
// campaigns are read directly by the app). Pulse can't call a callable
// (it auths with a service account, not a Firebase user), so the doc IS
// the request.
//
// Guarantees:
//   • HARD anti-spam rate limits, server-enforced (the UI guard is only a
//     courtesy — this is what actually prevents a spam accident).
//   • Segment evaluated AT SEND TIME using the SAME SegmentFilters shape the
//     Pulse "calculate audience" button uses, so preview == real send.
//   • Idempotent + transactional claim so onCreate + cron never double-send.

import * as admin from 'firebase-admin';

// ── anti-spam (server-enforced) ──
// The real guard is PER-USER, not global: every individual user receives at
// most one broadcast push per 24h. The admin may queue/schedule as many
// campaigns as they like (80 is fine) — a user who already got a push today
// is simply skipped by the later ones. We stamp `lastBroadcastAt` on each
// recipient after sending and filter on it next time.
const PER_USER_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECIPIENTS = 20000;
const RATE_DOC = 'pushRate';
const DAY = 24 * 60 * 60 * 1000;

// Mirror of pulse/src/services/segments.ts SegmentFilters — keep in sync.
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

// Per-user shape we evaluate against (assembled from doc + Auth + groups).
interface U {
  uid: string;
  city?: string;
  attended: number;
  createdAt: number;
  invitedBy?: string;
  platform?: string;
  lastSeenAt?: number;
  hasPush: boolean;
  provider?: string;
  lastActiveAt?: number;
  inGroup: boolean;
}

function match(u: U, f: SegmentFilters, now: number): boolean {
  if (f.city && (u.city ?? '').trim() !== f.city.trim()) return false;
  if (f.provider && u.provider !== f.provider) return false;
  if (f.platform && u.platform !== f.platform) return false;
  if (f.games === 'never' && u.attended > 0) return false;
  if (f.games === 'min' && u.attended < (f.minGames ?? 1)) return false;
  if (f.group === 'in' && !u.inGroup) return false;
  if (f.group === 'notin' && u.inGroup) return false;
  if (f.newDays && now - u.createdAt > f.newDays * DAY) return false;
  if (f.inactiveDays) {
    const last = u.lastSeenAt ?? u.lastActiveAt ?? u.createdAt;
    if (now - last < f.inactiveDays * DAY) return false;
  }
  if (f.hasPush === true && !u.hasPush) return false;
  if (f.hasPush === false && u.hasPush) return false;
  if (f.invited === true && !u.invitedBy) return false;
  return true;
}

async function groupMemberSet(db: admin.firestore.Firestore): Promise<Set<string>> {
  const set = new Set<string>();
  const snap = await db.collection('groups').get();
  snap.forEach((d) => {
    const g = d.data();
    for (const u of (g.playerIds as string[] | undefined) ?? []) set.add(u);
    for (const u of (g.adminIds as string[] | undefined) ?? []) set.add(u);
  });
  return set;
}

// Auth metadata (provider + last-refresh ≈ last active) keyed by uid.
async function authMeta(
  uids: string[],
): Promise<Map<string, { provider?: string; lastActiveAt?: number }>> {
  const map = new Map<string, { provider?: string; lastActiveAt?: number }>();
  const auth = admin.auth();
  for (let i = 0; i < uids.length; i += 100) {
    const ids = uids.slice(i, i + 100).map((uid) => ({ uid }));
    try {
      const res = await auth.getUsers(ids);
      for (const r of res.users) {
        const pid = r.providerData[0]?.providerId;
        const provider =
          pid === 'google.com' ? 'google' : pid === 'apple.com' ? 'apple' : undefined;
        const lr = r.metadata.lastRefreshTime;
        map.set(r.uid, {
          provider,
          lastActiveAt: lr ? new Date(lr).getTime() : undefined,
        });
      }
    } catch {
      /* best-effort */
    }
  }
  return map;
}

async function tokensFor(
  db: admin.firestore.Firestore,
  uid: string,
  rootTokens?: string[],
): Promise<string[]> {
  try {
    const priv = await db.collection('users').doc(uid).collection('private').doc('push').get();
    return ((priv.data()?.fcmTokens as string[] | undefined) ?? rootTokens ?? []).filter(Boolean);
  } catch {
    return (rootTokens ?? []).filter(Boolean);
  }
}

interface Campaign {
  type?: string;
  title?: string;
  body?: string;
  segment?: SegmentFilters;
  sendAt?: number;
  status?: string;
  data?: Record<string, string>;
}

/** Process one PUSH campaign. Idempotent + rate-limited. */
export async function processCampaign(id: string, nowMs: number): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection('campaigns').doc(id);

  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { go: false as const };
    const c = snap.data() as Campaign;
    if (c.type !== 'push' || c.status !== 'queued') return { go: false as const };
    if (typeof c.sendAt === 'number' && c.sendAt > nowMs + 60_000) {
      return { go: false as const }; // not due — cron revisits
    }
    // Claim the campaign (idempotent: only one worker flips queued→sending).
    // No global rate gate — the per-user cap below is the real guard. We
    // still record the send timestamp for an informational "sent today".
    tx.update(ref, { status: 'sending', processedAt: nowMs });
    const rateRef = db.collection('adminConfig').doc(RATE_DOC);
    const sends = (((await tx.get(rateRef)).data()?.sends as number[]) ?? []).filter(
      (t) => nowMs - t < DAY,
    );
    tx.set(rateRef, { sends: [...sends, nowMs] }, { merge: true });
    return { go: true as const, c };
  });
  if (!claim.go) return;

  try {
    const f: SegmentFilters = claim.c.segment ?? {};
    const [usersSnap, memberSet] = await Promise.all([
      db.collection('users').get(),
      groupMemberSet(db),
    ]);
    const docs: {
      uid: string;
      root?: string[];
      lastBroadcastAt: number;
      base: Omit<U, 'provider' | 'lastActiveAt'>;
    }[] = [];
    usersSnap.forEach((d) => {
      const u = d.data() as Record<string, any>;
      if (u.deleted === true) return;
      docs.push({
        uid: d.id,
        root: u.fcmTokens,
        lastBroadcastAt: Number(u.lastBroadcastAt ?? 0),
        base: {
          uid: d.id,
          city: u.availability?.homeCity ?? u.city,
          attended: Number(u.stats?.attended ?? 0),
          createdAt: Number(u.createdAt ?? 0),
          invitedBy: u.invitedBy,
          platform: u.platform,
          lastSeenAt: typeof u.lastSeenAt === 'number' ? u.lastSeenAt : undefined,
          hasPush: Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0,
          inGroup: memberSet.has(d.id),
        },
      });
    });

    // Only do the (heavier) Auth lookup when the segment needs it.
    const needAuth = !!f.provider || !!f.inactiveDays;
    const meta = needAuth ? await authMeta(docs.map((d) => d.uid)) : new Map();

    const segmentMatched = docs.filter((d) =>
      match({ ...d.base, ...(meta.get(d.uid) ?? {}) }, f, nowMs),
    );
    // PER-USER daily cap: drop anyone who already got a broadcast in the
    // last 24h. This is what lets the admin queue many campaigns safely.
    const matched = segmentMatched.filter((d) => nowMs - d.lastBroadcastAt >= PER_USER_DAY_MS);
    const skippedDailyCap = segmentMatched.length - matched.length;

    // Collect tokens, remembering which users we actually reach (≥1 token) so
    // we only burn the daily cap for users who genuinely received the push.
    const recipientUids: string[] = [];
    const tokenSet = new Set<string>();
    for (const m of matched.slice(0, MAX_RECIPIENTS)) {
      const toks = await tokensFor(db, m.uid, m.root);
      if (toks.length) {
        recipientUids.push(m.uid);
        toks.forEach((t) => tokenSet.add(t));
      }
    }
    const tokens = [...tokenSet];

    const messaging = admin.messaging();
    let sent = 0;
    let dead = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title: claim.c.title || 'Teamder', body: claim.c.body || '' },
        data: { ...(claim.c.data || {}), type: 'adminBroadcast', campaignId: id },
        android: { priority: 'high', notification: { sound: 'default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      sent += res.successCount;
      res.responses.forEach((r) => {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument'
        )
          dead += 1;
      });
    }

    // Stamp the per-user daily cap on everyone we reached (batched, 450/op).
    for (let i = 0; i < recipientUids.length; i += 450) {
      const batch = db.batch();
      for (const uid of recipientUids.slice(i, i + 450)) {
        batch.set(db.collection('users').doc(uid), { lastBroadcastAt: nowMs }, { merge: true });
      }
      await batch.commit();
    }

    await ref.update({
      status: 'sent',
      matchedUsers: segmentMatched.length,
      skippedDailyCap,
      recipientUsers: recipientUids.length,
      recipientTokens: tokens.length,
      successCount: sent,
      deadTokens: dead,
      sentAt: nowMs,
      'metrics.delivered': sent,
    });
  } catch (err) {
    console.error('[processCampaign] failed', err);
    await ref.update({ status: 'error', errorMessage: String(err).slice(0, 300) });
  }
}

/** Cron sweep: send any queued PUSH campaigns whose sendAt has arrived. */
export async function sweepDueCampaigns(nowMs: number): Promise<void> {
  const db = admin.firestore();
  const due = await db
    .collection('campaigns')
    .where('type', '==', 'push')
    .where('status', '==', 'queued')
    .where('sendAt', '<=', nowMs)
    .limit(10)
    .get();
  for (const d of due.docs) {
    // eslint-disable-next-line no-await-in-loop
    await processCampaign(d.id, nowMs);
  }
}

// Engagement metric written by the app via the trackCampaignEvent callable.
// `open` = push notification tapped; `impression`/`click`/`dismiss` = popup
// shown / button tapped / closed. Stored under campaigns/{id}.metrics.* so
// Pulse can show a per-campaign report next to `delivered`.
const METRIC_FIELD: Record<string, string> = {
  open: 'opens',
  impression: 'impressions',
  click: 'clicks',
  dismiss: 'dismisses',
};
export async function recordCampaignMetric(campaignId: string, event: string): Promise<void> {
  const field = METRIC_FIELD[event];
  if (!campaignId || !field) return;
  await admin
    .firestore()
    .collection('campaigns')
    .doc(campaignId)
    .set(
      { metrics: { [field]: admin.firestore.FieldValue.increment(1) } },
      { merge: true },
    );
}

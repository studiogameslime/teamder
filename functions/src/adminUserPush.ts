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
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 20;
const MAX_RECIPIENTS = 20000;
const RATE_DOC = 'pushRate';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

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
    const rateRef = db.collection('adminConfig').doc(RATE_DOC);
    const sends = (((await tx.get(rateRef)).data()?.sends as number[]) ?? []).filter(
      (t) => nowMs - t < DAY,
    );
    const last = sends.length ? Math.max(...sends) : 0;
    let block = '';
    if (last && nowMs - last < MIN_INTERVAL_MS) block = 'נשלח פוש לפני פחות מ-2 דקות';
    else if (sends.filter((t) => nowMs - t < HOUR).length >= MAX_PER_HOUR)
      block = `מקסימום ${MAX_PER_HOUR} פושים בשעה`;
    else if (sends.length >= MAX_PER_DAY) block = `מקסימום ${MAX_PER_DAY} פושים ביום`;
    if (block) {
      tx.update(ref, { status: 'blocked', blockReason: block, processedAt: nowMs });
      return { go: false as const };
    }
    tx.update(ref, { status: 'sending', processedAt: nowMs });
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
    const docs: { uid: string; root?: string[]; base: Omit<U, 'provider' | 'lastActiveAt'> }[] = [];
    usersSnap.forEach((d) => {
      const u = d.data() as Record<string, any>;
      if (u.deleted === true) return;
      docs.push({
        uid: d.id,
        root: u.fcmTokens,
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

    const matched = docs.filter((d) =>
      match({ ...d.base, ...(meta.get(d.uid) ?? {}) }, f, nowMs),
    );

    const tokenSet = new Set<string>();
    for (const m of matched.slice(0, MAX_RECIPIENTS)) {
      (await tokensFor(db, m.uid, m.root)).forEach((t) => tokenSet.add(t));
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

    await ref.update({
      status: 'sent',
      recipientUsers: matched.length,
      recipientTokens: tokens.length,
      successCount: sent,
      deadTokens: dead,
      sentAt: nowMs,
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

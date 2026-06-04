"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCampaign = processCampaign;
exports.sweepDueCampaigns = sweepDueCampaigns;
const admin = __importStar(require("firebase-admin"));
// ── anti-spam (server-enforced) ──
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 20;
const MAX_RECIPIENTS = 20000;
const RATE_DOC = 'pushRate';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
function match(u, f, now) {
    if (f.city && (u.city ?? '').trim() !== f.city.trim())
        return false;
    if (f.provider && u.provider !== f.provider)
        return false;
    if (f.platform && u.platform !== f.platform)
        return false;
    if (f.games === 'never' && u.attended > 0)
        return false;
    if (f.games === 'min' && u.attended < (f.minGames ?? 1))
        return false;
    if (f.group === 'in' && !u.inGroup)
        return false;
    if (f.group === 'notin' && u.inGroup)
        return false;
    if (f.newDays && now - u.createdAt > f.newDays * DAY)
        return false;
    if (f.inactiveDays) {
        const last = u.lastSeenAt ?? u.lastActiveAt ?? u.createdAt;
        if (now - last < f.inactiveDays * DAY)
            return false;
    }
    if (f.hasPush === true && !u.hasPush)
        return false;
    if (f.hasPush === false && u.hasPush)
        return false;
    if (f.invited === true && !u.invitedBy)
        return false;
    return true;
}
async function groupMemberSet(db) {
    const set = new Set();
    const snap = await db.collection('groups').get();
    snap.forEach((d) => {
        const g = d.data();
        for (const u of g.playerIds ?? [])
            set.add(u);
        for (const u of g.adminIds ?? [])
            set.add(u);
    });
    return set;
}
// Auth metadata (provider + last-refresh ≈ last active) keyed by uid.
async function authMeta(uids) {
    const map = new Map();
    const auth = admin.auth();
    for (let i = 0; i < uids.length; i += 100) {
        const ids = uids.slice(i, i + 100).map((uid) => ({ uid }));
        try {
            const res = await auth.getUsers(ids);
            for (const r of res.users) {
                const pid = r.providerData[0]?.providerId;
                const provider = pid === 'google.com' ? 'google' : pid === 'apple.com' ? 'apple' : undefined;
                const lr = r.metadata.lastRefreshTime;
                map.set(r.uid, {
                    provider,
                    lastActiveAt: lr ? new Date(lr).getTime() : undefined,
                });
            }
        }
        catch {
            /* best-effort */
        }
    }
    return map;
}
async function tokensFor(db, uid, rootTokens) {
    try {
        const priv = await db.collection('users').doc(uid).collection('private').doc('push').get();
        return (priv.data()?.fcmTokens ?? rootTokens ?? []).filter(Boolean);
    }
    catch {
        return (rootTokens ?? []).filter(Boolean);
    }
}
/** Process one PUSH campaign. Idempotent + rate-limited. */
async function processCampaign(id, nowMs) {
    const db = admin.firestore();
    const ref = db.collection('campaigns').doc(id);
    const claim = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            return { go: false };
        const c = snap.data();
        if (c.type !== 'push' || c.status !== 'queued')
            return { go: false };
        if (typeof c.sendAt === 'number' && c.sendAt > nowMs + 60000) {
            return { go: false }; // not due — cron revisits
        }
        const rateRef = db.collection('adminConfig').doc(RATE_DOC);
        const sends = ((await tx.get(rateRef)).data()?.sends ?? []).filter((t) => nowMs - t < DAY);
        const last = sends.length ? Math.max(...sends) : 0;
        let block = '';
        if (last && nowMs - last < MIN_INTERVAL_MS)
            block = 'נשלח פוש לפני פחות מ-2 דקות';
        else if (sends.filter((t) => nowMs - t < HOUR).length >= MAX_PER_HOUR)
            block = `מקסימום ${MAX_PER_HOUR} פושים בשעה`;
        else if (sends.length >= MAX_PER_DAY)
            block = `מקסימום ${MAX_PER_DAY} פושים ביום`;
        if (block) {
            tx.update(ref, { status: 'blocked', blockReason: block, processedAt: nowMs });
            return { go: false };
        }
        tx.update(ref, { status: 'sending', processedAt: nowMs });
        tx.set(rateRef, { sends: [...sends, nowMs] }, { merge: true });
        return { go: true, c };
    });
    if (!claim.go)
        return;
    try {
        const f = claim.c.segment ?? {};
        const [usersSnap, memberSet] = await Promise.all([
            db.collection('users').get(),
            groupMemberSet(db),
        ]);
        const docs = [];
        usersSnap.forEach((d) => {
            const u = d.data();
            if (u.deleted === true)
                return;
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
        const matched = docs.filter((d) => match({ ...d.base, ...(meta.get(d.uid) ?? {}) }, f, nowMs));
        const tokenSet = new Set();
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
                if (code === 'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-argument')
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
    }
    catch (err) {
        console.error('[processCampaign] failed', err);
        await ref.update({ status: 'error', errorMessage: String(err).slice(0, 300) });
    }
}
/** Cron sweep: send any queued PUSH campaigns whose sendAt has arrived. */
async function sweepDueCampaigns(nowMs) {
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

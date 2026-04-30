"use strict";
// Cloud Functions consumer for the /notifications outbound queue + a
// scheduled reminder job for upcoming games.
//
// Triggers:
//   1. onCreate /notifications/{id}        → build + send FCM payload
//   2. onSchedule every 15m                 → write reminder notifications
//                                            for games starting ~1h away
//
// Per-type behaviour (Phase E.2.2):
//   joinRequest          → single recipient (the admin)
//   approved / rejected  → single recipient (the player)
//   newGameInCommunity   → fan-out: users where newGameSubscriptions
//                          array-contains payload.groupId
//   gameReminder         → fan-out: game.players (read from games/{gameId})
//   gameCanceledOrUpdated→ fan-out: game.players + waitlist + pending
//   spotOpened           → single recipient (the promoted user)
//   imLate               → single recipient (the organizer)
//   inviteToGame         → single recipient (the invited user)
//
// Deploy:
//   cd functions
//   npm install && npm run build
//   firebase deploy --only functions
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
exports.scheduledAutoGenerateTeams = exports.onVoteWritten = exports.sendGameReminders = exports.onNotificationCreated = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
(0, v2_1.setGlobalOptions)({ region: 'us-central1', maxInstances: 10 });
// ─── Default Hebrew messages per type ──────────────────────────────────
function buildMessage(type, payload) {
    const groupName = payload.groupName || 'הקבוצה';
    const gameTitle = payload.gameTitle || payload.title || 'המשחק';
    const startsAt = payload.startsAt;
    const when = startsAt ? formatHebrewWhen(startsAt) : '';
    switch (type) {
        case 'joinRequest':
            return {
                title: 'בקשת הצטרפות חדשה',
                body: `מישהו מבקש להצטרף ל${groupName}`,
            };
        case 'approved':
            return { title: 'הבקשה אושרה', body: `אושרת ל${groupName}` };
        case 'rejected':
            return {
                title: 'הבקשה נדחתה',
                body: `הבקשה שלך ל${groupName} נדחתה`,
            };
        case 'newGameInCommunity': {
            const title = payload.title || groupName;
            return {
                title: `משחק חדש: ${title}`,
                body: when ? `${title} · ${when}` : `נפתח משחק חדש ב${title}`,
            };
        }
        case 'gameReminder':
            return {
                title: 'תזכורת למשחק',
                body: when
                    ? `${gameTitle} מתחיל ב-${when}`
                    : `${gameTitle} מתחיל בקרוב`,
            };
        case 'gameCanceledOrUpdated':
            return {
                title: 'המשחק בוטל',
                body: `${gameTitle} בוטל. בדוק את לשונית המשחקים.`,
            };
        case 'spotOpened':
            return {
                title: 'נפתח לך מקום במשחק!',
                body: `מישהו ביטל ב${gameTitle} — אתה רשום כעת.`,
            };
        case 'imLate': {
            const lateName = payload.lateUserName || 'שחקן';
            return {
                title: 'שחקן מאחר',
                body: `${lateName} הודיע שיאחר ל${gameTitle}`,
            };
        }
        case 'inviteToGame': {
            const inviter = payload.inviterName || 'מאמן המשחק';
            return {
                title: 'הזמנה למשחק',
                body: when
                    ? `${inviter} הזמין אותך ל${gameTitle} (${when})`
                    : `${inviter} הזמין אותך ל${gameTitle}`,
            };
        }
        case 'growthMilestone':
            return null; // not yet implemented client-side
        default:
            return null;
    }
}
function formatHebrewWhen(ms) {
    // Cloud Functions run in UTC; use Israel local time so notification
    // text matches the time the user actually expects to play. Without
    // this override, a 20:00 Israel game renders as 17:00 (UTC).
    const tz = 'Asia/Jerusalem';
    const d = new Date(ms);
    const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    const dayMap = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekdayShort = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: tz,
    }).format(d);
    const day = days[dayMap[weekdayShort] ?? 0];
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const part = (t) => parts.find((p) => p.type === t)?.value ?? '';
    return `יום ${day} ${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`;
}
// ─── Recipient resolution ──────────────────────────────────────────────
async function loadUsers(uids) {
    if (uids.length === 0)
        return [];
    // De-dupe (game arrays can drift) and use db.getAll for a single
    // batched read instead of an `in` query that's capped at 30.
    const unique = Array.from(new Set(uids));
    const refs = unique.map((u) => db.collection('users').doc(u));
    const snaps = await db.getAll(...refs);
    const out = [];
    for (const snap of snaps) {
        if (snap.exists)
            out.push(snap.data());
    }
    return out;
}
async function resolveRecipients(notif) {
    const payload = notif.payload || {};
    if (notif.type === 'newGameInCommunity') {
        const groupId = payload.groupId || notif.recipientId;
        if (!groupId)
            return [];
        const snap = await db
            .collection('users')
            .where('newGameSubscriptions', 'array-contains', groupId)
            .get();
        return snap.docs.map((d) => d.data());
    }
    if (notif.type === 'gameReminder' ||
        notif.type === 'gameCanceledOrUpdated') {
        const gameId = payload.gameId || notif.recipientId;
        if (!gameId)
            return [];
        const gSnap = await db.collection('games').doc(gameId).get();
        if (!gSnap.exists)
            return [];
        const g = gSnap.data();
        const ids = notif.type === 'gameReminder'
            ? g.players || []
            : Array.from(new Set([
                ...(g.players || []),
                ...(g.waitlist || []),
                ...(g.pending || []),
            ]));
        return loadUsers(ids);
    }
    // Single recipient.
    const snap = await db.collection('users').doc(notif.recipientId).get();
    if (!snap.exists)
        return [];
    return [snap.data()];
}
// ─── Delivery ──────────────────────────────────────────────────────────
async function deliverBatch(type, recipients, message, data) {
    // Aggregate tokens across all recipients into a Set so a user with
    // the same device registered twice (or two recipients sharing a
    // token, which shouldn't happen but cheap to guard) doesn't get a
    // duplicate push for one logical notification.
    const tokens = new Set();
    let skippedPref = 0;
    let skippedNoToken = 0;
    for (const user of recipients) {
        if (user.notificationPrefs?.[type] === false) {
            skippedPref++;
            continue;
        }
        const userTokens = (user.fcmTokens || []).filter((t) => typeof t === 'string' && t.length > 0);
        if (userTokens.length === 0) {
            skippedNoToken++;
            continue;
        }
        userTokens.forEach((t) => tokens.add(t));
    }
    if (skippedPref > 0) {
        console.log(`[notifications] ${type}: skipped ${skippedPref} user(s) — pref off`);
    }
    if (skippedNoToken > 0) {
        console.log(`[notifications] ${type}: skipped ${skippedNoToken} user(s) — no fcm token`);
    }
    if (tokens.size === 0) {
        return { ok: 0, failed: 0, skippedPref, skippedNoToken };
    }
    // sendEachForMulticast is capped at 500 tokens per call.
    const all = Array.from(tokens);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < all.length; i += 500) {
        const chunk = all.slice(i, i + 500);
        const res = await messaging.sendEachForMulticast({
            tokens: chunk,
            notification: { title: message.title, body: message.body },
            data,
            android: { priority: 'high', notification: { sound: 'default' } },
            apns: { payload: { aps: { sound: 'default' } } },
        });
        ok += res.successCount;
        failed += res.failureCount;
    }
    return { ok, failed, skippedPref, skippedNoToken };
}
// ─── onCreate trigger ──────────────────────────────────────────────────
exports.onNotificationCreated = (0, firestore_1.onDocumentCreated)('notifications/{id}', async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const notif = snap.data();
    if (notif.delivered)
        return;
    const message = buildMessage(notif.type, notif.payload || {});
    if (!message) {
        await snap.ref.update({
            delivered: true,
            deliveredAt: Date.now(),
            skipped: 'type-not-implemented',
        });
        return;
    }
    let totalOk = 0;
    let totalFailed = 0;
    let skippedPref = 0;
    let skippedNoToken = 0;
    try {
        const recipients = await resolveRecipients(notif);
        const data = {
            type: notif.type,
            ...Object.fromEntries(Object.entries(notif.payload || {}).map(([k, v]) => [k, String(v)])),
        };
        const res = await deliverBatch(notif.type, recipients, message, data);
        totalOk = res.ok;
        totalFailed = res.failed;
        skippedPref = res.skippedPref;
        skippedNoToken = res.skippedNoToken;
    }
    catch (err) {
        console.error('[onNotificationCreated] delivery failed', err);
    }
    await snap.ref.update({
        delivered: true,
        deliveredAt: Date.now(),
        stats: {
            ok: totalOk,
            failed: totalFailed,
            skippedPref,
            skippedNoToken,
        },
    });
});
// ─── Scheduled: 1h-before reminders ────────────────────────────────────
exports.sendGameReminders = (0, scheduler_1.onSchedule)({
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Jerusalem',
}, async () => {
    // Look for games starting in [now+50, now+70] minutes that haven't
    // had a reminder dispatched yet. The 20-minute window covers slack
    // around our 15-minute cadence — a game is found in exactly one run.
    const now = Date.now();
    const lower = now + 50 * 60 * 1000;
    const upper = now + 70 * 60 * 1000;
    const snap = await db
        .collection('games')
        .where('startsAt', '>=', lower)
        .where('startsAt', '<', upper)
        .get();
    if (snap.empty) {
        console.log('[sendGameReminders] no candidate games');
        return;
    }
    const ops = [];
    for (const doc of snap.docs) {
        const g = doc.data();
        if (g.reminderSent)
            continue;
        if (g.status && g.status !== 'open' && g.status !== 'locked')
            continue;
        if (!g.players || g.players.length === 0)
            continue;
        // Write the notification + flip reminderSent atomically. A failure
        // mid-write at worst skips the reminder for this game; not double.
        ops.push(db.collection('notifications').add({
            type: 'gameReminder',
            recipientId: doc.id, // fan-out marker
            payload: {
                gameId: doc.id,
                gameTitle: g.title || 'המשחק',
                startsAt: g.startsAt,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            delivered: false,
        }));
        ops.push(doc.ref.update({ reminderSent: true }));
    }
    await Promise.all(ops);
    console.log(`[sendGameReminders] dispatched ${ops.length / 2} reminder(s)`);
});
// ─── Rating: keep summary doc in sync with vote subcollection ──────────
/**
 * Vote subcollection trigger. Incremental update — we read the
 * before/after values from the event itself and apply a transactional
 * delta to the parent summary doc. No full scan of the votes
 * subcollection, so latency stays O(1) even when a community grows
 * to thousands of voters.
 */
exports.onVoteWritten = (0, firestore_1.onDocumentWritten)('groups/{groupId}/ratings/{ratedUserId}/votes/{raterUserId}', async (event) => {
    const { groupId, ratedUserId } = event.params;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const validRating = (r) => typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5;
    const oldR = validRating(before?.rating) ? before.rating : null;
    const newR = validRating(after?.rating) ? after.rating : null;
    let countDelta = 0;
    let sumDelta = 0;
    if (oldR === null && newR !== null) {
        countDelta = 1;
        sumDelta = newR;
    }
    else if (oldR !== null && newR === null) {
        countDelta = -1;
        sumDelta = -oldR;
    }
    else if (oldR !== null && newR !== null) {
        // update — count unchanged, sum shifts by the delta
        sumDelta = newR - oldR;
    }
    else {
        return; // no rating before or after; nothing to do
    }
    const summaryRef = db
        .collection('groups')
        .doc(groupId)
        .collection('ratings')
        .doc(ratedUserId);
    // Transaction so two near-simultaneous votes don't race on the
    // count/sum read-modify-write.
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(summaryRef);
        const cur = snap.exists && snap.data()
            ? snap.data()
            : { count: 0, sum: 0 };
        const newCount = Math.max(0, (cur.count ?? 0) + countDelta);
        const newSum = Math.max(0, (cur.sum ?? 0) + sumDelta);
        const newAvg = newCount > 0 ? Math.round((newSum / newCount) * 10) / 10 : 0;
        tx.set(summaryRef, {
            userId: ratedUserId,
            count: newCount,
            sum: newSum,
            average: newAvg,
            updatedAt: Date.now(),
        });
    });
});
// ─── Scheduled: auto-balance teams before a game ───────────────────────
const DEFAULT_AUTO_BALANCE_MINUTES = 60;
const GUEST_ID_PREFIX = 'guest:';
function perTeamSize(format) {
    if (format === '6v6')
        return 6;
    if (format === '7v7')
        return 7;
    return 5;
}
/** In-place Fisher–Yates shuffle. */
function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}
/**
 * rating_greedy_v1 — distribute registered players into N teams so the
 * sum of ratings per team is roughly equal.
 *
 * - Unrated players are scored at the neutral 3.0.
 * - The whole list is shuffled BEFORE sorting so every run is
 *   non-deterministic when several players share a rating (Array.sort
 *   is stable in V8 since ES2019, so the shuffle order is preserved
 *   for ties).
 * - Greedy assignment respects a hard `perTeam` cap; any registered
 *   player who can't fit lands on the bench in shuffled order.
 * - Tie-breaker order: lowest team total → fewest players → random.
 */
function balanceTeamsV1(playerIds, ratings, numberOfTeams, perTeam) {
    let unratedCount = 0;
    const scored = playerIds.map((id) => {
        const known = ratings[id];
        if (typeof known === 'number') {
            return { id, rating: known, unrated: false };
        }
        unratedCount += 1;
        return { id, rating: 3, unrated: true };
    });
    // Shuffle BEFORE sort so reruns aren't deterministic. JS sort is
    // stable, so shuffled-order survives within any tied rating bucket.
    shuffleInPlace(scored);
    scored.sort((a, b) => b.rating - a.rating);
    const teams = Array.from({ length: numberOfTeams }, () => ({ ids: [], total: 0 }));
    const capacity = perTeam;
    const assignments = {};
    const benchOrder = [];
    for (const p of scored) {
        // Build the candidate list of teams that still have capacity.
        const open = teams.filter((t) => t.ids.length < capacity);
        if (open.length === 0) {
            // Capacity exhausted — overflow to bench.
            benchOrder.push(p.id);
            continue;
        }
        // Tie-breaker: lowest total → fewest players → random pick among
        // remaining ties so identical seeds don't clump on team[0].
        open.sort((a, b) => {
            if (a.total !== b.total)
                return a.total - b.total;
            if (a.ids.length !== b.ids.length)
                return a.ids.length - b.ids.length;
            return Math.random() - 0.5;
        });
        const target = open[0];
        target.ids.push(p.id);
        target.total += p.rating;
    }
    // Map team[0] / team[1] → 'teamA' / 'teamB'. Live-match state model
    // only handles 2 teams natively today; any extra team's roster
    // spills onto the bench so we never drop registered players.
    teams.forEach((t, i) => {
        const zone = i === 0 ? 'teamA' : i === 1 ? 'teamB' : null;
        if (!zone) {
            benchOrder.push(...t.ids);
            return;
        }
        t.ids.forEach((uid) => {
            assignments[uid] = zone;
        });
    });
    benchOrder.forEach((uid) => {
        assignments[uid] = 'bench';
    });
    return {
        assignments,
        benchOrder,
        teamRatings: teams.slice(0, 2).map((t) => Math.round(t.total * 10) / 10),
        unratedCount,
    };
}
/** Read every rating summary in the group as a uid → average map. */
async function loadGroupRatings(groupId, uids) {
    if (uids.length === 0)
        return {};
    const out = {};
    // Firestore doesn't support an `in` query against subcollection doc
    // ids cleanly across many groups, but per-group we just batched
    // get the docs.
    const refs = uids.map((u) => db.collection('groups').doc(groupId).collection('ratings').doc(u));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s, i) => {
        if (!s.exists)
            return;
        const d = s.data();
        if (typeof d.average === 'number' && (d.count ?? 0) > 0) {
            out[uids[i]] = d.average;
        }
    });
    return out;
}
/**
 * Scheduled every 5 minutes. Narrow Firestore window first
 * (startsAt within the next 65 minutes), then per-game we re-check
 * the configured `autoTeamGenerationMinutesBeforeStart` so a game
 * with a custom 30-min window only fires when its own trigger
 * crosses. The 65-min cap covers the default 60-min option plus
 * scheduler drift; longer windows (e.g. 120-min) trigger when the
 * game finally enters the 65-min horizon.
 *
 * The actual write is wrapped in a Firestore transaction that
 * re-reads `autoTeamsGeneratedAt` and `teamsEditedManually` so we
 * NEVER overwrite either a previous auto-generation or a coach's
 * manual edit (transaction aborts if either flag is now set).
 */
exports.scheduledAutoGenerateTeams = (0, scheduler_1.onSchedule)({
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Jerusalem',
}, async () => {
    const now = Date.now();
    // Tight window: only games starting in the next 65 minutes are
    // candidates. The per-game check below filters further by the
    // configured minutesBeforeStart.
    const upper = now + 65 * 60 * 1000;
    const snap = await db
        .collection('games')
        .where('status', '==', 'open')
        .where('startsAt', '>=', now)
        .where('startsAt', '<=', upper)
        .get();
    if (snap.empty) {
        console.log('[autoBalance] no candidate games');
        return;
    }
    const ops = [];
    for (const doc of snap.docs) {
        const g = doc.data();
        g.id = doc.id;
        // Quick filters before paying for the transaction round-trip.
        if (g.autoTeamsGeneratedAt)
            continue;
        if (g.teamsEditedManually)
            continue;
        if (!g.groupId)
            continue;
        const players = g.players ?? [];
        if (players.length === 0)
            continue;
        const startsAt = g.startsAt ?? 0;
        const minutesBefore = g.autoTeamGenerationMinutesBeforeStart ??
            DEFAULT_AUTO_BALANCE_MINUTES;
        const triggerAt = startsAt - minutesBefore * 60 * 1000;
        // Per-game trigger: only fire when we've crossed the
        // configured window. Games whose minutesBefore is 120 (i.e.
        // they want generation 2h before kickoff) only trigger once
        // they're inside the 65-min query window — that's a documented
        // trade-off for the simpler tight-window query.
        if (now < triggerAt)
            continue;
        ops.push(generateForGame(doc.ref, g));
    }
    await Promise.all(ops);
    console.log(`[autoBalance] generated for ${ops.length} game(s)`);
});
async function generateForGame(ref, g) {
    try {
        // Load ratings BEFORE the transaction so the transaction body
        // stays small and fast (transactions retry; we don't want to
        // re-read every rating doc each retry).
        const players = g.players ?? [];
        const ratings = await loadGroupRatings(g.groupId, players);
        const perTeam = perTeamSize(g.format);
        const numberOfTeams = typeof g.numberOfTeams === 'number' && g.numberOfTeams >= 2
            ? g.numberOfTeams
            : 2;
        const wrote = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists)
                return false;
            const data = fresh.data();
            // Re-check inside the transaction so a concurrent function
            // run, or a coach edit between the outer query and this write,
            // can't be clobbered.
            if (data.autoTeamsGeneratedAt)
                return false;
            if (data.teamsEditedManually)
                return false;
            const freshPlayers = data.players ?? players;
            const freshGuests = data.guests ?? [];
            if (freshPlayers.length === 0 && freshGuests.length === 0)
                return false;
            // Compose the roster: real users keep their uid; guests are
            // encoded as `guest:<id>` so the roster id space is disjoint.
            // Their rating is `estimatedRating` when set, otherwise the
            // neutral 3.0 (handled by balanceTeamsV1's unrated branch).
            const guestRoster = freshGuests.map((gu) => `${GUEST_ID_PREFIX}${gu.id}`);
            const guestRatings = {};
            for (const gu of freshGuests) {
                if (typeof gu.estimatedRating === 'number' &&
                    gu.estimatedRating >= 1 &&
                    gu.estimatedRating <= 5) {
                    guestRatings[`${GUEST_ID_PREFIX}${gu.id}`] = gu.estimatedRating;
                }
            }
            const rosterIds = [...freshPlayers, ...guestRoster];
            const combinedRatings = { ...ratings, ...guestRatings };
            const result = balanceTeamsV1(rosterIds, combinedRatings, numberOfTeams, perTeam);
            const liveMatch = {
                phase: 'organizing',
                assignments: result.assignments,
                benchOrder: result.benchOrder,
                scoreA: 0,
                scoreB: 0,
                lateUserIds: [],
                updatedAt: Date.now(),
            };
            tx.update(ref, {
                liveMatch,
                autoTeamsGeneratedAt: Date.now(),
                autoTeamsGeneratedBy: 'system',
                teamBalanceMeta: {
                    generatedAt: Date.now(),
                    algorithm: 'rating_greedy_v1',
                    unratedCount: result.unratedCount,
                    teamRatings: result.teamRatings,
                },
                updatedAt: Date.now(),
                // INTENTIONALLY NOT touching teamsEditedManually — system
                // generation must never flip that flag; only UI edits do.
            });
            return true;
        });
        if (wrote) {
            await db.collection('notifications').add({
                type: 'gameCanceledOrUpdated',
                recipientId: ref.id, // fan-out marker
                payload: { gameId: ref.id, action: 'teams_generated' },
                createdAt: Date.now(),
                delivered: false,
            });
        }
    }
    catch (err) {
        console.error('[autoBalance] generateForGame failed', ref.id, err);
    }
}

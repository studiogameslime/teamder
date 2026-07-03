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
exports.cronEvery15Min = exports.cronEvery5Min = exports.onFeedbackSubmitted = exports.trackLinkClick = exports.trackCampaignEvent = exports.onCampaignCreated = exports.onErrorLogged = exports.onAvailabilityUpdated = exports.onCommunityJoinedAlert = exports.onCommunityCreatedAlert = exports.onGameJoinedAlert = exports.onGameCreatedAlert = exports.onNewUserJoined = exports.inviteFriendsToGroup = exports.removeFriendship = exports.acceptFriendRequest = exports.onFriendRequestCreated = exports.declineFiller = exports.approveFiller = exports.submitFillerInterest = exports.onFillerInterestCreated = exports.serveCommunityPage = exports.updateShowcaseOnGameChange = exports.updateShowcaseOnGroupChange = exports.backfillGroupCreatorIdsOnce = exports.createGroupCallable = exports.uploadGroupCover = exports.promoteOrphanToGroup = exports.getServerTime = exports.ensurePersonalGroup = exports.notifyTeamsReady = exports.notifyPlayerCancelled = exports.adminAddPlayers = exports.sendGameInvite = exports.setGuestRating = exports.updateAppConfig = exports.onVoteWrittenLegacy = exports.onVoteWritten = exports.onGameRosterChanged = exports.onGameRotationChanged = exports.onGameTimerChanged = exports.onGroupPendingChanged = exports.reconcileJoinsTask = exports.onJoinRequestCreated = exports.scheduledGameMomentTask = exports.flushPendingJoinerNotifsTask = exports.onNotificationCreated = exports.onDmChatMessage = exports.onCommunityChatMessage = exports.onGameChatMessage = void 0;
exports.removeRetroGoal = exports.addRetroGoal = exports.commitRoundStats = exports.cronEvery60Min = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const tasks_1 = require("firebase-functions/v2/tasks");
const functions_1 = require("firebase-admin/functions");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const v2_1 = require("firebase-functions/v2");
const params_1 = require("firebase-functions/params");
const reviewAlerts_1 = require("./reviewAlerts");
const adminPush_1 = require("./adminPush");
const adminUserPush_1 = require("./adminUserPush");
const notificationDedup_1 = require("./notificationDedup");
// Chat fan-out + "one push per chat until opened" — defined in its own
// module, re-exported so Cloud Functions discovers the triggers.
var chatPush_1 = require("./chatPush");
Object.defineProperty(exports, "onGameChatMessage", { enumerable: true, get: function () { return chatPush_1.onGameChatMessage; } });
Object.defineProperty(exports, "onCommunityChatMessage", { enumerable: true, get: function () { return chatPush_1.onCommunityChatMessage; } });
Object.defineProperty(exports, "onDmChatMessage", { enumerable: true, get: function () { return chatPush_1.onDmChatMessage; } });
admin.initializeApp();
const db = admin.firestore();
// Skip — rather than reject — undefined fields on writes. Without this,
// a single optional-and-absent field in a notification payload (e.g. a
// game with no `fieldName`) throws "Cannot use undefined as a Firestore
// value" and silently drops the whole push. Omitting the field is always
// the safer outcome for our resilient notification writes.
db.settings({ ignoreUndefinedProperties: true });
const messaging = admin.messaging();
(0, v2_1.setGlobalOptions)({ region: 'us-central1', maxInstances: 10 });
// ⚠️ TEMPORARY (2026-06-04): App Check enforcement is OFF for every
// callable below. Reason: iOS App Attest was registered in the Firebase
// console only after enforcement was already live, so iOS clients have no
// valid App Check token yet and ALL enforced callables reject them with
// `unauthenticated` (group/game creation, invites, etc. — fully broken on
// iOS). Flipping this to `false` unblocks iOS immediately, server-side, no
// app release. Auth is still required on every callable; we only drop the
// App-Check abuse layer.
// RE-ENABLE: set back to `true` and redeploy once App Attest is confirmed
// minting valid tokens on iOS (check Firebase Console → App Check metrics
// for "verified" iOS requests).
const ENFORCE_APP_CHECK = false;
// Store-review-alert credentials (App Store Connect .p8, Google Play SA JSON).
// Set via: firebase functions:secrets:set ASC_P8 / PLAY_SA
const ASC_P8 = (0, params_1.defineSecret)('ASC_P8');
const PLAY_SA = (0, params_1.defineSecret)('PLAY_SA');
// ─── Growth milestone dispatcher ────────────────────────────────────────
//
// Push admins exactly once when a community crosses a member-count
// threshold. The list is intentionally short — sparse enough to feel
// like a meaningful event, dense enough at small scale to give early
// communities a few wins.
const GROWTH_MILESTONES = [10, 25, 50, 100, 250, 500];
async function dispatchGrowthMilestoneIfNeeded(groupId, memberCount, adminIds, groupName) {
    if (!groupId || adminIds.length === 0)
        return;
    // The largest milestone we've now reached. Note: a community that
    // jumps from 8 → 60 (e.g. CSV import) should announce 50, not all
    // intermediate milestones — chatty admins find that annoying.
    const reached = GROWTH_MILESTONES.filter((m) => memberCount >= m);
    if (reached.length === 0)
        return;
    const target = reached[reached.length - 1];
    // Persist via transaction so concurrent writes can't double-fire
    // the same milestone (e.g. two admins approving at the same instant
    // pushing the count from 49 → 50 → 51 in two events). The txn
    // claims the milestone first, THEN we dispatch — if the dispatch
    // throws, the milestone stays claimed and won't re-fire on the
    // next write either, which is the conservative behaviour we want
    // for retry safety.
    const groupRef = db.collection('groups').doc(groupId);
    const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(groupRef);
        if (!snap.exists)
            return false;
        const data = snap.data();
        const already = Array.isArray(data.notifiedMilestones)
            ? data.notifiedMilestones
            : [];
        if (already.includes(target))
            return false;
        tx.update(groupRef, {
            notifiedMilestones: admin.firestore.FieldValue.arrayUnion(target),
            updatedAt: Date.now(),
        });
        return true;
    });
    if (!claimed)
        return;
    await Promise.allSettled(adminIds.map((adminUid) => createNotificationOnce({
        type: 'growthMilestone',
        recipientId: adminUid,
        payload: {
            groupId,
            groupName,
            milestone: target,
            memberCount,
        },
    })));
}
// ─── createNotificationOnce — single source for writing /notifications ───
//
// Notification doc schema. Bumped from v1 (no dedupe metadata) to v2
// (dedupeKey + entity + read tracking) when this helper rolled out.
// Future migrations should bump again so consumers can branch on the
// version explicitly.
const NOTIFICATION_SCHEMA_VERSION = 2;
// Unread notifications older than this are considered abandoned —
// any new event for the same dedupeKey should NOT be suppressed by
// them. Without this, an admin who edited a game once 3 weeks ago
// could permanently silence all future "game updated" pushes for
// recipients who never opened the original.
const STALE_UNREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Types that opt into "primary unread suppression": before writing,
// query the collection for ANY unread doc with the same dedupeKey
// (across all cooldown buckets, not just the current one). If found
// and not stale, skip the write entirely. Reading the existing doc
// is what unlocks the next push — bucket rotation is then only the
// SECONDARY protection, mainly against retry duplicates within ms.
//
// We opt in `gameCanceledOrUpdated` because that's the headline
// spam vector: an admin can edit a game 30+ times before kickoff,
// and recipients shouldn't drown in push noise. The unread query
// requires a `(dedupeKey, read)` composite index — see
// firestore.indexes.json.
const STRICT_UNREAD_DEDUP = {
    gameCanceledOrUpdated: true,
};
// Types where a duplicate write inside the cooldown bucket should
// AGGREGATE the payload (count + appended id/name lists) into the
// existing unread doc instead of being dropped silently. The
// `onDocumentCreated` trigger only fires on the FIRST create, so the
// recipient still gets exactly ONE push for the cluster — but if
// they tap through to the in-app inbox, the doc reflects the latest
// aggregated state ("3 שחקנים ביטלו" instead of just the first one).
const AGGREGATE_ON_DUPLICATE = {
    playerCancelled: true,
    // Admin "X joined" — fire ONE push immediately on the first joiner, then
    // fold any further joiners within the 5-min dedupe bucket into the same
    // unread doc (count + names) instead of a fresh push. Replaces the old
    // 1-minute buffer that delayed even a single join (user report: Teamder
    // lagged ~20s behind Pulse).
    gamePlayersJoined: true,
};
// Build the aggregation update for a duplicate write of an
// AGGREGATE_ON_DUPLICATE type. The fields we touch are bounded
// (capped at 50 entries to stop runaway growth even if a cron loops);
// everything else on the doc is left intact, including the
// already-fired `delivered: true / false` and `createdAt`.
function buildAggregateUpdate(type, payload) {
    if (type === 'playerCancelled') {
        const update = {
            'payload.count': admin.firestore.FieldValue.increment(1),
            updatedAtMs: Date.now(),
        };
        if (typeof payload.cancellingUserId === 'string') {
            update['payload.cancellingUserIds'] =
                admin.firestore.FieldValue.arrayUnion(payload.cancellingUserId);
        }
        if (typeof payload.cancellingUserName === 'string') {
            update['payload.cancellingUserNames'] =
                admin.firestore.FieldValue.arrayUnion(payload.cancellingUserName);
        }
        return update;
    }
    if (type === 'gamePlayersJoined') {
        // Fold a follow-on joiner into the existing unread "joined" notice:
        // bump the count and append the id/name. `joinerIds`/`joinerNames`
        // arrive as single values here (one joiner per roster-change event).
        const update = {
            'payload.count': admin.firestore.FieldValue.increment(1),
            updatedAtMs: Date.now(),
        };
        if (typeof payload.joinerIds === 'string' && payload.joinerIds) {
            update['payload.joinerIdList'] = admin.firestore.FieldValue.arrayUnion(payload.joinerIds);
        }
        if (typeof payload.joinerNames === 'string' && payload.joinerNames) {
            update['payload.joinerNameList'] = admin.firestore.FieldValue.arrayUnion(payload.joinerNames);
        }
        return update;
    }
    return {};
}
/**
 * All server-side notification writes funnel through here.
 *
 * Two layers of dedupe:
 *   1. PRIMARY (for STRICT_UNREAD_DEDUP types): query for any unread
 *      doc with the same dedupeKey. If found and not stale, skip.
 *      Reading unlocks future pushes.
 *   2. SECONDARY (always): atomic `ref.create()` against the
 *      bucket-id'd doc — fails on AlreadyExists, which we treat as
 *      a duplicate (or, for AGGREGATE_ON_DUPLICATE types, as a
 *      signal to merge into the existing doc).
 *
 * Concurrency: `ref.create()` is atomic — two parallel callers
 * inside the same bucket race; one wins, the other gets
 * AlreadyExists. The loser then either skips or aggregates. No
 * `set()` overwrite, so the original payload (and trigger fire) is
 * never lost.
 *
 * Failure mode: any throw is logged and swallowed —
 * `{ wrote: false, skipped: 'error' }`. The originating user action
 * (approve, edit, cancel, etc.) MUST NOT be blocked by a
 * notification failure.
 */
async function createNotificationOnce(input) {
    if (!input.recipientId || !input.type) {
        return { wrote: false, id: '', skipped: 'invalid-input' };
    }
    const payload = input.payload ?? {};
    const inferred = (0, notificationDedup_1.inferEntityFromPayload)(input.type, input.recipientId, payload);
    const dedupeInput = {
        type: input.type,
        recipientId: input.recipientId,
        entityType: input.entityType ?? inferred.entityType,
        entityId: input.entityId ?? inferred.entityId,
        reason: input.reason ?? inferred.reason,
    };
    const now = input.nowMs ?? Date.now();
    const id = (0, notificationDedup_1.dedupeIdFor)(dedupeInput, now);
    const dedupeKey = (0, notificationDedup_1.dedupeKeyFor)(dedupeInput);
    const ref = db.collection('notifications').doc(id);
    // ── PRIMARY (strict-unread types) ─────────────────────────────────
    if (STRICT_UNREAD_DEDUP[input.type]) {
        try {
            const dup = await db
                .collection('notifications')
                .where('dedupeKey', '==', dedupeKey)
                .where('read', '==', false)
                .limit(1)
                .get();
            if (!dup.empty) {
                const dupData = dup.docs[0].data();
                const createdAtMs = Number(dupData.createdAtMs) || 0;
                if (now - createdAtMs < STALE_UNREAD_TTL_MS) {
                    console.log('[createNotificationOnce] suppressed by unread', { type: input.type, recipientId: input.recipientId, dedupeKey });
                    return { wrote: false, id, skipped: 'unread-exists' };
                }
                // Stale unread — fall through. The bucket-create below is
                // ALSO protected, so even if a stale doc exists with the
                // same id, we'll handle it via AlreadyExists.
            }
        }
        catch (err) {
            // Index missing / network blip — log but don't block. The
            // bucket-id create below still provides retry safety.
            console.warn('[createNotificationOnce] strict-unread query failed', { type: input.type, recipientId: input.recipientId }, err);
        }
    }
    // ── SECONDARY (always): atomic create against bucket-id ───────────
    const docBody = {
        type: input.type,
        recipientId: input.recipientId,
        entityType: dedupeInput.entityType,
        entityId: dedupeInput.entityId,
        reason: dedupeInput.reason,
        dedupeKey,
        payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMs: now,
        cooldownMs: (0, notificationDedup_1.cooldownMsFor)(input.type),
        read: false,
        delivered: false,
        createdByUid: input.createdByUid ?? '',
        schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    };
    try {
        await ref.create(docBody);
        console.log('[createNotificationOnce] wrote', {
            type: input.type,
            recipientId: input.recipientId,
            id,
            entityId: dedupeInput.entityId,
            reason: dedupeInput.reason,
        });
        return { wrote: true, id };
    }
    catch (err) {
        // Firestore Admin throws AlreadyExists (gRPC code 6) when the
        // doc already exists. Any other code is a real failure.
        const code = err.code;
        const isAlreadyExists = code === 6 || code === 'already-exists';
        if (!isAlreadyExists) {
            console.error('[createNotificationOnce] create failed', { type: input.type, recipientId: input.recipientId, id }, err);
            return { wrote: false, id, skipped: 'error' };
        }
        // Doc exists. If aggregation is allowed for this type, fold the
        // new event into the existing doc — but only if it's still
        // unread (otherwise the previous push has already been seen and
        // we should let bucket rotation produce a fresh doc). The
        // existence/read read here is racy with a parallel update; that
        // race is benign because both racers want to merge into the
        // same doc.
        if (AGGREGATE_ON_DUPLICATE[input.type]) {
            try {
                const snap = await ref.get();
                const data = snap.data();
                const createdAtMs = Number(data?.createdAtMs) || 0;
                const stale = createdAtMs > 0 && now - createdAtMs >= STALE_UNREAD_TTL_MS;
                if (data && !data.read && !stale) {
                    await ref.update(buildAggregateUpdate(input.type, payload));
                    return { wrote: false, id, skipped: 'aggregated' };
                }
            }
            catch (mergeErr) {
                console.warn('[createNotificationOnce] aggregation merge failed', { type: input.type, recipientId: input.recipientId, id }, mergeErr);
            }
        }
        return { wrote: false, id, skipped: 'duplicate-bucket' };
    }
}
// ─── Default Hebrew messages per type ──────────────────────────────────
function buildMessage(type, payload) {
    const groupName = payload.groupName || 'המועדון';
    const gameTitle = payload.gameTitle || payload.title || 'המשחק';
    const startsAt = payload.startsAt;
    const when = startsAt ? formatHebrewWhen(startsAt) : '';
    switch (type) {
        case 'joinRequest':
            // Same type covers community and game join requests. A game
            // request carries `gameId` — phrase it for the game so the admin
            // knows which surface to open and approve.
            if (typeof payload.gameId === 'string') {
                return {
                    title: 'בקשת הצטרפות למשחק',
                    body: `מישהו מבקש להצטרף למשחק ${gameTitle}. אשר או דחה בפרטי המשחק.`,
                };
            }
            return {
                title: 'בקשת הצטרפות חדשה',
                body: `מישהו מבקש להצטרף ל${groupName}`,
            };
        case 'approved': {
            // Same notification type covers both community membership
            // approval and game-join approval. The presence of `gameId` in
            // the payload is the discriminator — community approvals carry
            // a groupName (or default), game approvals carry a gameTitle.
            // Game approvals also carry `bucket: 'players' | 'waitlist'` so
            // a user who lands on the waitlist (capacity already filled by
            // the time the admin approved) gets honest copy instead of
            // assuming they're in.
            const isGameApproval = typeof payload.gameId === 'string';
            if (isGameApproval) {
                const bucket = typeof payload.bucket === 'string' ? payload.bucket : '';
                if (bucket === 'waitlist') {
                    return {
                        title: 'הבקשה אושרה — נכנסת לרשימת המתנה',
                        body: `אושרת ל${gameTitle}, אבל ההרכב מלא. שובצת ברשימת המתנה ותקבל התראה אם יתפנה מקום.`,
                    };
                }
                return {
                    title: 'הבקשה אושרה',
                    body: `אושרת ל${gameTitle}`,
                };
            }
            return {
                title: 'הבקשה אושרה',
                body: `אושרת ל${groupName}`,
            };
        }
        case 'rejected': {
            const isGameRejection = typeof payload.gameId === 'string';
            return {
                title: 'הבקשה נדחתה',
                body: isGameRejection
                    ? `הבקשה שלך ל${gameTitle} נדחתה`
                    : `הבקשה שלך ל${groupName} נדחתה`,
            };
        }
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
                    ? `${gameTitle} מתחיל ${when}`
                    : `${gameTitle} מתחיל בקרוב`,
            };
        case 'gameRsvpNudge':
            return {
                title: 'אתה בא למשחק?',
                body: when
                    ? `${gameTitle} מתחיל ${when}. אתה מצטרף?`
                    : `${gameTitle} מתחיל היום. אתה מצטרף?`,
            };
        case 'gameCanceledOrUpdated': {
            // Dispatch sites pass `action: 'cancelled' | 'deleted' | 'updated'`.
            // ONLY 'cancelled' / 'deleted' should produce the "המשחק בוטל"
            // copy — those are explicit admin actions that end the game. Any
            // other action (including unknown / legacy values) gets the
            // softer "המשחק עודכן" wording so a stray dispatch never tells
            // players the game was cancelled when it wasn't.
            const action = typeof payload.action === 'string' ? payload.action : '';
            if (action === 'cancelled' || action === 'deleted') {
                return {
                    title: 'המשחק בוטל',
                    body: `${gameTitle} בוטל. בדוק את לשונית המשחקים.`,
                };
            }
            return {
                title: 'המשחק עודכן',
                body: `${gameTitle} עודכן. בדוק את הפרטים בלשונית המשחקים.`,
            };
        }
        case 'spotOpened':
            return {
                title: 'נפתח לך מקום במשחק!',
                body: `מישהו ביטל ב${gameTitle} — אתה רשום כעת.`,
            };
        case 'spotOffered':
            // Confirmation-required variant of spotOpened. The user is the
            // head of the waitlist and a slot just opened — they have to
            // explicitly tap "אישור" to claim it. The push carries
            // CONFIRM_SPOT / PASS_SPOT action buttons (registered in
            // App.tsx under the `SPOT_OFFER` category).
            return {
                title: 'התפנה לך מקום!',
                body: when
                    ? `${gameTitle} (${when}) — מאשר/ת הגעה?`
                    : `${gameTitle} — מאשר/ת הגעה?`,
            };
        case 'inviteToGame': {
            const inviter = payload.inviterName || 'מנהל המשחק';
            return {
                title: 'הזמנה למשחק',
                body: when
                    ? `${inviter} הזמין אותך ל${gameTitle} (${when})`
                    : `${inviter} הזמין אותך ל${gameTitle}`,
            };
        }
        case 'addedToGame': {
            // Admin REGISTERED the player (not just invited) — copy reflects that
            // they're already in, and on the waitlist when the game was full.
            const adder = payload.adderName || 'מנהל המשחק';
            const onWaitlist = payload.waitlisted === true;
            const where = onWaitlist ? 'רשימת ההמתנה של' : '';
            return {
                title: onWaitlist ? 'נוספת לרשימת ההמתנה' : 'נרשמת למשחק!',
                body: when
                    ? `${adder} רשם אותך ל${where}${gameTitle} (${when})`
                    : `${adder} רשם אותך ל${where}${gameTitle}`,
            };
        }
        case 'rateReminder':
            return {
                title: 'דרג את חבריך מהמשחק',
                body: `המשחק ${gameTitle} הסתיים — תן דירוג בלחיצה אחת.`,
            };
        case 'gameFillingUp': {
            const remaining = payload.remaining ?? 0;
            const head = remaining === 1 ? 'מקום אחרון' : `${remaining} מקומות אחרונים`;
            return {
                title: `${head} ב${gameTitle}`,
                body: when
                    ? `${head} — המשחק ${when}, הירשם לפני שייסגר.`
                    : `${head} — הירשם לפני שייסגר.`,
            };
        }
        case 'gamePlayersJoined': {
            // Batched admin push — N joiners in the LATEST window are
            // consolidated into ONE notification. The flushPendingJoinerNotifs
            // cron assembles `joinerNames` (CSV) + `count`. The count is
            // BATCH-SCOPED (joiners since the last flush) — NOT total game
            // roster — so the copy uses "נוספים" / "חדשים" to set that
            // expectation. Earlier copy ("6 שחקנים אישרו הגעה") read like a
            // total, which confused admins whose game already had more
            // registrants from previous batches.
            const namesCsv = typeof payload.joinerNames === 'string'
                ? payload.joinerNames
                : '';
            const names = namesCsv ? namesCsv.split(',').filter(Boolean) : [];
            const count = payload.count ?? names.length;
            const head = names.length === 0
                ? `${count} שחקנים סימנו שיגיעו`
                : names.length === 1
                    ? `${names[0]} סימן שיגיע`
                    : count <= 2
                        ? `${names[0]} ו-${names[1]} סימנו שיגיעו`
                        : `${names[0]} ועוד ${count - 1} סימנו שיגיעו`;
            return {
                title: head,
                body: `ל${gameTitle}`,
            };
        }
        case 'groupDeleted': {
            // Sent to every former member when an admin deletes the
            // community. Per-game cancellations fan out separately via
            // `gameCanceledOrUpdated` — this push specifically tells
            // members the COMMUNITY itself is gone.
            const name = payload.groupName || groupName;
            return {
                title: 'המועדון נסגר',
                body: `המועדון ${name} נמחק על ידי המנהל.`,
            };
        }
        case 'gameShortageWarning': {
            // Admin-only T-2h nudge: roster can't fill two teams. Body
            // tells the admin the current count and required minimum so
            // they can decide whether to cancel manually, push for more
            // players, or run the game short-handed.
            const registered = typeof payload.registered === 'number' ? payload.registered : 0;
            const required = typeof payload.required === 'number' ? payload.required : 0;
            return {
                title: 'אין מספיק שחקנים למשחק',
                body: `ל${gameTitle} (עוד שעתיים) רשומים ${registered}/${required} שחקנים — לא מספיק ל-2 קבוצות. תחליט/י אם לבטל או להמשיך.`,
            };
        }
        case 'playerCancelled': {
            // Sent only to the game admin. Three flavours:
            //   • account-deletion sweep with multiple games:
            //     payload.reason='accountDeleted' AND gameTitles[] is set
            //     → consolidated "X deleted account, left games A, B, C"
            //   • single game cancellation with waitlist promotion:
            //     payload.promotedUserId is a string
            //     → "X cancelled in <game>, waitlist player took the spot"
            //   • plain single cancellation:
            //     → "X cancelled in <game>, find a replacement"
            const reason = typeof payload.reason === 'string' ? payload.reason : '';
            const titles = Array.isArray(payload.gameTitles)
                ? payload.gameTitles.filter((s) => typeof s === 'string' && s.length > 0)
                : [];
            if (reason === 'accountDeleted' && titles.length > 0) {
                const list = titles.length === 1
                    ? titles[0]
                    : titles.length === 2
                        ? `${titles[0]} ו-${titles[1]}`
                        : `${titles.slice(0, 2).join(', ')} ועוד ${titles.length - 2}`;
                return {
                    title: 'שחקן מחק את החשבון',
                    body: `שחקן מחק את חשבונו והוסר מהמשחקים: ${list}.`,
                };
            }
            const promoted = typeof payload.promotedUserId === 'string';
            return {
                title: 'שחקן ביטל השתתפות',
                body: promoted
                    ? `שחקן ביטל ב${gameTitle} — שחקן מרשימת ההמתנה אוּשר במקומו.`
                    : `שחקן ביטל ב${gameTitle}. כדאי לחפש מחליף.`,
            };
        }
        case 'growthMilestone': {
            // Per-admin push when a community crosses a member-count
            // threshold (10 / 25 / 50 / 100 / 250 / 500). The dispatcher
            // (`dispatchGrowthMilestoneIfNeeded`) records the crossed
            // value on `groups.notifiedMilestones[]` so the same milestone
            // is never re-fired even if a member leaves and re-joins.
            const milestone = Number(payload.milestone) || 0;
            return {
                title: `${groupName} חצה ${milestone} חברי סגל 🎉`,
                body: `המועדון גדל — תודה שתרמתם לבנייתו.`,
            };
        }
        case 'fillerOpportunity': {
            // → candidate. Discreet copy: NOT framed as "the community
            // approved you" — they only expressed interest. The admin
            // still has to approve via the receiveing side.
            const city = typeof payload.city === 'string' && payload.city.length > 0
                ? ` ב${payload.city}`
                : '';
            const shortBy = typeof payload.shortBy === 'number' && payload.shortBy > 0
                ? ` חסרים ${payload.shortBy} שחקנים.`
                : '';
            return {
                title: 'הזדמנות למילוי משחק',
                // Show the GAME name, never the community name — outside candidates
                // shouldn't see the club's identity here (organiser request).
                body: `${gameTitle}${city} צריך שחקנים${when ? ` — ${when}` : ''}.${shortBy} רוצה להגיש מועמדות?`,
            };
        }
        case 'fillerInterestReceived': {
            // → game admin. Doesn't reveal the candidate's name in the
            // body (admin clicks through to see profile + trust meter
            // before approving).
            return {
                title: 'מישהו מעוניין למלא',
                body: `שחקן הגיש מועמדות למלא ב${gameTitle}. עיין בפרופיל לפני אישור.`,
            };
        }
        case 'fillerNoCandidates': {
            // → game admin, fallback after the matcher couldn't find any
            // available candidate. (Trust filtering still runs server-side,
            // but it's no longer surfaced to users — keep the copy neutral.)
            return {
                title: 'אין כרגע מועמדים מתאימים',
                body: `לא נמצאו כרגע שחקנים פנויים שיכולים למלא ב${gameTitle}. ננסה שוב בהמשך.`,
            };
        }
        case 'promotePrompt': {
            // → creator of an orphan game whose evening just ended. The
            // CTA opens the promote screen pre-filled with the roster.
            return {
                title: 'היה אחלה משחק! 🤝',
                body: `רוצה לשמור את החברים מ"${gameTitle}"? צור מועדון בלחיצה ותקבע מחזור שבועי.`,
            };
        }
        case 'groupInvitation': {
            // → participant of an orphan game whose creator just
            // promoted the personal group to a real community.
            const inviter = typeof payload.inviterName === 'string'
                ? payload.inviterName
                : 'מארגן המשחק';
            const name = payload.groupName || groupName;
            return {
                title: 'הזמנה למועדון',
                body: `${inviter} מזמין אותך להצטרף ל"${name}". להיכנס ולאשר?`,
            };
        }
        case 'friendRequest': {
            // → recipient of a friend request. fromName is written
            // server-side from the canonical sender doc (no spoofing).
            const fromName = typeof payload.fromName === 'string' && payload.fromName.length > 0
                ? payload.fromName
                : 'שחקן';
            return {
                title: 'בקשת חברות חדשה',
                body: `${fromName} רוצה להתחבר אליך כחבר. אשר או דחה בפרופיל.`,
            };
        }
        case 'friendRequestAccepted': {
            // → original sender, once the recipient accepted.
            const fromName = typeof payload.fromName === 'string' && payload.fromName.length > 0
                ? payload.fromName
                : 'שחקן';
            return {
                title: 'בקשת החברות אושרה 🤝',
                body: `${fromName} אישר/ה את בקשת החברות שלך — אתם חברים עכשיו.`,
            };
        }
        case 'teamsGenerated': {
            // Per-player: the dispatcher pre-computes `teammates` (this player's
            // same-team members' first names) so the body is personal.
            const teammates = typeof payload.teammates === 'string' && payload.teammates.length > 0
                ? payload.teammates
                : '';
            return {
                title: 'הכוחות להיום מוכנים! ⚽',
                body: teammates
                    ? `אתה בקבוצה עם ${teammates}`
                    : 'הכוחות חולקו — לחץ לצפייה בקבוצות',
            };
        }
        default:
            return null;
    }
}
function formatHebrewWhen(ms) {
    // Cloud Functions run in UTC; use Israel local time so notification
    // text matches the time the user actually expects to play. Without
    // this override, a 20:00 Israel game renders as 17:00 (UTC).
    // Designed to slot into "מתחיל {when}" — near-term games read as
    // "היום ב-20:00" / "מחר ב-20:00" instead of a bare date.
    const tz = 'Asia/Jerusalem';
    const d = new Date(ms);
    const timeParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const tp = (t) => timeParts.find((p) => p.type === t)?.value ?? '';
    const time = `${tp('hour')}:${tp('minute')}`;
    // Calendar-day diff in Israel local time → היום / מחר.
    const ymd = (x) => new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(x);
    const diff = Math.round((Date.parse(`${ymd(d)}T00:00:00Z`) -
        Date.parse(`${ymd(new Date())}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000));
    if (diff === 0)
        return `היום ב-${time}`;
    if (diff === 1)
        return `מחר ב-${time}`;
    const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    const dayMap = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekdayShort = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: tz,
    }).format(d);
    const day = days[dayMap[weekdayShort] ?? 0];
    const dParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
    }).formatToParts(d);
    const dp = (t) => dParts.find((p) => p.type === t)?.value ?? '';
    return `ביום ${day} ${dp('day')}/${dp('month')} ב-${time}`;
}
// ─── Recipient resolution ──────────────────────────────────────────────
// Loads users for outbound notification delivery, MERGING the
// public /users/{uid} doc with the private
// /users/{uid}/private/push doc that holds fcmTokens +
// notificationPrefs. Sensitive fields used to live on the public
// user doc, which any signed-in client could read — see Security
// Audit Finding #1. We moved them to a self-only subcollection;
// the CF (Admin SDK) bypasses rules and reads both.
//
// Backward compatibility: legacy users that haven't yet written a
// private/push doc still have fcmTokens / notificationPrefs on the
// root /users/{uid} doc. The merge prefers private values when
// present and falls back to root values otherwise — so delivery
// works for both migrated and legacy users without a forced
// migration.
async function loadUsers(uids) {
    if (uids.length === 0)
        return [];
    const unique = Array.from(new Set(uids));
    const userRefs = unique.map((u) => db.collection('users').doc(u));
    const privateRefs = unique.map((u) => db.collection('users').doc(u).collection('private').doc('push'));
    // One getAll call for both sets — cheaper than two round-trips.
    const all = await db.getAll(...userRefs, ...privateRefs);
    const half = unique.length;
    const out = [];
    for (let i = 0; i < half; i++) {
        const userSnap = all[i];
        const privSnap = all[i + half];
        if (!userSnap.exists)
            continue;
        const root = userSnap.data();
        const uid = userSnap.id;
        if (privSnap.exists) {
            const priv = privSnap.data();
            out.push({
                ...root,
                uid,
                fcmTokens: priv.fcmTokens ?? root.fcmTokens,
                notificationPrefs: priv.notificationPrefs ?? root.notificationPrefs,
            });
        }
        else {
            out.push({ ...root, uid });
        }
    }
    return out;
}
async function resolveRecipients(notif) {
    const payload = notif.payload || {};
    if (notif.type === 'newGameInCommunity') {
        const groupId = payload.groupId || notif.recipientId;
        if (!groupId)
            return [];
        // Self-exclusion depends ENTIRELY on whether the dispatcher passed
        // `createdBy` in the payload:
        //   • Manual game creation DOES pass it → the organiser is excluded
        //     (they just made the game; no need to ping them).
        //   • Registration-open (flipScheduledGameOnce) and recurring-clone
        //     opens deliberately OMIT it → the organiser IS notified that
        //     registration opened, same as everyone else (spec).
        // We must NOT re-derive createdBy from the game doc here — that
        // fallback wrongly excluded the organiser from the registration-open
        // push (user report: "as the manager I should also get the push").
        const createdBy = typeof payload.createdBy === 'string' ? payload.createdBy : '';
        const snap = await db
            .collection('users')
            .where('newGameSubscriptions', 'array-contains', groupId)
            .get();
        // Re-route through `loadUsers` so the per-user private/push
        // subcollection (fcmTokens + notificationPrefs) is merged in.
        // The query returns only the root user doc, which post-migration
        // has empty / stale fcmTokens.
        const uids = snap.docs
            .map((d) => d.id)
            .filter((uid) => uid !== createdBy);
        // Always include the organiser on a registration-open push, even if
        // they never toggled the community's new-game subscription — they
        // scheduled the game and expect the "registration opened" ping.
        // `flipScheduledGameOnce` passes their uid here (the manual-creation
        // path doesn't, so it stays self-excluded).
        const alsoNotify = typeof payload.alsoNotifyUid === 'string' ? payload.alsoNotifyUid : '';
        if (alsoNotify && alsoNotify !== createdBy && !uids.includes(alsoNotify)) {
            uids.push(alsoNotify);
        }
        return loadUsers(uids);
    }
    if (notif.type === 'gameReminder' ||
        notif.type === 'gameCanceledOrUpdated' ||
        notif.type === 'rateReminder') {
        const gameId = payload.gameId || notif.recipientId;
        if (!gameId)
            return [];
        const gSnap = await db.collection('games').doc(gameId).get();
        // When the game doc is gone (gameCanceledOrUpdated action='deleted'
        // hard-deletes it), fall back to the roster the client captured on
        // the payload before deleting — otherwise NO registered player would
        // be notified that the game was cancelled.
        const g = gSnap.exists
            ? gSnap.data()
            : Array.isArray(payload.recipientUids)
                ? { players: payload.recipientUids }
                : null;
        if (!g)
            return [];
        const ids = notif.type === 'gameCanceledOrUpdated'
            ? Array.from(new Set([
                ...(g.players || []),
                ...(g.waitlist || []),
                ...(g.pending || []),
            ]))
            : g.players || []; // gameReminder + rateReminder → players only
        // Self-exclusion: the admin who edited / cancelled the game is
        // typically also a player (organisers usually play). They DON'T
        // need a "המשחק עודכן" push for an action they themselves just
        // took — that's the most common spam complaint. The dispatch
        // sites stamp the editor uid on the payload; absence of the
        // field falls back to the no-op behaviour from before.
        if (notif.type === 'gameCanceledOrUpdated') {
            const editorUid = typeof payload.editorUid === 'string'
                ? payload.editorUid
                : '';
            const filtered = editorUid
                ? ids.filter((u) => u !== editorUid)
                : ids;
            return loadUsers(filtered);
        }
        return loadUsers(ids);
    }
    if (notif.type === 'gamePlayersJoined') {
        // Fan out to community admins so they know who locked in. The
        // flush cron stamps `joinerIds` on the payload (CSV) so we can
        // self-exclude — an admin who joined their own game shouldn't
        // get a "you joined" push.
        const groupId = payload.groupId || '';
        if (!groupId)
            return [];
        const grpSnap = await db.collection('groups').doc(groupId).get();
        if (!grpSnap.exists)
            return [];
        const grp = grpSnap.data();
        const joinerCsv = typeof payload.joinerIds === 'string'
            ? payload.joinerIds
            : '';
        const joinerSet = new Set(joinerCsv.split(',').filter(Boolean));
        const recipients = (grp.adminIds || []).filter((uid) => !joinerSet.has(uid));
        return loadUsers(recipients);
    }
    if (notif.type === 'gameFillingUp') {
        // Fan out to community members who could still join — exclude
        // anyone already on the roster (players, waitlist, pending). The
        // `recipientId` carries the gameId; payload.groupId is required.
        const gameId = payload.gameId || notif.recipientId;
        const groupId = payload.groupId;
        if (!gameId || !groupId)
            return [];
        const [gSnap, grpSnap] = await Promise.all([
            db.collection('games').doc(gameId).get(),
            db.collection('groups').doc(groupId).get(),
        ]);
        if (!gSnap.exists || !grpSnap.exists)
            return [];
        const g = gSnap.data();
        const grp = grpSnap.data();
        const inRoster = new Set([
            ...(g.players || []),
            ...(g.waitlist || []),
            ...(g.pending || []),
        ]);
        const candidates = (grp.playerIds || []).filter((u) => !inRoster.has(u));
        return loadUsers(candidates);
    }
    // Single recipient. Re-route through loadUsers so the private/push
    // subcollection is merged in; otherwise post-migration users would
    // have no fcmTokens visible from the root doc.
    return loadUsers([notif.recipientId]);
}
// ─── Delivery ──────────────────────────────────────────────────────────
async function deliverBatch(type, recipients, message, data) {
    // Aggregate tokens across all recipients into a Set so a user with
    // the same device registered twice (or two recipients sharing a
    // token, which shouldn't happen but cheap to guard) doesn't get a
    // duplicate push for one logical notification.
    const tokens = new Set();
    // token → owning uid, so an FCM "token not registered" failure can be
    // pruned from the right user doc (stale tokens otherwise live forever
    // and every push to them is silently lost — exactly the symptom hit by
    // users whose token refresh was blocked by the old /users rules bug).
    const tokenToUser = new Map();
    let skippedPref = 0;
    let skippedNoToken = 0;
    // Map notification TYPE → the pref KEY that gates it. Most match 1:1, but
    // 'approved'/'rejected' are two types governed by the single 'approvedRejected'
    // toggle — without this map a user who turned that toggle OFF still got the
    // pushes (the gate looked up a non-existent 'approved'/'rejected' key).
    const prefKey = type === 'approved' || type === 'rejected' ? 'approvedRejected' : type;
    for (const user of recipients) {
        if (user.notificationPrefs?.[prefKey] === false) {
            skippedPref++;
            continue;
        }
        const userTokens = (user.fcmTokens || []).filter((t) => typeof t === 'string' && t.length > 0);
        if (userTokens.length === 0) {
            skippedNoToken++;
            continue;
        }
        userTokens.forEach((t) => {
            tokens.add(t);
            if (user.uid && !tokenToUser.has(t))
                tokenToUser.set(t, user.uid);
        });
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
    // Notifications that should render with action buttons advertise
    // a category id; expo-notifications matches it against the
    // categories the client registered at boot (see App.tsx) and the
    // OS draws the buttons. `gameReminder` and `gameRsvpNudge` share
    // the "אני בא / לא בא" pair; `spotOffered` uses its own
    // "אישור הגעה / ויתור" pair.
    let categoryIdentifier;
    if (type === 'gameRsvpNudge') {
        // The RSVP nudge is literally "are you coming?" → keep the אני בא / לא בא
        // buttons. The plain gameReminder no longer carries buttons: a reminder
        // for a game you're ALREADY registered to shouldn't offer a one-tap "לא
        // בא" that silently cancels the registration from the lock screen.
        categoryIdentifier = 'GAME_REMINDER';
    }
    else if (type === 'newGameInCommunity') {
        // Registration-just-opened announcement → "מגיע" (join) / "לא מגיע"
        // (dismiss). NOT the reminder category, whose "לא בא" cancels a
        // registration the recipient doesn't have yet.
        categoryIdentifier = 'NEW_GAME_RSVP';
    }
    else if (type === 'spotOffered') {
        categoryIdentifier = 'SPOT_OFFER';
    }
    else if (type === 'fillerOpportunity') {
        categoryIdentifier = 'FILLER_OPPORTUNITY';
    }
    // When a categoryIdentifier is set, action buttons must render on
    // both platforms. Android requires special handling: if the FCM
    // message has a top-level `notification` block, the OS auto-renders
    // the notification in background and bypasses expo-notifications
    // entirely — so the registered category's buttons are never
    // attached. The only reliable path is a *data-only* FCM message,
    // which forces expo-notifications' FirebaseMessagingService to
    // build the notification itself and read `data.categoryId` (note:
    // Android reads `categoryId`, not `categoryIdentifier` — that's
    // the iOS spelling). For iOS we keep the alert payload under
    // `apns.payload.aps.alert` since dropping the top-level
    // `notification` removes its visible content otherwise.
    // sendEachForMulticast is capped at 500 tokens per call.
    const all = Array.from(tokens);
    let ok = 0;
    let failed = 0;
    // Tokens FCM reports as permanently invalid → pruned from their owner
    // after the send loop.
    const deadTokens = new Set();
    const DEAD_TOKEN_CODES = new Set([
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
        'messaging/invalid-argument',
    ]);
    for (let i = 0; i < all.length; i += 500) {
        const chunk = all.slice(i, i + 500);
        const baseData = categoryIdentifier
            ? {
                ...data,
                // Android side of expo-notifications reads `categoryId`.
                categoryId: categoryIdentifier,
                // Kept for any JS-side handler that still keys off the
                // iOS spelling (and as a forward-compat hint).
                categoryIdentifier,
                // expo-notifications builds the visible notification from
                // data["title"] / data["message"] when there's no
                // top-level notification block.
                title: message.title,
                message: message.body,
            }
            : data;
        const res = await messaging.sendEachForMulticast({
            tokens: chunk,
            // Drop the top-level `notification` block when we have a
            // category — see comment above. Without buttons we keep the
            // existing dual-payload shape so nothing else changes.
            ...(categoryIdentifier
                ? {}
                : { notification: { title: message.title, body: message.body } }),
            data: baseData,
            android: categoryIdentifier
                ? { priority: 'high' }
                : { priority: 'high', notification: { sound: 'default' } },
            apns: {
                payload: {
                    aps: categoryIdentifier
                        ? {
                            alert: { title: message.title, body: message.body },
                            sound: 'default',
                            category: categoryIdentifier,
                        }
                        : {
                            sound: 'default',
                        },
                },
            },
        });
        ok += res.successCount;
        failed += res.failureCount;
        if (res.failureCount > 0) {
            const failures = res.responses
                .map((r, idx) => (r.success ? null : { token: chunk[idx]?.slice(0, 12) + '…', err: r.error?.message, code: r.error?.code }))
                .filter((x) => x !== null);
            console.warn(`[notifications] ${type}: ${res.failureCount} FCM failure(s) of ${chunk.length}`, JSON.stringify(failures.slice(0, 5)));
            // Flag permanently-invalid tokens for pruning.
            res.responses.forEach((r, idx) => {
                if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
                    const tok = chunk[idx];
                    if (tok)
                        deadTokens.add(tok);
                }
            });
        }
    }
    // Prune dead tokens from their owners — from BOTH the legacy root
    // /users/{uid}.fcmTokens and the /users/{uid}/private/push.fcmTokens,
    // so the next push for that user no longer wastes a slot on (and
    // silently "succeeds" against) a dead token. Best-effort + grouped by
    // user to minimise writes.
    if (deadTokens.size > 0) {
        const byUser = new Map();
        for (const tok of deadTokens) {
            const uid = tokenToUser.get(tok);
            if (!uid)
                continue;
            const arr = byUser.get(uid) ?? [];
            arr.push(tok);
            byUser.set(uid, arr);
        }
        await Promise.allSettled(Array.from(byUser.entries()).flatMap(([uid, toks]) => [
            db
                .collection('users')
                .doc(uid)
                .update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...toks) })
                .catch(() => undefined),
            db
                .collection('users')
                .doc(uid)
                .collection('private')
                .doc('push')
                .update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...toks) })
                .catch(() => undefined),
        ]));
        console.log(`[notifications] ${type}: pruned ${deadTokens.size} dead token(s) across ${byUser.size} user(s)`);
    }
    console.log(`[notifications] ${type}: dispatched tokens=${tokens.size} ok=${ok} failed=${failed} skippedPref=${skippedPref} skippedNoToken=${skippedNoToken} categoryIdentifier=${categoryIdentifier ?? 'none'}`);
    return { ok, failed, skippedPref, skippedNoToken };
}
// ─── onCreate trigger ──────────────────────────────────────────────────
/**
 * Dedup window for game-update fan-outs. An admin who edits a game
 * 3 times in 30 seconds should not fire 3 separate pushes to every
 * registered player — that's spam. We collapse repeat 'updated'
 * events for the same gameId within this window into a single
 * delivered push (the FIRST one wins; subsequent ones are marked
 * delivered with `skipped: 'duplicate'`).
 *
 * Cancellations / deletions are NOT deduped — those are terminal
 * one-shots and the user needs to know.
 */
const GAME_UPDATE_DEDUP_WINDOW_MS = 60 * 1000;
/**
 * Re-fetch user-visible textual fields from canonical /games and
 * /groups docs so a client cannot spoof them via the notification
 * payload. We touch ONLY:
 *   • payload.gameTitle  ←  /games/{gameId}.title
 *   • payload.groupName  ←  /groups/{groupId}.name
 *   • payload.startsAt   ←  /games/{gameId}.startsAt
 *
 * Other payload fields (IDs, action discriminators, counters) are
 * either internal IDs the client can't usefully spoof or already
 * server-generated upstream (e.g. `inviterName` is set by the
 * `sendGameInvite` callable, never by the client directly). We
 * leave those untouched.
 *
 * The helper is best-effort: if a fetch fails (deleted game, network
 * blip), the original payload value passes through. This keeps
 * notifications flowing during transient outages instead of dropping
 * pushes silently.
 */
async function canonicaliseNotificationPayload(raw) {
    const payload = { ...(raw || {}) };
    const gameId = typeof payload.gameId === 'string' ? payload.gameId : '';
    const groupId = typeof payload.groupId === 'string'
        ? payload.groupId
        : '';
    const fetches = [];
    if (gameId) {
        fetches.push(db
            .collection('games')
            .doc(gameId)
            .get()
            .then((snap) => {
            if (!snap.exists)
                return;
            const g = snap.data();
            if (typeof g.title === 'string')
                payload.gameTitle = g.title;
            if (typeof g.startsAt === 'number')
                payload.startsAt = g.startsAt;
        })
            .catch(() => {
            /* best-effort */
        }));
    }
    if (groupId) {
        fetches.push(db
            .collection('groups')
            .doc(groupId)
            .get()
            .then((snap) => {
            if (!snap.exists)
                return;
            const g = snap.data();
            if (typeof g.name === 'string')
                payload.groupName = g.name;
        })
            .catch(() => {
            /* best-effort */
        }));
    }
    await Promise.all(fetches);
    return payload;
}
exports.onNotificationCreated = (0, firestore_1.onDocumentCreated)('notifications/{id}', async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const notif = snap.data();
    if (notif.delivered)
        return;
    // Game-update / cancel / delete dedup: any of these actions
    // shouldn't fan out twice within the dedup window. We use a
    // per-gameId latch doc with `lastDispatchedAt`; if fresh, skip
    // this push. Defense against:
    //   • admin editing a game 3 times in 30s (`updated`)
    //   • multiple cascade dispatches accidentally hitting the
    //     same game (`cancelled` / `deleted`)
    // Updating the latch is best-effort — if it fails the worst
    // case is one duplicate push, which is fine.
    if (notif.type === 'gameCanceledOrUpdated' &&
        (notif.payload?.action === 'updated' ||
            notif.payload?.action === 'cancelled' ||
            notif.payload?.action === 'deleted') &&
        typeof notif.payload?.gameId === 'string') {
        const gameId = notif.payload.gameId;
        const latchRef = db.collection('gameUpdateLatches').doc(gameId);
        const latch = await latchRef.get();
        const now = Date.now();
        const lastAt = latch.exists
            ? Number(latch.data()?.lastDispatchedAt) || 0
            : 0;
        if (lastAt > 0 && now - lastAt < GAME_UPDATE_DEDUP_WINDOW_MS) {
            await snap.ref.update({
                delivered: true,
                deliveredAt: now,
                skipped: 'duplicate',
            });
            return;
        }
        try {
            await latchRef.set({ lastDispatchedAt: now, gameId }, { merge: true });
        }
        catch (err) {
            console.warn('[onNotificationCreated] latch write failed', err);
        }
    }
    // Canonicalise message-bearing payload fields BEFORE building the
    // notification text. Previously `buildMessage()` consumed
    // `payload.gameTitle` / `payload.groupName` directly from the
    // notification doc — fields any signed-in client could spoof to
    // phish recipients ("המשחק בוטל - דמי גבוהים מ־2000"). The
    // Firestore rule caps their length but cannot validate truthfulness.
    //
    // Fix: re-derive them server-side from the canonical /games and
    // /groups docs by ID. The IDs themselves come from the payload
    // but they're unguessable opaque strings, and authorisation to
    // create the notification is enforced separately.
    const canonical = await canonicaliseNotificationPayload(notif.payload);
    const message = buildMessage(notif.type, canonical);
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
        // The data payload that ships with the FCM message is built from
        // the CANONICAL values too — so a client that introspects the
        // raw push (Notifee / Notifications API) can't see spoofed
        // strings either.
        const data = {
            type: notif.type,
            ...Object.fromEntries(Object.entries(canonical).map(([k, v]) => [k, String(v)])),
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
async function runSendGameReminders() {
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
        // Notify FIRST, then flip reminderSent — sequentially, so the latch is set
        // ONLY after a successful notify (a failed notify leaves the flag unset and
        // the next tick retries; createNotificationOnce dedupes so no double-push).
        ops.push((async () => {
            await createNotificationOnce({
                type: 'gameReminder',
                recipientId: doc.id, // fan-out marker
                payload: {
                    gameId: doc.id,
                    gameTitle: g.title || 'המשחק',
                    startsAt: g.startsAt,
                },
            });
            await doc.ref.update({ reminderSent: true });
        })());
    }
    // allSettled: one game's failure must not abandon the rest of this tick.
    const results = await Promise.allSettled(ops);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    console.log(`[sendGameReminders] dispatched ${ok}/${ops.length} reminder(s)`);
}
// ─── Scheduled: 5h-before "did you forget to RSVP?" nudge ───────────────
/**
 * Per-user push to community members who are still on the fence
 * 5 hours before kickoff. The push carries the same JOIN/CANCEL
 * action buttons as `gameReminder`, so the recipient can lock
 * their answer without opening the app — exactly the WhatsApp-poll
 * UX we're trying to replace.
 *
 * Eligibility:
 *   • game.status === 'open'
 *   • game.startsAt in [now+4h50m, now+5h10m]  (matches our 15-min
 *     cron cadence)
 *   • !game.rsvpNudgeSent  (per-game latch)
 *   • not already at capacity
 *
 * Recipients per game:
 *   • the parent group's playerIds + adminIds  (community members)
 *   • MINUS anyone already in players / waitlist / pending
 *   • MINUS anyone in `cancellations` (they explicitly opted out)
 *   • MINUS the game's createdBy (don't ping the organiser about
 *     their own game)
 */
async function runSendRsvpNudges() {
    const now = Date.now();
    const lower = now + 4 * 60 * 60 * 1000 + 50 * 60 * 1000;
    const upper = now + 5 * 60 * 60 * 1000 + 10 * 60 * 1000;
    const snap = await db
        .collection('games')
        .where('startsAt', '>=', lower)
        .where('startsAt', '<', upper)
        .get();
    if (snap.empty) {
        console.log('[sendRsvpNudges] no candidate games');
        return;
    }
    let nudged = 0;
    for (const doc of snap.docs) {
        const g = doc.data();
        if (g.rsvpNudgeSent)
            continue;
        if (g.status !== 'open')
            continue;
        if (!g.groupId)
            continue;
        const playersCount = g.players?.length ?? 0;
        const guestsCount = g.guests?.length ?? 0;
        if (g.maxPlayers && playersCount + guestsCount >= g.maxPlayers)
            continue;
        // Pull the parent group to enumerate its members.
        const groupSnap = await db.collection('groups').doc(g.groupId).get();
        if (!groupSnap.exists)
            continue;
        const grp = groupSnap.data();
        const members = new Set([
            ...(grp.playerIds ?? []),
            ...(grp.adminIds ?? []),
        ]);
        // Exclusions: anyone already in any roster bucket, anyone who
        // already cancelled (they opted out), the organiser themselves.
        const exclude = new Set([
            ...(g.players ?? []),
            ...(g.waitlist ?? []),
            ...(g.pending ?? []),
            ...Object.keys(g.cancellations ?? {}),
        ]);
        if (g.createdBy)
            exclude.add(g.createdBy);
        const targets = Array.from(members).filter((uid) => !exclude.has(uid));
        // Flip the latch transactionally BEFORE dispatching, with a
        // re-read guard. This protects against:
        //   • two cron instances racing (CF can occasionally double-fire)
        //   • partial dispatch + retry → duplicate sends
        // Trade-off accepted: if the function crashes mid-loop below,
        // at most a handful of users miss the nudge for this one game.
        // A missed nudge is recoverable; a duplicate one is annoying.
        let claimed = false;
        try {
            await db.runTransaction(async (tx) => {
                const fresh = await tx.get(doc.ref);
                if (!fresh.exists)
                    return;
                if (fresh.data().rsvpNudgeSent) {
                    return;
                }
                tx.update(doc.ref, { rsvpNudgeSent: true });
                claimed = true;
            });
        }
        catch (e) {
            console.error('[sendRsvpNudges] latch txn failed', doc.id, e);
            continue;
        }
        if (!claimed)
            continue;
        if (targets.length === 0)
            continue;
        // One notification doc per target — wrapped individually so a
        // single failure (e.g. quota blip on one add) doesn't strand
        // the rest. The latch is already set, so we won't retry from
        // a re-fire either way.
        for (const uid of targets) {
            try {
                await createNotificationOnce({
                    type: 'gameRsvpNudge',
                    recipientId: uid,
                    payload: {
                        gameId: doc.id,
                        gameTitle: g.title || 'המשחק',
                        startsAt: g.startsAt,
                    },
                });
                nudged += 1;
            }
            catch (e) {
                console.error('[sendRsvpNudges] add failed', doc.id, uid, e);
            }
        }
    }
    console.log(`[sendRsvpNudges] nudged ${nudged} member(s)`);
}
// ─── Scheduled: flush batched join notifications to admins ──────────────
/**
 * Consumes the `pendingJoinerIds[]` / `pendingJoinFlushAt` buffer
 * that `onGameRosterChanged` builds up on every join. When the
 * window expires (default 3 min from the first joiner), we send a
 * SINGLE consolidated push to the community admins instead of N
 * separate "X joined" pings — so a 10-player rush after a community
 * blast becomes one notification, not ten.
 *
 * Runs every minute → max latency for the admin push is `window + 1m`.
 *
 * Idempotency: the buffer is cleared inside a transaction that also
 * captures the joiner list, so two concurrent cron runs can't
 * dispatch the same batch twice.
 */
/**
 * Cloud Tasks handler — replaces the every-1-minute cron with a
 * one-shot task scheduled exactly at `pendingJoinFlushAt`.
 *
 * The handler runs the SAME claim-and-dispatch logic the cron did, just
 * for one specific game (passed via the task payload) instead of
 * scanning the whole collection on every minute.
 *
 * Cost win: the cron paid ~43,200 invocations / month even with zero
 * joins. The task variant pays one invocation per join-batch (≈1 per
 * 100 joins, since each fires at the same flushAt). ~96% reduction.
 *
 * Latency win: the task fires at the exact scheduled second (Cloud
 * Tasks SLA is sub-second). The cron added up to 60 s of polling
 * delay; the task removes it.
 *
 * Idempotency: the claim transaction in the body is the same one the
 * cron used, so re-enqueueing or duplicate-firing a task is still
 * safe — the second dispatch finds an empty buffer and no-ops.
 */
exports.flushPendingJoinerNotifsTask = (0, tasks_1.onTaskDispatched)({
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 6 },
}, async (req) => {
    const { gameId } = (req.data ?? {});
    if (!gameId) {
        console.warn('[flushPendingJoinerNotifsTask] missing gameId');
        return;
    }
    const ref = db.collection('games').doc(gameId);
    // Claim transactionally — captures the joiner list AND clears the
    // buffer atomically. If the task fires twice (unlikely under Cloud
    // Tasks but possible after retry), the second one finds an empty
    // buffer and exits without dispatch.
    let claimedJoiners = [];
    let g = {};
    try {
        await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists)
                return;
            const d = fresh.data();
            // If a later joiner extended the window (shouldn't happen with
            // the current writer — it never extends — but kept defensive),
            // re-enqueue ourselves for the new time and exit.
            if (d.pendingJoinFlushAt && d.pendingJoinFlushAt > Date.now() + 2000) {
                // Defensive only — current writer doesn't extend. Skip.
                return;
            }
            claimedJoiners = (d.pendingJoinerIds ?? []).slice();
            g = { title: d.title, groupId: d.groupId, startsAt: d.startsAt };
            tx.update(ref, {
                pendingJoinerIds: admin.firestore.FieldValue.delete(),
                pendingJoinFlushAt: admin.firestore.FieldValue.delete(),
            });
        });
    }
    catch (err) {
        console.error('[flushPendingJoinerNotifsTask] claim failed', gameId, err);
        throw err; // task will retry per retryConfig
    }
    if (claimedJoiners.length === 0 || !g.groupId)
        return;
    // Resolve display names (best-effort).
    let names = [];
    try {
        const userRefs = claimedJoiners.map((uid) => db.collection('users').doc(uid));
        const userSnaps = await db.getAll(...userRefs);
        names = userSnaps
            .map((s) => {
            if (!s.exists)
                return '';
            const data = s.data();
            return (data.name || data.displayName || '').trim();
        })
            .filter((n) => n.length > 0);
    }
    catch (err) {
        console.error('[flushPendingJoinerNotifsTask] name lookup failed', err);
    }
    try {
        await createNotificationOnce({
            type: 'gamePlayersJoined',
            recipientId: g.groupId,
            payload: {
                gameId,
                groupId: g.groupId,
                gameTitle: g.title || 'המשחק',
                startsAt: g.startsAt ?? null,
                joinerIds: claimedJoiners.join(','),
                joinerNames: names.join(','),
                count: claimedJoiners.length,
            },
        });
    }
    catch (err) {
        console.error('[flushPendingJoinerNotifsTask] dispatch failed', gameId, err);
        throw err; // retry per retryConfig
    }
});
// ─── Precise one-shot: fire a scheduled game "moment" on time ───────────
//
// The every-5-min cron opens registration / flips a game public with up
// to 5 minutes of slack ("registration opens at 10:00" can fire at
// 10:03). For time-sensitive moments we ALSO enqueue a Cloud Task that
// fires at the exact second. Both paths funnel through the same
// self-verifying `flipScheduledGameOnce` / `flipPublicGameOnce`, so:
//
//   • cancel    → the game leaves 'scheduled'/'community'; a stale task
//                 fired at the old moment no-ops.
//   • reschedule→ `enqueueGameMoments` queues a fresh task for the new
//                 time; the old task fires harmlessly (not-yet-due or
//                 already-handled). No task deletion needed.
//   • double-fire (task + cron, or a retry) → the openedNotificationSent
//                 / publicOpenedAt latches make it idempotent.
//
// The cron stays as a safety net (covers moments >25 days out, which
// exceed the Cloud Tasks 30-day schedule horizon, and any enqueue that
// failed). `moment` is 'registrationOpen' | 'publicOpen'.
exports.scheduledGameMomentTask = (0, tasks_1.onTaskDispatched)({
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 6 },
}, async (req) => {
    const { gameId, moment } = (req.data ?? {});
    if (!gameId || !moment) {
        console.warn('[scheduledGameMomentTask] missing gameId/moment', req.data);
        return;
    }
    try {
        if (moment === 'registrationOpen') {
            const r = await flipScheduledGameOnce(gameId);
            console.log(`[scheduledGameMomentTask] registrationOpen ${gameId} → ${r}`);
        }
        else if (moment === 'publicOpen') {
            const r = await flipPublicGameOnce(gameId);
            console.log(`[scheduledGameMomentTask] publicOpen ${gameId} → ${r}`);
        }
        else {
            console.warn(`[scheduledGameMomentTask] unknown moment '${moment}'`);
        }
    }
    catch (err) {
        console.error('[scheduledGameMomentTask] failed', gameId, moment, err);
        throw err; // retry per retryConfig
    }
});
// Cloud Tasks can schedule at most ~30 days out. Stay under that with a
// margin; anything further is left to the safety-net cron.
const MAX_TASK_HORIZON_MS = 25 * 24 * 60 * 60 * 1000;
// Enqueue precise one-shot tasks for a game's future "moments" whenever
// the game is created or edited. Called from `onGameRosterChanged`.
//
// We enqueue a task ONLY when the moment is (a) in the future, (b) within
// the task horizon, and (c) NEW or CHANGED vs. the previous doc — so a
// roster-only edit (someone joined) doesn't re-enqueue, but moving the
// registration time does. Re-enqueueing on a no-op change would be safe
// (the handler is idempotent) but wasteful, so we gate on change.
async function enqueueGameMoments(gameId, before, after) {
    const now = Date.now();
    const horizon = now + MAX_TASK_HORIZON_MS;
    const ops = [];
    // registrationOpen — only meaningful while the game is still waiting
    // to open (status 'scheduled').
    const reg = after.registrationOpensAt;
    if (after.status === 'scheduled' &&
        typeof reg === 'number' &&
        reg > now + 1000 &&
        reg < horizon &&
        reg !== before?.registrationOpensAt) {
        ops.push({ moment: 'registrationOpen', at: reg });
    }
    // publicOpen — community game scheduled to surface app-wide later.
    const pub = after.publicOpenAt;
    if (after.visibility === 'community' &&
        typeof pub === 'number' &&
        pub > now + 1000 &&
        pub < horizon &&
        pub !== before?.publicOpenAt) {
        ops.push({ moment: 'publicOpen', at: pub });
    }
    if (ops.length === 0)
        return;
    for (const op of ops) {
        try {
            await (0, functions_1.getFunctions)()
                .taskQueue('scheduledGameMomentTask')
                .enqueue({ gameId, moment: op.moment, expectedAt: op.at }, { scheduleTime: new Date(op.at) });
            console.log(`[enqueueGameMoments] ${op.moment} for ${gameId} @ ${new Date(op.at).toISOString()}`);
        }
        catch (err) {
            // Non-fatal — the safety-net cron will still pick this game up
            // within 5 minutes of the moment.
            console.error(`[enqueueGameMoments] enqueue ${op.moment} failed for ${gameId}`, err);
        }
    }
}
// ═══ Fair registration — tap-time reconciler ════════════════════════════
//
// Clients write a contention-free request doc per user
// (/games/{id}/joinRequests/{uid}) stamped with `tappedAt` from the
// server-synced clock. A short settle window collects the opening burst, then
// this reconciler seats everyone strictly by tap time — so the spot goes to
// whoever tapped first, not whoever's network was fastest. Mirrors the pure
// `assignJoins` in src/services/joinFairness.ts (kept in sync by hand; the app
// side has the exhaustive unit tests).
const JOIN_SETTLE_MS = 2000;
const TAP_BACKDATE_GRACE_MS = 15000;
async function reconcileGameJoins(gameId) {
    const gameRef = db.collection('games').doc(gameId);
    const reqCol = gameRef.collection('joinRequests');
    await db.runTransaction(async (tx) => {
        // Reads first (Admin SDK allows queries inside a transaction).
        const gameSnap = await tx.get(gameRef);
        if (!gameSnap.exists)
            return;
        const queuedSnap = await tx.get(reqCol.where('state', '==', 'queued'));
        if (queuedSnap.empty)
            return;
        const g = gameSnap.data();
        const now = Date.now();
        // Lifecycle gate — if the game isn't joinable, reject the whole batch
        // (the client surfaces a friendly message off the request doc state).
        const liveMatch = g.liveMatch;
        const notOpen = g.status !== 'open';
        // Honor the same 1h post-kickoff grace the client offers (canJoinGame /
        // LATE_REG_GRACE_MS) so a late-but-within-grace join the UI allowed isn't
        // rejected server-side. Live games are still blocked by `live` below.
        const LATE_REG_GRACE_MS = 60 * 60 * 1000;
        const started = typeof g.startsAt === 'number' &&
            g.startsAt + LATE_REG_GRACE_MS < now;
        const live = liveMatch?.phase === 'live';
        if (notOpen || started || live) {
            const reason = notOpen ? 'GAME_NOT_OPEN' : started ? 'GAME_STARTED' : 'GAME_LIVE';
            queuedSnap.docs.forEach((d) => tx.update(d.ref, { state: 'rejected', reason, assignedAt: now }));
            return;
        }
        // Order the batch by clamped tap time (network-independent), then receipt,
        // then uid — identical to assignJoins/orderJoinRequests.
        const reqs = queuedSnap.docs.map((d) => {
            const r = d.data();
            const receipt = r.requestedAt instanceof admin.firestore.Timestamp
                ? r.requestedAt.toMillis()
                : now;
            const rawTap = typeof r.tappedAt === 'number' && r.tappedAt > 0 ? r.tappedAt : receipt;
            const key = Math.max(rawTap, receipt - TAP_BACKDATE_GRACE_MS);
            return { ref: d.ref, uid: r.uid ?? d.id, key, receipt };
        });
        reqs.sort((a, b) => a.key - b.key ||
            a.receipt - b.receipt ||
            (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
        const players = [...(g.players ?? [])];
        const waitlist = [...(g.waitlist ?? [])];
        const pending = [...(g.pending ?? [])];
        const inAny = new Set([...players, ...waitlist, ...pending]);
        const rejected = g.rejectedPlayerIds ?? [];
        const guests = Array.isArray(g.guests) ? g.guests.length : 0;
        const offer = g.pendingPromotion?.uid ? 1 : 0;
        const maxPlayers = typeof g.maxPlayers === 'number' ? g.maxPlayers : 15;
        const requiresApproval = g.requiresApproval === true;
        const createdBy = typeof g.createdBy === 'string' ? g.createdBy : '';
        // Users who were explicitly INVITED to this game bypass approval (an
        // invite IS the approval) — same exemption as the creator.
        const invitedUserIds = new Set(g.invitedUserIds ?? []);
        const joinedAt = g.joinedAt && typeof g.joinedAt === 'object'
            ? { ...g.joinedAt }
            : {};
        // Clear a re-joiner's stale cancellation: someone who cancelled and then
        // re-joins must not linger in `cancellations` — otherwise they show up in
        // BOTH the roster and the "ביטלו השתתפות" list (user report).
        const cancellations = g.cancellations && typeof g.cancellations === 'object'
            ? { ...g.cancellations }
            : {};
        let cancellationsChanged = false;
        let occupancy = players.length + guests + offer;
        // Active red-card block: a member holding an ACTIVE red card in this game's
        // community can't SELF-register (admins adding a player use a different path
        // that bypasses this). Only new joiners are affected — anyone already in the
        // roster stays. One grouped read; mirrors src/utils/cardState.isActiveRedCard.
        const groupId = typeof g.groupId === 'string' ? g.groupId : '';
        const redBlocked = new Set();
        if (groupId) {
            const grpSnap = await tx.get(db.collection('groups').doc(groupId));
            const grpData = grpSnap.exists
                ? grpSnap.data()
                : null;
            // The cards master switch suspends ALL card behaviour, enforcement
            // included — skip the scan entirely when it's off (also spares the
            // read on the vast majority of games that never enabled cards).
            if (grpData?.cardsEnabled === true) {
                const redValidityDays = grpData.redCardValidityDays;
                const redSnap = await tx.get(db
                    .collection('communityPlayerEvents')
                    .where('groupId', '==', groupId)
                    .where('type', '==', 'red')
                    // Newest-first + bounded: an ACTIVE card is recent, so ordering by
                    // `at desc` keeps it inside the window even if a long-lived club has
                    // amassed >1000 (mostly expired/revoked) red docs. Backed by the
                    // (groupId, type, at desc) composite index. Only runs when cards on.
                    .orderBy('at', 'desc')
                    .limit(1000));
                for (const d of redSnap.docs) {
                    const e = d.data();
                    if (!e.userId || e.revoked)
                        continue;
                    // Prefer the expiry snapshotted at issue time; fall back to the live
                    // group-validity computation for legacy cards that pre-date it.
                    const exp = e.expiresAt !== undefined
                        ? e.expiresAt
                        : typeof redValidityDays === 'number' && redValidityDays > 0
                            ? (e.at ?? 0) + redValidityDays * 86400000
                            : null;
                    const expired = exp !== null && now > exp;
                    if (!expired)
                        redBlocked.add(e.userId);
                }
            }
        }
        for (const r of reqs) {
            if (rejected.includes(r.uid)) {
                tx.update(r.ref, {
                    state: 'rejected',
                    reason: 'GAME_JOIN_REJECTED',
                    assignedAt: now,
                });
                continue;
            }
            // New joiner with an active red card → blocked (already-in players stay).
            if (!inAny.has(r.uid) && redBlocked.has(r.uid)) {
                tx.update(r.ref, {
                    state: 'rejected',
                    reason: 'RED_CARD_ACTIVE',
                    assignedAt: now,
                });
                continue;
            }
            let bucket;
            if (inAny.has(r.uid)) {
                bucket = players.includes(r.uid)
                    ? 'players'
                    : waitlist.includes(r.uid)
                        ? 'waitlist'
                        : 'pending';
            }
            else if (requiresApproval && r.uid !== createdBy && !invitedUserIds.has(r.uid)) {
                // Approval needed only for someone who is NEITHER the creator NOR an
                // explicitly invited user. Invited / creator join directly.
                pending.push(r.uid);
                bucket = 'pending';
            }
            else if (occupancy < maxPlayers) {
                players.push(r.uid);
                occupancy += 1;
                bucket = 'players';
            }
            else {
                waitlist.push(r.uid);
                bucket = 'waitlist';
            }
            inAny.add(r.uid);
            if (joinedAt[r.uid] === undefined)
                joinedAt[r.uid] = r.receipt;
            if (cancellations[r.uid] !== undefined) {
                delete cancellations[r.uid];
                cancellationsChanged = true;
            }
            tx.update(r.ref, { state: 'assigned', bucket, assignedAt: now });
        }
        const participantIds = Array.from(new Set([...players, ...waitlist, ...pending]));
        const update = {
            players,
            waitlist,
            pending,
            participantIds,
            joinedAt,
            updatedAt: now,
        };
        if (cancellationsChanged)
            update.cancellations = cancellations;
        tx.update(gameRef, update);
    });
}
// A new join request schedules a reconcile ~SETTLE later. A deterministic,
// time-bucketed task id dedupes the whole opening burst down to ONE reconcile
// (all the simultaneous taps map to the same id → only the first task lands).
exports.onJoinRequestCreated = (0, firestore_1.onDocumentCreated)('games/{gameId}/joinRequests/{uid}', async (event) => {
    const gameId = event.params.gameId;
    const windowBucket = Math.floor(Date.now() / JOIN_SETTLE_MS);
    try {
        await (0, functions_1.getFunctions)()
            .taskQueue('reconcileJoinsTask')
            .enqueue({ gameId }, {
            scheduleTime: new Date(Date.now() + JOIN_SETTLE_MS),
            id: `rj-${gameId}-${windowBucket}`,
        });
    }
    catch (err) {
        // ALREADY_EXISTS (gRPC code 6) → a reconcile for this window is already
        // scheduled. That's the dedupe working as intended; swallow it.
        const code = err?.code;
        if (code !== 6 && !String(err).includes('ALREADY_EXISTS')) {
            console.error('[onJoinRequestCreated] enqueue failed', gameId, err);
        }
    }
});
exports.reconcileJoinsTask = (0, tasks_1.onTaskDispatched)({
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 5 },
    rateLimits: { maxConcurrentDispatches: 6 },
}, async (req) => {
    const gameId = (req.data ?? {}).gameId;
    if (!gameId)
        return;
    try {
        await reconcileGameJoins(gameId);
    }
    catch (err) {
        console.error('[reconcileJoinsTask] failed', gameId, err);
        throw err; // retry per retryConfig
    }
});
// ─── Scheduled: deferred-open flip for recurring games ──────────────────
//
// Every 5 minutes, look for games in `status: 'scheduled'` whose
// `registrationOpensAt` has passed and:
//   1. Dispatch the `newGameInCommunity` push so subscribed members
//      learn registration just opened.
//   2. Mark the game with `openedNotificationSent: true` to stop a
//      retry from re-firing on the next run.
//   3. Flip status → 'open' (so feeds, joins and rules stop hiding it).
//
// Order matters for failure recovery: notify-then-flag-then-flip means
// the cron predicate (status='scheduled' AND !openedNotificationSent)
// keeps retrying until BOTH the dispatch AND the flag write land. The
// status flip is the last step — once it lands the game leaves the
// query window for good.
//
// `openedNotificationSent` is also the guard that prevents an admin's
// post-creation edit of `registrationOpensAt` from firing a second
// push: once the flag is true we never dispatch again for this game.
// Per-game registration-open flip — the unit of work shared by the
// every-5-min safety-net cron (`runFlipScheduledGames`) and the precise
// one-shot Cloud Task (`scheduledGameMomentTask`). It re-reads the game
// fresh and is fully self-verifying ("fire-but-verify"):
//
//   • status must still be 'scheduled' — a cancelled/edited-away game
//     no-ops, so a stale task fired at an OLD registrationOpensAt does
//     nothing once the game moved on.
//   • registrationOpensAt must be ≤ now — a game rescheduled LATER is
//     not opened early; the late task simply finds it not-yet-due.
//   • openedNotificationSent latches the push so a double-fire (task +
//     cron, or a task retry) can never double-notify.
//
// Because of these guards we never need to delete/cancel an in-flight
// task on cancel or reschedule: we just enqueue a NEW task for the new
// moment and let the old one fall through harmlessly.
async function flipScheduledGameOnce(gameId) {
    const now = Date.now();
    const ref = db.collection('games').doc(gameId);
    const snap = await ref.get();
    if (!snap.exists)
        return 'skip';
    const g = snap.data();
    // Guard 1 — only games still waiting to open. Cancelled/finished/
    // already-open games are out of scope (this is what makes a stale
    // task fired after a cancel a no-op).
    if (g.status !== 'scheduled')
        return 'skip';
    // Guard 2 — not yet due (game was rescheduled to a later time after
    // this task/cron was queued).
    if (typeof g.registrationOpensAt !== 'number' || g.registrationOpensAt > now) {
        return 'skip';
    }
    let notified = false;
    // Step 1 — dispatch notification (only if not already sent). The
    // notification doc → CF fan-out → FCM, so a second run that re-enters
    // this branch would double-notify. The flag write below prevents that.
    if (!g.openedNotificationSent) {
        const res = await createNotificationOnce({
            type: 'newGameInCommunity',
            recipientId: g.groupId ?? gameId,
            payload: {
                groupId: g.groupId,
                gameId,
                title: g.title || 'המשחק',
                startsAt: g.startsAt,
                fieldName: g.fieldName,
                // Registration-open for a recurring/scheduled game: notify
                // EVERYONE in the community INCLUDING the organiser/admin
                // (spec) — so deliberately DON'T pass createdBy here (which
                // would exclude the creator from the fan-out). And force-include
                // the organiser even if they never subscribed: it's THEIR game
                // opening, they expect the ping.
                alsoNotifyUid: g.createdBy,
            },
        });
        // Only latch + flip if the notification actually landed or was
        // correctly suppressed as an already-existing one (unread-exists /
        // aggregated / duplicate-bucket — all mean "a push for this moment
        // exists"). A genuine failure (Firestore error, invalid input) must
        // NOT set the flag — otherwise the push is silently lost forever.
        // Throwing makes the task/cron retry.
        const failed = res.skipped === 'error' || res.skipped === 'invalid-input';
        if (failed) {
            throw new Error(`[flipScheduledGameOnce] notify failed for ${gameId} (${res.skipped})`);
        }
        notified = true;
    }
    // Single write — flip status AND (when we just notified) set the latch in
    // ONE update instead of two. Two separate writes re-fired the whole
    // games-trigger fan-out twice per flip; this halves it. Atomic: if it fails,
    // neither the latch nor the flip lands, so the next run re-enters the notify
    // branch (createNotificationOnce dedupes → no double push) and retries.
    await ref.update({
        status: 'open',
        ...(notified ? { openedNotificationSent: true } : {}),
        updatedAt: now,
    });
    return notified ? 'flipped' : 'notified';
}
async function runFlipScheduledGames() {
    const now = Date.now();
    // Equality query — auto-indexed, no composite needed. The
    // registrationOpensAt + openedNotificationSent filters run
    // client-side.
    const snap = await db
        .collection('games')
        .where('status', '==', 'scheduled')
        .get();
    if (snap.empty) {
        console.log('[flipScheduledGames] no scheduled games');
        return;
    }
    let flipped = 0;
    for (const doc of snap.docs) {
        const g = doc.data();
        if (typeof g.registrationOpensAt !== 'number' ||
            g.registrationOpensAt > now) {
            continue;
        }
        try {
            const r = await flipScheduledGameOnce(doc.id);
            if (r === 'flipped' || r === 'notified')
                flipped++;
        }
        catch (err) {
            console.error(`[flipScheduledGames] flip failed for ${doc.id}`, err);
        }
    }
    console.log(`[flipScheduledGames] processed ${flipped} due game(s)`);
}
// ─── Scheduled: recurring weekly game clone-on-completion ───────────────
//
// A recurring community game (`recurring: true`) re-creates itself every
// week. ~3h AFTER kickoff we clone the fixture into next week with the
// EXACT same settings: startsAt +7d, and the same relative offsets for
// registrationOpensAt / publicOpenAt / guestsOpenAt (each +7d). The fresh
// instance starts with an empty roster. The original is stamped with
// `recurringNextCreatedAt` so we never clone the same instance twice — the
// clone (also recurring) will, in turn, spawn the following week's game
// ~3h after ITS kickoff. No series doc, no management UI — just the toggle.
const RECURRING_CLONE_DELAY_MS = 3 * 60 * 60 * 1000; // 3h after kickoff
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Israel-local UTC offset (ms) at a given instant. +2h winter / +3h summer. */
function israelOffsetMs(epoch) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
        .formatToParts(new Date(epoch))
        .map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUtc - epoch;
}
/**
 * Advance an instant by one week while preserving its Asia/Jerusalem WALL
 * time. A flat `+WEEK_MS` would silently move a 20:00 fixture to 21:00 (spring)
 * or 19:00 (autumn) across a DST boundary; here we correct by the offset delta
 * so "every Thursday 20:00" stays 20:00 year-round.
 */
function addOneWeekSameWallTime(epoch) {
    const naive = epoch + WEEK_MS;
    return naive + (israelOffsetMs(epoch) - israelOffsetMs(naive));
}
async function runCloneRecurringGames() {
    const now = Date.now();
    // `recurring == true` accumulates EVERY weekly instance ever created (each
    // clone is also recurring). A game is only DUE to clone once kickoff+3h has
    // passed, so range-filter `startsAt <= now-3h` AT THE QUERY: this excludes
    // every future instance (the ones that were crowding the window) and returns
    // only past-kickoff games. Ordered newest-past-first so a just-due game sits
    // at the front and can never be pushed out of the cap. Range on the orderBy
    // field reuses the existing (recurring, startsAt) composite index — no new
    // index needed. The in-loop +3h guard below stays as defense-in-depth.
    const dueCutoff = now - RECURRING_CLONE_DELAY_MS;
    const snap = await db
        .collection('games')
        .where('recurring', '==', true)
        .where('startsAt', '<=', dueCutoff)
        .orderBy('startsAt', 'desc')
        .limit(100)
        .get();
    if (snap.empty) {
        console.log('[cloneRecurringGames] none');
        return;
    }
    let cloned = 0;
    for (const doc of snap.docs) {
        const g = doc.data();
        if (typeof g.startsAt !== 'number')
            continue;
        if (g.recurringNextCreatedAt)
            continue; // already spawned next week
        if (g.status === 'cancelled')
            continue; // a cancelled week doesn't recur
        if (now < g.startsAt + RECURRING_CLONE_DELAY_MS)
            continue; // wait 3h post-kickoff
        // Advance kickoff by one week preserving Israel wall time (DST-safe), then
        // shift every dependent window by the SAME delta so each keeps its exact
        // offset from kickoff (e.g. "24h before") across a DST boundary.
        const nextStartsAt = addOneWeekSameWallTime(g.startsAt);
        const weekDelta = nextStartsAt - g.startsAt;
        const shift = (v) => typeof v === 'number' && v > 0 ? v + weekDelta : undefined;
        // Faithful copy of the settings, with a reset roster + shifted times.
        const next = { ...g };
        next.id = '';
        next.startsAt = nextStartsAt;
        const nextReg = shift(g.registrationOpensAt);
        const nextPublic = shift(g.publicOpenAt);
        const nextGuests = shift(g.guestsOpenAt);
        const nextAutoTeams = shift(g.autoTeamsAt);
        if (nextReg !== undefined)
            next.registrationOpensAt = nextReg;
        else
            delete next.registrationOpensAt;
        if (nextPublic !== undefined)
            next.publicOpenAt = nextPublic;
        else
            delete next.publicOpenAt;
        if (nextGuests !== undefined)
            next.guestsOpenAt = nextGuests;
        else
            delete next.guestsOpenAt;
        // Scheduled auto-teams time shifts +7d like the others; keep autoTeamsMethod
        // (copied via spread). The GENERATED outputs/latches are cleared below so
        // next week re-generates fresh instead of inheriting last week's teams.
        if (nextAutoTeams !== undefined)
            next.autoTeamsAt = nextAutoTeams;
        else
            delete next.autoTeamsAt;
        // Fresh roster + per-instance transient state.
        next.players = [];
        next.waitlist = [];
        next.pending = [];
        next.participantIds = [];
        next.guests = [];
        next.matches = [];
        next.arrivals = {};
        next.cancellations = {};
        next.joinedAt = {}; // per-player registration times — last week's are stale
        next.ballBringerIds = [];
        next.currentMatchIndex = 0;
        next.locked = false;
        // Reset team/match state so next week's instance starts blank — without
        // this the clone inherited last week's draftTeams + live state, and the
        // copied autoTeamsGeneratedAt latch permanently disabled auto-generation.
        delete next.draftTeams;
        delete next.draftTeamFeedback;
        delete next.liveMatch;
        delete next.rotation;
        delete next.autoTeamsGeneratedAt;
        delete next.autoTeamsGeneratedBy;
        delete next.teamBalanceMeta;
        delete next.teamsNotifiedAt;
        delete next.teamsEditedManually;
        // Clear all idempotency latches so next week's pushes fire fresh.
        delete next.recurringNextCreatedAt;
        delete next.openedNotificationSent;
        delete next.reminderSent;
        delete next.rateReminderSent;
        delete next.rsvpNudgeSent;
        delete next.shortageWarningSent;
        delete next.fillingUpSent;
        delete next.publicOpenedAt;
        delete next.pinnedMessage;
        // Per-instance state that must NOT ride into a fresh week (carried via the
        // {...g} spread otherwise):
        delete next.pendingPromotion; // last week's reserved-slot offer → phantom on an empty roster
        delete next.rejectedPlayerIds; // don't silently pre-ban last week's rejected players
        delete next.capacityNoticeSent; // stale latch would suppress the "full" notice once it refills
        delete next.promotePromptSent;
        delete next.ballHolderUserId; // legacy per-game holders (group-level holders are the live ones)
        delete next.jerseysHolderUserId;
        delete next.teams; // legacy Team[]; modern draftTeams already cleared above
        delete next.weather; // stale forecast — refreshed on demand
        // Status: scheduled if registration hasn't opened yet, else open.
        const isDeferred = typeof nextReg === 'number' && nextReg > now;
        next.status = isDeferred ? 'scheduled' : 'open';
        // If it flips to public on a schedule, it starts members-only again.
        if (nextPublic !== undefined)
            next.visibility = 'community';
        next.createdAt = now;
        next.updatedAt = now;
        try {
            // Deterministic clone id (source + this week's kickoff) + create() —
            // which FAILS if the doc already exists. This makes the clone idempotent
            // independently of the latch: if two sweeps overlap, or one crashed
            // after add() but before latching, the second create() throws
            // ALREADY_EXISTS instead of producing a duplicate game for the week.
            const cloneId = `${doc.id}_w${next.startsAt}`;
            const ref = db.collection('games').doc(cloneId);
            try {
                await ref.create({ ...next, id: cloneId });
            }
            catch (e) {
                // ALREADY_EXISTS: this week's clone is already there (a prior partial
                // run). Just (re)assert the latch and move on — no duplicate, no second
                // notification. Match both the numeric gRPC code AND the string form
                // (the SDK delivers either depending on the throw path — same dual
                // check as createNotificationOnce / onJoinRequestCreated elsewhere).
                const code = e.code;
                if (code === 6 || code === 'already-exists') {
                    await doc.ref.update({ recurringNextCreatedAt: now, updatedAt: now });
                    continue;
                }
                throw e;
            }
            await doc.ref.update({ recurringNextCreatedAt: now, updatedAt: now });
            // Notify the community now only if it opened immediately. A deferred
            // instance gets its push from flipScheduledGames when reg opens.
            if (!isDeferred) {
                await createNotificationOnce({
                    type: 'newGameInCommunity',
                    recipientId: g.groupId ?? ref.id,
                    payload: {
                        groupId: g.groupId,
                        gameId: ref.id,
                        title: g.title || 'המשחק',
                        startsAt: next.startsAt,
                        fieldName: g.fieldName,
                    },
                });
            }
            cloned++;
        }
        catch (err) {
            console.error(`[cloneRecurringGames] clone failed for ${doc.id}`, err);
        }
    }
    console.log(`[cloneRecurringGames] cloned ${cloned}`);
}
// ─── Scheduled: flip community→public at publicOpenAt ───────────────────
//
// A community game can be scheduled to open to the whole app at a set
// time (publicOpenAt). Every few minutes we flip any due game's
// visibility to 'public' so it surfaces in the app-wide feed. The
// `publicOpenedAt` latch makes the flip idempotent.
// Per-game community→public flip — shared by the every-5-min safety-net
// cron and the precise `scheduledGameMomentTask`. Self-verifying like
// `flipScheduledGameOnce`: re-reads fresh, the `publicOpenedAt` latch
// makes a double-fire idempotent, and a game cancelled/rescheduled after
// the task was queued simply no-ops here.
async function flipPublicGameOnce(gameId) {
    const now = Date.now();
    const ref = db.collection('games').doc(gameId);
    const snap = await ref.get();
    if (!snap.exists)
        return 'skip';
    const g = snap.data();
    if (g.visibility !== 'community')
        return 'skip'; // already public / private
    if (g.publicOpenedAt)
        return 'skip'; // idempotency latch
    if (typeof g.publicOpenAt !== 'number' || g.publicOpenAt > now)
        return 'skip';
    if (g.status === 'cancelled' || g.status === 'finished')
        return 'skip';
    await ref.update({
        visibility: 'public',
        publicOpenedAt: now,
        updatedAt: now,
    });
    return 'flipped';
}
async function runFlipPublicGames() {
    const now = Date.now();
    const snap = await db
        .collection('games')
        .where('visibility', '==', 'community')
        .get();
    if (snap.empty)
        return;
    let flipped = 0;
    for (const doc of snap.docs) {
        const g = doc.data();
        if (g.publicOpenedAt)
            continue;
        if (typeof g.publicOpenAt !== 'number' || g.publicOpenAt > now)
            continue;
        try {
            const r = await flipPublicGameOnce(doc.id);
            if (r === 'flipped')
                flipped++;
        }
        catch (err) {
            console.error(`[flipPublicGames] flip failed for ${doc.id}`, err);
        }
    }
    if (flipped)
        console.log(`[flipPublicGames] flipped ${flipped}`);
}
// ─── Scheduled: stale-game cleanup ─────────────────────────────────────
/**
 * Hourly sweep that retires games whose kickoff was more than 6h ago
 * but never reached a terminal state. Two outcomes per stale game:
 *
 *   • Zombie (nobody ever joined: `players` and `guests` both empty)
 *     → delete the game doc + every `/rounds/{id}` it owns. Keeps the
 *       DB free of "ghost" entries the user never engaged with.
 *
 *   • Anything else (people registered, possibly played, just nobody
 *     pressed "סיים ערב")
 *     → flip status to 'finished' and lock=true. The doc keeps living
 *       so the History tab and any shared invite links continue to
 *       resolve cleanly.
 *
 * The CF and the client guards in gameLifecycle.ts are intentionally
 * redundant: clients hide stale games from the UI immediately, and the
 * CF makes the change durable in Firestore so writes from older
 * clients (or admins reaching the doc via direct nav) can't resurrect.
 */
// ── Promotion-offer expiry ─────────────────────────────────────────────
// When a player spot opens it's OFFERED to the head of the waitlist
// (`pendingPromotion = { uid, offeredAt }`) and reserved until they confirm.
// With no expiry, an unresponsive offered user holds the spot FOREVER — so
// everyone else who joins lands on the waitlist and the roster is stuck (user
// report). This sweep advances any offer older than the TTL to the next in
// line, mirroring the client `adminAdvanceOffer`: the unresponsive uid is moved
// to the BACK of the waitlist (keeps their place, drops priority) and the new
// head is offered (or the offer is cleared when no one's left / the game is
// full). The existing onGameRosterChanged trigger sends the spotOffered push on
// the uid change, so we don't dispatch it here.
const PROMO_OFFER_TTL_MS = 20 * 60 * 1000; // 20 minutes to respond to an offer
async function runExpireStaleOffers() {
    const cutoff = Date.now() - PROMO_OFFER_TTL_MS;
    // Single-field range filter (auto-indexed); games with no offer lack this
    // field and games with a fresh offer have offeredAt >= cutoff, so only stale
    // offers match. Status is re-checked per game below.
    const snap = await db
        .collection('games')
        .where('pendingPromotion.offeredAt', '<', cutoff)
        .limit(50)
        .get();
    if (snap.empty) {
        console.log('[expireStaleOffers] none');
        return;
    }
    let advanced = 0;
    for (const gameDoc of snap.docs) {
        if (gameDoc.data().status !== 'open')
            continue;
        try {
            await db.runTransaction(async (tx) => {
                const fresh = await tx.get(gameDoc.ref);
                if (!fresh.exists)
                    return;
                const d = fresh.data();
                if (d.status !== 'open')
                    return;
                const offer = d.pendingPromotion;
                // Re-check inside the txn — the offer may have been accepted/advanced
                // (or refreshed) since the query read.
                if (!offer?.uid ||
                    typeof offer.offeredAt !== 'number' ||
                    offer.offeredAt >= cutoff) {
                    return;
                }
                const offeredUid = offer.uid;
                // Move the unresponsive uid to the BACK of the waitlist.
                const waitlist = (d.waitlist ?? []).filter((id) => id !== offeredUid);
                waitlist.push(offeredUid);
                const players = d.players ?? [];
                const pending = d.pending ?? [];
                const activeGuests = (d.guests ?? []).filter((g) => !g?.waitlisted).length;
                let nextOffer = null;
                if (waitlist.length > 0 &&
                    waitlist[0] !== offeredUid &&
                    players.length + activeGuests < (d.maxPlayers ?? 15)) {
                    nextOffer = { uid: waitlist[0], offeredAt: Date.now() };
                }
                // Keep the denormalised participant union consistent — the offered uid
                // may not have been in the waitlist before (it's now appended).
                const participantIds = Array.from(new Set([...players, ...waitlist, ...pending]));
                tx.update(gameDoc.ref, {
                    waitlist,
                    participantIds,
                    pendingPromotion: nextOffer,
                    updatedAt: Date.now(),
                });
            });
            advanced += 1;
        }
        catch (err) {
            console.error('[expireStaleOffers] failed', gameDoc.id, err);
        }
    }
    console.log(`[expireStaleOffers] advanced ${advanced} stale offer(s)`);
}
async function runCleanupStaleGames() {
    // 3h past kickoff with no start → stale (owner request: a game whose time
    // long passed and never started should be cleared).
    const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
    const cutoff = Date.now() - STALE_AFTER_MS;
    // We only care about games that haven't reached a terminal state.
    // 'in' supports up to 30 values so three buckets fit fine.
    // Bounded so a post-outage backlog can't fan out hundreds of concurrent
    // batch commits + per-game rounds sub-queries in one invocation (timeout
    // risk). Oldest-first so the most overdue games drain first; the hourly
    // cron catches the rest over subsequent ticks.
    const snap = await db
        .collection('games')
        .where('status', 'in', ['open', 'locked', 'active'])
        .where('startsAt', '<', cutoff)
        .orderBy('startsAt', 'asc')
        .limit(200)
        .get();
    if (snap.empty) {
        console.log('[cleanupStaleGames] no stale games');
        return;
    }
    let deleted = 0;
    let finished = 0;
    const ops = [];
    for (const gameDoc of snap.docs) {
        const g = gameDoc.data();
        const playerCount = (g.players ?? []).length;
        const guestCount = (g.guests ?? []).length;
        const isZombie = playerCount === 0 && guestCount === 0;
        // "Did this game actually get played?" Single source of truth:
        // `liveMatch.startedAt` is stamped the first time the admin
        // taps the timer's play button (after the teams-full gate). As
        // a safety net for games written before that field existed, we
        // also accept any phase value that implies the round actually
        // ran. Without either signal the game was created and forgotten
        // — it shouldn't count toward stats, trust, or history.
        // Only HARD-DELETE a truly-empty (zombie) game. A game with a real roster
        // must NOT be deleted just because the in-app live timer was never tapped —
        // many groups organize in the app but play offline, and deleting their
        // game silently wiped the roster + history. Populated games fall through to
        // the `else` branch and are FINISHED (archived). Whether the evening was
        // actually played is no longer a DELETION signal — it gates the stats
        // credit instead (see the games-played tally in onGameRosterChanged).
        const shouldDelete = isZombie;
        if (shouldDelete) {
            // Nuke the game and any /rounds it owns. We use a chunked delete
            // because a single batch caps at 500 ops — round counts here are
            // tiny (≤ ~10), but the pattern is safe regardless.
            ops.push((async () => {
                const rounds = await db
                    .collection('rounds')
                    .where('gameId', '==', gameDoc.id)
                    .get();
                const batch = db.batch();
                rounds.docs.forEach((r) => batch.delete(r.ref));
                batch.delete(gameDoc.ref);
                await batch.commit();
                deleted++;
            })());
        }
        else {
            ops.push(gameDoc.ref.update({ status: 'finished', locked: true }).then(() => {
                finished++;
            }));
        }
    }
    // allSettled (not all): one failing delete/finish must not abandon the rest
    // of the sweep for this tick.
    const results = await Promise.allSettled(ops);
    const failed = results.filter((r) => r.status === 'rejected').length;
    console.log(`[cleanupStaleGames] swept ${snap.size} stale games — deleted ${deleted} zombies, finished ${finished}, failed ${failed}`);
}
// ─── Scheduled: prune accumulating server-side state ───────────────────
/**
 * Daily housekeeping. Three independent sweeps in one CF so we pay
 * for one cron tick instead of three. Each sweep wraps its own
 * try/catch so a failure in one doesn't block the others.
 *
 * 1. /notifications older than 30 days → delete. The dispatch was
 *    already delivered (the CF marks `delivered=true` immediately);
 *    keeping the doc forever just bloats the collection. 30 days is
 *    enough for any debugging / audit needs.
 *
 * 2. /gameUpdateLatches whose target game is finished/cancelled or
 *    no longer exists → delete. The latch was used to dedup pushes
 *    within a 60-second window; once the game is terminal it's
 *    irrelevant.
 *
 * 3. /groupJoinRequests resolved (approved/rejected) more than 90
 *    days ago → delete. Audit trail beyond 90 days adds zero value
 *    and accumulates linearly with community activity.
 *
 * Batching: each sweep deletes in chunks of 400 (Firestore's per-
 * batch cap is 500). We don't paginate within a single CF run;
 * if a sweep produces >400 docs the leftovers wait for the next
 * day's run. That keeps the function bounded.
 */
async function runDailyCleanup() {
    const BATCH_LIMIT = 400;
    const NOTIFICATIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const JOIN_REQUESTS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    // 1) Old /notifications.
    let notifsDeleted = 0;
    try {
        const cutoff = now - NOTIFICATIONS_TTL_MS;
        const snap = await db
            .collection('notifications')
            .where('createdAt', '<', cutoff)
            .limit(BATCH_LIMIT)
            .get();
        if (!snap.empty) {
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            notifsDeleted = snap.size;
        }
    }
    catch (err) {
        console.error('[dailyCleanup] notifications sweep failed', err);
    }
    // 2) Stale /gameUpdateLatches. We can't query "where target game
    // is terminal" directly (no cross-collection joins), so we read
    // the latch's gameId and check the game doc one-by-one. Cheap
    // because the latch collection is small (one per active game).
    let latchesDeleted = 0;
    try {
        const snap = await db
            .collection('gameUpdateLatches')
            .limit(BATCH_LIMIT)
            .get();
        const candidates = [];
        for (const latch of snap.docs) {
            const gameId = String(latch.data()?.gameId ?? latch.id);
            try {
                const gameSnap = await db.collection('games').doc(gameId).get();
                const status = gameSnap.exists
                    ? gameSnap.data()?.status
                    : undefined;
                if (!gameSnap.exists ||
                    status === 'finished' ||
                    status === 'cancelled') {
                    candidates.push(latch.id);
                }
            }
            catch (err) {
                console.warn('[dailyCleanup] latch game lookup failed', latch.id, err);
            }
        }
        if (candidates.length > 0) {
            const batch = db.batch();
            candidates.forEach((id) => batch.delete(db.collection('gameUpdateLatches').doc(id)));
            await batch.commit();
            latchesDeleted = candidates.length;
        }
    }
    catch (err) {
        console.error('[dailyCleanup] latches sweep failed', err);
    }
    // 3) Old /groupJoinRequests (approved or rejected, decidedAt
    // older than 90 days). Pending requests are NEVER deleted —
    // that's an active state.
    let requestsDeleted = 0;
    try {
        const cutoff = now - JOIN_REQUESTS_TTL_MS;
        const snap = await db
            .collection('groupJoinRequests')
            .where('decidedAt', '<', cutoff)
            .limit(BATCH_LIMIT)
            .get();
        if (!snap.empty) {
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            requestsDeleted = snap.size;
        }
    }
    catch (err) {
        console.error('[dailyCleanup] joinRequests sweep failed', err);
    }
    // 4) Orphaned /games/{gameId}/fillerInterests/{uid} docs. A filler
    // candidate's interest is meaningful only while the game is still
    // recruiting. Once the parent game is `finished` or `cancelled`,
    // the subcollection just bloats Firestore and surfaces in admin
    // queries that target active recruitment screens. We can't issue
    // a direct collectionGroup query that joins against the parent
    // game status, so we iterate terminal games and clear their
    // subcollections one by one. Same BATCH_LIMIT cap as the other
    // sweeps; leftovers carry over to the next day.
    let fillerInterestsDeleted = 0;
    try {
        // Pull a bounded page of terminal games. The query is split into
        // two single-status reads so we can rely on the existing
        // composite index used elsewhere (status + startsAt) instead of
        // adding a new "status in" index just for cleanup.
        const terminalStatuses = ['finished', 'cancelled'];
        const terminalGameIds = [];
        for (const status of terminalStatuses) {
            if (terminalGameIds.length >= BATCH_LIMIT)
                break;
            const remaining = BATCH_LIMIT - terminalGameIds.length;
            const gamesSnap = await db
                .collection('games')
                .where('status', '==', status)
                .limit(remaining)
                .get();
            for (const g of gamesSnap.docs)
                terminalGameIds.push(g.id);
        }
        for (const gameId of terminalGameIds) {
            try {
                const interests = await db
                    .collection('games')
                    .doc(gameId)
                    .collection('fillerInterests')
                    .limit(BATCH_LIMIT)
                    .get();
                if (interests.empty)
                    continue;
                const batch = db.batch();
                interests.docs.forEach((d) => batch.delete(d.ref));
                await batch.commit();
                fillerInterestsDeleted += interests.size;
            }
            catch (err) {
                console.warn('[dailyCleanup] fillerInterests sweep failed for', gameId, err);
            }
        }
    }
    catch (err) {
        console.error('[dailyCleanup] fillerInterests outer sweep failed', err);
    }
    console.log(`[dailyCleanup] notifications=${notifsDeleted}, latches=${latchesDeleted}, joinRequests=${requestsDeleted}, fillerInterests=${fillerInterestsDeleted}`);
}
// ─── Scheduled: post-game "rate teammates" reminder ────────────────────
/**
 * Wake players up to rate their teammates after the evening ends.
 *
 * Window: a game is eligible once `startsAt` is between 60-180 minutes
 * in the past AND it has at least one player. The wide window covers
 * scheduler skew (we run every 30m) and games whose admin pressed
 * "סיים ערב" late. The `rateReminderSent` flag latches the reminder so
 * a second run inside that window doesn't double-fire.
 *
 * We don't gate on `status === 'finished'` because a perfectly normal
 * game might still be `'active'` 90 minutes after kickoff (admin
 * forgot to press end). The cleanup CF will eventually flip it; in the
 * meantime players still want a reminder while the night is fresh.
 *
 * Status guard: skip 'cancelled' explicitly — there are no teammates
 * to rate. 'open' / 'locked' games where kickoff was 60+ min ago and
 * nothing happened mean a no-show; the cleanup CF deletes those as
 * zombies anyway, so we'd never fire on them in practice — the guard
 * is belt-and-suspenders.
 */
async function runSendRateReminders() {
    // DISABLED (product decision 2026-06-14): ratings are GLOBAL and PER-PAIR
    // (one vote per rater→ratee, anywhere — see ratingsService), NOT per-game.
    // A recurring "rate your teammates" reminder is therefore noise for a
    // regular group — everyone's already rated after a game or two, and
    // re-rating just overwrites the same vote. Players can still rate anyone
    // anytime from the player card. Revisit with a "smart" version that only
    // nudges players who still have UN-RATED teammates from a given game.
    console.log('[sendRateReminders] disabled — no-op');
    return;
}
// ─── Realtime trigger: community join request → admin push ─────────────
/**
 * Watches community docs for additions to `pendingPlayerIds` and fans
 * out a `joinRequest` push to every admin server-side.
 *
 * Why this lives on the server: the user submitting the request goes
 * through the public-projection path (groupsPublic) — they can't read
 * the private `/groups/{id}` doc, so `group.adminIds` comes back empty
 * client-side and the existing client-side dispatch in
 * `groupStore.requestJoinById` silently no-ops. The CF reads the
 * private doc with admin credentials and dispatches per admin.
 *
 * Idempotency: we only fire when the array actually grew on this
 * write. Edits to the same doc that don't change pendingPlayerIds
 * (rename, settings, etc.) are no-ops here. We never persist a "sent"
 * flag because each request is its own event — sending twice means
 * the user genuinely re-requested.
 */
exports.onGroupPendingChanged = (0, firestore_1.onDocumentWritten)('groups/{groupId}', async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    // Group deletion: canonical /groups doc is gone. Clean up the
    // public mirror in case the client-side delete swallowed an
    // error (network drop, transient quota). Without this, the
    // discovery feed would surface a "ghost" community whose
    // canonical no longer exists.
    if (!after && before) {
        const groupId = event.params.groupId;
        try {
            await db.collection('groupsPublic').doc(groupId).delete();
        }
        catch (err) {
            console.warn('[onGroupDeleted] groupsPublic cleanup failed', groupId, err);
        }
        return;
    }
    if (!after)
        return;
    // Sync the denormalised /groupsPublic.memberCount whenever
    // playerIds changes. Client-side join paths can't write to the
    // public doc (rule requires admin), so the feed's count would
    // otherwise drift every time someone direct-joins an open
    // community. Best-effort — failure logs but doesn't throw.
    const beforePlayers = before
        ?.playerIds;
    const afterPlayers = after
        ?.playerIds;
    const playerCountChanged = Array.isArray(afterPlayers) &&
        (afterPlayers.length !== (beforePlayers?.length ?? 0) ||
            JSON.stringify(beforePlayers ?? []) !==
                JSON.stringify(afterPlayers));
    // Also bump teamsJoined for newcomers — the client's hardened
    // /users rules block this cross-user write. Server-side keeps
    // counters honest regardless of which path admitted the user
    // (admin approve vs open-group direct-join vs cancel-promote).
    //
    // While we're at it, default the new member into the community's
    // new-game push subscription (`newGameSubscriptions` array-contains
    // groupId). The bell on `CommunityDetailsScreen` flips this same
    // value, so a member can opt out at any time — but the default
    // is ON because brand-new joiners typically WANT to hear about
    // the next game; an opt-in default left most pushes silenced.
    // `arrayUnion` is a no-op when the groupId is already present,
    // so the rare "join → opt-out → leave → rejoin" flow doesn't
    // re-enable behind the user's back ON THE SAME WRITE — but a
    // genuine fresh rejoin (groupId absent from the array) does
    // restore the default, which matches the "treat rejoin like a
    // fresh join" semantics elsewhere.
    if (Array.isArray(afterPlayers)) {
        const prevSet = new Set(beforePlayers ?? []);
        const newJoiners = afterPlayers.filter((uid) => !prevSet.has(uid));
        const groupId = event.params.groupId;
        for (const uid of newJoiners) {
            // Subscription default — idempotent (arrayUnion), and we WANT it to
            // re-run on a genuine rejoin, so it stays outside the credit latch.
            try {
                await db.collection('users').doc(uid).set({
                    newGameSubscriptions: admin.firestore.FieldValue.arrayUnion(groupId),
                    updatedAt: Date.now(),
                }, { merge: true });
            }
            catch (err) {
                console.warn('[onGroupPendingChanged] subscription default failed', uid, err);
            }
            // teamsJoined — gated by a per-(group,uid) marker so at-least-once
            // redelivery can't double-count (and a rejoin of the SAME community
            // won't re-credit; teamsJoined counts distinct communities).
            try {
                const b = db.batch();
                b.create(db
                    .collection('groups')
                    .doc(groupId)
                    .collection('memberCredited')
                    .doc(uid), { at: Date.now() });
                b.set(db.collection('users').doc(uid), {
                    achievements: {
                        teamsJoined: admin.firestore.FieldValue.increment(1),
                    },
                    updatedAt: Date.now(),
                }, { merge: true });
                await b.commit();
            }
            catch (err) {
                const code = err.code;
                if (code === 6 || code === 'already-exists')
                    continue;
                console.warn('[onGroupPendingChanged] teamsJoined bump failed', uid, err);
            }
        }
    }
    // Prune ball/jersey equipment holders who are no longer members — a
    // holder who leaves (or is removed) would otherwise keep a dangling
    // "מי מביא את הכדור" badge forever. The leaving client can't touch these
    // admin-only fields (rules), so it has to happen here (Admin SDK). The
    // update only fires when there's actually something to remove, so the
    // re-trigger it causes finds nothing to prune and terminates.
    if (Array.isArray(afterPlayers)) {
        const memberSet = new Set(afterPlayers);
        const ball = after.ballHolderIds ?? [];
        const jerseys = after.jerseysHolderIds ?? [];
        const ballGone = ball.filter((u) => !memberSet.has(u));
        const jerseysGone = jerseys.filter((u) => !memberSet.has(u));
        // Also prune adminRatings for departed members — otherwise a stale
        // admin-assigned rating lingers and silently re-applies (and feeds
        // rating-based auto-teams) if the person ever re-joins the community.
        const adminRatings = after.adminRatings ?? {};
        const ratingsGone = Object.keys(adminRatings).filter((u) => !memberSet.has(u));
        if (ballGone.length || jerseysGone.length || ratingsGone.length) {
            try {
                await db
                    .collection('groups')
                    .doc(event.params.groupId)
                    .update({
                    ...(ballGone.length
                        ? {
                            ballHolderIds: admin.firestore.FieldValue.arrayRemove(...ballGone),
                        }
                        : {}),
                    ...(jerseysGone.length
                        ? {
                            jerseysHolderIds: admin.firestore.FieldValue.arrayRemove(...jerseysGone),
                        }
                        : {}),
                    ...Object.fromEntries(ratingsGone.map((u) => [
                        `adminRatings.${u}`,
                        admin.firestore.FieldValue.delete(),
                    ])),
                    updatedAt: Date.now(),
                });
            }
            catch (err) {
                console.warn('[onGroupPendingChanged] equipment/rating holder prune failed', event.params.groupId, err);
            }
        }
    }
    if (playerCountChanged) {
        try {
            await db
                .collection('groupsPublic')
                .doc(event.params.groupId)
                .set({
                memberCount: afterPlayers.length,
                updatedAt: Date.now(),
            }, { merge: true });
        }
        catch (err) {
            console.warn('[onGroupWritten] groupsPublic memberCount sync failed', event.params.groupId, err);
        }
        // Growth milestone push: when memberCount crosses a threshold
        // we haven't already announced. Wired here (instead of in the
        // `newJoiners` loop above) so it fires once per write — and
        // the persistence on `notifiedMilestones[]` makes retries /
        // membership churn idempotent.
        try {
            await dispatchGrowthMilestoneIfNeeded(event.params.groupId, afterPlayers.length, after.adminIds ?? [], after.name || '');
        }
        catch (err) {
            console.warn('[onGroupPendingChanged] milestone dispatch failed', event.params.groupId, err);
        }
    }
    const beforeIds = new Set(before?.pendingPlayerIds ?? []);
    const afterIds = after.pendingPlayerIds ?? [];
    const newcomers = afterIds.filter((id) => !beforeIds.has(id));
    if (newcomers.length === 0)
        return;
    const admins = after.adminIds ?? [];
    if (admins.length === 0)
        return;
    const groupId = event.params.groupId;
    const groupName = after.name || 'המועדון';
    // Use allSettled so a single quota / network failure on one push
    // doesn't drop the rest. Previously Promise.all rejected on the
    // first failure — leaving the requester in pendingPlayerIds with
    // NO admin notified, an effectively-silent loss of the join
    // request. Per-failure warnings are logged for monitoring.
    const ops = [];
    for (const requesterId of newcomers) {
        for (const adminId of admins) {
            ops.push(createNotificationOnce({
                type: 'joinRequest',
                recipientId: adminId,
                payload: {
                    groupId,
                    groupName,
                    requesterId,
                },
            }));
        }
    }
    const results = await Promise.allSettled(ops);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
        console.warn(`[onGroupPendingChanged] ${failed}/${results.length} joinRequest dispatch(es) failed for group ${groupId}`);
        for (const r of results) {
            if (r.status === 'rejected') {
                console.warn('[onGroupPendingChanged] reason:', r.reason);
            }
        }
    }
    const ok = results.length - failed;
    console.log(`[onGroupPendingChanged] dispatched ${ok}/${results.length} joinRequest push(es) for group ${groupId}`);
});
// ─── Realtime trigger: live-timer sync to home widgets / watch tiles ───
/**
 * When the shared match clock changes (start / pause / resume / reset),
 * fan out a SILENT, data-only FCM to every registered player so their
 * home-screen widget + paired-watch tile refresh — even when their app is
 * killed. (The in-app onSnapshot listener that normally pushes the payload
 * to the widget only runs while the JS process is alive, so a player who
 * isn't actively in the app saw a stale clock — the exact bug reported.)
 *
 * The native `TeamderMessagingService` receives this `type: 'timerSync'`
 * message and updates the widget/tile directly in Kotlin (no JS, no
 * Firestore read needed). Android-only: the home widget + Wear tile are
 * Android surfaces, so we skip iOS recipients to avoid pointless wakeups.
 */
exports.onGameTimerChanged = (0, firestore_1.onDocumentWritten)('games/{id}', async (event) => {
    const after = event.data?.after?.data();
    if (!after)
        return;
    const before = event.data?.before?.data();
    const a = after.liveMatch ?? {};
    const b = before?.liveMatch ?? {};
    // Only fire when a timer primitive actually changed — not on every
    // roster write.
    const changed = (a.timerRunning ?? null) !== (b.timerRunning ?? null) ||
        (a.timerLastStartedAt ?? null) !== (b.timerLastStartedAt ?? null) ||
        (a.timerAccumulatedMs ?? null) !== (b.timerAccumulatedMs ?? null);
    if (!changed)
        return;
    const recipients = Array.isArray(after.participantIds)
        ? after.participantIds
        : Array.isArray(after.players)
            ? after.players
            : [];
    if (recipients.length === 0)
        return;
    const users = await loadUsers(recipients);
    const tokens = new Set();
    for (const u of users) {
        // Skip iOS — no Android-style home widget / Wear tile there.
        if (u.platform === 'ios')
            continue;
        (u.fcmTokens || []).forEach((t) => {
            if (typeof t === 'string' && t.length > 0)
                tokens.add(t);
        });
    }
    if (tokens.size === 0)
        return;
    const data = {
        type: 'timerSync',
        gameId: event.params.id,
        timerRunning: String(!!a.timerRunning),
        timerLastStartedAt: String(a.timerLastStartedAt ?? 0),
        timerAccumulatedMs: String(a.timerAccumulatedMs ?? 0),
        timerControlledBy: String(a.timerControlledBy ?? ''),
        timerControlledByName: String(a.timerControlledByName ?? ''),
        // NOT `title`/`message`/`body`: those keys make expo-notifications
        // render a visible notification on clients that DON'T have the native
        // TeamderMessagingService yet (pre-1.0.21). `gameTitle` is inert there
        // — the message stays silent — and the native service reads this key.
        gameTitle: String(after.title ?? ''),
    };
    const all = Array.from(tokens);
    let ok = 0;
    for (let i = 0; i < all.length; i += 500) {
        const chunk = all.slice(i, i + 500);
        try {
            // Data-only (no `notification` block) → silent: wakes the native
            // service to refresh the widget, never shows a push.
            const res = await messaging.sendEachForMulticast({
                tokens: chunk,
                data,
                android: { priority: 'high' },
                apns: {
                    headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
                    payload: { aps: { 'content-available': 1 } },
                },
            });
            ok += res.successCount;
        }
        catch (err) {
            console.warn('[onGameTimerChanged] send failed', err);
        }
    }
    console.log(`[onGameTimerChanged] timerSync → ${ok}/${tokens.size} token(s) for game ${event.params.id}`);
});
// ─── Realtime trigger: per-player wins from the live rotation ──────────
/**
 * When a "winner-stays" round ends, the client stamps the winning team's
 * registered players onto `rotation.lastRoundWinners` + a monotonic
 * `rotation.lastRoundAt`. Here we credit each of them a lifetime win
 * (`users/{uid}.stats.wins += 1`). Server-side because a client can't write
 * other users' docs. Idempotent: only fires when `lastRoundAt` advances.
 */
exports.onGameRotationChanged = (0, firestore_1.onDocumentWritten)('games/{id}', async (event) => {
    const after = event.data?.after?.data();
    if (!after?.rotation)
        return;
    const before = event.data?.before?.data();
    // Latch on the MONOTONIC round counter, not the wall-clock lastRoundAt: a
    // client clock that regresses (NTP/DST) or two rounds in the same ms would
    // make lastRoundAt non-increasing and silently DROP a round's win/pair
    // credit. `round` strictly increases by 1 per finalize. Fall back to
    // lastRoundAt only for legacy docs that predate the round counter.
    const ar = after.rotation.round;
    const br = before?.rotation?.round;
    if (typeof ar === 'number' && typeof br === 'number') {
        if (ar <= br)
            return; // no NEW round result
    }
    else {
        const a = after.rotation.lastRoundAt ?? 0;
        const b = before?.rotation?.lastRoundAt ?? 0;
        if (a <= b)
            return;
    }
    const reg = (arr) => (arr ?? []).filter((u) => typeof u === 'string' &&
        u.length > 0 &&
        !u.startsWith('guest:') &&
        // Defence-in-depth: a raw legacy guest id (genGuestId →
        // "<base36ts>-<rand>", all lowercase) must not get a phantom /users
        // doc. Match that EXACT shape rather than "any hyphen", so a real
        // Firebase uid (mixed-case, no hyphen — incl. email accounts) is
        // never excluded.
        !/^[0-9a-z]+-[0-9a-z]+$/.test(u));
    const winners = reg(after.rotation.lastRoundWinners);
    const losers = reg(after.rotation.lastRoundLosers);
    if (winners.length === 0 && losers.length === 0)
        return;
    const inc = admin.firestore.FieldValue.increment(1);
    const batch = db.batch();
    // 1) Lifetime per-player wins are NO LONGER written here — they're written
    //    by commitRoundStats in the same latched batch as the community/game
    //    win tallies, so the three win counters can't diverge. This trigger now
    //    only maintains the same-team pair stats below.
    // 2) Pairwise "played together on the same team" + together W/L. One doc
    //    per unordered pair at pairStats/{a__b} (sorted), so a player card can
    //    read a single doc for "you & X".
    const pairKey = (x, y) => [x, y].sort().join('__');
    const addPairs = (team, field) => {
        for (let i = 0; i < team.length; i++) {
            for (let j = i + 1; j < team.length; j++) {
                batch.set(db.collection('pairStats').doc(pairKey(team[i], team[j])), {
                    a: [team[i], team[j]].sort()[0],
                    b: [team[i], team[j]].sort()[1],
                    sameTeam: inc,
                    [field]: inc,
                }, { merge: true });
            }
        }
    };
    addPairs(winners, 'winsTogether');
    addPairs(losers, 'lossesTogether');
    // Idempotency latch: the round-counter check above only dedupes NEW vs OLD
    // state within a single delivery. Cloud Functions is at-least-once, so a
    // redelivered identical event passes that check again and would DOUBLE the
    // pair increments. A per-round marker created IN THE SAME BATCH makes the
    // whole commit fail (ALREADY_EXISTS) on any redelivery, so pairStats are
    // written exactly once per round — mirrors commitRoundStats/committedRounds.
    // The key MUST include the round timestamp, not just the round NUMBER: after
    // an "אפס רוטציה" reset the round counter restarts at 1, so a number-only
    // key (r1, r2…) would collide with the previous run and silently drop the
    // restarted rounds' pair stats. lastRoundAt is monotonic per finalize, so
    // `${round}_${lastRoundAt}` is unique across resets (matches committedRounds'
    // `${round}:${updatedAt}` shape).
    const roundKey = typeof ar === 'number'
        ? `r${ar}_${after.rotation.lastRoundAt ?? 0}`
        : `t${after.rotation.lastRoundAt ?? 0}`;
    batch.create(db
        .collection('games')
        .doc(event.params.id)
        .collection('pairRounds')
        .doc(roundKey), { at: Date.now() });
    try {
        await batch.commit();
        console.log(`[onGameRotationChanged] game ${event.params.id}: +win×${winners.length}, pairs W${winners.length}/L${losers.length}`);
    }
    catch (err) {
        const code = err.code;
        if (code === 6 || code === 'already-exists') {
            console.log(`[onGameRotationChanged] round ${roundKey} already counted — skip (redelivery)`);
        }
        else {
            console.warn('[onGameRotationChanged] increment failed', err);
        }
    }
});
// ─── Realtime trigger: "almost full" FOMO push ─────────────────────────
/**
 * Fan-out a "last spots" push when a game's roster crosses the 90%
 * capacity threshold. Triggers on every write to a game doc, but the
 * `capacityNoticeSent` latch on the doc itself ensures we only fire
 * once per game even if the threshold is briefly bounced (player
 * cancels, then someone new joins).
 *
 * Ignored when:
 *   • the game has no roster cap (`maxPlayers <= 0`)
 *   • the game's status is anything but 'open' (locked/active/etc are
 *     past the registration window — too late for a "join now" push)
 *   • capacity was already at/over 90% on the *previous* version of
 *     the doc — we only want to fire on the actual crossing event,
 *     not on every subsequent edit while it's full
 *   • the latch is already set
 *
 * Recipient resolution and de-duplication happen downstream in
 * `onNotificationCreated → resolveRecipients` (see `gameFillingUp`
 * branch there).
 */
exports.onGameRosterChanged = (0, firestore_1.onDocumentWritten)('games/{gameId}', async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after)
        return; // doc deleted
    const ref = event.data.after.ref;
    // ── Waitlist-offer push (server-side, reliable) ───────────────────────
    // Model: a freed player seat is OFFERED to the head of the waitlist — the
    // game doc gets `pendingPromotion = { uid, offeredAt }`, the offered user
    // gets a push, and they CONFIRM to take the seat (gameService handles the
    // accept). We send that push HERE rather than from the client that freed
    // the seat, because a cross-user notification write is fragile: the
    // notifications read-rule denies the dispatcher's existence-check on any
    // repeat offer, so the client write silently no-ops and no push arrives
    // (the reported "I was waiting, someone cancelled, and I got nothing").
    //
    // This fires for EVERY source of an offer (self-cancel, admin-remove,
    // pass→re-offer-to-next) and only ever to the ONE newly-offered uid.
    // Gated on the uid CHANGING so an unrelated game write doesn't re-push.
    const beforeOfferUid = before?.pendingPromotion?.uid;
    const afterOfferUid = after.pendingPromotion?.uid;
    if (afterOfferUid && afterOfferUid !== beforeOfferUid) {
        try {
            await createNotificationOnce({
                type: 'spotOffered',
                recipientId: afterOfferUid,
                payload: {
                    gameId: event.params.gameId,
                    title: after.title ?? '',
                    startsAt: after.startsAt,
                },
            });
        }
        catch (err) {
            console.error('[onGameRosterChanged] spotOffered push failed', event.params.gameId, err);
        }
    }
    // ── Count a full GAME per participant when the game FINISHES ───────────
    // Drives the community table's cumulative "games played" column. The
    // before→after status transition to 'finished' fires exactly once, so
    // this can't double-count. Uses the registered roster (players[]).
    // Gated on "was actually played" (timer started / a round ran) so a game
    // that the stale-cleanup FINISHES without ever being played in-app doesn't
    // credit everyone a phantom game — same signal the cleanup uses.
    const afterLm = after.liveMatch;
    const afterPhase = afterLm?.phase;
    const finishWasPlayed = typeof afterLm?.startedAt === 'number' ||
        afterPhase === 'roundRunning' ||
        afterPhase === 'roundEnded' ||
        afterPhase === 'live';
    if (before?.status !== 'finished' &&
        after.status === 'finished' &&
        finishWasPlayed &&
        after.groupId &&
        Array.isArray(after.players) &&
        after.players.length > 0) {
        try {
            const gid = after.groupId;
            const batch = db.batch();
            for (const uid of after.players) {
                batch.set(db.collection('communityPlayerStats').doc(`${gid}__${uid}`), {
                    groupId: gid,
                    userId: uid,
                    games: admin.firestore.FieldValue.increment(1),
                    updatedAt: Date.now(),
                }, { merge: true });
            }
            // Redelivery latch: at-least-once means this finish event can be
            // delivered twice (same before→after), double-crediting everyone.
            // A marker created IN THE SAME BATCH makes the second commit fail
            // (ALREADY_EXISTS) → credited exactly once per game.
            batch.create(db
                .collection('games')
                .doc(event.params.gameId)
                .collection('finishCredited')
                .doc('once'), { at: Date.now() });
            await batch.commit();
        }
        catch (err) {
            const code = err.code;
            if (code === 6 || code === 'already-exists') {
                console.log('[onGameRosterChanged] games already credited — skip (redelivery)', event.params.gameId);
            }
            else
                console.error('[onGameRosterChanged] games tally failed', event.params.gameId, err);
        }
    }
    // Precise push scheduling — (re)enqueue one-shot Cloud Tasks for this
    // game's future registration-open / public-open moments. Idempotent +
    // change-gated; the every-5-min cron remains the safety net. Cancel/
    // reschedule are handled by the tasks' own fire-but-verify guards, so
    // there is nothing to delete here.
    await enqueueGameMoments(event.params.gameId, before, after);
    // ── Game join-request → notify the organizer (+ community admins).
    // A user requesting to join an approval-required game lands in
    // `pending[]`. The requester can't write a notification for the
    // admin (hardened /notifications rules), so — exactly like the
    // community flow in `onGroupPendingChanged` — we fan out the
    // `joinRequest` push server-side. Without this the admin never
    // learns someone is waiting, and the approval feature is a dead end.
    {
        const beforePending = new Set(Array.isArray(before?.pending) ? before.pending : []);
        const afterPending = Array.isArray(after.pending) ? after.pending : [];
        const newRequesters = afterPending.filter((id) => !beforePending.has(id));
        if (newRequesters.length > 0) {
            // Recipients: the game creator plus any admins of the parent
            // community — both can approve from MatchDetails.
            const recipients = new Set();
            if (typeof after.createdBy === 'string' && after.createdBy) {
                recipients.add(after.createdBy);
            }
            if (typeof after.groupId === 'string' && after.groupId) {
                try {
                    const gSnap = await db.collection('groups').doc(after.groupId).get();
                    const gAdmins = gSnap.data()?.adminIds ?? [];
                    for (const a of gAdmins)
                        recipients.add(a);
                }
                catch (err) {
                    console.warn('[onGameRosterChanged] group admins read failed', after.groupId, err);
                }
            }
            const gameTitle = after.title || 'המשחק';
            const ops = [];
            for (const requesterId of newRequesters) {
                for (const adminId of recipients) {
                    if (adminId === requesterId)
                        continue; // never ping the requester
                    ops.push(createNotificationOnce({
                        type: 'joinRequest',
                        recipientId: adminId,
                        // Dedupe per (admin, game) so a game request never
                        // collides with a community joinRequest for the same
                        // group, and re-requests to different games stay
                        // distinct.
                        entityType: 'game',
                        entityId: event.params.gameId,
                        reason: 'game-join-request',
                        payload: {
                            gameId: event.params.gameId,
                            groupId: after.groupId,
                            // buildMessage interpolates `groupName`; pass the game
                            // title so the copy reads naturally for game requests.
                            groupName: gameTitle,
                            gameTitle,
                            requesterId,
                        },
                    }));
                }
            }
            const results = await Promise.allSettled(ops);
            const failed = results.filter((r) => r.status === 'rejected').length;
            if (failed > 0) {
                console.warn(`[onGameRosterChanged] ${failed}/${results.length} game joinRequest dispatch(es) failed for game ${event.params.gameId}`);
            }
        }
    }
    // ── Discipline cards on arrival changes. The admin's setArrival()
    // writes /games/{id}.arrivals[uid] = 'late' | 'no_show'. The
    // client used to ALSO write /users/{uid}.discipline directly,
    // but the hardened rules block that cross-user write. We mirror
    // the issue/revoke logic here with the Admin SDK so cards land
    // regardless of who triggered the arrival mark.
    //
    // Transitions handled:
    //   prev → 'late'     : yellow (≤60min) / red (>60min) card
    //   prev → 'no_show'  : red card with reason='no_show'
    //   'late'/'no_show' → other (admin un-marked) : revoke card
    const beforeArr = before?.arrivals ?? {};
    const afterArr = after.arrivals ?? {};
    const allArrUids = new Set([
        ...Object.keys(beforeArr),
        ...Object.keys(afterArr),
    ]);
    for (const uid of allArrUids) {
        const prev = beforeArr[uid] ?? 'unknown';
        const next = afterArr[uid] ?? 'unknown';
        if (prev === next)
            continue;
        try {
            if (next === 'late') {
                const startsAt = typeof after.startsAt === 'number' ? after.startsAt : Date.now();
                const minutesLate = (Date.now() - startsAt) / 60000;
                if (minutesLate > 5) {
                    const cardType = minutesLate > 60 ? 'red' : 'yellow';
                    await issueDisciplineCard(uid, {
                        type: cardType,
                        reason: 'late',
                        gameId: event.params.gameId,
                    });
                }
            }
            else if (next === 'no_show') {
                await issueDisciplineCard(uid, {
                    type: 'red',
                    reason: 'no_show',
                    gameId: event.params.gameId,
                });
            }
            else if ((prev === 'late' || prev === 'no_show') &&
                next !== 'late' &&
                next !== 'no_show') {
                // Admin un-marked — revoke any card we issued for this game.
                await revokeDisciplineCardsFor(uid, event.params.gameId);
            }
        }
        catch (err) {
            console.warn('[onGameRosterChanged] discipline write failed', uid, err);
        }
    }
    // ── Server-side achievement bumps for the joiners. The hardened
    // /users rules block cross-user writes from the client, so this
    // is the canonical place to keep gamesJoined in sync. Best-effort
    // — a failure here doesn't impact the join itself.
    if (after.status === 'open' && after.groupId) {
        const beforePlayersSet = new Set(before?.players ?? []);
        const freshJoiners = (after.players ?? []).filter((uid) => !beforePlayersSet.has(uid));
        for (const uid of freshJoiners) {
            try {
                // Per-(game,uid) marker in the same batch makes the increment
                // idempotent under at-least-once redelivery (and a cancel→rejoin of
                // the SAME game won't re-credit — gamesJoined counts distinct games).
                const b = db.batch();
                b.create(db
                    .collection('games')
                    .doc(event.params.gameId)
                    .collection('joinCredited')
                    .doc(uid), { at: Date.now() });
                b.set(db.collection('users').doc(uid), {
                    achievements: {
                        gamesJoined: admin.firestore.FieldValue.increment(1),
                    },
                    updatedAt: Date.now(),
                }, { merge: true });
                await b.commit();
            }
            catch (err) {
                const code = err.code;
                if (code === 6 || code === 'already-exists')
                    continue;
                console.warn('[onGameRosterChanged] gamesJoined bump failed', uid, err);
            }
        }
    }
    // ── Notify the community admins of new joiners IMMEDIATELY. We do this
    // BEFORE the gameFillingUp early-returns so it runs on every join,
    // regardless of capacity threshold or game status changes.
    //
    // Previously this buffered joiners for up to 1 minute and sent ONE
    // consolidated push — but that delayed even a single join by the full
    // window (Teamder lagged ~20s behind Pulse, user report). Instead we
    // send right away and lean on `createNotificationOnce`'s dedupe: the
    // first joiner in the 5-min bucket fires the push; any further joiners
    // (while the notice is still unread) AGGREGATE into it (count + names)
    // without a second push — so a join rush still collapses to one ping.
    if (after.status === 'open' && after.groupId) {
        const beforePlayers = new Set(before?.players ?? []);
        const newJoiners = (after.players ?? []).filter((uid) => !beforePlayers.has(uid));
        if (newJoiners.length > 0) {
            // Resolve display names (best-effort — push still fires without).
            let joinerNames = [];
            try {
                const snaps = await db.getAll(...newJoiners.map((uid) => db.collection('users').doc(uid)));
                joinerNames = snaps
                    .map((s) => {
                    if (!s.exists)
                        return '';
                    const d = s.data();
                    return (d.name || d.displayName || '').trim();
                })
                    .filter((n) => n.length > 0);
            }
            catch (err) {
                console.error('[onGameRosterChanged] joiner name lookup failed', err);
            }
            try {
                await createNotificationOnce({
                    type: 'gamePlayersJoined',
                    recipientId: after.groupId,
                    payload: {
                        gameId: event.params.gameId,
                        groupId: after.groupId,
                        gameTitle: after.title || 'המשחק',
                        startsAt: after.startsAt ?? null,
                        joinerIds: newJoiners.join(','),
                        joinerNames: joinerNames.join(','),
                        count: newJoiners.length,
                    },
                });
            }
            catch (err) {
                console.error('[onGameRosterChanged] gamePlayersJoined dispatch failed', event.params.gameId, err);
            }
        }
    }
    if (after.capacityNoticeSent)
        return;
    if (after.status !== 'open')
        return;
    const max = after.maxPlayers ?? 0;
    if (max <= 0)
        return;
    const beforeCount = (before?.players?.length ?? 0) + (before?.guests?.length ?? 0);
    const afterCount = (after.players?.length ?? 0) + (after.guests?.length ?? 0);
    const threshold = Math.ceil(max * 0.9);
    const crossed = beforeCount < threshold && afterCount >= threshold;
    if (!crossed)
        return;
    // Don't fire if the roster is already closed (full or over). At
    // 100% the message "last spots" is misleading; new joiners would
    // hit the waitlist instead.
    if (afterCount >= max)
        return;
    const remaining = max - afterCount;
    const gameId = event.params.gameId;
    // Latch via transaction so two concurrent triggers (e.g. two
    // players joining the same game in the same second) can't both
    // observe `capacityNoticeSent=false` and each write a duplicate
    // notification. The transaction reads the doc fresh and aborts if
    // the latch is already set; only the winner proceeds to dispatch.
    let claimed = false;
    try {
        await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists)
                return;
            const data = fresh.data();
            if (data.capacityNoticeSent)
                return; // someone else won
            tx.update(ref, { capacityNoticeSent: true });
            claimed = true;
        });
    }
    catch (err) {
        console.error('[onGameRosterChanged] latch transaction failed', err);
        return;
    }
    if (!claimed)
        return;
    await createNotificationOnce({
        type: 'gameFillingUp',
        recipientId: gameId,
        payload: {
            gameId,
            groupId: after.groupId || '',
            gameTitle: after.title || 'המשחק',
            startsAt: after.startsAt ?? null,
            remaining,
        },
    });
    console.log(`[onGameRosterChanged] dispatched gameFillingUp for ${gameId} (${afterCount}/${max}, ${remaining} left)`);
});
// ─── Rating: keep summary doc in sync with vote subcollection ──────────
/**
 * Vote subcollection trigger. Incremental update — we read the
 * before/after values from the event itself and apply a transactional
 * delta to the parent summary doc. No full scan of the votes
 * subcollection, so latency stays O(1) even when a community grows
 * to thousands of voters.
 */
exports.onVoteWritten = (0, firestore_1.onDocumentWritten)(
// GLOBAL ratings (was groups/{groupId}/ratings/...). One reputation
// per player across the whole app.
'ratings/{ratedUserId}/votes/{raterUserId}', async (event) => {
    const { ratedUserId } = event.params;
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
    await applyVoteDelta(db.collection('ratings').doc(ratedUserId), ratedUserId, countDelta, sumDelta);
});
// LEGACY per-group vote trigger. App versions already in the stores
// (≤1.0.11) still write votes to /groups/{gid}/ratings/{uid}/votes/{uid};
// this keeps their per-group summaries in sync so the rating action
// doesn't silently stop working during the global-ratings rollout.
// Remove once the global build is widely adopted.
exports.onVoteWrittenLegacy = (0, firestore_1.onDocumentWritten)('groups/{groupId}/ratings/{ratedUserId}/votes/{raterUserId}', async (event) => {
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
        sumDelta = newR - oldR;
    }
    else {
        return;
    }
    await applyVoteDelta(db
        .collection('groups')
        .doc(groupId)
        .collection('ratings')
        .doc(ratedUserId), ratedUserId, countDelta, sumDelta);
});
// Shared transactional count/sum/average updater for a rating summary doc.
async function applyVoteDelta(summaryRef, ratedUserId, countDelta, sumDelta) {
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
}
// ─── Scheduled: auto-balance teams before a game ───────────────────────
const DEFAULT_AUTO_BALANCE_MINUTES = 60;
const GUEST_ID_PREFIX = 'guest:';
function perTeamSize(format) {
    if (format === '4v4')
        return 4;
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
 * Coerce any stored rating onto the live 1.0–5.0 scale. Admin ratings created
 * before the 1–10 → 1–5 migration still sit in `adminRatings` / guest
 * `estimatedRating` as 6–10 values. Reading them raw makes an old "8" tower
 * over a neutral 3 and skews every auto-balance (B06/B07/B17). Anything above
 * the 1–5 max is treated as the old scale and halved back; everything is
 * clamped into [1,5]. Idempotent for already-migrated 1–5 values.
 */
function normalizeRating(v) {
    const r = v > 5 ? v / 2 : v;
    return Math.min(5, Math.max(1, r));
}
function balanceTeamsV1(playerIds, ratings, numberOfTeams, perTeam) {
    let unratedCount = 0;
    const scored = playerIds.map((id) => {
        const known = ratings[id];
        if (typeof known === 'number' && known > 0) {
            return { id, rating: normalizeRating(known), unrated: false };
        }
        unratedCount += 1;
        return { id, rating: 3, unrated: true }; // neutral midpoint of 1.0..5.0
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
    // Map team index → live-match zone. The live screen renders A/B as
    // the on-field matchup and C/D/E as the waiting queue — we assign
    // each balanced team to its corresponding zone instead of dumping
    // overflow on the bench (which left "team 3" visually empty even
    // though enough players were registered).
    const ZONES = ['teamA', 'teamB', 'teamC', 'teamD', 'teamE'];
    teams.forEach((t, i) => {
        const zone = ZONES[i];
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
async function runScheduledAutoGenerateTeams() {
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
        // Manual teams ALWAYS win: a captain-draft / manual split writes
        // `draftTeams`. The opt-in path already skips these; the legacy
        // minutes-before path must too, or it seeds a SECOND, conflicting team
        // model in `liveMatch.assignments` over the admin's split (B05/B16).
        if (g.draftTeams)
            continue;
        if (!g.groupId)
            continue;
        // Opt-in `autoTeamsAt` games are owned by the wall-clock path below
        // (which writes draftTeams + pushes). Don't let the legacy
        // minutes-before path race it and seed liveMatch.assignments instead.
        if (typeof g.autoTeamsAt === 'number' && g.autoTeamsAt > 0)
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
    // Opt-in path: games with an explicit wall-clock `autoTeamsAt` that has
    // passed. These write the manual-draft shape (`draftTeams`) by INTERNAL
    // rating and push every player their team. Separate query because
    // Firestore can't OR two range fields in one go.
    await runDueAutoTeamsAt(now);
}
/**
 * Generate balanced teams (by internal admin rating) for every open game
 * whose admin-picked `autoTeamsAt` time has passed and which hasn't been
 * generated yet. Writes `draftTeams` and fans out the "teams ready" push.
 */
async function runDueAutoTeamsAt(now) {
    // Bounded circuit-breaker. The index is (status, autoTeamsAt) so results come
    // oldest-autoTeamsAt first (FIFO), and generation clears autoTeamsAt — so the
    // set drains and no due game is ever starved past a tick or two.
    const snap = await db
        .collection('games')
        .where('status', '==', 'open')
        .where('autoTeamsAt', '<=', now)
        .limit(200)
        .get();
    if (snap.empty)
        return;
    const ops = [];
    for (const doc of snap.docs) {
        const g = doc.data();
        g.id = doc.id;
        if (!g.autoTeamsAt || g.autoTeamsAt <= 0)
            continue;
        if (g.autoTeamsGeneratedAt)
            continue;
        if (g.teamsEditedManually)
            continue;
        // Manual teams ALWAYS win: if an admin already set a split (by any
        // method), never auto-generate over it. The transaction re-checks too.
        if (g.draftTeams)
            continue;
        if (!g.groupId)
            continue;
        if ((g.players ?? []).length === 0 && (g.guests ?? []).length === 0) {
            continue;
        }
        ops.push(generateDraftTeamsForGame(doc.ref, g));
    }
    await Promise.all(ops);
    console.log(`[autoBalance] draftTeams generated for ${ops.length} game(s)`);
}
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
            // Re-check inside the transaction: a manual split may have landed between
            // the outer query and here. Never seed liveMatch.assignments over it.
            if (data.draftTeams)
                return false;
            // Never overwrite a liveMatch that's already past setup — this write
            // replaces the WHOLE liveMatch object, so clobbering a live/finished one
            // would wipe its score + goal log. Only generate onto a fresh/organizing
            // slot.
            const existingPhase = data.liveMatch?.phase;
            if (existingPhase && existingPhase !== 'organizing')
                return false;
            const freshPlayers = data.players ?? players;
            const freshGuests = data.guests ?? [];
            if (freshPlayers.length === 0 && freshGuests.length === 0)
                return false;
            // Compose the roster: real users keep their uid; guests are
            // encoded as `guest:<id>` so the roster id space is disjoint.
            // Their rating is `estimatedRating` when set, otherwise the
            // neutral 3 (handled by balanceTeamsV1's unrated branch).
            const guestRoster = freshGuests.map((gu) => `${GUEST_ID_PREFIX}${gu.id}`);
            const guestRatings = {};
            for (const gu of freshGuests) {
                // Accept any positive estimatedRating and normalise it onto 1–5.
                // Previously a legacy 1–10 value (e.g. 7) was rejected here and scored
                // as neutral, while the CLIENT used it raw — so the same roster split
                // differently depending on who generated it (B07). Normalising both
                // sides keeps them identical.
                if (typeof gu.estimatedRating === 'number' && gu.estimatedRating > 0) {
                    guestRatings[`${GUEST_ID_PREFIX}${gu.id}`] = normalizeRating(gu.estimatedRating);
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
        // Auto-balance is a silent server action — the next time anyone
        // opens the match they'll see the arranged teams. We deliberately
        // do NOT dispatch a push here. The previous `gameCanceledOrUpdated`
        // notification with action='teams_generated' fell through the body
        // resolver's switch to the cancellation copy ("המשחק בוטל"), so
        // every player got a misleading "game cancelled" push when in fact
        // teams had just been seeded.
        if (wrote) {
            console.log(`[autoBalance] generated teams for ${ref.id}`);
        }
    }
    catch (err) {
        console.error('[autoBalance] generateForGame failed', ref.id, err);
    }
}
/** Convert a balanceTeamsV1 zone map into draft teams (captain = highest
 *  rated member of each zone; `playerIds[0]` = captain). */
function buildDraftTeamsFromBalance(assignments, ratings, numberOfTeams, createdBy) {
    const ZONES = ['teamA', 'teamB', 'teamC', 'teamD', 'teamE'];
    // Unrated → neutral 3 (the 1–5 midpoint). The old default 5.5 sat ABOVE the
    // 1–5 max, so on the new scale every unrated player out-sorted every rated
    // one and wrongly became captain (B17). Rated values are normalised off any
    // leftover 1–10 data (B06/B07).
    const ratingOf = (id) => typeof ratings[id] === 'number' && ratings[id] > 0 ? normalizeRating(ratings[id]) : 3;
    const teams = [];
    for (let i = 0; i < numberOfTeams; i++) {
        const zone = ZONES[i];
        const members = Object.keys(assignments)
            .filter((id) => assignments[id] === zone)
            .sort((a, b) => ratingOf(b) - ratingOf(a));
        teams.push({
            index: i,
            captainId: members[0] ?? '',
            playerIds: members,
        });
    }
    return teams;
}
/** Read display names (first word) for a set of uids, for push bodies. */
async function loadFirstNames(uids) {
    const out = {};
    if (uids.length === 0)
        return out;
    const unique = Array.from(new Set(uids));
    const snaps = await db.getAll(...unique.map((u) => db.collection('users').doc(u)));
    snaps.forEach((s, i) => {
        if (!s.exists)
            return;
        const d = s.data();
        const full = (d.name || d.displayName || '').trim();
        if (full)
            out[unique[i]] = full.split(' ')[0];
    });
    return out;
}
/** Join names as "א, ב ו-ג" (Hebrew "and" before the last). */
function joinHebrewNames(names) {
    if (names.length === 0)
        return '';
    if (names.length === 1)
        return names[0];
    return `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`;
}
/**
 * Fan out one `teamsGenerated` notification per registered player, each with
 * a personal body listing their same-team members — registered teammates AND
 * guests on that team (guests get no push of their own, but their names still
 * appear in their teammates' lists). Stamps `teamsNotifiedAt` so a later
 * edit/re-save can't re-spam.
 */
async function fanOutTeamsReadyPush(ref, gameId, teams) {
    // Only real users (skip guest:* ids) receive a push.
    const realByTeam = teams.map((t) => t.playerIds.filter((id) => !id.startsWith(GUEST_ID_PREFIX)));
    const allReal = realByTeam.flat();
    if (allReal.length === 0)
        return;
    // Resolve guest names (keyed `guest:<id>`) from the game doc so guests can be
    // listed alongside registered teammates in each push body.
    const guestNameById = {};
    try {
        const snap = await ref.get();
        const guests = snap.data()?.guests ?? [];
        for (const gu of guests) {
            const first = (gu.name || '').trim().split(' ')[0];
            if (first)
                guestNameById[`${GUEST_ID_PREFIX}${gu.id}`] = first;
        }
    }
    catch (err) {
        console.error('[teamsReady] failed to load guest names', gameId, err);
    }
    // Guest first-names per team, in roster order.
    const guestNamesByTeam = teams.map((t) => t.playerIds
        .filter((id) => id.startsWith(GUEST_ID_PREFIX))
        .map((id) => guestNameById[id])
        .filter((n) => !!n));
    const firstNames = await loadFirstNames(allReal);
    const batch = db.batch();
    teams.forEach((t, ti) => {
        const mates = realByTeam[ti];
        mates.forEach((uid) => {
            const teammateNames = [
                ...mates
                    .filter((m) => m !== uid)
                    .map((m) => firstNames[m])
                    .filter((n) => !!n),
                ...guestNamesByTeam[ti],
            ];
            // Deterministic id per (game, player) so a second fan-out — the manual
            // "notify" callable racing the scheduled path, or a retry — overwrites
            // the same doc instead of creating a duplicate that fires a second push
            // (onNotificationCreated only triggers on CREATE). N6.
            const notifRef = db
                .collection('notifications')
                .doc(`${gameId}__teamsReady__${uid}`);
            batch.set(notifRef, {
                type: 'teamsGenerated',
                recipientId: uid,
                payload: {
                    gameId,
                    teammates: joinHebrewNames(teammateNames),
                },
                delivered: false,
                createdAt: Date.now(),
            });
        });
    });
    batch.update(ref, { teamsNotifiedAt: Date.now() });
    await batch.commit();
}
/**
 * Balance one game by internal rating into `draftTeams`, then push. The write
 * is transactional and re-checks the generation flags so a concurrent run or
 * a coach edit can't be clobbered.
 */
async function generateDraftTeamsForGame(ref, g) {
    try {
        const groupId = g.groupId;
        const grpSnap = await db.collection('groups').doc(groupId).get();
        if (!grpSnap.exists)
            return;
        const grp = grpSnap.data();
        const players = g.players ?? [];
        // Ratings depend on the admin-picked method:
        //  • 'random' → no ratings at all → balanceTeamsV1 splits evenly + random.
        //  • 'rating' (default) → internal admin ratings (or peer-vote fallback).
        let ratings;
        if (g.autoTeamsMethod === 'random') {
            ratings = {};
        }
        else if (grp.internalRating) {
            ratings = {};
            for (const uid of players) {
                const r = grp.adminRatings?.[uid];
                if (typeof r === 'number' && r > 0)
                    ratings[uid] = r;
            }
        }
        else {
            ratings = await loadGroupRatings(groupId, players);
        }
        const perTeam = perTeamSize(g.format);
        const numberOfTeams = typeof g.numberOfTeams === 'number' && g.numberOfTeams >= 2
            ? g.numberOfTeams
            : 2;
        const built = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists)
                return null;
            const data = fresh.data();
            if (data.autoTeamsGeneratedAt)
                return null;
            if (data.teamsEditedManually)
                return null;
            // Manual teams win — never overwrite a split an admin already made.
            if (data.draftTeams)
                return null;
            const freshPlayers = data.players ?? players;
            const freshGuests = data.guests ?? [];
            if (freshPlayers.length === 0 && freshGuests.length === 0)
                return null;
            const guestRoster = freshGuests.map((gu) => `${GUEST_ID_PREFIX}${gu.id}`);
            const guestRatings = {};
            for (const gu of freshGuests) {
                // Accept any positive estimatedRating and normalise it onto 1–5.
                // Previously a legacy 1–10 value (e.g. 7) was rejected here and scored
                // as neutral, while the CLIENT used it raw — so the same roster split
                // differently depending on who generated it (B07). Normalising both
                // sides keeps them identical.
                if (typeof gu.estimatedRating === 'number' && gu.estimatedRating > 0) {
                    guestRatings[`${GUEST_ID_PREFIX}${gu.id}`] = normalizeRating(gu.estimatedRating);
                }
            }
            const rosterIds = [...freshPlayers, ...guestRoster];
            // Never make more teams than players — otherwise a roster smaller than
            // numberOfTeams (e.g. 3 players, 4 teams) leaves empty zones with an
            // empty captainId. Need at least 2 players to form two teams.
            if (rosterIds.length < 2)
                return null;
            const effTeams = Math.min(numberOfTeams, rosterIds.length);
            const combinedRatings = { ...ratings, ...guestRatings };
            // Size so nobody benches — mirrors the client `balanceTeams`.
            const fitPerTeam = Math.max(perTeam, Math.ceil(rosterIds.length / effTeams));
            const result = balanceTeamsV1(rosterIds, combinedRatings, effTeams, fitPerTeam);
            const teams = buildDraftTeamsFromBalance(result.assignments, combinedRatings, effTeams, g.createdBy ?? 'system').filter((t) => t.playerIds.length > 0); // defensive: drop any empty zone
            const draftTeams = {
                method: 'snake',
                numTeams: teams.length,
                createdAt: Date.now(),
                createdBy: g.createdBy ?? 'system',
                teams,
            };
            tx.update(ref, {
                draftTeams,
                autoTeamsGeneratedAt: Date.now(),
                autoTeamsGeneratedBy: 'system',
                // Clear the schedule so this game drops OUT of the `autoTeamsAt <= now`
                // query immediately — otherwise it stays in the result set (re-fetched
                // every 5 min) from generation until kickoff. The latch above is the
                // real guard; this keeps the cron's read set self-draining.
                autoTeamsAt: admin.firestore.FieldValue.delete(),
                teamBalanceMeta: {
                    generatedAt: Date.now(),
                    algorithm: 'rating_greedy_v1',
                    unratedCount: result.unratedCount,
                    teamRatings: result.teamRatings,
                },
                updatedAt: Date.now(),
            });
            return teams;
        });
        if (built) {
            console.log(`[autoBalance] draftTeams seeded for ${ref.id}`);
            await fanOutTeamsReadyPush(ref, ref.id, built);
        }
    }
    catch (err) {
        console.error('[autoBalance] generateDraftTeamsForGame failed', ref.id, err);
    }
}
// ─── Callable: bump /appConfig/{platform} (admin-gated) ────────────────
//
// One-shot maintenance hook. Bumping `latestVersion` triggers the
// optional-update modal across every install on next cold start; bumping
// `minimumSupportedVersion` triggers the force-update modal. Open from
// `firebase functions:shell` or via a httpsCallable invocation:
//
//   const fn = httpsCallable(functions, 'updateAppConfig');
//   await fn({ platform: 'android', latestVersion: '0.2.5' });
//
// Gated to a single hard-coded admin uid so only the project owner can
// call it — App Check + auth are layered on top in production.
exports.updateAppConfig = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const ALLOWED_UID = '1IdtNEjbEXfiRSqvLrJVn99NsfI2'; // matan
    if (request.auth?.uid !== ALLOWED_UID) {
        throw new https_1.HttpsError('permission-denied', 'admin only');
    }
    const data = (request.data ?? {});
    const platform = data.platform === 'ios' ? 'ios' : 'android';
    const patch = { updatedAt: Date.now() };
    if (typeof data.latestVersion === 'string') {
        patch.latestVersion = data.latestVersion;
    }
    if (typeof data.minimumSupportedVersion === 'string') {
        patch.minimumSupportedVersion = data.minimumSupportedVersion;
    }
    await db.collection('appConfig').doc(platform).set(patch, { merge: true });
    return { ok: true, platform, patch };
});
// ─── Callable: send game invite (server-trusted) ────────────────────────
//
// Replaces the legacy client-side `addDoc('/notifications', { type:
// 'inviteToGame', payload: { inviterName, gameTitle, ... } })` flow.
// That path let any signed-in client write a notification with an
// arbitrary `inviterName` — i.e. impersonate "מנהל הקבוצה" or any
// other display name in a phishing-style push.
//
// This callable is the only legitimate way to dispatch an invite. It:
//   1. requires `request.auth` (Firestore rule no longer allows
//      `inviteToGame` from clients, so the legacy path is dead);
//   2. enforces a server-side per-uid rate limit (30/hour) using a
//      `/rateLimits/{uid}_inviteToGame` doc that the client cannot
//      tamper with through the function — the function reads & writes
//      via Admin SDK and is the only writer trusted by the count;
//   3. validates IDs only (recipientId, gameId) — caller cannot
//      smuggle inviterName / gameTitle / etc.;
//   4. loads the sender + game server-side and constructs the payload
//      from canonical state (sender name from /users/{auth.uid}.name,
//      game title from /games/{gameId}.title);
//   5. checks permission: caller must be a member or admin of the
//      game's parent community;
//   6. blocks self-invite, blocks invites to a game the recipient is
//      already in, blocks invites to terminal-state games.
//
// Errors propagate as `HttpsError` codes the client can branch on:
//   • `unauthenticated` — caller has no auth
//   • `invalid-argument` — missing / oversized IDs
//   • `permission-denied` — caller can't see this game / not a member
//   • `failed-precondition` — recipient already in game / game closed
//   • `resource-exhausted` — server-side rate limit exceeded
const INVITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const INVITE_RATE_LIMIT_CAP = 30;
/**
 * setGuestRating — let the player who ADDED a guest set/clear that guest's
 * `estimatedRating`. ONLY the adder (`guest.addedBy === caller`) may change a
 * guest's rating: the community admin manages the roster (rename/remove) but
 * deliberately CANNOT touch the rating, because they don't know the guest.
 *
 * Routed through a callable (rather than a client write + Firestore rule)
 * because rules can't validate per-element ownership inside the `guests`
 * array — only the admin SDK can read `guest.addedBy` and gate on it.
 *
 * Errors: `unauthenticated`, `invalid-argument`, `not-found`,
 * `permission-denied` (caller is not the guest's adder).
 */
exports.setGuestRating = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign-in required');
    }
    const uid = auth.uid;
    const data = (request.data ?? {});
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const guestId = typeof data.guestId === 'string' ? data.guestId : '';
    if (!gameId || gameId.length > 128 || !guestId || guestId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'invalid gameId or guestId');
    }
    // rating: a number in [1,5] (one-decimal granularity) or null to clear.
    let rating;
    if (data.rating === null || data.rating === undefined) {
        rating = null;
    }
    else if (typeof data.rating === 'number' &&
        Number.isFinite(data.rating) &&
        data.rating >= 1 &&
        data.rating <= 5) {
        rating = Math.round(data.rating * 10) / 10;
    }
    else {
        throw new https_1.HttpsError('invalid-argument', 'rating must be 1..5 or null');
    }
    const ref = db.collection('games').doc(gameId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new https_1.HttpsError('not-found', 'game not found');
        const g = snap.data();
        const guests = Array.isArray(g.guests) ? g.guests : [];
        const idx = guests.findIndex((x) => x.id === guestId);
        if (idx < 0)
            throw new https_1.HttpsError('not-found', 'guest not found');
        const guest = guests[idx];
        if (guest.addedBy !== uid) {
            throw new https_1.HttpsError('permission-denied', 'only the player who added this guest can rate them');
        }
        const updated = { ...guest };
        if (rating === null)
            delete updated.estimatedRating;
        else
            updated.estimatedRating = rating;
        const next = [
            ...guests.slice(0, idx),
            updated,
            ...guests.slice(idx + 1),
        ];
        tx.update(ref, { guests: next, updatedAt: Date.now() });
    });
    return { ok: true };
});
exports.sendGameInvite = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    // 1) Auth
    const auth = request.auth;
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign-in required to send invites');
    }
    const senderUid = auth.uid;
    // 2) Input shape — IDs only. Anything textual the function loads
    //    server-side from canonical state.
    const data = (request.data ?? {});
    const recipientId = typeof data.recipientId === 'string' ? data.recipientId : '';
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    if (recipientId.length === 0 ||
        recipientId.length > 128 ||
        gameId.length === 0 ||
        gameId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'invalid recipientId or gameId');
    }
    if (recipientId === senderUid) {
        throw new https_1.HttpsError('invalid-argument', 'cannot invite yourself');
    }
    // 3) Server-side rate limit. Single transactional read+write so two
    //    fast invocations can't both pass under the cap.
    const limitRef = db
        .collection('rateLimits')
        .doc(`${senderUid}_inviteToGame_v2`); // distinct id from client counter
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(limitRef);
        const now = Date.now();
        if (!snap.exists) {
            tx.set(limitRef, {
                uid: senderUid,
                op: 'inviteToGame',
                windowStart: now,
                count: 1,
                updatedAt: now,
            });
            return;
        }
        const cur = snap.data();
        const expired = typeof cur.windowStart !== 'number' ||
            now - cur.windowStart > INVITE_RATE_LIMIT_WINDOW_MS;
        if (expired) {
            tx.set(limitRef, {
                uid: senderUid,
                op: 'inviteToGame',
                windowStart: now,
                count: 1,
                updatedAt: now,
            });
            return;
        }
        const nextCount = (cur.count ?? 0) + 1;
        if (nextCount > INVITE_RATE_LIMIT_CAP) {
            throw new https_1.HttpsError('resource-exhausted', 'too many invites — try again later');
        }
        tx.update(limitRef, { count: nextCount, updatedAt: now });
    });
    // 4) Load sender, game, and recipient — all canonical, all server-side.
    const [senderSnap, gameSnap, recipientSnap] = await Promise.all([
        db.collection('users').doc(senderUid).get(),
        db.collection('games').doc(gameId).get(),
        db.collection('users').doc(recipientId).get(),
    ]);
    if (!senderSnap.exists) {
        throw new https_1.HttpsError('failed-precondition', 'sender profile missing');
    }
    if (!gameSnap.exists) {
        throw new https_1.HttpsError('failed-precondition', 'game not found');
    }
    if (!recipientSnap.exists) {
        throw new https_1.HttpsError('failed-precondition', 'recipient not found');
    }
    const sender = senderSnap.data();
    const game = gameSnap.data();
    // 5) Permission: caller must be allowed to see + invite to the game.
    //    For community games we require that they're a group member or
    //    admin (matching the read rule for /games). For public games any
    //    signed-in user can already read, so we accept them as inviters.
    if (game.visibility !== 'public') {
        if (!game.groupId) {
            throw new https_1.HttpsError('permission-denied', 'game has no community');
        }
        const groupSnap = await db
            .collection('groups')
            .doc(game.groupId)
            .get();
        if (!groupSnap.exists) {
            throw new https_1.HttpsError('permission-denied', 'community missing');
        }
        const grp = groupSnap.data();
        const ids = new Set([
            ...(grp.playerIds ?? []),
            ...(grp.adminIds ?? []),
        ]);
        if (!ids.has(senderUid)) {
            throw new https_1.HttpsError('permission-denied', 'not a member of this community');
        }
    }
    // 6) Lifecycle: don't invite to a terminal or in-progress game.
    if (game.status === 'finished' || game.status === 'cancelled') {
        throw new https_1.HttpsError('failed-precondition', 'game is no longer accepting invites');
    }
    // 7) Recipient already in roster? Don't spam them.
    const inRoster = new Set([
        ...(game.players ?? []),
        ...(game.waitlist ?? []),
        ...(game.pending ?? []),
    ]);
    if (inRoster.has(recipientId)) {
        throw new https_1.HttpsError('failed-precondition', 'recipient is already registered');
    }
    // 8) Record the invitee on the game so the security rules grant them
    //    read + self-join access even on a community-only game (they're not
    //    a member, but they were explicitly invited). Admin-SDK write →
    //    bypasses rules. Without this the invitee tapping the push hit the
    //    "members only" wall (user report).
    try {
        await gameSnap.ref.update({
            invitedUserIds: admin.firestore.FieldValue.arrayUnion(recipientId),
            updatedAt: Date.now(),
        });
    }
    catch (err) {
        console.warn('[sendGameInvite] invitedUserIds write failed', err);
    }
    // 9) Construct payload server-side ONLY. inviterName / gameTitle /
    //    startsAt all come from canonical state — the client cannot
    //    influence what the recipient sees.
    await createNotificationOnce({
        type: 'inviteToGame',
        recipientId,
        payload: {
            gameId,
            gameTitle: typeof game.title === 'string' ? game.title : 'המשחק',
            inviterName: typeof sender.name === 'string' ? sender.name : '',
            inviterId: senderUid,
            startsAt: typeof game.startsAt === 'number' ? game.startsAt : 0,
        },
        createdByUid: senderUid,
    });
    // 9) Fire-and-forget telemetry counter so analytics keep working
    //    after the flow moves off the client (the client used to
    //    `achievementsService.bump('invitesSent')` after this — bump
    //    server-side instead so even non-app callers see consistent
    //    counters).
    try {
        await db.collection('users').doc(senderUid).set({
            achievements: {
                invitesSent: admin.firestore.FieldValue.increment(1),
            },
            updatedAt: Date.now(),
        }, { merge: true });
    }
    catch (err) {
        console.warn('[sendGameInvite] invitesSent bump failed', err);
    }
    return { ok: true };
});
// ─── Callable: admin registers community members to a game ─────────────
//
// The organiser / a community admin picks members from their community and
// registers them straight into the game (NOT just an invite — they're added
// to `players`, overflowing to `waitlist` when the game is full). Each added
// member gets an `addedToGame` push. Admin-only; targets must be members of
// the game's community. Runs server-side (Admin SDK) so the roster write is
// atomic + authoritative and the push fans out canonically.
exports.adminAddPlayers = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign-in required');
    }
    const callerUid = auth.uid;
    const data = (request.data ?? {});
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const userIds = Array.isArray(data.userIds)
        ? data.userIds.filter((x) => typeof x === 'string' && x.length > 0)
        : [];
    if (gameId.length === 0 || gameId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'invalid gameId');
    }
    if (userIds.length === 0 || userIds.length > 40) {
        throw new https_1.HttpsError('invalid-argument', 'userIds must be 1..40');
    }
    const targets = Array.from(new Set(userIds)); // dedupe
    // Load game + caller's name.
    const [gameSnap, callerSnap] = await Promise.all([
        db.collection('games').doc(gameId).get(),
        db.collection('users').doc(callerUid).get(),
    ]);
    if (!gameSnap.exists) {
        throw new https_1.HttpsError('failed-precondition', 'game not found');
    }
    const game = gameSnap.data();
    if (game.status === 'finished' || game.status === 'cancelled') {
        throw new https_1.HttpsError('failed-precondition', 'game is no longer open');
    }
    if (!game.groupId) {
        throw new https_1.HttpsError('failed-precondition', 'game has no community');
    }
    // Permission: caller must be the organiser OR a community admin, and we
    // also need the member set so we only add genuine community members.
    const groupSnap = await db.collection('groups').doc(game.groupId).get();
    if (!groupSnap.exists) {
        throw new https_1.HttpsError('permission-denied', 'community missing');
    }
    const grp = groupSnap.data();
    const adminIds = new Set(grp.adminIds ?? []);
    const isAdmin = callerUid === game.createdBy || adminIds.has(callerUid);
    if (!isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'admins only');
    }
    const memberIds = new Set([...(grp.playerIds ?? []), ...(grp.adminIds ?? [])]);
    // Transaction: append eligible targets to players (then waitlist when the
    // game is full), keeping participantIds + joinedAt in sync.
    const result = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(gameSnap.ref);
        const g = fresh.data();
        const players = [...(g.players ?? [])];
        const waitlist = [...(g.waitlist ?? [])];
        const pending = [...(g.pending ?? [])];
        const joinedAt = { ...(g.joinedAt ?? {}) };
        const cap = typeof g.maxPlayers === 'number' && g.maxPlayers > 0 ? g.maxPlayers : Infinity;
        const inRoster = new Set([...players, ...waitlist, ...pending]);
        const now = Date.now();
        const addedToPlayers = [];
        const addedToWaitlist = [];
        for (const uid of targets) {
            if (!memberIds.has(uid))
                continue; // not a community member → skip
            if (inRoster.has(uid))
                continue; // already registered → skip
            inRoster.add(uid);
            joinedAt[uid] = now;
            if (players.length < cap) {
                players.push(uid);
                addedToPlayers.push(uid);
            }
            else {
                waitlist.push(uid);
                addedToWaitlist.push(uid);
            }
        }
        if (addedToPlayers.length === 0 && addedToWaitlist.length === 0) {
            return { addedToPlayers, addedToWaitlist };
        }
        const participantIds = Array.from(new Set([...players, ...waitlist, ...pending]));
        tx.update(gameSnap.ref, {
            players,
            waitlist,
            participantIds,
            joinedAt,
            updatedAt: now,
        });
        return { addedToPlayers, addedToWaitlist };
    });
    // Push each newly-added member (one doc per recipient → per-player body).
    const adderName = callerSnap.data()?.name ?? '';
    const title = typeof game.title === 'string' ? game.title : 'המשחק';
    const startsAt = typeof game.startsAt === 'number' ? game.startsAt : 0;
    const pushOne = (uid, waitlisted) => createNotificationOnce({
        type: 'addedToGame',
        recipientId: uid,
        payload: { gameId, gameTitle: title, adderName, startsAt, waitlisted },
        createdByUid: callerUid,
    }).catch((err) => console.warn('[adminAddPlayers] push failed', uid, err));
    await Promise.all([
        ...result.addedToPlayers.map((uid) => pushOne(uid, false)),
        ...result.addedToWaitlist.map((uid) => pushOne(uid, true)),
    ]);
    return {
        ok: true,
        addedToPlayers: result.addedToPlayers.length,
        addedToWaitlist: result.addedToWaitlist.length,
    };
});
// ─── Callable: notify game admin of player cancellation ────────────────
//
// Moved off the client write path so we can:
//   • aggregate multiple cancellations on the same game into ONE
//     unread notification (count + names appended via the
//     server-side AGGREGATE_ON_DUPLICATE branch in
//     `createNotificationOnce`);
//   • canonicalise the cancelling player's name from the /users doc
//     instead of trusting whatever the client posts;
//   • keep the dedupeKey free of per-user discriminators so
//     successive cancels collide on the same doc id.
//
// Auth: the cancelling user must be signed in AND must currently be
// the user identified in the input (no proxy cancellations). The
// game's createdBy is the recipient; if the canceller IS the game
// creator (organiser cancelling themselves out of their own game)
// we skip — they don't need a push about their own action.
exports.notifyPlayerCancelled = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const callerUid = request.auth.uid;
    const data = request.data;
    const gameId = typeof data?.gameId === 'string' ? data.gameId : '';
    if (!gameId || gameId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'invalid gameId');
    }
    const reason = typeof data?.reason === 'string' ? data.reason : '';
    if (reason.length > 60) {
        throw new https_1.HttpsError('invalid-argument', 'reason too long');
    }
    const [gameSnap, userSnap] = await Promise.all([
        db.collection('games').doc(gameId).get(),
        db.collection('users').doc(callerUid).get(),
    ]);
    if (!gameSnap.exists) {
        throw new https_1.HttpsError('not-found', 'game does not exist');
    }
    const game = gameSnap.data();
    const adminUid = game.createdBy;
    if (!adminUid) {
        // No admin to notify (legacy game). Silently succeed —
        // suppressing the push is the right behaviour.
        return { ok: true, skipped: 'no-admin' };
    }
    if (adminUid === callerUid) {
        return { ok: true, skipped: 'self-cancel' };
    }
    const cancellingUserName = (userSnap.exists &&
        typeof userSnap.data()?.name === 'string' &&
        userSnap.data().name.slice(0, 60)) ||
        '';
    const result = await createNotificationOnce({
        type: 'playerCancelled',
        recipientId: adminUid,
        payload: {
            gameId,
            gameTitle: typeof game.title === 'string' ? game.title : '',
            cancellingUserId: callerUid,
            cancellingUserName,
            // Initial count = 1 — the AGGREGATE_ON_DUPLICATE branch will
            // increment this on subsequent cancellations within the bucket.
            count: 1,
            cancellingUserIds: [callerUid],
            cancellingUserNames: cancellingUserName ? [cancellingUserName] : [],
        },
        createdByUid: callerUid,
    });
    return { ok: true, result };
});
// ─── Callable: notify players their auto-balanced teams are ready ──────
//
// Admin-triggered from the teams screen after a manual auto-balance + review.
// Fans out one personalized `teamsGenerated` push per registered player
// ("אתה בקבוצה עם …"). Gated to the game's organiser / a group admin.
exports.notifyTeamsReady = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const callerUid = request.auth.uid;
    const data = request.data;
    const gameId = typeof data?.gameId === 'string' ? data.gameId : '';
    if (!gameId || gameId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'invalid gameId');
    }
    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) {
        throw new https_1.HttpsError('not-found', 'game does not exist');
    }
    const game = gameSnap.data();
    // Authorize: organiser or a group admin.
    let authorized = game.createdBy === callerUid;
    if (!authorized && game.groupId) {
        const grpSnap = await db.collection('groups').doc(game.groupId).get();
        const grp = grpSnap.data();
        authorized = !!grp?.adminIds?.includes(callerUid);
    }
    if (!authorized) {
        throw new https_1.HttpsError('permission-denied', 'admin only');
    }
    // Debounce a double-tap: if we already fanned out within the last 30s,
    // no-op. A deliberate re-notify after editing teams (later) still works.
    if (typeof game.teamsNotifiedAt === 'number' &&
        Date.now() - game.teamsNotifiedAt < 30000) {
        return { ok: true, skipped: 'debounce' };
    }
    const teams = game.draftTeams?.teams ?? [];
    if (teams.length === 0) {
        throw new https_1.HttpsError('failed-precondition', 'no teams to notify');
    }
    await fanOutTeamsReadyPush(gameSnap.ref, gameId, teams);
    return { ok: true };
});
// ─── Callable: ensure personal (hidden) community for orphan games ─────
//
// Returns the caller's `personalGroupId`, creating it lazily if missing.
// All games created via the "ללא קהילה" wizard path land in this group
// so the rest of the app (rules, queries, CFs) keeps working unchanged.
// The group is `isPersonal: true, hidden: true` so it never surfaces in
// feeds, search, or discovery.
exports.ensurePersonalGroup = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
        throw new https_1.HttpsError('not-found', 'user doc missing');
    }
    const userData = userSnap.data();
    // Fast path: already provisioned. Verify the group still exists AND is
    // still a personal group — if it was deleted, OR PROMOTED to a real
    // community (isPersonal flipped to false), we re-provision rather than
    // handing back its id. Otherwise the next one-off game would be created
    // INSIDE that public community (its members, chat, feed) — the personal
    // group id is never reset on promotion.
    if (typeof userData.personalGroupId === 'string' &&
        userData.personalGroupId.length > 0) {
        const existing = await db
            .collection('groups')
            .doc(userData.personalGroupId)
            .get();
        if (existing.exists && existing.data()?.isPersonal === true) {
            return { groupId: userData.personalGroupId, created: false };
        }
    }
    // Create a fresh hidden group. We don't write a /groupsPublic
    // mirror — `hidden: true` keeps it out of every feed.
    const groupRef = db.collection('groups').doc();
    const now = Date.now();
    const inviteCode = randomInviteCode();
    const userName = typeof userData.name === 'string' && userData.name.length > 0
        ? userData.name
        : 'משתמש';
    await groupRef.set({
        name: `המשחקים של ${userName}`,
        normalizedName: `המשחקים של ${userName}`.toLowerCase().trim(),
        adminIds: [uid],
        playerIds: [uid],
        pendingPlayerIds: [],
        creatorId: uid,
        inviteCode,
        isOpen: false,
        isPersonal: true,
        hidden: true,
        createdAt: now,
        updatedAt: now,
    });
    await userRef.set({ personalGroupId: groupRef.id, updatedAt: now }, { merge: true });
    return { groupId: groupRef.id, created: true };
});
// ─── Callable: server clock probe (NTP-style offset source) ────────────
//
// Returns the server's wall-clock epoch (ms). The client calls this a few
// times, measures round-trip time, and derives `offset = serverNow -
// localNow` so every device can compute a SHARED `serverNow()` for the
// live-match timer. Without this, two phones with skewed clocks render the
// same `timerLastStartedAt` anchor as different elapsed times.
//
// Deliberately minimal and unauthenticated: it leaks nothing (just the
// time) and is cheap. No App Check / auth gate so the offset can be
// measured even on a freshly-launched, not-yet-authed client.
exports.getServerTime = (0, https_1.onCall)({ enforceAppCheck: false }, async () => {
    return { now: Date.now() };
});
// ─── Callable: promote a personal/orphan group to a real community ─────
//
// Flips `isPersonal` and `hidden` to false, applies the user-chosen
// name/description/city, writes the /groupsPublic mirror, and adds the
// invited participants to `pendingPlayerIds` (each receives a
// `groupInvitation` push with confirm/decline actions).
//
// Auth: caller must be admin of the group AND the group must currently
// be a personal group. We don't allow this callable to be used to
// promote a regular group — that path stays via the standard groupEdit
// flow.
exports.promoteOrphanToGroup = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const callerUid = request.auth.uid;
    const data = request.data;
    const groupId = typeof data.groupId === 'string' ? data.groupId : '';
    const name = typeof data.name === 'string' ? data.name.trim().slice(0, 60) : '';
    const description = typeof data.description === 'string'
        ? data.description.trim().slice(0, 500)
        : '';
    const isOpen = data.isOpen === true;
    const rules = typeof data.rules === 'string' ? data.rules.trim().slice(0, 2000) : '';
    const contactPhone = typeof data.contactPhone === 'string'
        ? data.contactPhone.trim().slice(0, 30)
        : '';
    const city = typeof data.city === 'string' ? data.city.trim().slice(0, 80) : '';
    const inviteUserIds = Array.isArray(data.inviteUserIds)
        ? data.inviteUserIds
            .filter((u) => typeof u === 'string' && u.length > 0)
            .slice(0, 100)
        : [];
    // The specific orphan game this community is being created FROM. Used
    // to scope the community's inherited stats to just that game (see below).
    const fromGameId = typeof data.fromGameId === 'string'
        ? (data.fromGameId).slice(0, 128)
        : '';
    if (!groupId || groupId.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'invalid groupId');
    }
    if (name.length < 2) {
        throw new https_1.HttpsError('invalid-argument', 'name too short');
    }
    const groupRef = db.collection('groups').doc(groupId);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) {
        throw new https_1.HttpsError('not-found', 'group does not exist');
    }
    const group = groupSnap.data();
    if (!Array.isArray(group.adminIds) || !group.adminIds.includes(callerUid)) {
        throw new https_1.HttpsError('permission-denied', 'admin only');
    }
    if (group.isPersonal !== true) {
        throw new https_1.HttpsError('failed-precondition', 'group is not a personal group');
    }
    const now = Date.now();
    // The participants we invite go into `pendingPlayerIds` — we never
    // auto-accept them into `playerIds`. Each user gets a push that
    // links into the community-details "המתנה לאישור" flow on tap.
    const dedupedInvitees = Array.from(new Set(inviteUserIds.filter((u) => u !== callerUid)));
    await groupRef.update({
        name,
        normalizedName: name.toLowerCase().trim(),
        description: description.length > 0 ? description : null,
        rules: rules.length > 0 ? rules : null,
        contactPhone: contactPhone.length > 0 ? contactPhone : null,
        isOpen,
        city: city.length > 0 ? city : null,
        isPersonal: false,
        hidden: false,
        pendingPlayerIds: dedupedInvitees,
        promotedAt: now,
        ...(fromGameId ? { promotedFromGameId: fromGameId } : {}),
        updatedAt: now,
    });
    // ── Scope the new community's stats to the promoting game only ─────────
    // A user's one-off games ALL share one hidden personal group, so its
    // communityStats / communityPlayerStats commingle every one-off game's
    // goals + mini-games. When that group becomes a real community we reset
    // those aggregates to reflect ONLY the game it was created from — the
    // reported surprise of "a brand-new community already showing goals,
    // mini-games and a championship from games that aren't this one".
    // Per-GAME stats (gamePlayerStats) stay intact on every game.
    //
    // The app passes `fromGameId` (1.0.31+). Older clients don't, so we
    // derive it: the promote prompt fires right after a game ends, so the
    // group's most-recent finished game is the one being promoted. (Two
    // equality filters → no composite index; pick the max startsAt in code.)
    let effectiveFromGameId = fromGameId;
    if (!effectiveFromGameId) {
        try {
            const finished = await db
                .collection('games')
                .where('groupId', '==', groupId)
                .where('status', '==', 'finished')
                .get();
            let best = null;
            for (const d of finished.docs) {
                const sa = d.data().startsAt ?? 0;
                if (!best || sa > best.startsAt)
                    best = { id: d.id, startsAt: sa };
            }
            if (best)
                effectiveFromGameId = best.id;
        }
        catch (err) {
            console.error('[promoteOrphanToGroup] derive fromGame failed', groupId, err);
        }
    }
    if (effectiveFromGameId) {
        try {
            const [cpsSnap, gpsSnap, roundsSnap] = await Promise.all([
                db.collection('communityPlayerStats').where('groupId', '==', groupId).get(),
                db.collection('gamePlayerStats').where('gameId', '==', effectiveFromGameId).get(),
                db.collection('games').doc(effectiveFromGameId).collection('committedRounds').get(),
            ]);
            const keep = new Map();
            let totalGoals = 0;
            for (const d of gpsSnap.docs) {
                const x = d.data();
                if (!x.userId)
                    continue;
                const goals = x.goals ?? 0;
                const assists = x.assists ?? 0;
                const rounds = x.rounds ?? 0;
                const wins = x.wins ?? 0;
                const losses = x.losses ?? 0;
                // The community is created FROM this one game → games played = 1.
                keep.set(x.userId, { goals, assists, rounds, wins, losses, games: 1 });
                totalGoals += goals;
            }
            const batch = db.batch();
            // Drop every commingled row that doesn't belong to the promoting game.
            for (const d of cpsSnap.docs) {
                const x = d.data();
                if (x.userId && keep.has(x.userId))
                    continue;
                batch.delete(d.ref);
            }
            // Overwrite the kept players with EXACTLY this game's tally.
            for (const [uid, v] of keep) {
                batch.set(db.collection('communityPlayerStats').doc(`${groupId}__${uid}`), {
                    groupId,
                    userId: uid,
                    goals: v.goals,
                    assists: v.assists,
                    rounds: v.rounds,
                    wins: v.wins,
                    losses: v.losses,
                    games: v.games,
                    updatedAt: now,
                });
            }
            // Club totals = this game's mini-games (committed rounds) + goals.
            batch.set(db.collection('communityStats').doc(groupId), {
                groupId,
                rounds: roundsSnap.size,
                goals: totalGoals,
                updatedAt: now,
            });
            await batch.commit();
        }
        catch (err) {
            console.error('[promoteOrphanToGroup] stats reset failed', groupId, effectiveFromGameId, err);
        }
    }
    // Write the /groupsPublic mirror so the new community shows up in
    // discovery. Mirror the same shape the createGroup callable uses.
    await db
        .collection('groupsPublic')
        .doc(groupId)
        .set({
        name,
        normalizedName: name.toLowerCase().trim(),
        description: description.length > 0 ? description : null,
        city: city.length > 0 ? city : null,
        memberCount: Array.isArray(group.playerIds)
            ? group.playerIds.length
            : 1,
        isOpen,
        updatedAt: now,
        createdAt: now,
    }, { merge: true });
    // Send a per-recipient `groupInvitation` push. The CF helper
    // ensures dedupe and aggregation; failures don't block the
    // promotion.
    const inviter = await db.collection('users').doc(callerUid).get();
    const inviterName = (inviter.exists &&
        typeof inviter.data()?.name === 'string' &&
        inviter.data().name.slice(0, 60)) ||
        '';
    await Promise.allSettled(dedupedInvitees.map((recipientUid) => createNotificationOnce({
        type: 'groupInvitation',
        recipientId: recipientUid,
        payload: {
            groupId,
            groupName: name,
            inviterName,
            inviterId: callerUid,
        },
        createdByUid: callerUid,
    })));
    return { ok: true, invited: dedupedInvitees.length };
});
// ─── Scheduled: promote-prompt cron ─────────────────────────────────────
//
// Once an hour, scan for finished games hosted in a personal group
// whose creator hasn't yet been prompted to promote. The push is
// fire-and-forget — if the creator dismisses, the latch keeps it from
// re-firing. If the personal group has already been promoted (no
// longer `isPersonal: true`), we skip.
async function runSendPromotePrompts() {
    const now = Date.now();
    const lower = now - 6 * 60 * 60 * 1000; // 6h window — catch slow cron
    const upper = now - 30 * 60 * 1000; // wait 30m post-game so the
    // user isn't pinged mid-shower
    const snap = await db
        .collection('games')
        .where('status', '==', 'finished')
        .where('startsAt', '>=', lower)
        .where('startsAt', '<=', upper)
        .get();
    if (snap.empty) {
        console.log('[sendPromotePrompts] no candidates');
        return;
    }
    let dispatched = 0;
    for (const doc of snap.docs) {
        const g = doc.data();
        if (g.promotePromptSent)
            continue;
        if (!g.groupId || !g.createdBy)
            continue;
        if (g.isOrphanContext !== true)
            continue;
        // Verify the host group is still a personal one. If the user
        // already promoted it manually (or via this same cron racing
        // against itself), skip.
        const gSnap = await db.collection('groups').doc(g.groupId).get();
        if (!gSnap.exists)
            continue;
        const grp = gSnap.data();
        if (grp.isPersonal !== true)
            continue;
        try {
            await createNotificationOnce({
                type: 'promotePrompt',
                recipientId: g.createdBy,
                payload: {
                    gameId: doc.id,
                    groupId: g.groupId,
                    gameTitle: g.title || 'המשחק',
                },
            });
            await doc.ref.update({ promotePromptSent: true, updatedAt: now });
            dispatched += 1;
        }
        catch (err) {
            console.error('[sendPromotePrompts] dispatch failed', doc.id, err);
        }
    }
    console.log(`[sendPromotePrompts] dispatched ${dispatched}`);
}
// Random 6-char alphanumeric invite code. Mirror of the helper used by
// `createGroup` — duplicated locally to keep this section self-contained.
function randomInviteCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip ambiguous chars
    let out = '';
    for (let i = 0; i < 6; i++) {
        out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
}
// ─── Callable: create community (server-trusted rate limit) ─────────────
//
// Replaces the legacy client-side `groupService.createGroup` flow.
// The previous design enforced "5 community creates per user per day"
// via /rateLimits/{uid}_createGroup, but that doc was client-writable
// — a malicious client could overwrite the counter to bypass the cap
// (Security Audit Finding #3). This callable moves the entire flow to
// the server: rate-limit doc lives in /serverRateLimits/{rid}, which
// no client can read or write (rule denies all client access).
//
// The function:
//   1. Requires App Check + auth.
//   2. Rate-limits via Admin SDK transaction on /serverRateLimits.
//   3. Validates input shape + size caps.
//   4. Generates id + invite code server-side.
//   5. Writes /groups/{id} + /groupsPublic/{id} in a single batch.
//   6. Bumps the creator's `teamsCreated` achievement (cross-user-safe
//      via Admin SDK; client can't do this under hardened /users rules).
//
// Old clients still hit /groups directly — the rule keeps that path
// alive for backward compatibility. Once min-supported version
// includes the new client, lock down the rule and delete the legacy
// path.
const CREATE_GROUP_RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const CREATE_GROUP_RATE_CAP = 5;
function genInviteCode() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function normaliseGroupName(name) {
    return name.trim().toLowerCase();
}
function pickShortString(v, max, field, required) {
    if (v == null) {
        if (required) {
            throw new https_1.HttpsError('invalid-argument', `${field} is required`);
        }
        return undefined;
    }
    if (typeof v !== 'string') {
        throw new https_1.HttpsError('invalid-argument', `${field} must be a string`);
    }
    const trimmed = v.trim();
    if (required && trimmed.length === 0) {
        throw new https_1.HttpsError('invalid-argument', `${field} is required`);
    }
    if (trimmed.length > max) {
        throw new https_1.HttpsError('invalid-argument', `${field} too long (max ${max})`);
    }
    return trimmed.length > 0 ? trimmed : undefined;
}
/**
 * Upload a community cover photo on behalf of a group admin.
 *
 * Why a callable instead of a direct client Storage upload: the Storage
 * rule for `groups/{id}/cover.jpg` gated writes on
 * `firestore.get(...).adminIds`, but a cross-service read from a Storage
 * rule carries no App Check token — and this project enforces App Check
 * on Firestore — so the get() failed and even legitimate admins got
 * `storage/unauthorized`. Here we verify the admin with the Admin SDK
 * (which bypasses App Check) and write with the Admin SDK (which bypasses
 * Storage rules), then mint the standard Firebase download URL.
 *
 * Client sends the already-resized JPEG as base64 (~250 KB → ~340 KB
 * base64, well within the callable payload limit).
 */
exports.uploadGroupCover = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {});
    const groupId = typeof data.groupId === 'string' ? data.groupId : '';
    const imageBase64 = typeof data.imageBase64 === 'string' ? data.imageBase64 : '';
    const contentType = typeof data.contentType === 'string' ? data.contentType : 'image/jpeg';
    if (!groupId || !imageBase64) {
        throw new https_1.HttpsError('invalid-argument', 'groupId + imageBase64 required');
    }
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
        throw new https_1.HttpsError('invalid-argument', 'unsupported content type');
    }
    // Admin gate — Admin SDK read is not subject to App Check.
    const gSnap = await db.collection('groups').doc(groupId).get();
    if (!gSnap.exists) {
        throw new https_1.HttpsError('not-found', 'group not found');
    }
    const adminIds = gSnap.data()?.adminIds ?? [];
    if (!adminIds.includes(uid)) {
        throw new https_1.HttpsError('permission-denied', 'group admins only');
    }
    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
        throw new https_1.HttpsError('invalid-argument', 'image missing or too large');
    }
    const token = (0, crypto_1.randomUUID)();
    const bucket = admin.storage().bucket();
    const objectPath = `groups/${groupId}/cover.jpg`;
    const file = bucket.file(objectPath);
    try {
        await file.save(buffer, {
            contentType,
            resumable: false,
            metadata: {
                // This token is what makes the public download URL below work,
                // matching the format the client `getDownloadURL()` returns.
                metadata: { firebaseStorageDownloadTokens: token },
            },
        });
    }
    catch (err) {
        console.error('[uploadGroupCover] save failed', groupId, err);
        throw new https_1.HttpsError('internal', 'upload failed');
    }
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
        `${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    return { url };
});
exports.createGroupCallable = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign-in required');
    }
    const uid = auth.uid;
    // 1) Server-side rate limit. The doc lives in /serverRateLimits
    //    (deny-all from client) so a malicious client cannot reset
    //    the counter the way it could for /rateLimits.
    const rateRef = db
        .collection('serverRateLimits')
        .doc(`${uid}_createGroup`);
    const now = Date.now();
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(rateRef);
        const cur = snap.exists
            ? snap.data()
            : {};
        const windowStart = cur.windowStart ?? 0;
        const inWindow = now - windowStart < CREATE_GROUP_RATE_WINDOW_MS;
        const count = inWindow ? (cur.count ?? 0) : 0;
        if (count >= CREATE_GROUP_RATE_CAP) {
            throw new https_1.HttpsError('resource-exhausted', 'יצירת מועדונים מוגבלת ל-5 ביום. נסה שוב מאוחר יותר.');
        }
        tx.set(rateRef, {
            uid,
            op: 'createGroup',
            windowStart: inWindow ? windowStart : now,
            count: count + 1,
            updatedAt: now,
        });
    });
    // 2) Input validation. Server is the source of truth — client-side
    //    checks are nice-to-have but rules can't enforce length on the
    //    callable path. Slim shape per the new responsibility split.
    const input = (request.data ?? {});
    const name = pickShortString(input.name, 80, 'name', true);
    const description = pickShortString(input.description, 500, 'description', false);
    const city = pickShortString(input.city, 80, 'city', false);
    const contactPhone = pickShortString(input.contactPhone, 40, 'contactPhone', false);
    const rulesText = pickShortString(input.rules, 2000, 'rules', false);
    const maxMembers = typeof input.maxMembers === 'number' && input.maxMembers > 0
        ? Math.min(input.maxMembers, 1000)
        : undefined;
    const isOpen = input.isOpen === true;
    const internalRating = input.internalRating === true;
    // Only meaningful alongside internalRating — ratings become admin-private.
    const hideInternalRating = internalRating && input.hideInternalRating === true;
    // Per-community cards feature. Master switch + optional validity in days
    // (positive int; anything else = no expiry). Validity is preserved even
    // when cardsEnabled is false so re-enabling restores the prior config.
    const cardsEnabled = input.cardsEnabled === true;
    const sanitizeValidity = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
        ? Math.min(Math.floor(v), 3650)
        : null;
    const yellowCardValidityDays = sanitizeValidity(input.yellowCardValidityDays);
    const redCardValidityDays = sanitizeValidity(input.redCardValidityDays);
    // 3) Generate id + invite code. Server-controlled to prevent
    //    duplicate-code attacks (Audit Finding #2 / Sec #9 followup).
    const groupRef = db.collection('groups').doc();
    const groupId = groupRef.id;
    const createdAt = now;
    const groupDoc = {
        id: groupId,
        name,
        normalizedName: normaliseGroupName(name),
        creatorId: uid,
        adminIds: [uid],
        playerIds: [uid],
        pendingPlayerIds: [],
        inviteCode: genInviteCode(),
        isOpen,
        internalRating,
        hideInternalRating,
        createdAt,
        updatedAt: createdAt,
    };
    if (description !== undefined)
        groupDoc.description = description;
    if (city !== undefined)
        groupDoc.city = city;
    if (contactPhone !== undefined)
        groupDoc.contactPhone = contactPhone;
    if (rulesText !== undefined)
        groupDoc.rules = rulesText;
    if (maxMembers !== undefined)
        groupDoc.maxMembers = maxMembers;
    if (cardsEnabled)
        groupDoc.cardsEnabled = true;
    if (yellowCardValidityDays !== null)
        groupDoc.yellowCardValidityDays = yellowCardValidityDays;
    if (redCardValidityDays !== null)
        groupDoc.redCardValidityDays = redCardValidityDays;
    const publicDoc = {
        id: groupId,
        name,
        normalizedName: normaliseGroupName(name),
        memberCount: 1,
        isOpen,
        createdAt,
        updatedAt: createdAt,
    };
    if (description !== undefined)
        publicDoc.description = description;
    if (city !== undefined)
        publicDoc.city = city;
    if (contactPhone !== undefined)
        publicDoc.contactPhone = contactPhone;
    if (maxMembers !== undefined)
        publicDoc.maxMembers = maxMembers;
    // 4) Atomic dual-write of canonical + public projection.
    const batch = db.batch();
    batch.set(groupRef, groupDoc);
    batch.set(db.collection('groupsPublic').doc(groupId), publicDoc);
    await batch.commit();
    // 5) Bump teamsCreated achievement (server-only path; the
    //    hardened /users rules block this from the client when it
    //    would target someone other than self, so doing it here keeps
    //    counters honest no matter how the user reached this code
    //    path).
    try {
        await db.collection('users').doc(uid).set({
            achievements: {
                teamsCreated: admin.firestore.FieldValue.increment(1),
            },
            updatedAt: now,
        }, { merge: true });
    }
    catch (err) {
        console.warn('[createGroupCallable] teamsCreated bump failed', err);
    }
    return { ok: true, groupId };
});
// ─── One-shot migration: backfill creatorId on legacy /groups ──────────
//
// The hardened /groups update rule (Security Audit Finding #16) now
// REQUIRES creatorId in resource.data on every admin update. Legacy
// groups created before the field existed would be locked out of all
// admin operations until creatorId is filled in.
//
// This callable is admin-gated (matan only) and idempotent: it scans
// every /groups doc and, for any that's missing creatorId, sets it to
// the first entry of adminIds. Safe to re-run.
//
// Run once (post-deploy) by invoking via httpsCallable from a trusted
// client, then leave deployed for emergency re-runs.
exports.backfillGroupCreatorIdsOnce = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const ALLOWED_UID = '1IdtNEjbEXfiRSqvLrJVn99NsfI2'; // matan
    if (request.auth?.uid !== ALLOWED_UID) {
        throw new https_1.HttpsError('permission-denied', 'admin only');
    }
    const snap = await db.collection('groups').get();
    let touched = 0;
    let skipped = 0;
    let failed = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        if (typeof data.creatorId === 'string' && data.creatorId.length > 0) {
            skipped += 1;
            continue;
        }
        const fallback = Array.isArray(data.adminIds) && data.adminIds.length > 0
            ? data.adminIds[0]
            : null;
        if (!fallback) {
            // No adminIds either — orphan doc, nothing safe to set.
            failed += 1;
            continue;
        }
        try {
            await doc.ref.update({
                creatorId: fallback,
                updatedAt: Date.now(),
            });
            touched += 1;
        }
        catch (err) {
            console.warn('[backfillGroupCreatorIdsOnce] update failed', doc.id, err);
            failed += 1;
        }
    }
    return {
        ok: true,
        total: snap.size,
        touched,
        skipped,
        failed,
    };
});
async function issueDisciplineCard(uid, input) {
    if (!uid)
        return;
    const userRef = db.collection('users').doc(uid);
    const event = {
        id: `disc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: uid,
        type: input.type,
        reason: input.reason,
        gameId: input.gameId,
        createdAt: Date.now(),
    };
    // Append the event + bump the matching counter atomically. Use a
    // transaction so the events array doesn't race with concurrent
    // marks (e.g. admin sets late, then immediately bumps to no_show).
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const data = (snap.exists ? snap.data() : {});
        const cur = data.discipline ?? {};
        const events = Array.isArray(cur.events) ? cur.events : [];
        // Idempotency: don't double-issue for the same (uid, gameId, reason).
        if (input.gameId &&
            events.some((e) => e.gameId === input.gameId && e.reason === input.reason)) {
            return;
        }
        const yellowCards = (cur.yellowCards ?? 0) + (input.type === 'yellow' ? 1 : 0);
        const redCards = (cur.redCards ?? 0) + (input.type === 'red' ? 1 : 0);
        tx.set(userRef, {
            discipline: {
                yellowCards,
                redCards,
                events: [...events, event],
            },
            updatedAt: Date.now(),
        }, { merge: true });
    });
}
async function recomputeCommunityShowcase(groupId, preloaded) {
    if (!groupId)
        return;
    // 1) Canonical group doc — reuse the trigger's already-loaded snapshot
    //    when given (saves one read per fire), else fetch. If missing, the
    //    community has been deleted: tear down the showcase mirror.
    const groupSnap = preloaded ?? (await db.collection('groups').doc(groupId).get());
    if (!groupSnap.exists) {
        try {
            await db.collection('communityShowcase').doc(groupId).delete();
        }
        catch (err) {
            console.warn('[updateCommunityShowcase] showcase teardown failed', groupId, err);
        }
        return;
    }
    const group = groupSnap.data();
    // 2) Terminal games for this community. Mirrors the in-app
    //    getCommunityStats query (status in [finished, cancelled],
    //    ordered desc, capped at 200).
    const gamesSnap = await db
        .collection('games')
        .where('groupId', '==', groupId)
        .where('status', 'in', ['finished', 'cancelled'])
        .orderBy('startsAt', 'desc')
        .limit(200)
        .get();
    const now = Date.now();
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    let totalFinished = 0;
    let totalCancelled = 0;
    let attendanceSum = 0;
    let thisMonthGames = 0;
    const attendedTally = {};
    const activeMonth = new Set();
    const activeYear = new Set();
    const recentGamesRaw = [];
    for (const doc of gamesSnap.docs) {
        const g = doc.data();
        const status = g.status === 'cancelled' ? 'cancelled' : 'finished';
        if (status === 'cancelled') {
            totalCancelled += 1;
        }
        else {
            totalFinished += 1;
        }
        const startsAt = typeof g.startsAt === 'number' ? g.startsAt : null;
        if (status === 'finished' && startsAt !== null && startsAt >= monthAgo) {
            thisMonthGames += 1;
        }
        let attendedHere = 0;
        if (status === 'finished') {
            const arrivals = g.arrivals ?? {};
            const players = Array.isArray(g.players) ? g.players : [];
            const within30 = startsAt !== null && startsAt >= monthAgo;
            const within365 = startsAt !== null && startsAt >= yearAgo;
            for (const uid of players) {
                if (arrivals[uid] === 'no_show')
                    continue;
                attendedHere += 1;
                attendedTally[uid] = (attendedTally[uid] ?? 0) + 1;
                if (within30)
                    activeMonth.add(uid);
                if (within365)
                    activeYear.add(uid);
            }
            attendanceSum += attendedHere;
        }
        if (recentGamesRaw.length < 8) {
            recentGamesRaw.push({
                id: doc.id,
                title: g.title ?? '',
                startsAt,
                fieldName: g.fieldName ?? null,
                status,
                attendedCount: attendedHere,
            });
        }
    }
    const organizationRatePct = totalFinished + totalCancelled > 0
        ? Math.round((totalFinished / (totalFinished + totalCancelled)) * 100)
        : 0;
    const avgAttendance = totalFinished > 0
        ? Math.round((attendanceSum / totalFinished) * 10) / 10
        : 0;
    // 3) Hydrate users for top attenders + members. We cap the hydration
    //    set so a community with 500 members doesn't blow up the read
    //    budget on every recompute — the page renders the first 50
    //    members alphabetically, plus the top-5 attenders, and that's it.
    const playerIds = Array.isArray(group.playerIds) ? group.playerIds : [];
    const adminIds = Array.isArray(group.adminIds) ? group.adminIds : [];
    const adminSet = new Set(adminIds);
    const memberIds = Array.from(new Set([...playerIds, ...adminIds]));
    const topUidsRanked = Object.entries(attendedTally)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([uid]) => uid);
    const memberSlice = memberIds.slice(0, 50);
    const hydrateSet = new Set([...memberSlice, ...topUidsRanked]);
    const hydrateIds = Array.from(hydrateSet);
    const userByUid = {};
    // Firestore `getAll` with up to 500 refs is one round-trip — cheaper
    // than N separate gets. We chunk to be safe.
    const chunkSize = 100;
    for (let i = 0; i < hydrateIds.length; i += chunkSize) {
        const chunk = hydrateIds.slice(i, i + chunkSize);
        if (chunk.length === 0)
            continue;
        const refs = chunk.map((uid) => db.collection('users').doc(uid));
        const snaps = await db.getAll(...refs);
        for (const s of snaps) {
            if (!s.exists)
                continue;
            const d = s.data();
            userByUid[s.id] = {
                name: d.name,
                photoUrl: d.photoUrl ?? null,
                avatarId: d.avatarId ?? null,
                createdAt: typeof d.createdAt === 'number' ? d.createdAt : undefined,
            };
        }
    }
    const topAttenders = topUidsRanked.map((uid) => {
        const u = userByUid[uid] ?? {};
        const games = attendedTally[uid] ?? 0;
        const pct = totalFinished > 0 ? Math.round((games / totalFinished) * 100) : 0;
        return {
            uid,
            name: u.name || 'שחקן',
            photoUrl: u.photoUrl ?? null,
            avatarId: u.avatarId ?? null,
            gamesPlayed: games,
            attendancePct: pct,
        };
    });
    const members = memberSlice.map((uid) => {
        const u = userByUid[uid] ?? {};
        const games = attendedTally[uid] ?? 0;
        return {
            uid,
            name: u.name || 'שחקן',
            photoUrl: u.photoUrl ?? null,
            avatarId: u.avatarId ?? null,
            isAdmin: adminSet.has(uid),
            joinedAt: u.createdAt ?? null,
            gamesPlayed: games,
        };
    });
    // Show admins first, then by gamesPlayed desc.
    members.sort((a, b) => {
        if (a.isAdmin !== b.isAdmin)
            return a.isAdmin ? -1 : 1;
        return (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0);
    });
    const recentGames = recentGamesRaw.slice(0, 5);
    const showcase = {
        groupId,
        name: group.name ?? 'מועדון',
        description: group.description ?? null,
        city: group.city ?? null,
        fieldName: group.fieldName ?? null,
        fieldAddress: group.fieldAddress ?? null,
        isOpen: !!group.isOpen,
        foundedAt: group.createdAt ?? now,
        totalGamesFinished: totalFinished,
        totalGamesCancelled: totalCancelled,
        organizationRatePct,
        thisMonthGames,
        avgAttendance,
        totalMembers: memberIds.length,
        activeMembersThisMonth: activeMonth.size,
        activeMembersThisYear: activeYear.size,
        topAttenders,
        recentGames,
        members,
        updatedAt: now,
    };
    await db
        .collection('communityShowcase')
        .doc(groupId)
        .set(showcase, { merge: false });
}
/**
 * Recompute the public showcase whenever a /groups doc changes.
 * Every metadata edit (rename, description tweak, city, etc.) and
 * every membership change affects the rendered page.
 */
// Only these group fields affect the rendered showcase. Membership churn that
// doesn't touch them (pendingPlayerIds, notifiedMilestones, updatedAt, …) must
// NOT trigger a full rebuild — each rebuild is ~50-255 reads, and sibling
// triggers (milestones, pending) write the group doc, so an unguarded rebuild
// cascades. Created/deleted always recompute.
const SHOWCASE_GROUP_FIELDS = [
    'name', 'description', 'city', 'fieldName', 'fieldAddress',
    'isOpen', 'playerIds', 'adminIds', 'createdAt',
];
function showcaseGroupFieldsChanged(before, after) {
    return SHOWCASE_GROUP_FIELDS.some((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
}
exports.updateShowcaseOnGroupChange = (0, firestore_1.onDocumentWritten)('groups/{groupId}', async (event) => {
    const groupId = event.params.groupId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    // Recompute only when a showcase-relevant field changed, or on
    // create/delete. Skips the cascade from pending/milestone/updatedAt writes.
    if (before && after && !showcaseGroupFieldsChanged(before, after))
        return;
    try {
        await recomputeCommunityShowcase(groupId, event.data?.after);
    }
    catch (err) {
        console.warn('[updateShowcaseOnGroupChange] recompute failed', groupId, err);
    }
});
/**
 * Recompute the public showcase whenever a /games doc changes its
 * terminal state. We narrow the trigger to writes that flip the game
 * INTO finished/cancelled, or edit a game that's already terminal —
 * mid-flow writes (open → locked → active) don't change any showcase
 * field, so re-running the aggregation on every roster join would be
 * wasteful (a popular community can see hundreds of joins/cancels per
 * week per game).
 */
exports.updateShowcaseOnGameChange = (0, firestore_1.onDocumentWritten)('games/{gameId}', async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const groupId = (after?.groupId || before?.groupId || '');
    if (!groupId)
        return;
    const beforeTerminal = before?.status === 'finished' || before?.status === 'cancelled';
    const afterTerminal = after?.status === 'finished' || after?.status === 'cancelled';
    // Only recompute when the doc is/was terminal — that's the only
    // shape that contributes to showcase aggregates.
    if (!beforeTerminal && !afterTerminal)
        return;
    try {
        await recomputeCommunityShowcase(groupId);
    }
    catch (err) {
        console.warn('[updateShowcaseOnGameChange] recompute failed', groupId, err);
    }
});
// ─── SSR for community pages — share-preview support ────────────────
//
// Open Graph crawlers (WhatsApp, Facebook, Twitter) DO NOT execute
// JavaScript. They read the raw HTML, grab <title> + the og:* meta
// tags, and that's it. Without server-side rendering every share
// preview shows our static fallback ("קהילה ב־Teamder") regardless of
// which community was shared — defeating the whole point of a
// shareable link.
//
// This function rewrites /c/** at the Hosting layer: it reads the
// pre-built /functions/templates/community.html (copy of public/c/
// index.html, kept in sync via predeploy script), fetches the
// /communityShowcase doc, and injects the community name +
// description into <title>, og:title, og:description, twitter:title,
// twitter:description, AND a JSON-LD blob.
//
// Cache-Control sends a 5-minute browser cache + 10-minute CDN cache
// so the function isn't re-invoked on every refresh. Stale share
// previews are acceptable; the cost of always-fresh rendering is
// not.
//
// The JS in the page itself still runs and overrides document.title /
// og:title once the showcase loads — this just guarantees crawlers
// (which never run that JS) see the right values.
const COMMUNITY_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'community.html');
const INVITE_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'invite.html');
const templateCache = {};
function loadTemplate(filePath) {
    if (templateCache[filePath])
        return templateCache[filePath];
    templateCache[filePath] = fs.readFileSync(filePath, 'utf8');
    return templateCache[filePath];
}
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
async function loadShowcaseSummary(groupId) {
    try {
        // Two parallel reads — showcase (name/desc/city/counts) + the raw
        // group doc (cover). Both cached for 5-10min downstream so this
        // doesn't run on every share-link click.
        const [showSnap, groupSnap] = await Promise.all([
            db.collection('communityShowcase').doc(groupId).get(),
            db.collection('groups').doc(groupId).get(),
        ]);
        if (!showSnap.exists)
            return null;
        const d = showSnap.data();
        const name = typeof d.name === 'string' ? d.name : '';
        if (!name)
            return null;
        const groupData = groupSnap.exists
            ? groupSnap.data()
            : {};
        const cover = typeof groupData.coverPhotoUrl === 'string'
            ? groupData.coverPhotoUrl
            : null;
        return {
            name,
            description: typeof d.description === 'string' ? d.description : null,
            city: typeof d.city === 'string' ? d.city : null,
            totalGamesFinished: typeof d.totalGamesFinished === 'number'
                ? d.totalGamesFinished
                : 0,
            totalMembers: typeof d.totalMembers === 'number' ? d.totalMembers : 0,
            coverPhotoUrl: cover,
        };
    }
    catch (err) {
        console.warn('[serveCommunityPage] showcase fetch failed', groupId, err);
        return null;
    }
}
function buildMetaBlock(summary) {
    if (!summary) {
        return {
            title: 'מועדון ב־Teamder',
            description: 'צפו בסטטיסטיקות המועדון, השחקנים הכי נאמנים, והמשחקים האחרונים.',
        };
    }
    const title = `${summary.name} · Teamder`;
    let description;
    if (summary.description && summary.description.trim().length > 0) {
        description = summary.description.trim();
    }
    else {
        const parts = [];
        if (summary.city)
            parts.push(summary.city);
        parts.push(`${summary.totalGamesFinished} משחקים`);
        parts.push(`${summary.totalMembers} חברי סגל`);
        description = `מועדון כדורגל ב־Teamder · ${parts.join(' · ')}`;
    }
    return { title, description };
}
function injectMeta(html, title, description, imageUrl) {
    const safeTitle = escapeHtml(title);
    const safeDesc = escapeHtml(description);
    const safeImage = imageUrl ? escapeHtml(imageUrl) : null;
    let out = html;
    // <title> — a single replacement on the literal default works because
    // the static template has exactly one <title> tag.
    out = out.replace(/<title>[^<]*<\/title>/, `<title>${safeTitle}</title>`);
    // <meta name="description"> — page-level description (used by Google +
    // some link-preview crawlers as a fallback when og:description is
    // missing).
    out = out.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${safeDesc}" />`);
    // og:title / og:description / twitter:* — replace the static
    // defaults the crawlers see.
    out = out.replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${safeTitle}" />`);
    out = out.replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${safeDesc}" />`);
    // og:image / twitter:image — the community's cover photo so the
    // WhatsApp / Telegram preview card shows the actual group image
    // instead of the generic Teamder logo. Only rewritten when we
    // have a URL — the static fallback to /logo.png stays for groups
    // without a cover.
    if (safeImage) {
        out = out.replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${safeImage}" />`);
        out = out.replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:image" content="${safeImage}" />`);
    }
    // twitter:title / twitter:description if present (invite.html has
    // them; community.html relies on og:* fallback).
    out = out.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${safeTitle}" />`);
    out = out.replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${safeDesc}" />`);
    return out;
}
exports.serveCommunityPage = (0, https_1.onRequest)({ region: 'us-central1', memory: '256MiB' }, async (req, res) => {
    try {
        // Hosting forwards the original path verbatim. We support TWO
        // route families that both need SSR OG injection:
        //   /c/{groupId}    → community showcase (full stats page)
        //   /team/{groupId} → invite landing (open-in-app / install card)
        // The template differs, the OG injection logic is shared.
        const raw = (req.path || '').replace(/^\/+/, '');
        const parts = raw.split('/').filter(Boolean);
        const isInvite = parts[0] === 'team';
        const groupId = parts[0] === 'c' || parts[0] === 'team'
            ? parts[1] || ''
            : parts[0] || '';
        const html = loadTemplate(isInvite ? INVITE_TEMPLATE_PATH : COMMUNITY_TEMPLATE_PATH);
        let summary = null;
        if (groupId) {
            summary = await loadShowcaseSummary(groupId);
        }
        const { title, description } = buildMetaBlock(summary);
        const rendered = injectMeta(html, title, description, summary?.coverPhotoUrl ?? null);
        // 5min browser, 10min edge cache. Hosting-side CDN keys on the
        // full URL, so each /c/{id} caches independently. When a
        // community renames itself the CF re-runs after the cache
        // expires — acceptable lag for share previews.
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
        res.status(200).send(rendered);
    }
    catch (err) {
        console.error('[serveCommunityPage] render failed', err);
        // Best-effort fallback: serve the static template untouched so
        // the user still sees the page; crawlers fall back to the static
        // OG tags for this one request.
        try {
            res.set('Content-Type', 'text/html; charset=utf-8');
            const fallbackPath = (req.path || '').startsWith('/team')
                ? INVITE_TEMPLATE_PATH
                : COMMUNITY_TEMPLATE_PATH;
            res.status(200).send(loadTemplate(fallbackPath));
        }
        catch {
            res.status(500).send('internal error');
        }
    }
});
async function revokeDisciplineCardsFor(uid, gameId) {
    if (!uid || !gameId)
        return;
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists)
            return;
        const data = snap.data();
        const cur = data.discipline ?? {};
        const events = Array.isArray(cur.events) ? cur.events : [];
        const remaining = events.filter((e) => e.gameId !== gameId);
        if (remaining.length === events.length)
            return;
        const removed = events.filter((e) => e.gameId === gameId);
        const yellowDelta = removed.filter((e) => e.type === 'yellow').length;
        const redDelta = removed.filter((e) => e.type === 'red').length;
        tx.set(userRef, {
            discipline: {
                yellowCards: Math.max(0, (cur.yellowCards ?? 0) - yellowDelta),
                redCards: Math.max(0, (cur.redCards ?? 0) - redDelta),
                events: remaining,
            },
            updatedAt: Date.now(),
        }, { merge: true });
    });
}
// ─── Cross-community filler matching (Phase 1) ─────────────────────────
//
// Three Cloud Functions implement the flow:
//
//   1. `findFillerCandidates` — scheduled, every 30 min. Scans games
//      whose `acceptsFillers === true` and roster is below the
//      shortage threshold (minPlayers OR 80% of maxPlayers). Pushes
//      `fillerOpportunity` notifications to up to 10 candidate users
//      who match the game's city, opted into filler push, and clear
//      the configured min trust score. Tracks who got pushed in
//      `game.fillerPushHistory` to avoid duplicates. If 0 candidates
//      pass the filter, falls back to a `fillerNoCandidates` push to
//      the admin (latched at 6h to avoid spam).
//
//   2. `onFillerInterestCreated` — trigger on
//      `/games/{id}/fillerInterests/{uid}` doc creation. The
//      candidate tapped "מעוניין" on the opportunity push; this CF
//      pushes `fillerInterestReceived` to the game admin so they can
//      open the candidate's profile and approve / reject manually.
//
//   3. `computeTrustScoreServerSide` — Admin-SDK-side mirror of the
//      client's `trustService.getSummary`. Reads the user's recent
//      games + applies the same formula. Internal helper, not
//      exported.
const FILLER_HOUR_MS = 60 * 60 * 1000;
const FILLER_DAY_MS = 24 * FILLER_HOUR_MS;
/** Window the matcher considers: kickoff is 3-12h away. */
const FILLER_WINDOW_EARLIEST_HOURS = 3;
const FILLER_WINDOW_LATEST_HOURS = 12;
/** Max candidates pushed per game per matcher run. */
const FILLER_PUSH_LIMIT_PER_GAME = 10;
/** Latch on the "no candidates" fallback push so we don't spam the
 *  admin every 30 minutes. */
const FILLER_NO_CANDIDATES_COOLDOWN_MS = 6 * FILLER_HOUR_MS;
const TRUST_WINDOW_MS = 90 * FILLER_DAY_MS;
const TRUST_MIN_GAMES = 3;
const TRUST_SOFT_PENALTY = 3;
const TRUST_HARD_PENALTY = 10;
/**
 * Server-side mirror of `trustService.computeTrustFromGames`. Loads
 * the user's last-90-days games and computes the 0-100 score (or
 * `null` if the user has too few games to be meaningful). The
 * formula MUST stay aligned with the client implementation —
 * otherwise users see a different number on their own profile vs
 * what the matcher uses to filter them.
 */
async function computeTrustScoreServerSide(uid) {
    if (!uid)
        return null;
    const now = Date.now();
    const cutoff = now - TRUST_WINDOW_MS;
    const snap = await db
        .collection('games')
        .where('participantIds', 'array-contains', uid)
        .where('startsAt', '>=', cutoff)
        .get();
    let registered = 0;
    let attended = 0;
    let softCancels = 0;
    let hardCancels = 0;
    for (const doc of snap.docs) {
        const g = doc.data();
        if (g.status !== 'finished' && g.status !== 'cancelled')
            continue;
        const startsAt = typeof g.startsAt === 'number' ? g.startsAt : 0;
        if (startsAt >= now)
            continue;
        const cancelTs = g.cancellations?.[uid];
        if (typeof cancelTs === 'number') {
            const deadline = typeof g.cancelDeadlineHours === 'number'
                ? startsAt - g.cancelDeadlineHours * FILLER_HOUR_MS
                : null;
            if (deadline !== null && cancelTs > deadline) {
                hardCancels += 1;
            }
            else {
                softCancels += 1;
            }
            continue;
        }
        if (g.status !== 'finished')
            continue;
        if (!(g.players ?? []).includes(uid))
            continue;
        registered += 1;
        if (g.arrivals?.[uid] !== 'no_show')
            attended += 1;
    }
    if (registered < TRUST_MIN_GAMES)
        return null;
    const rate = attended / registered;
    return Math.max(0, Math.min(100, Math.round(rate * 100) -
        softCancels * TRUST_SOFT_PENALTY -
        hardCancels * TRUST_HARD_PENALTY));
}
// ── Geocoding helpers ─────────────────────────────────────────────
//
// Server-side equivalent of the client's geocodeService — used by
// the matcher to resolve a game's city to lat/lng. Cached in
// /cityGeocode/{normName} so we hit Nominatim at most once per
// distinct city across all matcher runs (~250 Israeli cities, so
// the cache fills fast and stays small).
//
// `null` propagates when Nominatim has no hit; matcher then falls
// back to an exact-name comparison for that game.
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'Teamder/1.0 (studiogameslime@gmail.com)';
function normaliseCityKey(name) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[\s ]+/g, '-') // collapse all whitespace into '-'
        .replace(/-+/g, '-'); // collapse runs of '-'
}
async function getCityCoords(city) {
    const trimmed = city.trim();
    if (!trimmed)
        return null;
    const key = normaliseCityKey(trimmed);
    if (!key)
        return null;
    // Cache hit: read fast path.
    try {
        const cacheRef = db.collection('cityGeocode').doc(key);
        const snap = await cacheRef.get();
        if (snap.exists) {
            const d = snap.data();
            if (d.notFound)
                return null;
            if (typeof d.lat === 'number' && typeof d.lng === 'number') {
                return { lat: d.lat, lng: d.lng };
            }
        }
    }
    catch (err) {
        console.warn('[getCityCoords] cache read failed', city, err);
    }
    // Cache miss → Nominatim.
    let coords = null;
    try {
        const url = `${NOMINATIM_BASE}` +
            `?q=${encodeURIComponent(trimmed)}` +
            `&format=json&limit=1&countrycodes=il`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': NOMINATIM_USER_AGENT,
                Accept: 'application/json',
            },
        });
        if (res.ok) {
            const data = (await res.json());
            const hit = Array.isArray(data) ? data[0] : null;
            const lat = hit?.lat ? parseFloat(hit.lat) : NaN;
            const lng = hit?.lon ? parseFloat(hit.lon) : NaN;
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                coords = { lat, lng };
            }
        }
    }
    catch (err) {
        console.warn('[getCityCoords] Nominatim fetch failed', city, err);
    }
    // Persist outcome (positive AND negative) so we don't re-query
    // unknown names on every run.
    try {
        await db
            .collection('cityGeocode')
            .doc(key)
            .set(coords
            ? {
                originalName: trimmed,
                lat: coords.lat,
                lng: coords.lng,
                fetchedAt: Date.now(),
            }
            : {
                originalName: trimmed,
                notFound: true,
                fetchedAt: Date.now(),
            }, { merge: true });
    }
    catch (err) {
        console.warn('[getCityCoords] cache write failed', city, err);
    }
    return coords;
}
/**
 * Great-circle distance between two lat/lng points on Earth, in
 * kilometres. Standard Haversine — accurate to ~0.5% for distances
 * under a few thousand km, which covers any conceivable
 * football-radius use case in Israel.
 */
function haversineKm(a, b) {
    const R = 6371; // Earth radius (km)
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x = Math.sin(dLat / 2) ** 2 +
        Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
async function runFindFillerCandidates() {
    const now = Date.now();
    const earliest = now + FILLER_WINDOW_EARLIEST_HOURS * FILLER_HOUR_MS;
    const latest = now + FILLER_WINDOW_LATEST_HOURS * FILLER_HOUR_MS;
    // Pull all `open` games whose kickoff falls in the matcher
    // window. Filter `acceptsFillers` in code (Firestore can't
    // combine inequality on startsAt with equality on
    // acceptsFillers without a composite index — keeping the query
    // simple and filtering client-side avoids index pressure for
    // the MVP).
    const snap = await db
        .collection('games')
        .where('status', '==', 'open')
        .where('startsAt', '>=', earliest)
        .where('startsAt', '<=', latest)
        .get();
    let processed = 0;
    let pushed = 0;
    let fallbackPushed = 0;
    // Candidate pool is identical for every game in this run — load it AT MOST
    // ONCE (lazily, only when the first shortage game needs it) and reuse, instead
    // of re-scanning the users collection per game. If no game reaches the
    // candidate stage, the users collection is never read.
    let candidateDocs = null;
    for (const doc of snap.docs) {
        const game = doc.data();
        if (game.acceptsFillers !== true)
            continue;
        const players = game.players ?? [];
        const maxPlayers = game.maxPlayers ?? 0;
        if (maxPlayers <= 0)
            continue;
        if (players.length >= maxPlayers)
            continue; // already full
        // Shortage threshold:
        //  • if `minPlayers` set: shortage when players < minPlayers
        //  • else: shortage when players < 80% of maxPlayers
        const threshold = typeof game.minPlayers === 'number' && game.minPlayers > 0
            ? game.minPlayers
            : Math.floor(maxPlayers * 0.8);
        if (players.length >= threshold)
            continue;
        processed += 1;
        // Matcher key is the STRICT `game.city` field (picked from
        // autocomplete in the wizard). The free-text `game.fieldAddress`
        // is street/landmark detail and would feed garbage to the
        // distance computation, so we deliberately don't fall back to it.
        // Legacy games without `city` are skipped — admin should re-edit
        // through the wizard to populate the strict field.
        const city = typeof game.city === 'string' ? game.city.trim() : '';
        if (!city)
            continue;
        // Geocode the game's city ONCE per matcher run (cached in
        // /cityGeocode/{normName}). Without coords we can't compute
        // distance to candidates — fall back to a name-equality match
        // so the user still gets some coverage.
        const gameCoords = await getCityCoords(city);
        // Candidate query: opted-in users only — loaded once per run and reused
        // across all shortage games (see candidateDocs above). The pool is small
        // (only users who toggled on `acceptsFillerPush`), so filtering by distance
        // in code is cheaper than a geo index for the MVP.
        if (!candidateDocs) {
            candidateDocs = (await db
                .collection('users')
                .where('availability.acceptsFillerPush', '==', true)
                .get()).docs;
        }
        // Exclude users already in the community or game.
        let memberSet = new Set();
        if (game.groupId) {
            const gSnap = await db
                .collection('groups')
                .doc(game.groupId)
                .get();
            if (gSnap.exists) {
                const grp = gSnap.data();
                memberSet = new Set([
                    ...(grp.playerIds ?? []),
                    ...(grp.adminIds ?? []),
                    ...(grp.pendingPlayerIds ?? []),
                ]);
            }
        }
        const inGame = new Set([
            ...(game.players ?? []),
            ...(game.waitlist ?? []),
            ...(game.pending ?? []),
        ]);
        const alreadyPushed = game.fillerPushHistory ?? {};
        const newlyPushed = {};
        let pushesThisGame = 0;
        for (const userDoc of candidateDocs) {
            if (pushesThisGame >= FILLER_PUSH_LIMIT_PER_GAME)
                break;
            const uid = userDoc.id;
            if (memberSet.has(uid))
                continue;
            if (inGame.has(uid))
                continue;
            if (alreadyPushed[uid])
                continue;
            // Geographic gate — distance from user's home city to the
            // game's city must be within the user's chosen radius.
            // Strict graceful-degradation policy:
            //   • both have coords → Haversine, compare to radius
            //   • either is missing coords → fall back to name match
            //     (user.homeCity === game.city). This covers the period
            //     before geocoding has populated, and unknown cities.
            const userData = userDoc.data();
            const av = userData.availability ?? {};
            const userCity = av.homeCity ?? av.preferredCity ?? av.cities?.[0];
            if (!userCity)
                continue;
            const radiusKm = typeof av.availabilityRadiusKm === 'number' &&
                av.availabilityRadiusKm > 0
                ? av.availabilityRadiusKm
                : 20;
            let withinRange = false;
            if (gameCoords &&
                typeof av.homeCityLat === 'number' &&
                typeof av.homeCityLng === 'number') {
                const distKm = haversineKm({ lat: av.homeCityLat, lng: av.homeCityLng }, gameCoords);
                withinRange = distKm <= radiusKm;
            }
            else {
                // Fallback: treat exact city-name equality as "in range".
                withinRange =
                    normaliseCityKey(userCity) === normaliseCityKey(city);
            }
            if (!withinRange)
                continue;
            // (Trust filtering removed — candidates are matched purely by
            // availability + geography now. Trust is still computed
            // elsewhere but no longer gates the filler pool.)
            // Dispatch the opportunity notification. Recipient = uid,
            // single-recipient delivery via the existing
            // onNotificationCreated pipeline.
            await createNotificationOnce({
                type: 'fillerOpportunity',
                recipientId: uid,
                payload: {
                    gameId: doc.id,
                    groupId: game.groupId,
                    gameTitle: game.title,
                    startsAt: game.startsAt,
                    city,
                    // Open spots until the game is FULL (maxPlayers − registered), e.g.
                    // 10/15 → 5. NOT `threshold − players` (threshold is the shortage
                    // trigger = minPlayers or 80%, which overstated the gap).
                    shortBy: maxPlayers - players.length,
                },
            });
            newlyPushed[uid] = now;
            pushesThisGame += 1;
            pushed += 1;
        }
        if (pushesThisGame > 0) {
            // Persist the dedup history so the next run doesn't re-push
            // the same candidate. Merge with the existing map.
            const pushedUids = Object.keys(newlyPushed);
            await doc.ref.set({
                fillerPushHistory: { ...alreadyPushed, ...newlyPushed },
                // Grant each pushed candidate PERMANENT read access to this game —
                // the games read rule honours `invitedUserIds`, so tapping the
                // fillerOpportunity push always reaches the "הגש מועמדות" CTA, even
                // if `acceptsFillers` later toggles off (game filled / started).
                // Without this the push dead-ended on the "משחק לסגל בלבד" wall
                // (Pulse feat-1).
                ...(pushedUids.length
                    ? {
                        invitedUserIds: admin.firestore.FieldValue.arrayUnion(...pushedUids),
                    }
                    : {}),
                updatedAt: now,
            }, { merge: true });
        }
        // (No "no candidates" admin push anymore — without a trust filter
        // there's no threshold for the admin to lower, so the fallback
        // notification was removed.)
    }
    console.log(`[findFillerCandidates] scanned ${snap.size} games, processed ${processed} shortage games, pushed ${pushed} opportunities, ${fallbackPushed} fallback admin pushes`);
}
// ─── Scheduled: admin shortage warning (T-2h) ──────────────────────────
//
// Fires once per game at roughly 2 hours before kickoff, when the
// registered roster can't even fill TWO teams in the chosen format
// (5v5 → < 10, 6v6 → < 12, 7v7 → < 14). The admin gets a single push
// and decides whether to cancel, hunt for more players, or run the
// game short-handed. Replaces the previous auto-cancel + fan-out flow
// which surfaced as a misleading "המשחק בוטל" push to every player.
//
// Gate:
//   • game.status === 'open'
//   • startsAt within [now+T-2h-window-low, now+T-2h-window-high]
//   • players + guests < 2 × playersPerTeam(format)
//   • !game.shortageWarningSentAt  (per-game latch)
//
// Recipient: game.createdBy (the organizer). Community admins don't
// get this — only the person who scheduled the game has the context
// to decide. The 12h cooldown in COOLDOWN_MS plus the per-game latch
// makes a re-fire impossible within the same kickoff window even if
// the function retries.
//
// Cadence: every 15 minutes. Window is [T-130min, T-110min] so the
// cron is guaranteed to catch each game exactly once across the
// 15-minute schedule (≥ 20-min window absorbs scheduler drift).
const SHORTAGE_WINDOW_EARLIEST_MIN = 110;
const SHORTAGE_WINDOW_LATEST_MIN = 130;
function playersPerTeamForFormat(format) {
    if (format === '4v4')
        return 4;
    if (format === '6v6')
        return 6;
    if (format === '7v7')
        return 7;
    return 5;
}
async function runSendShortageWarnings() {
    const now = Date.now();
    const earliest = now + SHORTAGE_WINDOW_EARLIEST_MIN * 60 * 1000;
    const latest = now + SHORTAGE_WINDOW_LATEST_MIN * 60 * 1000;
    const snap = await db
        .collection('games')
        .where('status', '==', 'open')
        .where('startsAt', '>=', earliest)
        .where('startsAt', '<=', latest)
        .get();
    if (snap.empty) {
        console.log('[shortageWarnings] no candidate games');
        return;
    }
    let pushed = 0;
    for (const doc of snap.docs) {
        const g = doc.data();
        if (!g.createdBy)
            continue;
        if (g.shortageWarningSentAt)
            continue;
        const registered = (g.players?.length ?? 0) + (g.guests?.length ?? 0);
        // Shortage threshold: can't fill TWO teams in the configured
        // format. That's the minimum to actually play a match; below
        // it the admin almost certainly wants to cancel.
        const perTeam = playersPerTeamForFormat(g.format);
        const required = perTeam * 2;
        if (registered >= required)
            continue;
        try {
            await createNotificationOnce({
                type: 'gameShortageWarning',
                recipientId: g.createdBy,
                payload: {
                    gameId: doc.id,
                    groupId: g.groupId,
                    gameTitle: g.title || 'המשחק',
                    startsAt: g.startsAt ?? null,
                    registered,
                    required,
                    hoursToKickoff: 2,
                },
            });
            await doc.ref.set({ shortageWarningSentAt: now, updatedAt: now }, { merge: true });
            pushed += 1;
        }
        catch (err) {
            console.error('[shortageWarnings] dispatch failed', doc.id, err);
        }
    }
    console.log(`[shortageWarnings] scanned ${snap.size} games, pushed ${pushed}`);
}
exports.onFillerInterestCreated = (0, firestore_1.onDocumentCreated)('games/{gameId}/fillerInterests/{uid}', async (event) => {
    const data = event.data?.data();
    if (!data)
        return;
    if (data.status !== 'pending')
        return;
    const gameId = event.params.gameId;
    const candidateUid = event.params.uid;
    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists)
        return;
    const game = gameSnap.data();
    const adminUid = game.createdBy;
    if (!adminUid)
        return;
    await createNotificationOnce({
        type: 'fillerInterestReceived',
        recipientId: adminUid,
        payload: {
            gameId,
            groupId: game.groupId,
            gameTitle: game.title,
            candidateUid,
            requesterId: candidateUid,
        },
    });
});
// ─── Filler approval flow — callables ──────────────────────────────────
//
// Three onCall functions complete the filler matching loop:
//
//   1. `submitFillerInterest`  — candidate taps "מעוניין" on the
//      filler push. Creates `/games/{gameId}/fillerInterests/{uid}`
//      with status='pending'. The existing `onFillerInterestCreated`
//      trigger then pushes the admin.
//
//   2. `approveFiller` — admin reviewed the candidate's profile
//      (trust meter, history) and approved. Adds the candidate to
//      game.players[] (or waitlist[] if full) and marks the
//      interest status='approved'. The candidate gets a push that
//      they're in.
//
//   3. `declineFiller` — admin rejected. Marks interest
//      status='rejected'. No notification to the candidate (low-key
//      rejection — the slot may have been filled by someone else).
//
// All three: enforceAppCheck + auth required. Authorization checks
// are CF-level (rules can't validate "caller is admin of the game's
// community" on a sub-collection write that doesn't touch the
// game doc).
exports.submitFillerInterest = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign-in required');
    }
    const uid = auth.uid;
    const data = (request.data ?? {});
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    if (!gameId) {
        throw new https_1.HttpsError('invalid-argument', 'gameId required');
    }
    // Validate game state. The candidate may have taken minutes /
    // hours to tap the push — meanwhile the game might have filled
    // up, been cancelled, or the admin disabled fillers.
    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) {
        throw new https_1.HttpsError('not-found', 'game not found');
    }
    const game = gameSnap.data();
    if (game.acceptsFillers !== true) {
        throw new https_1.HttpsError('failed-precondition', 'game is not accepting fillers');
    }
    if (game.status !== 'open') {
        throw new https_1.HttpsError('failed-precondition', 'game is no longer open');
    }
    if (typeof game.startsAt === 'number' &&
        game.startsAt < Date.now()) {
        throw new https_1.HttpsError('failed-precondition', 'game already started');
    }
    // Reject if the candidate is already a community member or
    // already in the game roster — they should use the regular join
    // flow, not the filler path.
    if (game.groupId) {
        const grpSnap = await db
            .collection('groups')
            .doc(game.groupId)
            .get();
        if (grpSnap.exists) {
            const grp = grpSnap.data();
            if ((grp.playerIds ?? []).includes(uid) ||
                (grp.adminIds ?? []).includes(uid)) {
                throw new https_1.HttpsError('failed-precondition', 'community members should join the regular way');
            }
        }
    }
    const inGame = (game.players ?? []).includes(uid) ||
        (game.waitlist ?? []).includes(uid) ||
        (game.pending ?? []).includes(uid);
    if (inGame) {
        throw new https_1.HttpsError('already-exists', 'already in this game');
    }
    // Idempotent write: if the candidate already submitted an
    // interest (and didn't withdraw it), don't dispatch a duplicate
    // admin push. We still update `updatedAt` so the admin sees
    // freshness.
    const interestRef = db
        .collection('games')
        .doc(gameId)
        .collection('fillerInterests')
        .doc(uid);
    const existing = await interestRef.get();
    if (existing.exists &&
        existing.data().status === 'pending') {
        await interestRef.set({ updatedAt: Date.now() }, { merge: true });
        return { ok: true, alreadyPending: true };
    }
    await interestRef.set({
        userId: uid,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
    return { ok: true };
});
exports.approveFiller = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign-in required');
    }
    const callerUid = auth.uid;
    const data = (request.data ?? {});
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const candidateUid = typeof data.candidateUid === 'string' ? data.candidateUid : '';
    if (!gameId || !candidateUid) {
        throw new https_1.HttpsError('invalid-argument', 'gameId and candidateUid required');
    }
    // Run the entire roster mutation inside a transaction so two
    // concurrent admin approvals can't both push the roster past
    // maxPlayers, and the interest doc + game doc stay in sync.
    await db.runTransaction(async (tx) => {
        const gameRef = db.collection('games').doc(gameId);
        const interestRef = gameRef
            .collection('fillerInterests')
            .doc(candidateUid);
        const gameSnap = await tx.get(gameRef);
        if (!gameSnap.exists) {
            throw new https_1.HttpsError('not-found', 'game not found');
        }
        const game = gameSnap.data();
        // Authorization: caller must be the game's creator OR an
        // admin of the parent community. We need to read the group
        // doc to check adminIds — outside the per-game transaction
        // scope is fine since adminIds rarely changes during a
        // single write.
        let isAuthorized = game.createdBy === callerUid;
        if (!isAuthorized && game.groupId) {
            const grpSnap = await tx.get(db.collection('groups').doc(game.groupId));
            if (grpSnap.exists) {
                const grp = grpSnap.data();
                if ((grp.adminIds ?? []).includes(callerUid)) {
                    isAuthorized = true;
                }
            }
        }
        if (!isAuthorized) {
            throw new https_1.HttpsError('permission-denied', 'caller is not the game admin');
        }
        if (game.status !== 'open') {
            throw new https_1.HttpsError('failed-precondition', 'game is no longer open');
        }
        const players = game.players ?? [];
        const waitlist = game.waitlist ?? [];
        const maxPlayers = game.maxPlayers ?? 0;
        // Idempotency: if the candidate is already in players, just
        // make sure the interest is marked approved and exit.
        if (players.includes(candidateUid)) {
            tx.set(interestRef, { status: 'approved', updatedAt: Date.now() }, { merge: true });
            return;
        }
        if (waitlist.includes(candidateUid)) {
            tx.set(interestRef, { status: 'approved', updatedAt: Date.now() }, { merge: true });
            return;
        }
        // Decide bucket: players if there's room, otherwise waitlist.
        const goesToPlayers = maxPlayers > 0 && players.length < maxPlayers;
        const newPlayers = goesToPlayers
            ? [...players, candidateUid]
            : players;
        const newWaitlist = goesToPlayers
            ? waitlist
            : [...waitlist, candidateUid];
        // Maintain the participantIds invariant (denormalised union
        // of all three rosters) so the existing rule guards still
        // hold on subsequent self-cancel writes by this candidate.
        const newParticipants = Array.from(new Set([
            ...newPlayers,
            ...newWaitlist,
            ...(game.pending ?? []),
        ]));
        tx.update(gameRef, {
            players: newPlayers,
            waitlist: newWaitlist,
            participantIds: newParticipants,
            updatedAt: Date.now(),
        });
        tx.set(interestRef, {
            status: 'approved',
            bucket: goesToPlayers ? 'players' : 'waitlist',
            approvedAt: Date.now(),
            approvedBy: callerUid,
            updatedAt: Date.now(),
        }, { merge: true });
    });
    // Push the candidate so they know they're in. Fire-and-forget
    // outside the transaction.
    try {
        await createNotificationOnce({
            type: 'approved',
            recipientId: candidateUid,
            payload: {
                gameId,
                // The approved-handler in `buildMessage` reads `bucket`
                // and renders a different body for waitlist vs players.
                // We fetch the latest interest doc to get the bucket
                // we just wrote — keeps the push payload truthful even
                // if the interest moves to waitlist by capacity.
                bucket: 'players',
            },
            createdByUid: callerUid,
        });
    }
    catch (err) {
        console.warn('[approveFiller] notif dispatch failed', err);
    }
    return { ok: true };
});
exports.declineFiller = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign-in required');
    }
    const callerUid = auth.uid;
    const data = (request.data ?? {});
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const candidateUid = typeof data.candidateUid === 'string' ? data.candidateUid : '';
    if (!gameId || !candidateUid) {
        throw new https_1.HttpsError('invalid-argument', 'gameId and candidateUid required');
    }
    // Auth check: same as approveFiller.
    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) {
        throw new https_1.HttpsError('not-found', 'game not found');
    }
    const game = gameSnap.data();
    let isAuthorized = game.createdBy === callerUid;
    if (!isAuthorized && game.groupId) {
        const grpSnap = await db
            .collection('groups')
            .doc(game.groupId)
            .get();
        if (grpSnap.exists) {
            const grp = grpSnap.data();
            if ((grp.adminIds ?? []).includes(callerUid)) {
                isAuthorized = true;
            }
        }
    }
    if (!isAuthorized) {
        throw new https_1.HttpsError('permission-denied', 'caller is not the game admin');
    }
    await db
        .collection('games')
        .doc(gameId)
        .collection('fillerInterests')
        .doc(candidateUid)
        .set({
        status: 'rejected',
        rejectedAt: Date.now(),
        rejectedBy: callerUid,
        updatedAt: Date.now(),
    }, { merge: true });
    // No push to the candidate — quiet rejection.
    return { ok: true };
});
// ─── Friendships: request push + accept / remove callables ─────────────
//
// Model:
//   /friendRequests/{fromId__toId}  (pending|accepted|declined)
//   /users/{uid}.friends: string[]  mutual, written ONLY here (Admin SDK)
//
// • onFriendRequestCreated → pushes the recipient that a request arrived.
// • acceptFriendRequest    → recipient accepts; writes BOTH friends
//   arrays and pushes the original sender. No push on decline (that's a
//   plain client-side status flip, gated by firestore.rules).
// • removeFriendship       → either party removes the mutual link.
exports.onFriendRequestCreated = (0, firestore_1.onDocumentCreated)('friendRequests/{rid}', async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const req = snap.data();
    if (!req?.fromUserId || !req?.toUserId || req.status !== 'pending')
        return;
    // Canonical sender name read server-side — the recipient's push can
    // never carry a spoofed display name.
    let fromName = 'שחקן';
    try {
        const u = await db.collection('users').doc(req.fromUserId).get();
        const n = u.exists ? u.data().name : '';
        if (typeof n === 'string' && n.length > 0)
            fromName = n;
    }
    catch {
        /* best-effort */
    }
    await createNotificationOnce({
        type: 'friendRequest',
        recipientId: req.toUserId,
        payload: { fromUserId: req.fromUserId, fromName },
        createdByUid: req.fromUserId,
    });
});
exports.acceptFriendRequest = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid; // the accepter (= request.toUserId)
    const fromUserId = String(request.data?.fromUserId || '');
    if (!fromUserId || fromUserId === uid) {
        throw new https_1.HttpsError('invalid-argument', 'bad fromUserId');
    }
    const reqRef = db.collection('friendRequests').doc(`${fromUserId}__${uid}`);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) {
        throw new https_1.HttpsError('not-found', 'request not found');
    }
    const req = reqSnap.data();
    if (req.toUserId !== uid) {
        throw new https_1.HttpsError('permission-denied', 'not your request');
    }
    if (req.status === 'declined') {
        throw new https_1.HttpsError('failed-precondition', 'request was declined');
    }
    const now = Date.now();
    const batch = db.batch();
    batch.set(reqRef, { status: 'accepted', updatedAt: now }, { merge: true });
    batch.set(db.collection('users').doc(uid), {
        friends: admin.firestore.FieldValue.arrayUnion(fromUserId),
        updatedAt: now,
    }, { merge: true });
    batch.set(db.collection('users').doc(fromUserId), {
        friends: admin.firestore.FieldValue.arrayUnion(uid),
        updatedAt: now,
    }, { merge: true });
    await batch.commit();
    // Push the original sender that their request was accepted.
    let accepterName = 'שחקן';
    try {
        const u = await db.collection('users').doc(uid).get();
        const n = u.exists ? u.data().name : '';
        if (typeof n === 'string' && n.length > 0)
            accepterName = n;
    }
    catch {
        /* best-effort */
    }
    await createNotificationOnce({
        type: 'friendRequestAccepted',
        recipientId: fromUserId,
        payload: { fromUserId: uid, fromName: accepterName },
        createdByUid: uid,
    });
    return { ok: true };
});
exports.removeFriendship = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const otherUserId = String(request.data?.otherUserId || '');
    if (!otherUserId || otherUserId === uid) {
        throw new https_1.HttpsError('invalid-argument', 'bad otherUserId');
    }
    const now = Date.now();
    const batch = db.batch();
    batch.set(db.collection('users').doc(uid), {
        friends: admin.firestore.FieldValue.arrayRemove(otherUserId),
        updatedAt: now,
    }, { merge: true });
    batch.set(db.collection('users').doc(otherUserId), {
        friends: admin.firestore.FieldValue.arrayRemove(uid),
        updatedAt: now,
    }, { merge: true });
    // Clear any lingering request docs in either direction so a future
    // re-friend starts clean. Deleting a missing doc is a no-op.
    batch.delete(db.collection('friendRequests').doc(`${uid}__${otherUserId}`));
    batch.delete(db.collection('friendRequests').doc(`${otherUserId}__${uid}`));
    await batch.commit();
    return { ok: true };
});
// ─── Callable: invite app-friends to an existing community ─────────────
//
// The caller (a member or admin of the group) picks friends from their
// friends list; each is added to `pendingPlayerIds` and receives a
// `groupInvitation` push. Server-side guards: caller must belong to the
// group, and only the caller's actual friends who aren't already in the
// group are invited (so this can't be used to spam strangers).
exports.inviteFriendsToGroup = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const data = request.data;
    const groupId = String(data?.groupId || '');
    const friendIds = Array.isArray(data?.friendIds)
        ? data.friendIds.filter((x) => typeof x === 'string')
        : [];
    if (!groupId || friendIds.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'groupId + friendIds required');
    }
    const groupRef = db.collection('groups').doc(groupId);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) {
        throw new https_1.HttpsError('not-found', 'group not found');
    }
    const g = groupSnap.data();
    const members = new Set([
        ...(g.adminIds || []),
        ...(g.playerIds || []),
        ...(g.pendingPlayerIds || []),
    ]);
    if (!members.has(uid)) {
        throw new https_1.HttpsError('permission-denied', 'not a member of this group');
    }
    const inviterSnap = await db.collection('users').doc(uid).get();
    const inviterData = inviterSnap.data();
    const inviterFriends = new Set(inviterData?.friends || []);
    const inviterName = typeof inviterData?.name === 'string' && inviterData.name.length > 0
        ? inviterData.name
        : 'חבר';
    // Only real friends who aren't already in the group.
    const toInvite = friendIds.filter((fid) => inviterFriends.has(fid) && !members.has(fid));
    const room = Math.max(0, 200 - (g.pendingPlayerIds?.length || 0));
    const accepted = toInvite.slice(0, room);
    if (accepted.length === 0)
        return { invited: 0 };
    await groupRef.set({
        pendingPlayerIds: admin.firestore.FieldValue.arrayUnion(...accepted),
        updatedAt: Date.now(),
    }, { merge: true });
    await Promise.all(accepted.map((fid) => createNotificationOnce({
        type: 'groupInvitation',
        recipientId: fid,
        payload: {
            groupId,
            groupName: g.name || '',
            inviterName,
            inviterId: uid,
        },
        createdByUid: uid,
    })));
    return { invited: accepted.length };
});
// ─── Founder real-time alerts ─────────────────────────────────────────────
// Event-driven FCM pushes to the founder's Pulse device(s). Each respects the
// per-type on/off toggle in adminConfig/prefs (server-side — see adminPush.ts).
// "מישהו נרשם!" — the instant a /users doc is created.
exports.onNewUserJoined = (0, firestore_1.onDocumentCreated)('users/{uid}', async (event) => {
    const user = event.data?.data();
    if (!user)
        return;
    const uid = event.params.uid;
    const name = user.name && user.name !== 'משתמש שהוסר' ? user.name : 'משתמש חדש';
    // Attribution is written by SEPARATE client updates ~1-3s after signup
    // (applyInviteAttributionIfFresh / applyAcquisitionIfFresh), so neither is
    // on the doc at create time. Poll briefly to catch a referrer (`invitedBy`)
    // or a campaign-link (`acquisition.campaign`), exiting as soon as one lands
    // (organic signups just wait out the window).
    let inviterId;
    let campaign;
    for (const waitMs of [3000, 5000, 6000]) {
        await new Promise((r) => setTimeout(r, waitMs));
        const d = (await db.collection('users').doc(uid).get()).data();
        const v = d?.invitedBy;
        if (typeof v === 'string' && v && v !== uid)
            inviterId = v;
        const acq = d?.acquisition;
        if (acq?.campaign && typeof acq.campaign === 'string')
            campaign = acq.campaign;
        if (inviterId || campaign)
            break;
    }
    // Build the "via" suffix: a personal referral wins; otherwise a campaign.
    let via = '';
    if (inviterId) {
        try {
            const inv = (await db.collection('users').doc(inviterId).get()).data();
            const invName = inv?.name && inv.name !== 'משתמש שהוסר' ? inv.name : null;
            via = invName ? ` · דרך ${invName}` : ' · דרך הזמנה';
        }
        catch {
            via = ' · דרך הזמנה';
        }
    }
    else if (campaign) {
        via = ` · דרך קמפיין ${campaign}`;
    }
    await (0, adminPush_1.pushToAdmins)('newUser', 'Teamder', `מישהו נרשם לאפליקציה! 🎉 (${name})${via}`, { uid });
});
// ── Founder activity alerts: game/community create + join ──
// All honor the per-type toggle in adminConfig/prefs (Pulse Settings).
async function adminAlertUserName(uid) {
    try {
        const d = await admin.firestore().collection('users').doc(uid).get();
        const n = d.data()?.name;
        return n && n !== 'משתמש שהוסר' ? n : 'מישהו';
    }
    catch {
        return 'מישהו';
    }
}
exports.onGameCreatedAlert = (0, firestore_1.onDocumentCreated)('games/{id}', async (event) => {
    const g = event.data?.data();
    if (!g)
        return;
    const who = g.createdBy ? await adminAlertUserName(g.createdBy) : 'מישהו';
    await (0, adminPush_1.pushToAdmins)('gameCreate', 'Teamder', `${who} יצר משחק חדש ⚽`, { id: event.params.id });
});
exports.onGameJoinedAlert = (0, firestore_1.onDocumentUpdated)('games/{id}', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    const arr = (d) => [
        ...(d.players ?? []),
        ...(d.participantIds ?? []),
    ];
    const had = new Set(arr(before));
    const added = [...new Set(arr(after))].filter((u) => !had.has(u));
    if (!added.length)
        return;
    const who = await adminAlertUserName(added[0]);
    const extra = added.length > 1 ? ` +${added.length - 1}` : '';
    // Name the game so the alert says WHICH game was joined. Titled (quick)
    // games carry `title`; community games fall back to the field/location,
    // then a generic "משחק".
    const gameTitle = typeof after.title === 'string' ? after.title.trim() : '';
    const gameField = typeof after.fieldName === 'string' ? after.fieldName.trim() : '';
    const gameLabel = gameTitle || gameField || 'משחק';
    await (0, adminPush_1.pushToAdmins)('gameJoin', 'Teamder', `${who}${extra} נרשם ל${gameLabel} 🙋`, { id: event.params.id });
});
exports.onCommunityCreatedAlert = (0, firestore_1.onDocumentCreated)('groups/{id}', async (event) => {
    const grp = event.data?.data();
    if (!grp || grp.isPersonal === true)
        return; // skip personal/orphan groups
    const owner = grp.creatorId ?? grp.adminIds?.[0];
    const who = owner ? await adminAlertUserName(owner) : 'מישהו';
    await (0, adminPush_1.pushToAdmins)('communityCreate', 'Teamder', `${who} יצר מועדון: ${grp.name ?? ''} 🏟️`, { id: event.params.id });
});
exports.onCommunityJoinedAlert = (0, firestore_1.onDocumentUpdated)('groups/{id}', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    const had = new Set(before.playerIds ?? []);
    const added = (after.playerIds ?? []).filter((u) => !had.has(u));
    if (!added.length)
        return;
    const who = await adminAlertUserName(added[0]);
    const extra = added.length > 1 ? ` +${added.length - 1}` : '';
    await (0, adminPush_1.pushToAdmins)('communityJoin', 'Teamder', `${who}${extra} הצטרף למועדון ${after.name ?? ''} 👥`, { id: event.params.id });
});
// Founder alert: a user updated their availability (days / times / city /
// invitable). Event-driven — fires only on THIS user's write, so NO scan and
// NO Firestore reads on the common no-op path (it compares the before/after
// snapshots it already has and early-returns when availability is unchanged).
exports.onAvailabilityUpdated = (0, firestore_1.onDocumentUpdated)('users/{uid}', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    const a = after.availability;
    if (!a || typeof a !== 'object')
        return;
    // Signature only the MEANINGFUL fields (ignore coords/noise) so an unrelated
    // profile write (lastActive, stats…) never triggers a spurious alert.
    const sig = (x) => {
        const o = x ?? {};
        return JSON.stringify({
            d: o.preferredDays ?? [],
            t: o.preferredTimes ?? [],
            c: o.homeCity ?? '',
            inv: o.isAvailableForInvites,
            af: o.acceptsFillerPush,
        });
    };
    if (sig(before.availability) === sig(a))
        return;
    const who = after.name && after.name !== 'משתמש שהוסר' ? after.name : 'מישהו';
    const days = Array.isArray(a.preferredDays)
        ? a.preferredDays.length
        : 0;
    const daysTxt = days > 0 ? ` (${days} ימים)` : '';
    const city = typeof a.homeCity === 'string' && a.homeCity ? ` · ${a.homeCity}` : '';
    await (0, adminPush_1.pushToAdmins)('availabilityUpdate', 'Teamder', `${who} עדכן זמינות${daysTxt}${city} 🗓️`, { uid: event.params.uid });
});
// New ERROR signature — /errors is fingerprint-aggregated, so onCreate fires
// only on a genuinely new kind of failure (not every repeat occurrence).
exports.onErrorLogged = (0, firestore_1.onDocumentCreated)('errors/{fp}', async (event) => {
    const e = event.data?.data();
    if (!e)
        return;
    const emoji = e.category === 'crash' ? '💥' : e.category === 'silent' ? '⚠️' : '❌';
    const title = e.title || e.operation || 'שגיאה';
    const where = e.lastScreen ? ` · ${e.lastScreen}` : '';
    await (0, adminPush_1.pushToAdmins)('error', `${emoji} שגיאה חדשה`, `${title}${where}`, {
        fp: event.params.fp,
    });
});
// Admin push campaign created in Pulse → send immediately if due (future-
// dated ones wait for the cron sweep). Rate-limited + idempotent inside.
exports.onCampaignCreated = (0, firestore_1.onDocumentCreated)('campaigns/{id}', async (event) => {
    await (0, adminUserPush_1.processCampaign)(event.params.id, Date.now());
});
// Engagement reporting — the app calls this when a push is tapped or a
// popup is shown / clicked / dismissed. Increments campaigns/{id}.metrics.*
// so Pulse can show received-vs-clicked per campaign. Append-only counters;
// a signed-in user can only nudge a count up, never read or alter campaigns.
exports.trackCampaignEvent = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    const campaignId = request.data?.campaignId;
    const event = request.data?.event;
    if (typeof campaignId !== 'string' || typeof event !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'campaignId + event required');
    }
    await (0, adminUserPush_1.recordCampaignMetric)(campaignId, event);
    return { ok: true };
});
// Public click beacon for tracked share links. The /go landing page fires
// a fire-and-forget fetch here on load, so we count CLICKS (people who
// tapped the link + reached the page) independently of installs. Keyed by
// the link id `l` when present (per-link), else by source `s` (per-source).
exports.trackLinkClick = (0, https_1.onRequest)({ region: 'us-central1', memory: '256MiB', cors: true }, async (req, res) => {
    try {
        const l = typeof req.query.l === 'string' ? req.query.l : '';
        const s = typeof req.query.s === 'string' ? req.query.s : '';
        // Personal invite links (`/app?invitedBy=<uid>`) carry the inviter uid.
        // Count those clicks per-inviter so the dashboard can show "how many
        // tapped this user's link" alongside "how many registered through them".
        const inviter = typeof req.query.inviter === 'string' ? req.query.inviter : '';
        const inc = admin.firestore.FieldValue.increment(1);
        const now = Date.now();
        const db = admin.firestore();
        if (l) {
            await db.collection('adLinks').doc(l).set({ clicks: inc, lastClickAt: now }, { merge: true });
        }
        else if (s) {
            // Old links with no id — bucket clicks by source.
            await db.collection('linkClicks').doc(s).set({ clicks: inc, lastClickAt: now }, { merge: true });
        }
        // Independent of l/s: a personal link's inviter click is always counted.
        if (inviter) {
            await db.collection('inviteClicks').doc(inviter).set({ clicks: inc, lastClickAt: now }, { merge: true });
        }
    }
    catch {
        /* best-effort beacon — never error the user's redirect */
    }
    res.set('Cache-Control', 'no-store');
    res.status(204).send('');
});
// User feedback — bug report / feature suggestion (separate toggles).
exports.onFeedbackSubmitted = (0, firestore_1.onDocumentCreated)('feedback/{id}', async (event) => {
    const f = event.data?.data();
    if (!f)
        return;
    const isBug = f.type !== 'suggestion';
    const label = isBug ? '🐛 דיווח על תקלה' : '💡 הצעה לשיפור';
    const body = (f.userName ? f.userName + ': ' : '') + (f.message || '').slice(0, 140);
    await (0, adminPush_1.pushToAdmins)(isBug ? 'bug' : 'suggestion', label, body || 'דיווח חדש', {
        id: event.params.id,
    });
});
// ---------------------------------------------------------------------------
// Consolidated schedulers (cost optimisation)
//
// The 10 individual `onSchedule` jobs that used to live above were merged
// into the THREE dispatchers below. Cloud Scheduler bills per job beyond the
// 3 free, and most of those jobs fired with zero users — so 10 jobs meant a
// standing monthly cost for nothing. Each former job's logic now lives in a
// `run*` helper (declarations above, hoisted); the dispatchers invoke them
// in sequence, each wrapped in `runSweep` so one sweep failing never aborts
// the rest of the tick.
// ---------------------------------------------------------------------------
async function runSweep(label, fn) {
    try {
        await fn();
    }
    catch (err) {
        console.error(`[cron] sweep "${label}" failed`, err);
    }
}
// dailyCleanup was its own `every 24 hours` job. Folded into the hourly
// dispatcher but gated by a Firestore marker so the (delete-heavy) sweep
// still fires at most once per ~23h instead of every hour.
async function runDailyCleanupIfDue() {
    const ref = db.collection('cronMeta').doc('dailyCleanup');
    const snap = await ref.get();
    const lastRunAt = (snap.exists ? snap.data()?.lastRunAt : 0) ?? 0;
    const DUE_AFTER_MS = 23 * 60 * 60 * 1000;
    if (Date.now() - lastRunAt < DUE_AFTER_MS)
        return;
    await runDailyCleanup();
    await ref.set({ lastRunAt: Date.now() }, { merge: true });
}
// Every 5 minutes — latency-sensitive game-state transitions.
exports.cronEvery5Min = (0, scheduler_1.onSchedule)({ schedule: 'every 5 minutes', timeZone: 'Asia/Jerusalem' }, async () => {
    await runSweep('flipScheduledGames', runFlipScheduledGames);
    await runSweep('flipPublicGames', runFlipPublicGames);
    await runSweep('cloneRecurringGames', runCloneRecurringGames);
    await runSweep('scheduledAutoGenerateTeams', runScheduledAutoGenerateTeams);
    await runSweep('expireStaleOffers', runExpireStaleOffers);
    await runSweep('sweepDueCampaigns', () => (0, adminUserPush_1.sweepDueCampaigns)(Date.now()));
});
// Every 15 minutes — reminders, nudges, shortage + filler matching.
// Carries findFillerCandidates' heavier runtime budget (was 512MiB / 540s).
exports.cronEvery15Min = (0, scheduler_1.onSchedule)({
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Jerusalem',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [ASC_P8, PLAY_SA],
}, async () => {
    await runSweep('sendGameReminders', runSendGameReminders);
    await runSweep('sendRsvpNudges', runSendRsvpNudges);
    await runSweep('sendShortageWarnings', runSendShortageWarnings);
    await runSweep('sendRateReminders', runSendRateReminders);
    await runSweep('findFillerCandidates', runFindFillerCandidates);
    // Near-real-time store-review alerts → FCM to the founder's Pulse.
    await runSweep('reviewAlerts', () => (0, reviewAlerts_1.runReviewAlerts)(ASC_P8.value(), PLAY_SA.value()));
});
// Every 60 minutes — cleanup, promote prompts, and the gated daily sweep.
exports.cronEvery60Min = (0, scheduler_1.onSchedule)({ schedule: 'every 60 minutes', timeZone: 'Asia/Jerusalem' }, async () => {
    await runSweep('cleanupStaleGames', runCleanupStaleGames);
    await runSweep('sendPromotePrompts', runSendPromotePrompts);
    await runSweep('dailyCleanup', runDailyCleanupIfDue);
});
// ─── Advanced-mode round stats aggregation ─────────────────────────────────
// Called by the game admin when a round ends. The client can't write other
// players' stat docs (rules, correctly), so the aggregation runs here with the
// Admin SDK: per-scorer goals, per-community goals, and pair stats (same-team
// W/L + head-to-head against). Idempotency is the caller's concern — it sends
// each finished round once.
const GUEST_PREFIX = 'guest:';
// Legacy raw guest id shape: genGuestId() → "<base36ts>-<rand>" (all lowercase
// alphanumeric, exactly one hyphen). A real Firebase Auth uid is 28 MIXED-case
// alphanumeric chars and never contains a hyphen — including email/password
// accounts — so matching this exact shape (instead of "any hyphen") can never
// misclassify a real user, even a hypothetical one with a hyphen.
const RAW_GUEST_RE = /^[0-9a-z]+-[0-9a-z]+$/;
// A real Firebase Auth uid: not guest-prefixed AND not a raw legacy guest id.
const isReal = (id) => typeof id === 'string' &&
    id.length > 0 &&
    !id.startsWith(GUEST_PREFIX) &&
    !RAW_GUEST_RE.test(id);
exports.commitRoundStats = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    const { gameId, roundId, sideA, sideB, winnerSide, goals, } = (request.data ?? {});
    if (!gameId || (winnerSide !== 'A' && winnerSide !== 'B' && winnerSide !== 'tie')) {
        throw new https_1.HttpsError('invalid-argument', 'gameId + winnerSide required');
    }
    const snap = await db.collection('games').doc(gameId).get();
    if (!snap.exists)
        throw new https_1.HttpsError('not-found', 'game not found');
    const game = snap.data();
    // Authorize: only the game creator or a community admin may commit stats.
    const groupId = game.groupId;
    let isAdmin = game.createdBy === uid;
    if (!isAdmin && groupId) {
        const grp = await db.collection('groups').doc(groupId).get();
        isAdmin = (grp.data()?.adminIds ?? []).includes(uid);
    }
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'admin only');
    const A = (sideA ?? []).filter(isReal);
    const B = (sideB ?? []).filter(isReal);
    // Bound the side sizes BEFORE building the batch. The against-pairs loop
    // writes |A|×|B| docs; an unbounded (or forged) payload could blow the
    // Firestore 500-op batch cap, failing commit() and losing the WHOLE round's
    // stats. Real formats top out at 7-a-side, so 20 is generous headroom while
    // keeping |A|×|B| (≤400) + per-player writes safely under 500.
    const MAX_SIDE = 20;
    if (A.length > MAX_SIDE || B.length > MAX_SIDE) {
        throw new https_1.HttpsError('invalid-argument', `side too large (A=${A.length}, B=${B.length}, max ${MAX_SIDE})`);
    }
    // The set of players who actually played this round (both on-field sides).
    // Goals + assists are credited ONLY to members of this set, exactly like
    // rounds/wins/losses below — so a scorer or assister who isn't on either
    // playing side (a stale/over-full roster, a departed player still named on
    // a goal) can never be credited a goal/assist while being denied the
    // matching "round played" (B12, B13). Keeps every per-round stat internally
    // consistent: you played, or you got nothing.
    const onField = new Set([...A, ...B]);
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const now = Date.now();
    const batch = db.batch();
    const pairKey = (x, y) => [x, y].sort().join('__');
    // Idempotency latch — record this round's commit marker via create() in the
    // same batch. A retry / partial-failure re-press (or an SDK auto-retry of a
    // timed-out call) commits the SAME goals + against-pairs again; the create
    // then fails ALREADY_EXISTS and the whole batch is rejected, so increments
    // never double-apply. Skipped only for legacy callers that send no roundId.
    if (roundId !== undefined && roundId !== null) {
        batch.create(db.collection('games').doc(gameId).collection('committedRounds').doc(String(roundId)), { committedAt: now, by: uid, winnerSide });
    }
    // 1) goals → scorer.stats.goals + community tally
    const byScorer = {};
    for (const g of goals ?? []) {
        if (g.ownGoal || !g.scorerId || !isReal(g.scorerId))
            continue;
        if (!onField.has(g.scorerId))
            continue; // not on a playing side → skip
        byScorer[g.scorerId] = (byScorer[g.scorerId] ?? 0) + 1;
    }
    const totalGoalsThisRound = Object.values(byScorer).reduce((a, b) => a + b, 0);
    for (const [scorer, n] of Object.entries(byScorer)) {
        batch.set(db.collection('users').doc(scorer), { stats: { goals: inc(n) } }, { merge: true });
        if (groupId)
            batch.set(db.collection('communityPlayerStats').doc(`${groupId}__${scorer}`), { groupId, userId: scorer, goals: inc(n), updatedAt: now }, { merge: true });
        // Per-GAME tally → drives the in-game championship (shown once the
        // game is finished). Same idempotent batch, so a retry can't double.
        batch.set(db.collection('gamePlayerStats').doc(`${gameId}__${scorer}`), { gameId, userId: scorer, goals: inc(n), updatedAt: now }, { merge: true });
    }
    // Community-level rollup for the club's stats + championship table:
    // total mini-games (rounds) and total goals scored THROUGH this club's
    // games. In the same idempotent batch, so a retry can't double-count.
    if (groupId) {
        batch.set(db.collection('communityStats').doc(groupId), {
            groupId,
            rounds: inc(1),
            goals: inc(totalGoalsThisRound),
            // Ties get their own counter → drives the club's draw-rate fun fact.
            tiedRounds: inc(winnerSide === 'tie' ? 1 : 0),
            updatedAt: now,
        }, { merge: true });
    }
    // 1b) assists → assister.stats.assists + community tally + directional
    //     head-to-head ("X assisted Y") on the sorted pair doc. An assist only
    //     counts for a real, attributed scorer and a real, different assister.
    const byAssister = {};
    const assistPairs = [];
    for (const g of goals ?? []) {
        if (g.ownGoal || !g.scorerId || !isReal(g.scorerId))
            continue;
        if (!onField.has(g.scorerId))
            continue; // scorer off the playing sides
        if (!g.assisterId || !isReal(g.assisterId) || g.assisterId === g.scorerId)
            continue;
        if (!onField.has(g.assisterId))
            continue; // assister not on a playing side (B12)
        byAssister[g.assisterId] = (byAssister[g.assisterId] ?? 0) + 1;
        assistPairs.push({ assister: g.assisterId, scorer: g.scorerId });
    }
    for (const [assister, n] of Object.entries(byAssister)) {
        batch.set(db.collection('users').doc(assister), { stats: { assists: inc(n) } }, { merge: true });
        if (groupId)
            batch.set(db.collection('communityPlayerStats').doc(`${groupId}__${assister}`), { groupId, userId: assister, assists: inc(n), updatedAt: now }, { merge: true });
        // Per-GAME assist tally (mirrors the per-game goals write above).
        batch.set(db.collection('gamePlayerStats').doc(`${gameId}__${assister}`), { gameId, userId: assister, assists: inc(n), updatedAt: now }, { merge: true });
    }
    // 1c) mini-games PLAYED — every on-field player this round (both teams)
    //     gets a +1 `rounds` tally, per-community and per-game. Drives the
    //     championship's "games played" column + its score-per-game average.
    //     Counts everyone who played, not just scorers/assisters.
    for (const uid of new Set([...A, ...B])) {
        if (groupId)
            batch.set(db.collection('communityPlayerStats').doc(`${groupId}__${uid}`), { groupId, userId: uid, rounds: inc(1), updatedAt: now }, { merge: true });
        batch.set(db.collection('gamePlayerStats').doc(`${gameId}__${uid}`), { gameId, userId: uid, rounds: inc(1), updatedAt: now }, { merge: true });
    }
    // 1d) mini-games WON / LOST — the winning side's players get a +1 `wins`
    //     tally and the losing side a +1 `losses`, per-community + per-game.
    //     Drives the community table's wins/losses columns. (A tie credits
    //     neither side.)
    const roundWinners = winnerSide === 'A' ? A : winnerSide === 'B' ? B : [];
    const roundLosers = winnerSide === 'A' ? B : winnerSide === 'B' ? A : [];
    const tallyResult = (uid, field) => {
        if (groupId)
            batch.set(db.collection('communityPlayerStats').doc(`${groupId}__${uid}`), { groupId, userId: uid, [field]: inc(1), updatedAt: now }, { merge: true });
        batch.set(db.collection('gamePlayerStats').doc(`${gameId}__${uid}`), { gameId, userId: uid, [field]: inc(1), updatedAt: now }, { merge: true });
    };
    for (const uid of roundWinners) {
        tallyResult(uid, 'wins');
        // Lifetime per-player wins are written HERE — in the SAME idempotent,
        // committedRounds-latched batch as the community/game win tallies —
        // instead of the onGameRotationChanged trigger. That guarantees the
        // three win counters (lifetime / community / game) can never diverge:
        // they all commit together, or none of them on a failure.
        batch.set(db.collection('users').doc(uid), { stats: { wins: inc(1) } }, { merge: true });
    }
    for (const uid of roundLosers)
        tallyResult(uid, 'losses');
    // Directional pair assists: assistsAToB = sorted-first player assisted the
    // sorted-second; assistsBToA = the reverse. The player card reads its side.
    for (const { assister, scorer } of assistPairs) {
        const [pa, pb] = [assister, scorer].sort();
        const field = assister === pa ? 'assistsAToB' : 'assistsBToA';
        batch.set(db.collection('pairStats').doc(pairKey(assister, scorer)), { a: pa, b: pb, [field]: inc(1), updatedAt: now }, { merge: true });
        // Per-COMMUNITY assist pair → drives the club's "deadly duo" fun fact.
        // (pairStats is global/cross-group; this one is scoped to the club.)
        if (groupId) {
            batch.set(db.collection('communityPairStats').doc(`${groupId}__${pairKey(assister, scorer)}`), { groupId, a: pa, b: pb, assists: inc(1), updatedAt: now }, { merge: true });
        }
    }
    // NOTE: same-team pairs (sameTeam / winsTogether / lossesTogether) are
    // already written by the existing `onGameRotationChanged` trigger on every
    // rotation — do NOT duplicate them here. This callable only adds what that
    // trigger doesn't: goals, the head-to-head "against" tally, and community.
    // cross pairs (against) — every A×B pair played against each other this
    // round. On a tie, count `against` but credit no directional win.
    const aWon = winnerSide === 'A';
    const bWon = winnerSide === 'B';
    for (const w of A)
        for (const l of B) {
            const wFirst = [w, l].sort()[0] === w;
            // w is on side A, l on side B. winsA/winsB are by SORTED-first uid.
            const aIsFirst = wFirst; // w (side A) sorts first
            const sideAWinsField = aIsFirst ? 'winsA' : 'winsB';
            const sideBWinsField = aIsFirst ? 'winsB' : 'winsA';
            const [pa, pb] = [w, l].sort();
            batch.set(db.collection('pairStats').doc(pairKey(w, l)), {
                // Write a/b so against-ONLY pairs (never same-team) are still
                // discoverable by the Statistics screen's `where('a'|'b','==',uid)`
                // queries — otherwise the rival/nemesis cards would miss them.
                a: pa,
                b: pb,
                against: inc(1),
                [sideAWinsField]: inc(aWon ? 1 : 0),
                [sideBWinsField]: inc(bWon ? 1 : 0),
                updatedAt: now,
            }, { merge: true });
        }
    await batch.commit();
    return { ok: true, scorers: Object.keys(byScorer).length };
});
// ── Retro goals ─────────────────────────────────────────────────────────────
// Admin-only, AFTER a game is finished: credit a MISSED goal to a player's
// totals WITHOUT touching any mini-game score / winner / rotation (those are
// frozen — the rotation already physically happened). A retro goal is a pure
// STAT correction, detached from any round: it bumps the scorer's goals (and an
// optional assister's assists) across the SAME four stores commitRoundStats
// writes — users.stats, communityPlayerStats, gamePlayerStats, communityStats —
// so every leaderboard / profile / club-total reconciles for free. It NEVER
// writes wins, pair stats, rounds, or liveMatch.* — so it cannot move a result
// or create a "2:1 but the other team won" display.
//
// Idempotency + undo: each retro goal is a doc at games/{gameId}/retroGoals/
// {retroGoalId}. addRetroGoal create()s that marker in the SAME batch as the
// increments (a retry collides → no double-count); removeRetroGoal is gated on
// the marker EXISTING (so a decrement is only ever the inverse of a real add).
async function loadRetroGameContext(uid, gameId) {
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    if (!gameId)
        throw new https_1.HttpsError('invalid-argument', 'gameId required');
    const snap = await db.collection('games').doc(gameId).get();
    if (!snap.exists)
        throw new https_1.HttpsError('not-found', 'game not found');
    const game = snap.data();
    // Post-match only — a retro goal is a correction to a finished evening.
    if (game.status !== 'finished') {
        throw new https_1.HttpsError('failed-precondition', 'game is not finished');
    }
    const groupId = game.groupId;
    if (!groupId)
        throw new https_1.HttpsError('failed-precondition', 'game has no community');
    const grpSnap = await db.collection('groups').doc(groupId).get();
    const grp = grpSnap.data();
    // Personal / one-off hidden groups are excluded: promoteOrphanToGroup HARD-
    // resets their stats, which would orphan a retro marker + its counters.
    if (!grp || grp.isPersonal === true) {
        throw new https_1.HttpsError('failed-precondition', 'retro goals are only for real communities');
    }
    const adminIds = grp.adminIds ?? [];
    const isAdmin = game.createdBy === uid || adminIds.includes(uid);
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'community admin only');
    return { game, groupId };
}
const isAlreadyExists = (err) => {
    const e = err;
    return (e?.code === 6 ||
        e?.code === 'already-exists' ||
        (typeof e?.message === 'string' && e.message.includes('ALREADY_EXISTS')));
};
exports.addRetroGoal = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const uid = request.auth?.uid;
    const { gameId, scorerId, assisterId, retroGoalId } = (request.data ?? {});
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    if (!retroGoalId)
        throw new https_1.HttpsError('invalid-argument', 'retroGoalId required');
    if (!scorerId || !isReal(scorerId)) {
        throw new https_1.HttpsError('invalid-argument', 'a real (non-guest) scorer is required');
    }
    // Assister optional; ignore a guest / self-assist rather than failing.
    const assister = assisterId && isReal(assisterId) && assisterId !== scorerId ? assisterId : null;
    const { game, groupId } = await loadRetroGameContext(uid, gameId);
    // Scorer (and assister) must be on the game's registered roster — includes
    // players who went home (they stay in players[]); excludes guests already.
    const players = game.players ?? [];
    if (!players.includes(scorerId)) {
        throw new https_1.HttpsError('invalid-argument', 'scorer is not on this game roster');
    }
    if (assister && !players.includes(assister)) {
        throw new https_1.HttpsError('invalid-argument', 'assister is not on this game roster');
    }
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const now = Date.now();
    const batch = db.batch();
    // Idempotency marker + audit (create → collides on retry/double-tap).
    batch.create(db.collection('games').doc(gameId).collection('retroGoals').doc(retroGoalId), { scorerId, assisterId: assister, addedBy: uid, at: now });
    // Goal → the SAME four stores commitRoundStats writes (no rounds/wins/pairs).
    batch.set(db.collection('users').doc(scorerId), { stats: { goals: inc(1) } }, { merge: true });
    batch.set(db.collection('communityPlayerStats').doc(`${groupId}__${scorerId}`), { groupId, userId: scorerId, goals: inc(1), updatedAt: now }, { merge: true });
    batch.set(db.collection('gamePlayerStats').doc(`${gameId}__${scorerId}`), { gameId, userId: scorerId, goals: inc(1), updatedAt: now }, { merge: true });
    batch.set(db.collection('communityStats').doc(groupId), { groupId, goals: inc(1), updatedAt: now }, { merge: true });
    if (assister) {
        batch.set(db.collection('users').doc(assister), { stats: { assists: inc(1) } }, { merge: true });
        batch.set(db.collection('communityPlayerStats').doc(`${groupId}__${assister}`), { groupId, userId: assister, assists: inc(1), updatedAt: now }, { merge: true });
        batch.set(db.collection('gamePlayerStats').doc(`${gameId}__${assister}`), { gameId, userId: assister, assists: inc(1), updatedAt: now }, { merge: true });
    }
    try {
        await batch.commit();
    }
    catch (err) {
        // Marker already existed → this exact retro goal was already applied.
        // Treat as success (idempotent) instead of double-counting.
        if (isAlreadyExists(err))
            return { ok: true, duplicate: true };
        throw err;
    }
    return { ok: true };
});
exports.removeRetroGoal = (0, https_1.onCall)({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const uid = request.auth?.uid;
    const { gameId, retroGoalId } = (request.data ?? {});
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'sign in required');
    if (!retroGoalId)
        throw new https_1.HttpsError('invalid-argument', 'retroGoalId required');
    const { groupId } = await loadRetroGameContext(uid, gameId);
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const now = Date.now();
    const markerRef = db
        .collection('games')
        .doc(gameId)
        .collection('retroGoals')
        .doc(retroGoalId);
    await db.runTransaction(async (tx) => {
        const m = await tx.get(markerRef);
        if (!m.exists)
            return; // already removed / never existed → no-op
        const d = m.data();
        const scorerId = d.scorerId;
        const assister = d.assisterId ?? null;
        tx.delete(markerRef);
        if (scorerId && isReal(scorerId)) {
            tx.set(db.collection('users').doc(scorerId), { stats: { goals: inc(-1) } }, { merge: true });
            tx.set(db.collection('communityPlayerStats').doc(`${groupId}__${scorerId}`), { goals: inc(-1), updatedAt: now }, { merge: true });
            tx.set(db.collection('gamePlayerStats').doc(`${gameId}__${scorerId}`), { goals: inc(-1), updatedAt: now }, { merge: true });
            tx.set(db.collection('communityStats').doc(groupId), { goals: inc(-1), updatedAt: now }, { merge: true });
        }
        if (assister && isReal(assister)) {
            tx.set(db.collection('users').doc(assister), { stats: { assists: inc(-1) } }, { merge: true });
            tx.set(db.collection('communityPlayerStats').doc(`${groupId}__${assister}`), { assists: inc(-1), updatedAt: now }, { merge: true });
            tx.set(db.collection('gamePlayerStats').doc(`${gameId}__${assister}`), { assists: inc(-1), updatedAt: now }, { merge: true });
        }
    });
    return { ok: true };
});

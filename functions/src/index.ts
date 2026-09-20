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

import * as admin from 'firebase-admin';
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { StatBatch, MAX_ROUND_BATCH_OPS } from './statBatch';
import { commitRoundInOrder } from './commitProtocol';
import { eveningScoreServer } from './eveningScoreCore';
import { occupancyOf, inFillerQuietHours } from './fillerRules';
import { closeSeason, reopenSeason } from './seasonRollover';
import { buildRoundSides } from './roundSides';
import { seasonSeed } from './seasonSeed';
import {
  countPlayedEvenings,
  countSeasonEvenings,
  completedRoundsFrom,
  isSeasonDue,
  seasonFinishLine,
  type StampedEvening,
} from './seasonCounters';
import {
  todayIn,
  isSeasonOver,
  seasonEndDate,
  nextSeasonStart,
  isCalendarDate,
  isValidSeasonMonths,
  type CalendarDate,
} from './seasonDates';
import { planActivation, MIN_SEASON_ROUNDS, type HistoryChoice } from './seasonActivation';
import {
  eveningPlayState,
  didEveningHappen,
  type PlayableEvening,
} from './eveningPlayed';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions as getGcpFunctions } from 'firebase-admin/functions';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { runReviewAlerts } from './reviewAlerts';
import {
  balanceCore,
  buildPairRepeatWeights,
  HISTORY_GAMES,
  NEUTRAL_RATING,
  type BalanceBand,
  normalizeRating,
  type PastSplit,
} from './teamBalanceCore';
import {
  pairsFromRounds,
  pairMembers,
  type ChemistryRound,
  type PairTotals,
} from './clubChemistry';
import {
  buildRoundSummary,
  nextRecordBaseline,
  type ClubRecordBaseline,
  type ClubTotals,
  type PersonalBest,
  type PlayerCareer,
  type PlayerEvening,
  type RoundRec,
} from './roundSummary';
import { pushToAdmins } from './adminPush';
import { processCampaign, sweepDueCampaigns, recordCampaignMetric } from './adminUserPush';
import {
  NotificationKind as DedupeKind,
  NotificationEntity,
  cooldownMsFor,
  dedupeIdFor,
  dedupeKeyFor,
  inferEntityFromPayload,
} from './notificationDedup';
import { holidayNameOnDate } from './holidays';
import { computeMovement } from './eveningMovement';

// Chat fan-out + "one push per chat until opened" — defined in its own
// module, re-exported so Cloud Functions discovers the triggers.
export { onGameChatMessage, onCommunityChatMessage, onDmChatMessage } from './chatPush';

admin.initializeApp();
const db = admin.firestore();
// Skip — rather than reject — undefined fields on writes. Without this,
// a single optional-and-absent field in a notification payload (e.g. a
// game with no `fieldName`) throws "Cannot use undefined as a Firestore
// value" and silently drops the whole push. Omitting the field is always
// the safer outcome for our resilient notification writes.
db.settings({ ignoreUndefinedProperties: true });
const messaging = admin.messaging();

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

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
const ASC_P8 = defineSecret('ASC_P8');
const PLAY_SA = defineSecret('PLAY_SA');

// ─── Types (loose — Firestore docs are dynamic) ────────────────────────

type NotificationType =
  | 'joinRequest'
  | 'approved'
  | 'rejected'
  | 'newGameInCommunity'
  | 'gameReminder'
  | 'gameCanceledOrUpdated'
  | 'spotOpened'
  | 'spotOffered'
  | 'guestPromoted'          // → the adder: "האורח שלך נכנס להרכב"
  | 'growthMilestone'
  | 'inviteToGame'
  | 'addedToGame'
  | 'rateReminder'
  | 'gameFillingUp'
  | 'gameRsvpNudge'
  | 'gamePlayersJoined'
  | 'playerCancelled'
  | 'groupDeleted'
  // Cross-community filler matching (Phase 1)
  | 'fillerOpportunity'      // → candidate: "קהילה X זקוקה לשחקנים"
  | 'fillerInterestReceived' // → admin: "X מעוניין למלא"
  | 'fillerNoCandidates'     // → admin: "אין כרגע מועמדים מתאימים"
  | 'gameShortageWarning'    // → admin: "אין מספיק שחקנים — תחליט אם לבטל"
  // Orphan-game → community promote flow
  | 'promotePrompt'          // → creator: "צור קהילה מהמשחק שלך"
  | 'groupInvitation'        // → participant: "X יצר קהילה ומזמין אותך"
  // Mutual friendships
  | 'friendRequest'          // → recipient: "X רוצה להתחבר אליך"
  | 'friendRequestAccepted'  // → sender: "X אישר את בקשת החברות"
  // Auto-balanced teams ready (per-player: "אתה בקבוצה עם …")
  | 'teamsGenerated'
  // Evening finished → per-player "your night summary is ready" push.
  // Carries `gameId` → deep-links to the EveningSummary card.
  | 'eveningSummary'
  | 'seasonSummary'
  // Organizer heads-up: a game (manual or a recurring clone) is scheduled on a
  // Jewish "no-play" holiday. Carries `gameId` + `holiday` (name).
  | 'gameOnHoliday';

interface NotificationDoc {
  type: NotificationType;
  recipientId: string;
  payload?: Record<string, unknown>;
  delivered?: boolean;
  /** Authenticated creator uid. The /notifications rules require a
   *  client-created doc, IF it sets createdByUid, to set it to the signed-in
   *  uid. Used to authorise fan-out sends (see isFanoutSenderAuthorized). */
  createdByUid?: string;
  /** Server-origin marker. Set ONLY by createNotificationOnce (Admin SDK,
   *  rules bypassed). The rules FORBID clients from setting it, so a truthy
   *  value proves the doc was minted server-side and can be trusted for
   *  fan-out without a per-sender admin check. */
  srv?: boolean;
}

interface UserDoc {
  /** The user's uid — set by loadUsers so a failed FCM token can be
   *  pruned from the right user doc. */
  uid?: string;
  fcmTokens?: string[];
  notificationPrefs?: Partial<Record<NotificationType, boolean>>;
  newGameSubscriptions?: string[];
  /** Last-seen device platform. Used to skip iOS for Android-only silent
   *  pushes (home widget / Wear tile sync). */
  platform?: string;
  /** Epoch-ms of the last app-open presence ping (touchPresence, throttled
   *  ~6h). Powers the dormant-user gate in deliverBatch. Absent when the
   *  user has never opened a build that writes it (or the presence ping's
   *  feature flag is off) — absence is treated as ACTIVE, never dormant. */
  lastSeenAt?: number;
}

// ─── Growth milestone dispatcher ────────────────────────────────────────
//
// Push admins exactly once when a community crosses a member-count
// threshold. The list is intentionally short — sparse enough to feel
// like a meaningful event, dense enough at small scale to give early
// communities a few wins.
const GROWTH_MILESTONES = [10, 25, 50, 100, 250, 500] as const;

async function dispatchGrowthMilestoneIfNeeded(
  groupId: string,
  memberCount: number,
  adminIds: string[],
  groupName: string,
): Promise<void> {
  if (!groupId || adminIds.length === 0) return;
  // The largest milestone we've now reached. Note: a community that
  // jumps from 8 → 60 (e.g. CSV import) should announce 50, not all
  // intermediate milestones — chatty admins find that annoying.
  const reached = GROWTH_MILESTONES.filter((m) => memberCount >= m);
  if (reached.length === 0) return;
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
    if (!snap.exists) return false;
    const data = snap.data() as { notifiedMilestones?: number[] };
    const already = Array.isArray(data.notifiedMilestones)
      ? data.notifiedMilestones
      : [];
    if (already.includes(target)) return false;
    tx.update(groupRef, {
      notifiedMilestones: admin.firestore.FieldValue.arrayUnion(target),
      updatedAt: Date.now(),
    });
    return true;
  });
  if (!claimed) return;

  await Promise.allSettled(
    adminIds.map((adminUid) =>
      createNotificationOnce({
        type: 'growthMilestone',
        recipientId: adminUid,
        payload: {
          groupId,
          groupName,
          milestone: target,
          memberCount,
        },
      }),
    ),
  );
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
const STRICT_UNREAD_DEDUP: Partial<Record<DedupeKind, true>> = {
  gameCanceledOrUpdated: true,
};

// ─── Dormant-user push gate ─────────────────────────────────────────────
//
// A user who hasn't opened the app in this long stops receiving LOW-PRIORITY
// announcements/reminders — otherwise someone in several communities who
// never engages accumulates a push for every game in every community with no
// ceiling. Opening the app writes `lastSeenAt` (touchPresence) and lifts the
// gate on the very next launch, so it self-heals the moment they return.
//
// SAFETY: gated types are only the non-critical fan-outs below. Personal /
// actionable pushes (spot offered, added-to-game, invites, approvals, chat,
// teams-ready, friend requests, game-canceled) are NEVER suppressed — a
// dormant user must still learn the game they're IN was canceled. A missing
// `lastSeenAt` counts as ACTIVE (the presence ping is itself feature-flagged,
// so absence must not read as "dormant" and mute everyone).
const DORMANT_PUSH_CUTOFF_MS = 21 * 24 * 60 * 60 * 1000;
const DORMANT_SUPPRESSIBLE: Partial<Record<NotificationType, true>> = {
  newGameInCommunity: true,
  gameReminder: true,
  gameRsvpNudge: true,
  gameFillingUp: true,
  gamePlayersJoined: true,
  playerCancelled: true,
  eveningSummary: true,
  // seasonSummary is deliberately NOT here. Dormant suppression drops a push
  // for anyone not seen in 21 days, which is exactly the person a closing
  // season is for: someone who played the first half, drifted off, and is
  // being told what they did and which title they took. It fires once per
  // season per player, so it is not the kind of noise that rule exists to
  // stop. Suppressing it would silence precisely the audience.
  fillerOpportunity: true,
  growthMilestone: true,
  gameShortageWarning: true,
  promotePrompt: true,
};

// Types where a duplicate write inside the cooldown bucket should
// AGGREGATE the payload (count + appended id/name lists) into the
// existing unread doc instead of being dropped silently. The
// `onDocumentCreated` trigger only fires on the FIRST create, so the
// recipient still gets exactly ONE push for the cluster — but if
// they tap through to the in-app inbox, the doc reflects the latest
// aggregated state ("3 שחקנים ביטלו" instead of just the first one).
const AGGREGATE_ON_DUPLICATE: Partial<Record<DedupeKind, true>> = {
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
function buildAggregateUpdate(
  type: DedupeKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'playerCancelled') {
    const update: Record<string, unknown> = {
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
    const update: Record<string, unknown> = {
      'payload.count': admin.firestore.FieldValue.increment(1),
      updatedAtMs: Date.now(),
    };
    if (typeof payload.joinerIds === 'string' && payload.joinerIds) {
      update['payload.joinerIdList'] = admin.firestore.FieldValue.arrayUnion(
        payload.joinerIds,
      );
    }
    if (typeof payload.joinerNames === 'string' && payload.joinerNames) {
      update['payload.joinerNameList'] = admin.firestore.FieldValue.arrayUnion(
        payload.joinerNames,
      );
    }
    return update;
  }
  return {};
}

/**
 * Remove a set of uids from a game's drawn `draftTeams` and live `rotation` so a
 * player who left (self-cancel) doesn't linger as a ghost on a team — the
 * server-side twin of the client `pruneMemberFromTeams`. Returns only the keys
 * that actually change (empty object = nothing to prune).
 */
function pruneUidsFromTeamsSrv(
  d: Record<string, unknown>,
  gone: Set<string>,
): Record<string, unknown> {
  if (gone.size === 0) return {};
  const out: Record<string, unknown> = {};
  const draft = d.draftTeams as
    | { teams?: { playerIds?: string[] }[]; leftHome?: { playerId?: string }[] }
    | undefined;
  if (draft?.teams) {
    const inTeams = draft.teams.some((t) =>
      (t.playerIds ?? []).some((p) => gone.has(p)),
    );
    const inLeftHome = (draft.leftHome ?? []).some(
      (l) => l.playerId && gone.has(l.playerId),
    );
    if (inTeams || inLeftHome) {
      out.draftTeams = {
        ...draft,
        teams: draft.teams.map((t) => ({
          ...t,
          playerIds: (t.playerIds ?? []).filter((p) => !gone.has(p)),
        })),
        ...(inLeftHome
          ? {
              leftHome: (draft.leftHome ?? []).filter(
                (l) => !(l.playerId && gone.has(l.playerId)),
              ),
            }
          : {}),
      };
    }
  }
  const rotation = d.rotation as
    | {
        loans?: { playerId?: string }[];
        baseTeams?: { playerIds?: string[] }[];
      }
    | undefined;
  if (rotation) {
    const inLoans = (rotation.loans ?? []).some(
      (l) => l.playerId && gone.has(l.playerId),
    );
    const inBase = (rotation.baseTeams ?? []).some((t) =>
      (t.playerIds ?? []).some((p) => gone.has(p)),
    );
    if (inLoans || inBase) {
      out.rotation = {
        ...rotation,
        ...(inLoans
          ? {
              loans: (rotation.loans ?? []).filter(
                (l) => !(l.playerId && gone.has(l.playerId)),
              ),
            }
          : {}),
        ...(inBase
          ? {
              baseTeams: (rotation.baseTeams ?? []).map((t) => ({
                ...t,
                playerIds: (t.playerIds ?? []).filter((p) => !gone.has(p)),
              })),
            }
          : {}),
        updatedAt: Date.now(),
      };
    }
  }
  return out;
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
async function createNotificationOnce(input: {
  type: DedupeKind;
  recipientId: string;
  entityType?: NotificationEntity;
  entityId?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  /** Caller uid for audit + per-type abuse checks. Server callers pass
   *  the empty string (system-originated). */
  createdByUid?: string;
  /** Override the bucket time. Tests / cron-style flushes that want
   *  deterministic ids can pass a fixed value. */
  nowMs?: number;
}): Promise<{ wrote: boolean; id: string; skipped?: string }> {
  if (!input.recipientId || !input.type) {
    return { wrote: false, id: '', skipped: 'invalid-input' };
  }
  const payload = input.payload ?? {};
  const inferred = inferEntityFromPayload(
    input.type,
    input.recipientId,
    payload,
  );
  const dedupeInput = {
    type: input.type,
    recipientId: input.recipientId,
    entityType: input.entityType ?? inferred.entityType,
    entityId: input.entityId ?? inferred.entityId,
    reason: input.reason ?? inferred.reason,
  };
  const now = input.nowMs ?? Date.now();
  const id = dedupeIdFor(dedupeInput, now);
  const dedupeKey = dedupeKeyFor(dedupeInput);
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
        const dupData = dup.docs[0].data() as { createdAtMs?: number };
        const createdAtMs = Number(dupData.createdAtMs) || 0;
        if (now - createdAtMs < STALE_UNREAD_TTL_MS) {
          console.log(
            '[createNotificationOnce] suppressed by unread',
            { type: input.type, recipientId: input.recipientId, dedupeKey },
          );
          return { wrote: false, id, skipped: 'unread-exists' };
        }
        // Stale unread — fall through. The bucket-create below is
        // ALSO protected, so even if a stale doc exists with the
        // same id, we'll handle it via AlreadyExists.
      }
    } catch (err) {
      // Index missing / network blip — log but don't block. The
      // bucket-id create below still provides retry safety.
      console.warn(
        '[createNotificationOnce] strict-unread query failed',
        { type: input.type, recipientId: input.recipientId },
        err,
      );
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
    cooldownMs: cooldownMsFor(input.type),
    read: false,
    delivered: false,
    createdByUid: input.createdByUid ?? '',
    // Server-origin marker — trusted by isFanoutSenderAuthorized. Clients are
    // forbidden by the /notifications rules from setting `srv`.
    srv: true,
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
  };

  try {
    await ref.create(docBody);
    console.log(
      '[createNotificationOnce] wrote',
      {
        type: input.type,
        recipientId: input.recipientId,
        id,
        entityId: dedupeInput.entityId,
        reason: dedupeInput.reason,
      },
    );
    return { wrote: true, id };
  } catch (err) {
    // Firestore Admin throws AlreadyExists (gRPC code 6) when the
    // doc already exists. Any other code is a real failure.
    const code = (err as { code?: number | string }).code;
    const isAlreadyExists = code === 6 || code === 'already-exists';
    if (!isAlreadyExists) {
      console.error(
        '[createNotificationOnce] create failed',
        { type: input.type, recipientId: input.recipientId, id },
        err,
      );
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
        const data = snap.data() as
          | { read?: boolean; createdAtMs?: number }
          | undefined;
        const createdAtMs = Number(data?.createdAtMs) || 0;
        const stale =
          createdAtMs > 0 && now - createdAtMs >= STALE_UNREAD_TTL_MS;
        if (data && !data.read && !stale) {
          await ref.update(buildAggregateUpdate(input.type, payload));
          return { wrote: false, id, skipped: 'aggregated' };
        }
      } catch (mergeErr) {
        console.warn(
          '[createNotificationOnce] aggregation merge failed',
          { type: input.type, recipientId: input.recipientId, id },
          mergeErr,
        );
      }
    }
    return { wrote: false, id, skipped: 'duplicate-bucket' };
  }
}

// ─── Default Hebrew messages per type ──────────────────────────────────

function buildMessage(
  type: NotificationType,
  payload: Record<string, unknown>
): { title: string; body: string } | null {
  const groupName = (payload.groupName as string) || 'המועדון';
  const gameTitle = (payload.gameTitle as string) || (payload.title as string) || 'המשחק';
  const startsAt = payload.startsAt as number | undefined;
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
      const title = (payload.title as string) || groupName;
      return {
        title: `משחק חדש: ${title}`,
        body: when ? `${title} · ${when}` : `נפתח משחק חדש ב${title}`,
      };
    }
    case 'gameOnHoliday': {
      const holiday = (payload.holiday as string) || 'חג';
      return {
        title: 'משחק מתוזמן לחג',
        body: when
          ? `${gameTitle} מתוזמן ל${holiday} (${when}). אולי כדאי לבדוק.`
          : `${gameTitle} מתוזמן ל${holiday}. אולי כדאי לבדוק.`,
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
      // DIRECTED removal (admin kicked THIS player) → tell them plainly, not
      // the generic "game updated" (audit #12 follow-up).
      if (payload.directedTo) {
        return {
          title: 'הוסרת מהמשחק',
          body: `הוסרת מ${gameTitle} על ידי המנהל.`,
        };
      }
      if (action === 'cancelled' || action === 'deleted') {
        return {
          title: 'המשחק בוטל',
          body: `${gameTitle} בוטל. בדוק את לשונית המשחקים.`,
        };
      }
      // ── What actually changed ────────────────────────────────────────
      // Only TIME and PLACE ever reach the roster (see
      // src/utils/gameEditNotice), and the client sends them as DATA, not as
      // a sentence — the Hebrew is written here, beside every other push, so
      // the wording cannot drift between app versions and a client cannot put
      // words in our mouth.
      //
      // The time is stated outright, because that is the thing a player has to
      // re-plan around. The venue is only flagged as changed, deliberately
      // WITHOUT naming it: the address is right there in the game, and
      // spelling it out costs length without adding a decision.
      const timeChanged = payload.timeChanged === true;
      const placeChanged = payload.placeChanged === true;
      if (timeChanged || placeChanged) {
        if (timeChanged && placeChanged) {
          return {
            title: 'הזמן והמיקום השתנו',
            body: when
              ? `${gameTitle} מתחיל ${when}, והמיקום השתנה. בדוק בפרטי המחזור.`
              : `${gameTitle} — הזמן והמיקום השתנו. בדוק בפרטי המחזור.`,
          };
        }
        if (timeChanged) {
          return {
            title: 'הזמן השתנה',
            body: when
              ? `${gameTitle} מתחיל ${when}.`
              : `${gameTitle} — הזמן השתנה. בדוק בפרטי המחזור.`,
          };
        }
        return {
          title: 'המיקום השתנה',
          body: when
            ? `המיקום של ${gameTitle} (${when}) השתנה. בדוק בפרטי המחזור.`
            : `המיקום של ${gameTitle} השתנה. בדוק בפרטי המחזור.`,
        };
      }
      // Legacy clients send no `timeChanged`/`placeChanged` — they still get
      // the old, vague copy rather than nothing.
      return {
        title: 'המחזור עודכן',
        body: `${gameTitle} עודכן. בדוק את הפרטים בלשונית המשחקים.`,
      };
    }
    case 'spotOpened':
      return {
        title: 'נפתח לך מקום במשחק!',
        body: `מישהו ביטל ב${gameTitle} — אתה רשום כעת.`,
      };
    case 'guestPromoted': {
      // → the player who ADDED the guest (guests have no account to notify).
      const gName = (payload.guestName as string) || 'האורח שלך';
      return {
        title: 'האורח שלך נכנס להרכב!',
        body: when
          ? `${gName} עלה מרשימת ההמתנה להרכב ב${gameTitle} (${when}).`
          : `${gName} עלה מרשימת ההמתנה להרכב ב${gameTitle}.`,
      };
    }
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
      const inviter = (payload.inviterName as string) || 'מנהל המשחק';
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
      const adder = (payload.adderName as string) || 'מנהל המשחק';
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
      const remaining = (payload.remaining as number | undefined) ?? 0;
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
        ? (payload.joinerNames as string)
        : '';
      const names = namesCsv ? namesCsv.split(',').filter(Boolean) : [];
      const count = (payload.count as number | undefined) ?? names.length;
      const head =
        names.length === 0
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
      const name = (payload.groupName as string) || groupName;
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
      const registered =
        typeof payload.registered === 'number' ? payload.registered : 0;
      const required =
        typeof payload.required === 'number' ? payload.required : 0;
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
        ? (payload.gameTitles as unknown[]).filter(
            (s): s is string => typeof s === 'string' && s.length > 0,
          )
        : [];
      if (reason === 'accountDeleted' && titles.length > 0) {
        const list =
          titles.length === 1
            ? titles[0]
            : titles.length === 2
              ? `${titles[0]} ו-${titles[1]}`
              : `${titles.slice(0, 2).join(', ')} ועוד ${titles.length - 2}`;
        return {
          title: 'שחקן מחק את החשבון',
          body: `שחקן מחק את חשבונו והוסר מהמשחקים: ${list}.`,
        };
      }
      // Name the canceller in the body (organiser request — the generic
      // "שחקן ביטל" wasn't actionable). Prefer the aggregated distinct-name
      // list (arrayUnion, so already deduped); fall back to the single name,
      // and only to the generic "שחקן" when no name was captured.
      const names = Array.isArray(payload.cancellingUserNames)
        ? (payload.cancellingUserNames as unknown[]).filter(
            (s): s is string => typeof s === 'string' && s.length > 0,
          )
        : [];
      const singleName =
        typeof payload.cancellingUserName === 'string' &&
        payload.cancellingUserName.length > 0
          ? payload.cancellingUserName
          : '';
      const count = typeof payload.count === 'number' ? payload.count : 1;
      const plural = names.length >= 2 || count > 1;
      const who =
        names.length >= 2
          ? names.length === 2
            ? `${names[0]} ו-${names[1]}`
            : `${names.slice(0, 2).join(', ')} ועוד ${names.length - 2}`
          : names[0] || singleName || 'שחקן';
      const verb = plural ? 'ביטלו' : 'ביטל';
      const promoted = typeof payload.promotedUserId === 'string';
      return {
        title: plural ? 'שחקנים ביטלו השתתפות' : 'שחקן ביטל השתתפות',
        body: promoted
          ? `${who} ${verb} ב${gameTitle} — שחקן מרשימת ההמתנה אוּשר במקומו.`
          : `${who} ${verb} ב${gameTitle}. כדאי לחפש מחליף.`,
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
      const city =
        typeof payload.city === 'string' && payload.city.length > 0
          ? ` ב${payload.city}`
          : '';
      const shortBy =
        typeof payload.shortBy === 'number' && payload.shortBy > 0
          ? ` חסרים ${payload.shortBy} שחקנים.`
          : '';
      return {
        title: 'הזדמנות למילוי משחק',
        // Show the GAME name, never the community name — outside candidates
        // shouldn't see the club's identity here (organiser request).
        body: `${gameTitle}${city} צריך שחקנים${
          when ? ` — ${when}` : ''
        }.${shortBy} רוצה להגיש מועמדות?`,
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
      const inviter =
        typeof payload.inviterName === 'string'
          ? (payload.inviterName as string)
          : 'מארגן המשחק';
      const name = (payload.groupName as string) || groupName;
      return {
        title: 'הזמנה למועדון',
        body: `${inviter} מזמין אותך להצטרף ל"${name}". להיכנס ולאשר?`,
      };
    }
    case 'friendRequest': {
      // → recipient of a friend request. fromName is written
      // server-side from the canonical sender doc (no spoofing).
      const fromName =
        typeof payload.fromName === 'string' && payload.fromName.length > 0
          ? (payload.fromName as string)
          : 'שחקן';
      return {
        title: 'בקשת חברות חדשה',
        body: `${fromName} רוצה להתחבר אליך כחבר. אשר או דחה בפרופיל.`,
      };
    }
    case 'friendRequestAccepted': {
      // → original sender, once the recipient accepted.
      const fromName =
        typeof payload.fromName === 'string' && payload.fromName.length > 0
          ? (payload.fromName as string)
          : 'שחקן';
      return {
        title: 'בקשת החברות אושרה 🤝',
        body: `${fromName} אישר/ה את בקשת החברות שלך.`,
      };
    }
    case 'teamsGenerated': {
      // Per-player: the dispatcher pre-computes `teammates` (this player's
      // same-team members' first names) so the body is personal.
      const teammates =
        typeof payload.teammates === 'string' && payload.teammates.length > 0
          ? (payload.teammates as string)
          : '';
      return {
        title: 'הכוחות להיום מוכנים! ⚽',
        body: teammates
          ? `אתה בקבוצה עם ${teammates}`
          : 'הכוחות חולקו — לחץ לצפייה בקבוצות',
      };
    }
    case 'seasonSummary': {
      // A season just closed. Everyone who played in it gets their own card —
      // the numbers are per player, so the body cannot be generic without
      // being a lie about somebody.
      const no = typeof payload.seasonNo === 'number' ? payload.seasonNo : 0;
      const club = typeof payload.groupName === 'string' ? payload.groupName : '';
      return {
        title: no ? `עונה ${no} נגמרה 🏁` : 'העונה נגמרה 🏁',
        body: club
          ? `סיכום העונה שלך ב${club} מוכן — שערים, בישולים, ומי שיחק איתך הכי הרבה`
          : 'סיכום העונה שלך מוכן — שערים, בישולים, ומי שיחק איתך הכי הרבה',
      };
    }
    case 'eveningSummary':
      // Fired once per player when the evening finishes. Tapping opens the
      // shareable EveningSummary card for this game (gameId in the payload).
      return {
        title: 'סיכום הערב שלך מוכן! 🏆',
        body: `${gameTitle} נגמר — לחץ לצפייה בגולים, בישולים והציון שלך`,
      };
    default:
      return null;
  }
}

function formatHebrewWhen(ms: number): string {
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
  const tp = (t: string) => timeParts.find((p) => p.type === t)?.value ?? '';
  const time = `${tp('hour')}:${tp('minute')}`;

  // Calendar-day diff in Israel local time → היום / מחר.
  const ymd = (x: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(x);
  const diff = Math.round(
    (Date.parse(`${ymd(d)}T00:00:00Z`) -
      Date.parse(`${ymd(new Date())}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );
  if (diff === 0) return `היום ב-${time}`;
  if (diff === 1) return `מחר ב-${time}`;

  const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const dayMap: Record<string, number> = {
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
  const dp = (t: string) => dParts.find((p) => p.type === t)?.value ?? '';
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
async function loadUsers(uids: string[]): Promise<UserDoc[]> {
  if (uids.length === 0) return [];
  const unique = Array.from(new Set(uids));
  const out: UserDoc[] = [];
  // Chunk the getAll. A big fan-out (e.g. a 300-subscriber community's
  // newGameInCommunity push) built ONE getAll of 2×N refs → a giant gRPC
  // message at risk of the size cap / timeout. ≤150 uids (≤300 refs) per call.
  const CHUNK = 150;
  for (let start = 0; start < unique.length; start += CHUNK) {
    const slice = unique.slice(start, start + CHUNK);
    const userRefs = slice.map((u) => db.collection('users').doc(u));
    const privateRefs = slice.map((u) =>
      db.collection('users').doc(u).collection('private').doc('push'),
    );
    const all = await db.getAll(...userRefs, ...privateRefs);
    const half = slice.length;
    for (let i = 0; i < half; i++) {
      const userSnap = all[i];
      const privSnap = all[i + half];
      if (!userSnap.exists) continue;
      const root = userSnap.data() as UserDoc;
      const uid = userSnap.id;
      if (privSnap.exists) {
        const priv = privSnap.data() as {
          fcmTokens?: string[];
          notificationPrefs?: UserDoc['notificationPrefs'];
        };
        out.push({
          ...root,
          uid,
          fcmTokens: priv.fcmTokens ?? root.fcmTokens,
          notificationPrefs:
            priv.notificationPrefs ?? root.notificationPrefs,
        });
      } else {
        out.push({ ...root, uid });
      }
    }
  }
  return out;
}

// Notification types that fan a SINGLE client write out to MANY recipients.
// These are the mass-spoof vector: without a sender check, any signed-in
// user could write one `newGameInCommunity` doc for a community they don't
// belong to and blast every subscriber a push with attacker-chosen text.
const FANOUT_NOTIF_TYPES = new Set<string>([
  'newGameInCommunity',
  'gameCanceledOrUpdated',
  'gamePlayersJoined',
  'gameFillingUp',
]);

// Verify the CLAIMED sender of a fan-out notification is actually allowed to
// address that audience. createdByUid is trustworthy: the rules force a
// client doc to carry createdByUid == the authenticated uid, and server
// (Admin SDK) docs pass '' — which we trust as system-originated.
async function isFanoutSenderAuthorized(
  notif: NotificationDoc,
): Promise<boolean> {
  // Trust ONLY docs minted server-side (Admin SDK sets srv:true; clients are
  // forbidden by rules from setting it). Previously an EMPTY createdByUid was
  // trusted as "system" — but the rules tolerate a missing createdByUid, so an
  // attacker could OMIT it and get a free fan-out. srv is unspoofable.
  if (notif.srv === true) return true;
  const createdBy = notif.createdByUid ?? '';
  // No verifiable sender (client omitted createdByUid) → cannot authorise a
  // fan-out. Deliver to nobody. (Legit new clients always stamp createdByUid.)
  if (createdBy === '') return false;
  const payload = notif.payload || {};
  const groupId =
    (payload.groupId as string) ||
    (notif.type === 'newGameInCommunity' ? notif.recipientId : '') ||
    '';
  const gameId = (payload.gameId as string) || '';
  // Community admin? (covers newGameInCommunity, gamePlayersJoined,
  // gameFillingUp, and cancel/delete where groupId is stamped.)
  if (groupId) {
    const grp = await db.collection('groups').doc(groupId).get();
    const admins = (grp.data()?.adminIds as string[] | undefined) ?? [];
    if (admins.includes(createdBy)) return true;
  }
  // Game organiser (or an admin of the game's community).
  if (gameId) {
    const g = await db.collection('games').doc(gameId).get();
    const gd = g.data() as
      | { createdBy?: string; groupId?: string }
      | undefined;
    if (gd?.createdBy === createdBy) return true;
    if (gd?.groupId) {
      const grp = await db.collection('groups').doc(gd.groupId).get();
      const admins = (grp.data()?.adminIds as string[] | undefined) ?? [];
      if (admins.includes(createdBy)) return true;
    }
  }
  return false;
}

async function resolveRecipients(
  notif: NotificationDoc
): Promise<UserDoc[]> {
  const payload = notif.payload || {};

  // Sender-authorisation gate for fan-out types. An unverifiable or
  // unauthorised sender fans out to NOBODY (the whole exploit is one
  // spoofed write → mass push).
  if (FANOUT_NOTIF_TYPES.has(notif.type)) {
    if (!(await isFanoutSenderAuthorized(notif))) {
      console.warn('[resolveRecipients] fan-out blocked: unauthorised sender', {
        type: notif.type,
        createdBy: notif.createdByUid ?? '',
        recipientId: notif.recipientId,
      });
      return [];
    }
  }

  if (notif.type === 'newGameInCommunity') {
    const groupId = (payload.groupId as string) || notif.recipientId;
    if (!groupId) return [];
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
    const createdBy =
      typeof payload.createdBy === 'string' ? payload.createdBy : '';
    const snap = await db
      .collection('users')
      .where('newGameSubscriptions', 'array-contains', groupId)
      .get();
    // Re-route through `loadUsers` so the per-user private/push
    // subcollection (fcmTokens + notificationPrefs) is merged in.
    // The query returns only the root user doc, which post-migration
    // has empty / stale fcmTokens.
    let uids = snap.docs
      .map((d) => d.id)
      .filter((uid) => uid !== createdBy);
    // Exclude anyone ALREADY on this game's roster — most importantly the
    // regulars an admin pre-RESERVED on a scheduled game: without this they got
    // a spurious "new game in the community!" push when registration opened,
    // even though they were already registered.
    const gameIdForNew =
      typeof payload.gameId === 'string' ? payload.gameId : '';
    if (gameIdForNew) {
      try {
        const gSnap = await db.collection('games').doc(gameIdForNew).get();
        if (gSnap.exists) {
          const gd = gSnap.data() as {
            players?: string[];
            waitlist?: string[];
            pending?: string[];
          };
          const inRoster = new Set<string>([
            ...(gd.players ?? []),
            ...(gd.waitlist ?? []),
            ...(gd.pending ?? []),
          ]);
          uids = uids.filter((uid) => !inRoster.has(uid));
        }
      } catch (err) {
        console.warn('[newGameInCommunity] roster exclude failed', err);
      }
    }
    // Defense-in-depth: only CURRENT members of the community get the push.
    // `newGameSubscriptions` can be STALE for an ex-member — they left before
    // the unsubscribe-on-leave cleanup existed, or via a path that didn't fire
    // onGroupPendingChanged — and the games are members-only, so an ex-member's
    // push is a dead end ("לסגל בלבד" on tap, user report: Linoy Levi). Intersect
    // the subscribers with the group's live roster. Fail OPEN (skip the filter)
    // if the group read fails or returns empty, so a transient hiccup can't
    // silence a legitimate community-wide push.
    try {
      const grpSnap = await db.collection('groups').doc(groupId).get();
      const members = new Set<string>(
        (grpSnap.data() as { playerIds?: string[] } | undefined)?.playerIds ?? [],
      );
      if (members.size > 0) {
        uids = uids.filter((uid) => members.has(uid));
      }
    } catch (err) {
      console.warn('[newGameInCommunity] membership filter failed', groupId, err);
    }
    // Always include the organiser on a registration-open push, even if
    // they never toggled the community's new-game subscription — they
    // scheduled the game and expect the "registration opened" ping.
    // `flipScheduledGameOnce` passes their uid here (the manual-creation
    // path doesn't, so it stays self-excluded).
    const alsoNotify =
      typeof payload.alsoNotifyUid === 'string' ? payload.alsoNotifyUid : '';
    if (alsoNotify && alsoNotify !== createdBy && !uids.includes(alsoNotify)) {
      uids.push(alsoNotify);
    }
    return loadUsers(uids);
  }

  if (
    notif.type === 'gameReminder' ||
    notif.type === 'gameCanceledOrUpdated' ||
    notif.type === 'rateReminder'
  ) {
    const gameId = (payload.gameId as string) || notif.recipientId;
    if (!gameId) return [];
    // DIRECTED variant: an admin removing ONE player sends a "you were removed"
    // push meant for that single uid — NOT a roster-wide fan-out. Without this
    // the whole remaining roster got a spurious "game updated" push and the
    // kicked player got nothing (audit #12).
    if (
      notif.type === 'gameCanceledOrUpdated' &&
      typeof payload.directedTo === 'string' &&
      payload.directedTo
    ) {
      return loadUsers([payload.directedTo as string]);
    }
    const gSnap = await db.collection('games').doc(gameId).get();
    // When the game doc is gone (gameCanceledOrUpdated action='deleted'
    // hard-deletes it), fall back to the roster the client captured on
    // the payload before deleting — otherwise NO registered player would
    // be notified that the game was cancelled.
    const g:
      | { players?: string[]; waitlist?: string[]; pending?: string[] }
      | null = gSnap.exists
      ? (gSnap.data() as { players?: string[]; waitlist?: string[]; pending?: string[] })
      : Array.isArray(payload.recipientUids)
        ? { players: payload.recipientUids as string[] }
        : null;
    if (!g) return [];
    const ids =
      notif.type === 'gameCanceledOrUpdated'
        ? Array.from(
            new Set([
              ...(g.players || []),
              ...(g.waitlist || []),
              ...(g.pending || []),
            ])
          )
        : g.players || []; // gameReminder + rateReminder → players only
    // Self-exclusion: the admin who edited / cancelled the game is
    // typically also a player (organisers usually play). They DON'T
    // need a "המשחק עודכן" push for an action they themselves just
    // took — that's the most common spam complaint. The dispatch
    // sites stamp the editor uid on the payload; absence of the
    // field falls back to the no-op behaviour from before.
    if (notif.type === 'gameCanceledOrUpdated') {
      const editorUid =
        typeof payload.editorUid === 'string'
          ? (payload.editorUid as string)
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
    const groupId = (payload.groupId as string) || '';
    if (!groupId) return [];
    const grpSnap = await db.collection('groups').doc(groupId).get();
    if (!grpSnap.exists) return [];
    const grp = grpSnap.data() as { adminIds?: string[] };
    const joinerCsv =
      typeof payload.joinerIds === 'string'
        ? (payload.joinerIds as string)
        : '';
    const joinerSet = new Set(joinerCsv.split(',').filter(Boolean));
    const recipients = (grp.adminIds || []).filter(
      (uid) => !joinerSet.has(uid),
    );
    return loadUsers(recipients);
  }

  if (notif.type === 'gameFillingUp') {
    // Fan out to community members who could still join — exclude
    // anyone already on the roster (players, waitlist, pending). The
    // `recipientId` carries the gameId; payload.groupId is required.
    const gameId = (payload.gameId as string) || notif.recipientId;
    const groupId = payload.groupId as string | undefined;
    if (!gameId || !groupId) return [];
    const [gSnap, grpSnap] = await Promise.all([
      db.collection('games').doc(gameId).get(),
      db.collection('groups').doc(groupId).get(),
    ]);
    if (!gSnap.exists || !grpSnap.exists) return [];
    const g = gSnap.data() as {
      players?: string[];
      waitlist?: string[];
      pending?: string[];
    };
    const grp = grpSnap.data() as { playerIds?: string[] };
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

async function deliverBatch(
  type: NotificationType,
  recipients: UserDoc[],
  message: { title: string; body: string },
  data: Record<string, string>
): Promise<{ ok: number; failed: number; skippedPref: number; skippedNoToken: number; skippedDormant: number }> {
  // Aggregate tokens across all recipients into a Set so a user with
  // the same device registered twice (or two recipients sharing a
  // token, which shouldn't happen but cheap to guard) doesn't get a
  // duplicate push for one logical notification.
  const tokens = new Set<string>();
  // token → owning uid, so an FCM "token not registered" failure can be
  // pruned from the right user doc (stale tokens otherwise live forever
  // and every push to them is silently lost — exactly the symptom hit by
  // users whose token refresh was blocked by the old /users rules bug).
  const tokenToUser = new Map<string, string>();
  let skippedPref = 0;
  let skippedNoToken = 0;
  let skippedDormant = 0;
  // Dormant-user gate (see DORMANT_SUPPRESSIBLE): for low-priority types only,
  // users inactive ≥21d are skipped. Computed once per batch.
  const dormantGated = DORMANT_SUPPRESSIBLE[type] === true;
  const dormantCutoff = Date.now() - DORMANT_PUSH_CUTOFF_MS;
  // Map notification TYPE → the pref KEY that gates it. Most match 1:1, but
  // 'approved'/'rejected' are two types governed by the single 'approvedRejected'
  // toggle — without this map a user who turned that toggle OFF still got the
  // pushes (the gate looked up a non-existent 'approved'/'rejected' key).
  //
  // 'seasonSummary' and 'eveningSummary' take the 1:1 branch, i.e. the keys
  // `seasonSummary` and `eveningSummary`. That is the contract the client must
  // ship the toggles under — and it is not honoured end-to-end yet: neither key
  // is in `defaultNotificationPrefs`, and `readNotificationPrefs` rebuilds the
  // object from that list, so a stored `seasonSummary: false` is dropped on
  // read and can never be written back. Until those land, the gate below is
  // dead for both — which matters most for seasonSummary, the one type that
  // deliberately ignores the dormant cutoff and so pushes people who have not
  // opened the app in three weeks with no switch anywhere in the app.
  const prefKey =
    type === 'approved' || type === 'rejected'
      ? 'approvedRejected'
      : // friendRequest + friendRequestAccepted share the single 'friendRequest'
        // toggle; without this a user who muted friend-requests still received
        // the "your request was accepted" push (no 'friendRequestAccepted' key
        // exists, so the gate never matched).
        type === 'friendRequest' || type === 'friendRequestAccepted'
        ? 'friendRequest'
        : type;
  for (const user of recipients) {
    if (
      (user.notificationPrefs as Record<string, boolean> | undefined)?.[
        prefKey
      ] === false
    ) {
      skippedPref++;
      continue;
    }
    // Dormant gate — only for low-priority types, and only when we have a
    // real lastSeenAt that's older than the cutoff. Missing/zero → active.
    if (dormantGated) {
      const ls = typeof user.lastSeenAt === 'number' ? user.lastSeenAt : 0;
      if (ls > 0 && ls < dormantCutoff) {
        skippedDormant++;
        continue;
      }
    }
    const userTokens = (user.fcmTokens || []).filter(
      (t) => typeof t === 'string' && t.length > 0
    );
    if (userTokens.length === 0) {
      skippedNoToken++;
      continue;
    }
    userTokens.forEach((t) => {
      tokens.add(t);
      if (user.uid && !tokenToUser.has(t)) tokenToUser.set(t, user.uid);
    });
  }

  if (skippedPref > 0) {
    console.log(
      `[notifications] ${type}: skipped ${skippedPref} user(s) — pref off`
    );
  }
  if (skippedNoToken > 0) {
    console.log(
      `[notifications] ${type}: skipped ${skippedNoToken} user(s) — no fcm token`
    );
  }
  if (skippedDormant > 0) {
    console.log(
      `[notifications] ${type}: skipped ${skippedDormant} user(s) — dormant ≥21d`
    );
  }

  if (tokens.size === 0) {
    return { ok: 0, failed: 0, skippedPref, skippedNoToken, skippedDormant };
  }

  // Notifications that should render with action buttons advertise
  // a category id; expo-notifications matches it against the
  // categories the client registered at boot (see App.tsx) and the
  // OS draws the buttons. `gameReminder` and `gameRsvpNudge` share
  // the "אני בא / לא בא" pair; `spotOffered` uses its own
  // "אישור הגעה / ויתור" pair.
  let categoryIdentifier: string | undefined;
  if (type === 'newGameInCommunity') {
    // Registration-just-opened announcement → "מגיע" (join) / "לא מגיע"
    // (dismiss). NOT the reminder category, whose "לא בא" cancels a
    // registration the recipient doesn't have yet.
    categoryIdentifier = 'NEW_GAME_RSVP';
  } else if (type === 'spotOffered') {
    categoryIdentifier = 'SPOT_OFFER';
  }
  // `fillerOpportunity` intentionally carries NO action buttons: the old
  // "לא הפעם" was a silent no-op (identical to just dismissing the push) and
  // the one-tap "מעוניין" was redundant — tapping the push opens the game
  // screen where the candidate can express interest. Plain tap-to-open only.

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
  const deadTokens = new Set<string>();
  // Prune ONLY on codes that mean the token itself is permanently dead.
  // 'messaging/invalid-argument' is frequently a MESSAGE-level rejection
  // (oversized/invalid payload), not a per-token one — treating it as a dead
  // token let a single bad message delete the valid tokens of every recipient
  // in the chunk, silently disabling their push until a cold-start re-register.
  const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ]);
  // A raw APNs device token is 64 hex characters. FCM answers one with
  // INVALID_ARGUMENT — which is ALSO what it answers for a malformed message,
  // so that code can never join DEAD_TOKEN_CODES: one bad payload would prune
  // every token we hold in a single run. Guarding on the token's SHAPE makes
  // the prune safe, because a message-level failure cannot make a valid FCM
  // token look like 64 hex characters.
  //
  // The client stopped producing these (it now takes the token from
  // @react-native-firebase/messaging, which performs the APNs→FCM exchange),
  // and the 154 already stored were cleaned out on 2026-08-27. This is the
  // backstop for anything that slips through from an old build.
  const looksLikeApnsToken = (t: string) => /^[0-9a-f]{64}$/i.test(t);
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const baseData: Record<string, string> = categoryIdentifier
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
      console.warn(
        `[notifications] ${type}: ${res.failureCount} FCM failure(s) of ${chunk.length}`,
        JSON.stringify(failures.slice(0, 5)),
      );
      // Flag permanently-invalid tokens for pruning.
      res.responses.forEach((r, idx) => {
        if (!r.success && r.error) {
          const tok = chunk[idx];
          const shapeDead =
            r.error.code === 'messaging/invalid-argument' &&
            !!tok &&
            looksLikeApnsToken(tok);
          if (tok && (DEAD_TOKEN_CODES.has(r.error.code) || shapeDead)) {
            deadTokens.add(tok);
          }
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
    const byUser = new Map<string, string[]>();
    for (const tok of deadTokens) {
      const uid = tokenToUser.get(tok);
      if (!uid) continue;
      const arr = byUser.get(uid) ?? [];
      arr.push(tok);
      byUser.set(uid, arr);
    }
    await Promise.allSettled(
      Array.from(byUser.entries()).flatMap(([uid, toks]) => [
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
          // The varargs form, not an object literal: the client stores which
          // device each token came from under `devices[<token>]`, and an FCM
          // token contains ':' and '-', which a dotted string path would need
          // escaped. A FieldPath skips the parser entirely. Deleting these
          // alongside the token keeps the map from growing forever with
          // entries describing devices that can no longer be reached.
          .update(
            'fcmTokens',
            admin.firestore.FieldValue.arrayRemove(...toks),
            ...toks.flatMap((t) => [
              new admin.firestore.FieldPath('devices', t),
              admin.firestore.FieldValue.delete(),
            ]),
          )
          .catch(() => undefined),
      ]),
    );
    console.log(
      `[notifications] ${type}: pruned ${deadTokens.size} dead token(s) across ${byUser.size} user(s)`,
    );
  }

  console.log(
    `[notifications] ${type}: dispatched tokens=${tokens.size} ok=${ok} failed=${failed} skippedPref=${skippedPref} skippedNoToken=${skippedNoToken} skippedDormant=${skippedDormant} categoryIdentifier=${categoryIdentifier ?? 'none'}`,
  );
  return { ok, failed, skippedPref, skippedNoToken, skippedDormant };
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
async function canonicaliseNotificationPayload(
  raw: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...(raw || {}) };
  const gameId =
    typeof payload.gameId === 'string' ? (payload.gameId as string) : '';
  const groupId =
    typeof payload.groupId === 'string'
      ? (payload.groupId as string)
      : '';
  const fetches: Promise<unknown>[] = [];
  if (gameId) {
    fetches.push(
      db
        .collection('games')
        .doc(gameId)
        .get()
        .then((snap) => {
          if (!snap.exists) return;
          const g = snap.data() as { title?: string; startsAt?: number };
          if (typeof g.title === 'string') payload.gameTitle = g.title;
          if (typeof g.startsAt === 'number') payload.startsAt = g.startsAt;
        })
        .catch(() => {
          /* best-effort */
        }),
    );
  }
  if (groupId) {
    fetches.push(
      db
        .collection('groups')
        .doc(groupId)
        .get()
        .then((snap) => {
          if (!snap.exists) return;
          const g = snap.data() as { name?: string };
          if (typeof g.name === 'string') payload.groupName = g.name;
        })
        .catch(() => {
          /* best-effort */
        }),
    );
  }
  await Promise.all(fetches);
  return payload;
}

export const onNotificationCreated = onDocumentCreated(
  'notifications/{id}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const notif = snap.data() as NotificationDoc;
    if (notif.delivered) return;

    // Game-update / cancel / delete dedup: any of these actions
    // shouldn't fan out twice within the dedup window. We use a
    // per-gameId latch doc with `lastDispatchedAt`; if fresh, skip
    // this push. Defense against:
    //   • admin editing a game 3 times in 30s (`updated`)
    //   • multiple cascade dispatches accidentally hitting the
    //     same game (`cancelled` / `deleted`)
    // Updating the latch is best-effort — if it fails the worst
    // case is one duplicate push, which is fine.
    if (
      notif.type === 'gameCanceledOrUpdated' &&
      (notif.payload?.action === 'updated' ||
        notif.payload?.action === 'cancelled' ||
        notif.payload?.action === 'deleted') &&
      typeof notif.payload?.gameId === 'string'
    ) {
      const gameId = notif.payload.gameId as string;
      // Namespace the latch by action CATEGORY so a genuine cancellation is
      // never deduped against a preceding edit. Before, both shared one
      // per-game latch: editing a game then cancelling it within 60s made
      // the cancel push get dropped as a "duplicate" — players never learned
      // the game was cancelled. Edit-vs-edit and cancel-vs-cancel still dedup.
      const latchCategory =
        notif.payload?.action === 'updated' ? 'update' : 'cancel';
      const latchRef = db
        .collection('gameUpdateLatches')
        .doc(`${gameId}__${latchCategory}`);
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
        await latchRef.set(
          { lastDispatchedAt: now, gameId },
          { merge: true },
        );
      } catch (err) {
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
    let skippedDormant = 0;
    try {
      const recipients = await resolveRecipients(notif);
      // The data payload that ships with the FCM message is built from
      // the CANONICAL values too — so a client that introspects the
      // raw push (Notifee / Notifications API) can't see spoofed
      // strings either.
      const data: Record<string, string> = {
        type: notif.type,
        ...Object.fromEntries(
          Object.entries(canonical).map(([k, v]) => [k, String(v)])
        ),
      };
      const res = await deliverBatch(notif.type, recipients, message, data);
      totalOk = res.ok;
      totalFailed = res.failed;
      skippedPref = res.skippedPref;
      skippedNoToken = res.skippedNoToken;
      skippedDormant = res.skippedDormant;
    } catch (err) {
      console.error('[onNotificationCreated] delivery failed', err);
    }

    // The stats block must account for EVERY recipient deliverBatch was handed,
    // because there is no in-app inbox: this is the only durable record that a
    // push existed at all. It omitted skippedDormant, the one reason that can
    // account for an entire batch on its own, so 279 of the 1,206 docs that
    // carry a block (23%) read {ok:0, failed:0, skippedPref:0, skippedNoToken:0}
    // — a deliberately-suppressed announcement and a silently-broken dispatcher
    // were the same four zeroes. The number was only ever in the Cloud Run log
    // line, which ages out after 30 days.
    await snap.ref.update({
      delivered: true,
      deliveredAt: Date.now(),
      stats: {
        ok: totalOk,
        failed: totalFailed,
        skippedPref,
        skippedNoToken,
        skippedDormant,
      },
    });
  }
);

// ─── Game reminder — EXACTLY 1h before kickoff ─────────────────────────
// Primary path: a precise Cloud Task fires at startsAt−60min (enqueued in
// enqueueGameMoments). The cron below is a SAFETY NET only — it never fires
// earlier than ~1h before, so it can't produce the old "1h07m early" reminder.
const REMINDER_LEAD_MS = 60 * 60 * 1000;

// Send the 1h reminder for a single game, with the reminderSent latch. Shared
// by the precise task and the safety-net cron. Returns true if it dispatched.
async function sendGameReminderForGame(
  gameId: string,
  opts?: { enforceLead?: boolean },
): Promise<boolean> {
  const ref = db.collection('games').doc(gameId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const g = snap.data() as {
    title?: string;
    startsAt?: number;
    status?: string;
    reminderSent?: boolean;
    players?: string[];
  };
  if (g.reminderSent) return false;
  if (g.status && g.status !== 'open' && g.status !== 'locked') return false;
  if (!g.players || g.players.length === 0) return false;
  // Precise-task path: only fire if we're actually ~1h before the CURRENT
  // kickoff. Guards against a stale task whose game was rescheduled after the
  // task was enqueued (Cloud Tasks can't be cancelled) — the new time's task
  // will fire correctly instead. The cron safety net skips this check.
  if (opts?.enforceLead) {
    const sa = typeof g.startsAt === 'number' ? g.startsAt : 0;
    if (Math.abs(sa - REMINDER_LEAD_MS - Date.now()) > 6 * 60 * 1000) {
      return false;
    }
  }
  // Notify FIRST, then flip the latch — so a failed notify leaves the flag
  // unset and the caller/next tick retries; createNotificationOnce dedupes.
  await createNotificationOnce({
    type: 'gameReminder',
    recipientId: gameId, // fan-out marker → g.players
    payload: { gameId, gameTitle: g.title || 'המשחק', startsAt: g.startsAt },
  });
  await ref.update({ reminderSent: true });
  return true;
}

async function runSendGameReminders(): Promise<void> {
  // SAFETY NET: catch unreminded games starting within the next 59 minutes —
  // i.e. games whose precise T-60 task never fired (task failure) or that were
  // CREATED less than an hour before kickoff (no time to schedule the task).
  // Upper bound < 60min guarantees the cron never fires a reminder EARLIER than
  // an hour before, so the precise task owns the exact-1h case.
  const now = Date.now();
  const upper = now + 59 * 60 * 1000;

  const snap = await db
    .collection('games')
    .where('startsAt', '>=', now)
    .where('startsAt', '<', upper)
    .get();

  if (snap.empty) {
    console.log('[sendGameReminders] no candidate games');
    return;
  }

  const ops = snap.docs
    .filter((doc) => (doc.data() as { reminderSent?: boolean }).reminderSent !== true)
    .map((doc) => sendGameReminderForGame(doc.id));

  const results = await Promise.allSettled(ops);
  const ok = results.filter(
    (r) => r.status === 'fulfilled' && r.value === true,
  ).length;
  console.log(`[sendGameReminders] safety-net dispatched ${ok} reminder(s)`);
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
async function runSendRsvpNudges(): Promise<void> {
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
    const g = doc.data() as {
      title?: string;
      startsAt?: number;
      status?: string;
      rsvpNudgeSent?: boolean;
      groupId?: string;
      createdBy?: string;
      players?: string[];
      waitlist?: string[];
      pending?: string[];
      cancellations?: Record<string, number>;
      guests?: unknown[];
      maxPlayers?: number;
    };
    if (g.rsvpNudgeSent) continue;
    if (g.status !== 'open') continue;
    if (!g.groupId) continue;
    const playersCount = g.players?.length ?? 0;
    // Only ACTIVE guests occupy a seat — counting waitlisted guests raw made a
    // game with open seats look full and skipped the RSVP fill nudge (audit
    // #18 class, missed site). Match reconcileGameJoins/adminAddPlayers.
    const guestsCount = Array.isArray(g.guests)
      ? (g.guests as { waitlisted?: boolean }[]).filter((x) => !x?.waitlisted)
          .length
      : 0;
    if (g.maxPlayers && playersCount + guestsCount >= g.maxPlayers) continue;

    // Pull the parent group to enumerate its members.
    const groupSnap = await db.collection('groups').doc(g.groupId).get();
    if (!groupSnap.exists) continue;
    const grp = groupSnap.data() as {
      playerIds?: string[];
      adminIds?: string[];
    };
    const members = new Set<string>([
      ...(grp.playerIds ?? []),
      ...(grp.adminIds ?? []),
    ]);

    // Exclusions: anyone already in any roster bucket, anyone who
    // already cancelled (they opted out), the organiser themselves.
    const exclude = new Set<string>([
      ...(g.players ?? []),
      ...(g.waitlist ?? []),
      ...(g.pending ?? []),
      ...Object.keys(g.cancellations ?? {}),
    ]);
    if (g.createdBy) exclude.add(g.createdBy);

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
        if (!fresh.exists) return;
        if ((fresh.data() as { rsvpNudgeSent?: boolean }).rsvpNudgeSent) {
          return;
        }
        tx.update(doc.ref, { rsvpNudgeSent: true });
        claimed = true;
      });
    } catch (e) {
      console.error('[sendRsvpNudges] latch txn failed', doc.id, e);
      continue;
    }
    if (!claimed) continue;
    if (targets.length === 0) continue;

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
      } catch (e) {
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
export const flushPendingJoinerNotifsTask = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 6 },
  },
  async (req) => {
    const { gameId } = (req.data ?? {}) as { gameId?: string };
    if (!gameId) {
      console.warn('[flushPendingJoinerNotifsTask] missing gameId');
      return;
    }
    const ref = db.collection('games').doc(gameId);

    // Claim transactionally — captures the joiner list AND clears the
    // buffer atomically. If the task fires twice (unlikely under Cloud
    // Tasks but possible after retry), the second one finds an empty
    // buffer and exits without dispatch.
    let claimedJoiners: string[] = [];
    let g: {
      title?: string;
      groupId?: string;
      startsAt?: number;
    } = {};
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists) return;
        const d = fresh.data() as {
          title?: string;
          groupId?: string;
          startsAt?: number;
          pendingJoinerIds?: string[];
          pendingJoinFlushAt?: number;
        };
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
    } catch (err) {
      console.error('[flushPendingJoinerNotifsTask] claim failed', gameId, err);
      throw err;       // task will retry per retryConfig
    }

    if (claimedJoiners.length === 0 || !g.groupId) return;

    // Resolve display names (best-effort).
    let names: string[] = [];
    try {
      const userRefs = claimedJoiners.map((uid) =>
        db.collection('users').doc(uid),
      );
      const userSnaps = await db.getAll(...userRefs);
      names = userSnaps
        .map((s) => {
          if (!s.exists) return '';
          const data = s.data() as { name?: string; displayName?: string };
          return (data.name || data.displayName || '').trim();
        })
        .filter((n) => n.length > 0);
    } catch (err) {
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
    } catch (err) {
      console.error('[flushPendingJoinerNotifsTask] dispatch failed', gameId, err);
      throw err;       // retry per retryConfig
    }
  },
);

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
// failed). `moment` is 'registrationOpen' | 'publicOpen' | 'reminder1h'
//         | 'autoTeams'.
export const scheduledGameMomentTask = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 6 },
  },
  async (req) => {
    const { gameId, moment } = (req.data ?? {}) as {
      gameId?: string;
      moment?: string;
      expectedAt?: number;
    };
    if (!gameId || !moment) {
      console.warn('[scheduledGameMomentTask] missing gameId/moment', req.data);
      return;
    }
    try {
      if (moment === 'registrationOpen') {
        const r = await flipScheduledGameOnce(gameId);
        console.log(`[scheduledGameMomentTask] registrationOpen ${gameId} → ${r}`);
      } else if (moment === 'publicOpen') {
        const r = await flipPublicGameOnce(gameId);
        console.log(`[scheduledGameMomentTask] publicOpen ${gameId} → ${r}`);
      } else if (moment === 'autoTeams') {
        // Fires at exactly `autoTeamsAt`. Previously this moment had no task at
        // all and rode the 5-minute sweep, so a split set for 19:00 was pushed
        // at 19:04 — the sweep's phase is wherever the scheduler happened to
        // land, and it drifts on every redeploy.
        const r = await generateDueAutoTeamsForGame(gameId);
        console.log(`[scheduledGameMomentTask] autoTeams ${gameId} → ${r}`);
      } else if (moment === 'reminder1h') {
        // Fires at exactly startsAt−60min. The helper re-checks status /
        // players / the reminderSent latch, so a cancelled or emptied game
        // (or one already reminded by the safety-net cron) sends nothing.
        const r = await sendGameReminderForGame(gameId, { enforceLead: true });
        console.log(`[scheduledGameMomentTask] reminder1h ${gameId} → ${r}`);
      } else {
        console.warn(`[scheduledGameMomentTask] unknown moment '${moment}'`);
      }
    } catch (err) {
      console.error('[scheduledGameMomentTask] failed', gameId, moment, err);
      throw err; // retry per retryConfig
    }
  },
);

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
async function enqueueGameMoments(
  gameId: string,
  before:
    | {
        registrationOpensAt?: number;
        publicOpenAt?: number;
        startsAt?: number;
        autoTeamsAt?: number;
      }
    | undefined,
  after: {
    status?: string;
    visibility?: string;
    registrationOpensAt?: number;
    publicOpenAt?: number;
    startsAt?: number;
    autoTeamsAt?: number;
  },
): Promise<void> {
  const now = Date.now();
  const horizon = now + MAX_TASK_HORIZON_MS;
  const ops: Array<{ moment: string; at: number }> = [];

  // registrationOpen — only meaningful while the game is still waiting
  // to open (status 'scheduled').
  const reg = after.registrationOpensAt;
  if (
    after.status === 'scheduled' &&
    typeof reg === 'number' &&
    reg > now + 1000 &&
    reg < horizon &&
    reg !== before?.registrationOpensAt
  ) {
    ops.push({ moment: 'registrationOpen', at: reg });
  }

  // publicOpen — community game scheduled to surface app-wide later.
  const pub = after.publicOpenAt;
  if (
    after.visibility === 'community' &&
    typeof pub === 'number' &&
    pub > now + 1000 &&
    pub < horizon &&
    pub !== before?.publicOpenAt
  ) {
    ops.push({ moment: 'publicOpen', at: pub });
  }

  // reminder1h — fire the "game starts in an hour" reminder at EXACTLY
  // startsAt−60min. Only when that instant is still in the future (a game
  // created <1h before kickoff falls to the safety-net cron) and within the
  // task horizon, and only when the kickoff time itself is new/changed.
  const sa = after.startsAt;
  if (
    typeof sa === 'number' &&
    sa - REMINDER_LEAD_MS > now + 1000 &&
    sa - REMINDER_LEAD_MS < horizon &&
    sa !== before?.startsAt
  ) {
    ops.push({ moment: 'reminder1h', at: sa - REMINDER_LEAD_MS });
  }

  // autoTeams — the admin-chosen wall-clock minute to build the split and push
  // every player their team. Only while the game is still open and unsplit;
  // once generated the field is deleted, so a stale task finds nothing to do.
  const ata = after.autoTeamsAt;
  if (
    after.status === 'open' &&
    typeof ata === 'number' &&
    ata > now + 1000 &&
    ata < horizon &&
    ata !== before?.autoTeamsAt
  ) {
    ops.push({ moment: 'autoTeams', at: ata });
  }

  if (ops.length === 0) return;

  for (const op of ops) {
    try {
      await getGcpFunctions()
        .taskQueue('scheduledGameMomentTask')
        .enqueue(
          { gameId, moment: op.moment, expectedAt: op.at },
          { scheduleTime: new Date(op.at) },
        );
      console.log(
        `[enqueueGameMoments] ${op.moment} for ${gameId} @ ${new Date(op.at).toISOString()}`,
      );
    } catch (err) {
      // Non-fatal — the safety-net cron will still pick this game up
      // within 5 minutes of the moment.
      console.error(
        `[enqueueGameMoments] enqueue ${op.moment} failed for ${gameId}`,
        err,
      );
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
const TAP_BACKDATE_GRACE_MS = 15_000;

async function reconcileGameJoins(gameId: string): Promise<void> {
  const gameRef = db.collection('games').doc(gameId);
  const reqCol = gameRef.collection('joinRequests');
  await db.runTransaction(async (tx) => {
    // Reads first (Admin SDK allows queries inside a transaction).
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) return;
    const queuedSnap = await tx.get(reqCol.where('state', '==', 'queued'));
    if (queuedSnap.empty) return;
    const g = gameSnap.data() as Record<string, unknown>;
    const now = Date.now();

    // Lifecycle gate — if the game isn't joinable, reject the whole batch
    // (the client surfaces a friendly message off the request doc state).
    const liveMatch = g.liveMatch as { phase?: string } | undefined;
    const notOpen = g.status !== 'open';
    // Honor the same 1h post-kickoff grace the client offers (canJoinGame /
    // LATE_REG_GRACE_MS) so a late-but-within-grace join the UI allowed isn't
    // rejected server-side. Live games are still blocked by `live` below.
    const LATE_REG_GRACE_MS = 60 * 60 * 1000;
    const started =
      typeof g.startsAt === 'number' &&
      (g.startsAt as number) + LATE_REG_GRACE_MS < now;
    const live = liveMatch?.phase === 'live';
    if (notOpen || started || live) {
      const reason = notOpen ? 'GAME_NOT_OPEN' : started ? 'GAME_STARTED' : 'GAME_LIVE';
      queuedSnap.docs.forEach((d) =>
        tx.update(d.ref, { state: 'rejected', reason, assignedAt: now }),
      );
      return;
    }

    // Order the batch by clamped tap time (network-independent), then receipt,
    // then uid — identical to assignJoins/orderJoinRequests.
    const reqs = queuedSnap.docs.map((d) => {
      const r = d.data() as { uid?: string; tappedAt?: number; requestedAt?: unknown };
      const receipt =
        r.requestedAt instanceof admin.firestore.Timestamp
          ? r.requestedAt.toMillis()
          : now;
      const rawTap =
        typeof r.tappedAt === 'number' && r.tappedAt > 0 ? r.tappedAt : receipt;
      const key = Math.max(rawTap, receipt - TAP_BACKDATE_GRACE_MS);
      return { ref: d.ref, uid: r.uid ?? d.id, key, receipt };
    });
    reqs.sort(
      (a, b) =>
        a.key - b.key ||
        a.receipt - b.receipt ||
        (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0),
    );

    const players = [...((g.players as string[]) ?? [])];
    const waitlist = [...((g.waitlist as string[]) ?? [])];
    const pending = [...((g.pending as string[]) ?? [])];
    const inAny = new Set([...players, ...waitlist, ...pending]);
    const rejected = (g.rejectedPlayerIds as string[]) ?? [];
    // Only ACTIVE (non-waitlisted) guests occupy a seat — a waitlisted guest's
    // flag is never cleared, so counting them raw (the old `.length`) made the
    // reconciler see a full game and wrongly waitlist a real joiner even after a
    // seat freed (audit #18). Matches every other capacity site.
    const guests = Array.isArray(g.guests)
      ? (g.guests as { waitlisted?: boolean }[]).filter((x) => !x?.waitlisted)
          .length
      : 0;
    const offer = (g.pendingPromotion as { uid?: string } | null)?.uid ? 1 : 0;
    const maxPlayers = typeof g.maxPlayers === 'number' ? (g.maxPlayers as number) : 15;
    const requiresApproval = g.requiresApproval === true;
    const createdBy = typeof g.createdBy === 'string' ? (g.createdBy as string) : '';
    // Users who were explicitly INVITED to this game bypass approval (an
    // invite IS the approval) — same exemption as the creator.
    const invitedUserIds = new Set((g.invitedUserIds as string[]) ?? []);
    const joinedAt: Record<string, number> =
      g.joinedAt && typeof g.joinedAt === 'object'
        ? { ...(g.joinedAt as Record<string, number>) }
        : {};
    // Clear a re-joiner's stale cancellation: someone who cancelled and then
    // re-joins must not linger in `cancellations` — otherwise they show up in
    // BOTH the roster and the "ביטלו השתתפות" list (user report).
    const cancellations: Record<string, number> =
      g.cancellations && typeof g.cancellations === 'object'
        ? { ...(g.cancellations as Record<string, number>) }
        : {};
    let cancellationsChanged = false;
    let occupancy = players.length + guests + offer;

    // Active red-card block: a member holding an ACTIVE red card in this game's
    // community can't SELF-register (admins adding a player use a different path
    // that bypasses this). Only new joiners are affected — anyone already in the
    // roster stays. One grouped read; mirrors src/utils/cardState.isActiveRedCard.
    const groupId = typeof g.groupId === 'string' ? (g.groupId as string) : '';
    const redBlocked = new Set<string>();
    if (groupId) {
      const grpSnap = await tx.get(db.collection('groups').doc(groupId));
      const grpData = grpSnap.exists
        ? (grpSnap.data() as {
            redCardValidityDays?: number | null;
            cardsEnabled?: boolean;
          })
        : null;
      // The cards master switch suspends ALL card behaviour, enforcement
      // included — skip the scan entirely when it's off (also spares the
      // read on the vast majority of games that never enabled cards).
      if (grpData?.cardsEnabled === true) {
        const redValidityDays = grpData.redCardValidityDays;
        const redSnap = await tx.get(
          db
            .collection('communityPlayerEvents')
            .where('groupId', '==', groupId)
            .where('type', '==', 'red')
            // Newest-first + bounded: an ACTIVE card is recent, so ordering by
            // `at desc` keeps it inside the window even if a long-lived club has
            // amassed >1000 (mostly expired/revoked) red docs. Backed by the
            // (groupId, type, at desc) composite index. Only runs when cards on.
            .orderBy('at', 'desc')
            .limit(1000),
        );
        for (const d of redSnap.docs) {
          const e = d.data() as {
            userId?: string;
            at?: number;
            revoked?: boolean;
            expiresAt?: number | null;
          };
          if (!e.userId || e.revoked) continue;
          // Prefer the expiry snapshotted at issue time; fall back to the live
          // group-validity computation for legacy cards that pre-date it.
          const exp =
            e.expiresAt !== undefined
              ? e.expiresAt
              : typeof redValidityDays === 'number' && redValidityDays > 0
                ? (e.at ?? 0) + redValidityDays * 86_400_000
                : null;
          const expired = exp !== null && now > exp;
          if (!expired) redBlocked.add(e.userId);
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
      let bucket: 'players' | 'waitlist' | 'pending';
      if (inAny.has(r.uid)) {
        bucket = players.includes(r.uid)
          ? 'players'
          : waitlist.includes(r.uid)
            ? 'waitlist'
            : 'pending';
      } else if (requiresApproval && r.uid !== createdBy && !invitedUserIds.has(r.uid)) {
        // Approval needed only for someone who is NEITHER the creator NOR an
        // explicitly invited user. Invited / creator join directly.
        pending.push(r.uid);
        bucket = 'pending';
      } else if (occupancy < maxPlayers) {
        // Free spot → seat directly. (A pending offer already counts toward
        // `occupancy`, so while the waitlist head is being asked to confirm the
        // seat is reserved and outsiders fall through to the waitlist below.)
        players.push(r.uid);
        occupancy += 1;
        bucket = 'players';
      } else {
        waitlist.push(r.uid);
        bucket = 'waitlist';
      }
      inAny.add(r.uid);
      if (joinedAt[r.uid] === undefined) joinedAt[r.uid] = r.receipt;
      if (cancellations[r.uid] !== undefined) {
        delete cancellations[r.uid];
        cancellationsChanged = true;
      }
      tx.update(r.ref, { state: 'assigned', bucket, assignedAt: now });
    }

    const participantIds = Array.from(
      new Set([...players, ...waitlist, ...pending]),
    );
    const update: Record<string, unknown> = {
      players,
      waitlist,
      pending,
      participantIds,
      joinedAt,
      updatedAt: now,
    };
    if (cancellationsChanged) update.cancellations = cancellations;
    tx.update(gameRef, update);
  });
}

// A new join request schedules a reconcile ~SETTLE later. A deterministic,
// time-bucketed task id dedupes the whole opening burst down to ONE reconcile
// (all the simultaneous taps map to the same id → only the first task lands).
export const onJoinRequestCreated = onDocumentCreated(
  'games/{gameId}/joinRequests/{uid}',
  async (event) => {
    const gameId = event.params.gameId as string;
    const windowBucket = Math.floor(Date.now() / JOIN_SETTLE_MS);
    try {
      await getGcpFunctions()
        .taskQueue('reconcileJoinsTask')
        .enqueue(
          { gameId },
          {
            scheduleTime: new Date(Date.now() + JOIN_SETTLE_MS),
            id: `rj-${gameId}-${windowBucket}`,
          },
        );
    } catch (err) {
      // ALREADY_EXISTS (gRPC code 6) → a reconcile for this window is already
      // scheduled. That's the dedupe working as intended; swallow it.
      const code = (err as { code?: number | string })?.code;
      if (code !== 6 && !String(err).includes('ALREADY_EXISTS')) {
        console.error('[onJoinRequestCreated] enqueue failed', gameId, err);
      }
    }
  },
);

export const reconcileJoinsTask = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 5 },
    rateLimits: { maxConcurrentDispatches: 6 },
  },
  async (req) => {
    const gameId = (req.data ?? {}).gameId as string | undefined;
    if (!gameId) return;
    try {
      await reconcileGameJoins(gameId);
    } catch (err) {
      console.error('[reconcileJoinsTask] failed', gameId, err);
      throw err; // retry per retryConfig
    }
  },
);

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
async function flipScheduledGameOnce(
  gameId: string,
): Promise<'flipped' | 'notified' | 'skip'> {
  const now = Date.now();
  const ref = db.collection('games').doc(gameId);
  const snap = await ref.get();
  if (!snap.exists) return 'skip';
  const g = snap.data() as {
    title?: string;
    startsAt?: number;
    fieldName?: string;
    groupId?: string;
    createdBy?: string;
    status?: string;
    registrationOpensAt?: number;
    openedNotificationSent?: boolean;
  };
  // Guard 1 — only games still waiting to open. Cancelled/finished/
  // already-open games are out of scope (this is what makes a stale
  // task fired after a cancel a no-op).
  if (g.status !== 'scheduled') return 'skip';
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
      throw new Error(
        `[flipScheduledGameOnce] notify failed for ${gameId} (${res.skipped})`,
      );
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

async function runFlipScheduledGames(): Promise<void> {
  const now = Date.now();
  // Push the due-filter into the QUERY. Before, this read EVERY
  // status=='scheduled' game every 5 min (every future/recurring game sits in
  // 'scheduled' until registration opens) and filtered client-side — so the
  // scan grew with upcoming activity (~28K reads/day). The range filter on
  // registrationOpensAt excludes future/missing ones, so only DUE games are
  // read. Flipped games leave the 'scheduled' set. Needs composite index
  // (status ASC, registrationOpensAt ASC).
  const snap = await db
    .collection('games')
    .where('status', '==', 'scheduled')
    .where('registrationOpensAt', '<=', now)
    .limit(200)
    .get();

  if (snap.empty) {
    console.log('[flipScheduledGames] no scheduled games');
    return;
  }

  let flipped = 0;
  for (const doc of snap.docs) {
    const g = doc.data() as { registrationOpensAt?: number };
    if (
      typeof g.registrationOpensAt !== 'number' ||
      g.registrationOpensAt > now
    ) {
      continue;
    }
    try {
      const r = await flipScheduledGameOnce(doc.id);
      if (r === 'flipped' || r === 'notified') flipped++;
    } catch (err) {
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
function israelOffsetMs(epoch: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
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
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  );
  return asUtc - epoch;
}

/**
 * Asia/Jerusalem wall-clock parts for an instant. The Functions runtime clock
 * is UTC, so raw Date#getHours()/getDay() are 2–3h off Israel time — use this
 * whenever we bucket an epoch into a local day / hour-window.
 */
const IL_WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
function israelParts(epoch: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
} {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    })
      .formatToParts(new Date(epoch))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    weekday: IL_WEEKDAY[p.weekday] ?? 0,
  };
}

/** Epoch of Asia/Jerusalem local midnight for the calendar date containing
 *  `epoch` (DST-safe). */
function israelMidnight(epoch: number): number {
  const p = israelParts(epoch);
  const utcMid = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  // utcMid's Israel wall time is 02:00–03:00 (midnight + offset), which on the
  // spring-forward day sits AFTER the 02:00 transition — so sampling the offset
  // at utcMid would use the post-transition (+3) offset and land an hour into
  // the previous date. Refine once: re-sample the offset at the first estimate,
  // which is at ~local midnight, giving the correct offset for both DST days.
  let E = utcMid - israelOffsetMs(utcMid);
  E = utcMid - israelOffsetMs(E);
  return E;
}

/**
 * Advance an instant by one week while preserving its Asia/Jerusalem WALL
 * time. A flat `+WEEK_MS` would silently move a 20:00 fixture to 21:00 (spring)
 * or 19:00 (autumn) across a DST boundary; here we correct by the offset delta
 * so "every Thursday 20:00" stays 20:00 year-round.
 */
function addOneWeekSameWallTime(epoch: number): number {
  const naive = epoch + WEEK_MS;
  return naive + (israelOffsetMs(epoch) - israelOffsetMs(naive));
}

/**
 * Create the next occurrence of every ACTIVE weekly series that is due.
 *
 * This is the model that replaced clone-from-the-previous-match. The old cron
 * read the last past game and copied it, so the fixture lived inside a match:
 * deleting one week killed the chain, which is why "delete this week" had to
 * spawn next week up front and matches appeared unbidden (owner report:
 * deleting 2.9 produced 9.9).
 *
 * Here the settings live in `gameSeries`, so an occurrence is disposable. We
 * never look at the previous match — delete every one of them and the next
 * week is still built from the series. It also means no giant reset list: the
 * doc is composed from the template, so there is no stale roster, latch or
 * live-state to strip.
 */
async function runCreateSeriesOccurrences(): Promise<void> {
  const now = Date.now();
  const snap = await db
    .collection('gameSeries')
    .where('active', '==', true)
    .limit(200)
    .get();
  if (snap.empty) {
    console.log('[seriesOccurrences] none');
    return;
  }
  let created = 0;
  for (const doc of snap.docs) {
    const sdoc = doc.data() as {
      groupId?: string;
      createdBy?: string;
      lastOccurrenceAt?: number;
      settings?: Record<string, unknown>;
    };
    let last = sdoc.lastOccurrenceAt;
    const st = sdoc.settings;
    if (typeof last !== 'number' || !sdoc.groupId || !st) continue;

    // Self-heal a drifted anchor before it silences the series.
    //
    // The anchor is this function's ONLY state, and the gate below reads it
    // first: an anchor pushed too far forward doesn't fail, it goes QUIET —
    // skipping every run and logging "created 0" exactly like a healthy series
    // with nothing due. A club lost two weeks that way (anchor 09.09 while the
    // last match actually played was 25.08) and nothing anywhere compared the
    // two. A legitimate anchor is at most one week out, because it is set to
    // the kickoff of the occurrence just created.
    //
    // Reconciled against the series' newest REAL occurrence rather than to
    // `now`, so the fixture keeps its own weekday and time instead of snapping
    // to whenever the repair happened to run.
    //
    // ⚠️ MIRRORS `isAnchorDrifted` in src/utils/seriesSchedule.ts (unit-tested).
    const MAX_ANCHOR_LEAD_MS = 7 * 24 * 60 * 60 * 1000 + RECURRING_CLONE_DELAY_MS;
    if (last > now + MAX_ANCHOR_LEAD_MS) {
      const newest = await db
        .collection('games')
        .where('seriesId', '==', doc.id)
        .orderBy('startsAt', 'desc')
        .limit(1)
        .get();
      const realLast = newest.empty
        ? undefined
        : (newest.docs[0].data().startsAt as number | undefined);
      if (typeof realLast === 'number' && realLast > 0 && realLast < last) {
        console.warn(
          `[seriesOccurrences] anchor drift on ${doc.id}: ${last} → ${realLast}`,
        );
        await doc.ref.update({ lastOccurrenceAt: realLast });
        last = realLast;
      } else {
        // Nothing to reason from. Say so loudly rather than skip in silence —
        // silence is the whole failure mode here.
        console.error(
          `[seriesOccurrences] anchor ${last} is unreachably far ahead and the ` +
            `series has no earlier occurrence to reconcile against: ${doc.id}`,
        );
        continue;
      }
    }

    // Due only once the previous occurrence is well past — same 3h grace the
    // old clone used, so a fixture never doubles up while it's still being
    // played.
    if (now < last + RECURRING_CLONE_DELAY_MS) continue;

    // Walk forward to the first slot that is genuinely in the FUTURE.
    //
    // A blind `last + 1 week` breaks on a dormant series (cron outage, a club
    // that paused, a series created long ago): it would produce a long-dead
    // match, and since each run advances the anchor by only one week the next
    // run would create another, and another — dozens of past-dated matches at
    // five-minute intervals. Bounded at 520 weeks so bad data can't spin the
    // function's whole timeout.
    //
    // ⚠️ MIRRORS `nextOccurrenceAt` in src/utils/seriesSchedule.ts, which is
    //    unit-tested (tests/logic/seriesSchedule.test.ts). Keep the two in sync.
    let nextStartsAt = addOneWeekSameWallTime(last);
    for (let i = 0; i < 520 && nextStartsAt <= now; i++) {
      nextStartsAt = addOneWeekSameWallTime(nextStartsAt);
    }
    if (nextStartsAt <= now) {
      console.warn('[seriesOccurrences] anchor too old, skipping', doc.id);
      continue;
    }
    // Idempotence without a latch: if this series already has an occurrence at
    // that kickoff, we've done it. Survives retries and concurrent runs.
    const dupe = await db
      .collection('games')
      .where('seriesId', '==', doc.id)
      .where('startsAt', '==', nextStartsAt)
      .limit(1)
      .get();
    if (!dupe.empty) {
      await doc.ref.update({ lastOccurrenceAt: nextStartsAt });
      continue;
    }

    // ⚠️ MIRRORS `buildOccurrence` in src/utils/seriesSchedule.ts, which is
    //    unit-tested (tests/logic/seriesSchedule.test.ts). Keep the two in sync.
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' ? v : undefined;
    const at = (before: unknown): number | undefined => {
      const n = num(before);
      return n !== undefined && n > 0 ? nextStartsAt - n : undefined;
    };
    const reg = at(st.registrationOpensBeforeMs);
    // Deferred registration → 'scheduled', and a CF opens it at the picked
    // time. Already past → open now, don't hide it waiting for a flip that's
    // already due.
    const status = reg !== undefined && reg > now ? 'scheduled' : 'open';
    const game: Record<string, unknown> = {
      groupId: sdoc.groupId,
      seriesId: doc.id,
      createdBy: String(sdoc.createdBy ?? ''),
      title: String(st.title ?? ''),
      startsAt: nextStartsAt,
      fieldName: String(st.fieldName ?? ''),
      maxPlayers: num(st.maxPlayers) ?? 10,
      visibility: st.visibility === 'public' ? 'public' : 'community',
      requiresApproval: st.requiresApproval === true,
      // Explicit boolean, not `opt(...)` below: the client reader turns an
      // ABSENT field into `true`, so leaving it off would flip every clone of
      // an opted-out series back on.
      waitlistApprovalRequired: st.waitlistApprovalRequired === true,
      bringBall: st.bringBall === true,
      bringShirts: st.bringShirts === true,
      status,
      // A fresh week starts empty — explicit, never inherited.
      players: [],
      waitlist: [],
      pending: [],
      participantIds: [],
      guests: [],
      matches: [],
      arrivals: {},
      cancellations: {},
      joinedAt: {},
      ballBringerIds: [],
      locked: false,
      currentMatchIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    const opt = (key: string, v: unknown) => {
      if (v !== undefined && v !== null) game[key] = v;
    };
    opt('minPlayers', num(st.minPlayers));
    opt('format', st.format);
    opt('numberOfTeams', num(st.numberOfTeams));
    opt('cancelDeadlineHours', num(st.cancelDeadlineHours));
    opt('fieldType', st.fieldType);
    opt('matchDurationMinutes', num(st.matchDurationMinutes));
    opt('notes', st.notes);
    opt('city', st.city);
    opt('fieldAddress', st.fieldAddress);
    opt('fieldLat', num(st.fieldLat));
    opt('fieldLng', num(st.fieldLng));
    opt('ruleTags', Array.isArray(st.ruleTags) ? st.ruleTags : undefined);
    opt('acceptsFillers', st.acceptsFillers === true ? true : undefined);
    opt('fillerMinTrust', num(st.fillerMinTrust));
    opt('waitlistApprovalTimeoutMinutes', num(st.waitlistApprovalTimeoutMinutes));
    opt('advancedMode', st.advancedMode === true ? true : undefined);
    opt('advancedFillMode', st.advancedFillMode);
    opt('advancedTieMode', st.advancedTieMode);
    opt('registrationOpensAt', reg);
    opt('publicOpenAt', at(st.publicOpenBeforeMs));
    opt('guestsOpenAt', at(st.guestsOpenBeforeMs));

    try {
      await db.collection('games').add(game);
      await doc.ref.update({ lastOccurrenceAt: nextStartsAt });
      created += 1;
    } catch (err) {
      console.error('[seriesOccurrences] create failed', doc.id, err);
    }
  }
  console.log(`[seriesOccurrences] created ${created}`);
}

async function runCloneRecurringGames(): Promise<void> {
  const now = Date.now();
  // Clubs whose fixture already moved to a series doc. Their weeks are produced
  // by runCreateSeriesOccurrences, so nothing here may clone for them.
  //
  // Checking the CLUB, not just `game.seriesId`, is deliberate: a user still on
  // an older build runs the retired client-side "delete this week" path, which
  // creates a fresh `recurring: true` game with NO seriesId. Matching only on
  // the field would let that orphan start a SECOND weekly chain alongside the
  // series — two matches every week for the same fixture. This holds the line
  // server-side until every client has updated.
  const seriesGroups = new Set<string>();
  try {
    const active = await db
      .collection('gameSeries')
      .where('active', '==', true)
      .limit(500)
      .get();
    for (const d of active.docs) {
      const gid = (d.data() as { groupId?: string }).groupId;
      if (gid) seriesGroups.add(gid);
    }
  } catch (err) {
    console.error('[cloneRecurringGames] series guard failed', err);
  }
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
    const g = doc.data() as Record<string, unknown> & {
      startsAt?: number;
      status?: string;
      recurringNextCreatedAt?: number;
      registrationOpensAt?: number;
      publicOpenAt?: number;
      guestsOpenAt?: number;
      groupId?: string;
      title?: string;
      players?: string[];
      guests?: unknown[];
    };
    if (typeof g.startsAt !== 'number') continue;
    if (g.recurringNextCreatedAt) continue; // already spawned next week
    // Series-driven fixtures are handled by runCreateSeriesOccurrences from
    // their own settings doc. Cloning them here too would double-book the week.
    if ((g as { seriesId?: string }).seriesId) continue;
    if (g.groupId && seriesGroups.has(g.groupId)) continue;
    if (g.status === 'cancelled') continue; // a cancelled week doesn't recur
    if (now < g.startsAt + RECURRING_CLONE_DELAY_MS) continue; // wait 3h post-kickoff

    // Stop the perpetual-empty-clone chain for abandoned communities. We're now
    // ≥3h past kickoff; a live weekly fixture always has people on the roster by
    // this point. If NOBODY registered (no players, no guests), the community
    // that set up this recurring game is effectively dead — spawning next week
    // just creates another empty instance that runCleanupStaleGames deletes,
    // which then clones AGAIN (clones reset the latch), looping forever. Skip
    // the clone so the weekly chain dies with the roster. A community that comes
    // back to life re-enables recurring on its next real game.
    const rosterCount =
      (Array.isArray(g.players) ? g.players.length : 0) +
      (Array.isArray(g.guests) ? g.guests.length : 0);
    if (rosterCount === 0) {
      console.log('[cloneRecurringGames] skip empty (dead fixture)', {
        gameId: doc.id,
        groupId: g.groupId,
      });
      continue;
    }

    // Advance kickoff by one week preserving Israel wall time (DST-safe), then
    // shift every dependent window by the SAME delta so each keeps its exact
    // offset from kickoff (e.g. "24h before") across a DST boundary.
    const nextStartsAt = addOneWeekSameWallTime(g.startsAt);
    const weekDelta = nextStartsAt - g.startsAt;
    const shift = (v: unknown): number | undefined =>
      typeof v === 'number' && v > 0 ? v + weekDelta : undefined;

    // Faithful copy of the settings, with a reset roster + shifted times.
    const next: Record<string, unknown> = { ...g };
    next.id = '';
    next.startsAt = nextStartsAt;
    const nextReg = shift(g.registrationOpensAt);
    const nextPublic = shift(g.publicOpenAt);
    const nextGuests = shift(g.guestsOpenAt);
    const nextAutoTeams = shift((g as { autoTeamsAt?: number }).autoTeamsAt);
    if (nextReg !== undefined) next.registrationOpensAt = nextReg;
    else delete next.registrationOpensAt;
    if (nextPublic !== undefined) next.publicOpenAt = nextPublic;
    else delete next.publicOpenAt;
    if (nextGuests !== undefined) next.guestsOpenAt = nextGuests;
    else delete next.guestsOpenAt;
    // Scheduled auto-teams time shifts +7d like the others; keep autoTeamsMethod
    // (copied via spread). The GENERATED outputs/latches are cleared below so
    // next week re-generates fresh instead of inheriting last week's teams.
    //
    // BUT `autoTeamsAt` is CONSUMED — `runDueAutoTeamsAt` deletes it the moment
    // the split generates (~1h before kickoff), which is BEFORE this clone runs
    // (3h AFTER kickoff). So for any recurring game that actually generated its
    // teams, `g.autoTeamsAt` is already gone here and the shift above yields
    // undefined — silently dropping the schedule for every future week (the
    // admin picks "auto teams 1h before" once and it evaporates after week 1).
    // Reconstruct it from the SAME lead-before-kickoff: `autoTeamsMethod`
    // survives generation (only `autoTeamsAt` is deleted), so its presence means
    // the game opted in; `autoTeamsGeneratedAt` records when it fired, giving the
    // original lead (startsAt − generatedAt) to re-apply against next kickoff.
    const gExtra = g as {
      autoTeamsMethod?: string;
      autoTeamsGeneratedAt?: number;
      autoTeamGenerationMinutesBeforeStart?: number;
    };
    if (nextAutoTeams !== undefined) {
      next.autoTeamsAt = nextAutoTeams;
    } else if (gExtra.autoTeamsMethod) {
      // Opted into scheduled teams, but autoTeamsAt was consumed. Re-derive the
      // lead from when it generated; fall back to the configured minutes-before
      // (or 60') if that's missing.
      const genAt = gExtra.autoTeamsGeneratedAt;
      const leadMs =
        typeof genAt === 'number' && genAt > 0 && genAt < g.startsAt
          ? g.startsAt - genAt
          : (gExtra.autoTeamGenerationMinutesBeforeStart ?? 60) * 60 * 1000;
      const reAutoTeams = nextStartsAt - leadMs;
      // Only if it lands in the future and before next kickoff (sanity).
      if (reAutoTeams > now && reAutoTeams < nextStartsAt) {
        next.autoTeamsAt = reAutoTeams;
      } else {
        delete next.autoTeamsAt;
      }
    } else {
      delete next.autoTeamsAt;
    }
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
    // The real shortage-warning latch is `shortageWarningSentAt` (runSendShortage
    // Warnings guards on it). The old `shortageWarningSent` delete missed the
    // 'At', so the clone inherited last week's timestamp via {...g} and the
    // warning never fired again for a recurring game. (`fillingUpSent` was
    // likewise dead — its real latch `capacityNoticeSent` is cleared below.)
    delete next.shortageWarningSent;
    delete next.shortageWarningSentAt;
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
    // Invitations are per-INSTANCE: each weekly game has its own invite list, so
    // last week's invitees must not ride in via {...g} — otherwise the coach sees
    // them as "already invited" on the fresh game and can't re-invite them (user
    // report [DXo4]).
    delete next.invitedUserIds;
    delete next.invitesSent;
    // Per-instance moderation/dedup state must NOT carry over: last week's kick
    // log would show phantom removals on a fresh roster, and a stale filler-push
    // history would suppress this week's filler outreach.
    delete next.adminRemovals;
    delete next.adminRemovedBy;
    delete next.fillerPushHistory;
    // Status: scheduled if registration hasn't opened yet, else open.
    const isDeferred = typeof nextReg === 'number' && nextReg > now;
    next.status = isDeferred ? 'scheduled' : 'open';
    // If it flips to public on a schedule, it starts members-only again.
    if (nextPublic !== undefined) next.visibility = 'community';
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
      } catch (e) {
        // ALREADY_EXISTS: this week's clone is already there (a prior partial
        // run). Just (re)assert the latch and move on — no duplicate, no second
        // notification. Match both the numeric gRPC code AND the string form
        // (the SDK delivers either depending on the throw path — same dual
        // check as createNotificationOnce / onJoinRequestCreated elsewhere).
        const code = (e as { code?: number | string }).code;
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
            fieldName: (g as { fieldName?: string }).fieldName,
          },
        });
      }
      cloned++;
    } catch (err) {
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
async function flipPublicGameOnce(gameId: string): Promise<'flipped' | 'skip'> {
  const now = Date.now();
  const ref = db.collection('games').doc(gameId);
  const snap = await ref.get();
  if (!snap.exists) return 'skip';
  const g = snap.data() as {
    visibility?: string;
    publicOpenAt?: number;
    publicOpenedAt?: number;
    status?: string;
    registrationOpensAt?: number;
  };
  if (g.visibility !== 'community') return 'skip'; // already public / private
  if (g.publicOpenedAt) return 'skip'; // idempotency latch
  if (typeof g.publicOpenAt !== 'number' || g.publicOpenAt > now) return 'skip';
  if (g.status === 'cancelled' || g.status === 'finished') return 'skip';
  // Never expose a game to the whole public before its OWN community members can
  // even see/register for it: skip while still 'scheduled' (registration not yet
  // open) or while registrationOpensAt is in the future — a stray/edited
  // publicOpenAt < registrationOpensAt must not leapfrog members (audit #15).
  if (g.status === 'scheduled') return 'skip';
  if (
    typeof g.registrationOpensAt === 'number' &&
    g.registrationOpensAt > now
  )
    return 'skip';
  await ref.update({
    visibility: 'public',
    publicOpenedAt: now,
    updatedAt: now,
  });
  return 'flipped';
}

async function runFlipPublicGames(): Promise<void> {
  const now = Date.now();
  // Push the due-filter into the QUERY. Before, this read EVERY
  // visibility=='community' game every 5 min and filtered client-side —
  // community games that never go public (no/far-future publicOpenAt) stayed
  // in the set forever, so the scan grew unbounded (~86K reads/day). A range
  // filter on publicOpenAt excludes games with no publicOpenAt or a future one
  // (Firestore range queries skip docs missing the field), so only DUE games
  // are read. Flipped games leave the set (visibility becomes 'public').
  // Needs composite index (visibility ASC, publicOpenAt ASC).
  const snap = await db
    .collection('games')
    .where('visibility', '==', 'community')
    .where('publicOpenAt', '<=', now)
    .limit(200)
    .get();
  if (snap.empty) return;
  let flipped = 0;
  for (const doc of snap.docs) {
    const g = doc.data() as { publicOpenAt?: number; publicOpenedAt?: number };
    if (g.publicOpenedAt) continue;
    if (typeof g.publicOpenAt !== 'number' || g.publicOpenAt > now) continue;
    try {
      const r = await flipPublicGameOnce(doc.id);
      if (r === 'flipped') flipped++;
    } catch (err) {
      console.error(`[flipPublicGames] flip failed for ${doc.id}`, err);
    }
  }
  if (flipped) console.log(`[flipPublicGames] flipped ${flipped}`);
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
const PROMO_OFFER_TTL_MS = 20 * 60 * 1000; // default 20 min to respond to an offer
// Smallest offer window a game may configure — used as the QUERY floor so the
// sweep catches every potentially-due offer; the exact per-game window is
// applied inside the transaction.
const MIN_OFFER_TTL_MS = 2 * 60 * 1000;

async function runExpireStaleOffers(): Promise<void> {
  const nowMs = Date.now();
  // Query by the MINIMUM window so we catch every possibly-due offer; the exact
  // per-game window (waitlistApprovalTimeoutMinutes, default 20m) is applied in
  // the transaction below.
  const queryCutoff = nowMs - MIN_OFFER_TTL_MS;
  const snap = await db
    .collection('games')
    .where('pendingPromotion.offeredAt', '<', queryCutoff)
    .limit(50)
    .get();

  if (snap.empty) {
    console.log('[expireStaleOffers] none');
    return;
  }

  let advanced = 0;
  for (const gameDoc of snap.docs) {
    if ((gameDoc.data() as { status?: string }).status !== 'open') continue;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(gameDoc.ref);
        if (!fresh.exists) return;
        const d = fresh.data() as {
          status?: string;
          players?: string[];
          waitlist?: string[];
          pending?: string[];
          guests?: { waitlisted?: boolean }[];
          maxPlayers?: number;
          waitlistApprovalTimeoutMinutes?: number;
          pendingPromotion?: { uid?: string; offeredAt?: number } | null;
        };
        if (d.status !== 'open') return;
        const offer = d.pendingPromotion;
        // This game's configured confirm window (default 20m).
        const gameTtlMs =
          typeof d.waitlistApprovalTimeoutMinutes === 'number' &&
          d.waitlistApprovalTimeoutMinutes > 0
            ? d.waitlistApprovalTimeoutMinutes * 60 * 1000
            : PROMO_OFFER_TTL_MS;
        // Re-check inside the txn — the offer may have been accepted/advanced
        // (or refreshed) since the query read, and must be past THIS game's
        // window (not just the query floor) to expire.
        if (
          !offer?.uid ||
          typeof offer.offeredAt !== 'number' ||
          offer.offeredAt >= nowMs - gameTtlMs
        ) {
          return;
        }
        const offeredUid = offer.uid;
        // Move the unresponsive uid to the BACK of the waitlist.
        const waitlist = (d.waitlist ?? []).filter((id) => id !== offeredUid);
        waitlist.push(offeredUid);
        const players = d.players ?? [];
        const pending = d.pending ?? [];
        const activeGuests = (d.guests ?? []).filter(
          (g) => !g?.waitlisted,
        ).length;
        let nextOffer: { uid: string; offeredAt: number } | null = null;
        if (
          waitlist.length > 0 &&
          waitlist[0] !== offeredUid &&
          players.length + activeGuests < (d.maxPlayers ?? 15)
        ) {
          nextOffer = { uid: waitlist[0], offeredAt: Date.now() };
        }
        // Keep the denormalised participant union consistent — the offered uid
        // may not have been in the waitlist before (it's now appended).
        const participantIds = Array.from(
          new Set([...players, ...waitlist, ...pending]),
        );
        tx.update(gameDoc.ref, {
          waitlist,
          participantIds,
          pendingPromotion: nextOffer,
          updatedAt: Date.now(),
        });
      });
      advanced += 1;
    } catch (err) {
      console.error('[expireStaleOffers] failed', gameDoc.id, err);
    }
  }
  console.log(`[expireStaleOffers] advanced ${advanced} stale offer(s)`);
}

/** Scan upcoming games; if one falls on a no-play holiday and the organizer
 *  hasn't been warned yet, push them a heads-up. Catches both manual games and
 *  recurring clones that auto-landed on a holiday. Deduped by a per-game
 *  `holidayNotifiedAt` stamp (+ createNotificationOnce's own dedupe). */
async function runHolidayGameNotices(): Promise<void> {
  const now = Date.now();
  const horizon = now + 8 * 24 * 60 * 60 * 1000; // games within the next 8 days
  const snap = await db
    .collection('games')
    .where('startsAt', '>=', now)
    .where('startsAt', '<=', horizon)
    .orderBy('startsAt', 'asc')
    .limit(200)
    .get();
  if (snap.empty) return;
  for (const doc of snap.docs) {
    const g = doc.data() as {
      startsAt?: number;
      status?: string;
      createdBy?: string;
      title?: string;
      groupId?: string;
      holidayNotifiedAt?: number;
    };
    if (typeof g.startsAt !== 'number') continue;
    if (g.status === 'cancelled') continue;
    if (g.holidayNotifiedAt) continue; // already warned for this game
    const holiday = holidayNameOnDate(g.startsAt);
    if (!holiday) continue;
    const organizer = typeof g.createdBy === 'string' ? g.createdBy : '';
    if (!organizer) continue;
    try {
      await createNotificationOnce({
        type: 'gameOnHoliday',
        recipientId: organizer,
        createdByUid: '',
        payload: {
          gameId: doc.id,
          gameTitle: g.title || 'המשחק',
          startsAt: g.startsAt,
          holiday,
          groupId: g.groupId,
        },
      });
      // Stamp regardless of push outcome so we don't re-scan/re-notify.
      await doc.ref.set({ holidayNotifiedAt: now }, { merge: true });
    } catch (err) {
      console.error('[holidayGameNotices] failed', doc.id, err);
    }
  }
}

async function runCleanupStaleGames(): Promise<void> {
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
  const ops: Promise<unknown>[] = [];

  for (const gameDoc of snap.docs) {
    const g = gameDoc.data() as {
      id?: string;
      players?: string[];
      guests?: unknown[];
      liveMatch?: {
        phase?: string;
        startedAt?: number;
      };
    };
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
      ops.push(
        (async () => {
          const rounds = await db
            .collection('rounds')
            .where('gameId', '==', gameDoc.id)
            .get();
          const batch = db.batch();
          rounds.docs.forEach((r) => batch.delete(r.ref));
          batch.delete(gameDoc.ref);
          await batch.commit();
          deleted++;
        })()
      );
    } else {
      ops.push(
        (async () => {
          // Transactional, and re-reads the status inside.
          //
          // The query snapshot above is already stale by the time this runs,
          // and the one thing that can have changed is the very thing being
          // written: an admin pressing "סיים מחזור" in the same minute. That
          // close is a STATEMENT the evening happened; this one is a sweep
          // that knows nothing. Overwriting the first with the second would
          // turn a confirmed night into one waiting on a question nobody
          // needs to answer.
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(gameDoc.ref);
            const st = snap.data()?.status;
            if (st === 'finished' || st === 'cancelled') return; // already closed
            tx.update(gameDoc.ref, {
              status: 'finished',
              locked: true,
              // How it ended, recorded at the moment it ends. This is what
              // lets `eveningPlayState` tell an evening the system closed on
              // its own from one an admin closed deliberately — and from one
              // closed before any of this existed, which carries neither.
              endedBy: 'auto',
              autoClosedAt: Date.now(),
              updatedAt: Date.now(),
            });
          });
          finished++;
        })()
      );
    }
  }

  // allSettled (not all): one failing delete/finish must not abandon the rest
  // of the sweep for this tick.
  const results = await Promise.allSettled(ops);
  const failed = results.filter((r) => r.status === 'rejected').length;
  console.log(
    `[cleanupStaleGames] swept ${snap.size} stale games — deleted ${deleted} zombies, finished ${finished}, failed ${failed}`
  );
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
async function runDailyCleanup(): Promise<void> {
  const BATCH_LIMIT = 400;
  const NOTIFICATIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const JOIN_REQUESTS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // 1) Old /notifications.
  let notifsDeleted = 0;
  try {
    const cutoff = now - NOTIFICATIONS_TTL_MS;
    // Query the numeric `createdAtMs` mirror, NOT `createdAt`. Every notif
    // writes createdAt as a Firestore Timestamp; Timestamps sort in a
    // different type-group than a plain number, so `createdAt < <number>`
    // matched ZERO docs and the sweep never deleted anything (the collection
    // grew unbounded). Both write paths populate createdAtMs as a number.
    const snap = await db
      .collection('notifications')
      .where('createdAtMs', '<', cutoff)
      .limit(BATCH_LIMIT)
      .get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      notifsDeleted = snap.size;
    }
  } catch (err) {
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
    const candidates: string[] = [];
    for (const latch of snap.docs) {
      const gameId = String(latch.data()?.gameId ?? latch.id);
      try {
        const gameSnap = await db.collection('games').doc(gameId).get();
        const status = gameSnap.exists
          ? gameSnap.data()?.status
          : undefined;
        if (
          !gameSnap.exists ||
          status === 'finished' ||
          status === 'cancelled'
        ) {
          candidates.push(latch.id);
        }
      } catch (err) {
        console.warn(
          '[dailyCleanup] latch game lookup failed',
          latch.id,
          err,
        );
      }
    }
    if (candidates.length > 0) {
      const batch = db.batch();
      candidates.forEach((id) =>
        batch.delete(db.collection('gameUpdateLatches').doc(id)),
      );
      await batch.commit();
      latchesDeleted = candidates.length;
    }
  } catch (err) {
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
  } catch (err) {
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
    const terminalStatuses = ['finished', 'cancelled'] as const;
    const terminalGameIds: string[] = [];
    for (const status of terminalStatuses) {
      if (terminalGameIds.length >= BATCH_LIMIT) break;
      const remaining = BATCH_LIMIT - terminalGameIds.length;
      const gamesSnap = await db
        .collection('games')
        .where('status', '==', status)
        .limit(remaining)
        .get();
      for (const g of gamesSnap.docs) terminalGameIds.push(g.id);
    }
    for (const gameId of terminalGameIds) {
      try {
        const interests = await db
          .collection('games')
          .doc(gameId)
          .collection('fillerInterests')
          .limit(BATCH_LIMIT)
          .get();
        if (interests.empty) continue;
        const batch = db.batch();
        interests.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        fillerInterestsDeleted += interests.size;
      } catch (err) {
        console.warn(
          '[dailyCleanup] fillerInterests sweep failed for',
          gameId,
          err,
        );
      }
    }
  } catch (err) {
    console.error('[dailyCleanup] fillerInterests outer sweep failed', err);
  }

  console.log(
    `[dailyCleanup] notifications=${notifsDeleted}, latches=${latchesDeleted}, joinRequests=${requestsDeleted}, fillerInterests=${fillerInterestsDeleted}`,
  );
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
async function runSendRateReminders(): Promise<void> {
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
export const onGroupPendingChanged = onDocumentWritten(
  'groups/{groupId}',
  async (event) => {
    const before = event.data?.before?.data() as
      | { pendingPlayerIds?: string[] }
      | undefined;
    const after = event.data?.after?.data() as
      | {
          pendingPlayerIds?: string[];
          adminIds?: string[];
          name?: string;
        }
      | undefined;

    // Group deletion: canonical /groups doc is gone. Clean up the
    // public mirror in case the client-side delete swallowed an
    // error (network drop, transient quota). Without this, the
    // discovery feed would surface a "ghost" community whose
    // canonical no longer exists.
    if (!after && before) {
      const groupId = event.params.groupId;
      try {
        await db.collection('groupsPublic').doc(groupId).delete();
      } catch (err) {
        console.warn(
          '[onGroupDeleted] groupsPublic cleanup failed',
          groupId,
          err,
        );
      }
      return;
    }

    if (!after) return;

    // Sync the denormalised /groupsPublic.memberCount whenever
    // playerIds changes. Client-side join paths can't write to the
    // public doc (rule requires admin), so the feed's count would
    // otherwise drift every time someone direct-joins an open
    // community. Best-effort — failure logs but doesn't throw.
    const beforePlayers = (before as { playerIds?: string[] } | undefined)
      ?.playerIds;
    const afterPlayers = (after as { playerIds?: string[] } | undefined)
      ?.playerIds;
    const playerCountChanged =
      Array.isArray(afterPlayers) &&
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
      const afterSet = new Set(afterPlayers);
      const newJoiners = afterPlayers.filter((uid) => !prevSet.has(uid));
      const groupId = event.params.groupId;
      // Symmetric cleanup: members who LEFT (or were removed) must lose their
      // new-game push subscription for this community — otherwise an ex-member
      // keeps getting "משחק חדש" pushes for a club they quit, and the opt-out
      // bell (on CommunityDetailsScreen) is no longer reachable to them.
      // arrayRemove is a no-op when the groupId isn't present.
      const departed = (beforePlayers ?? []).filter((uid) => !afterSet.has(uid));
      for (const uid of departed) {
        try {
          await db.collection('users').doc(uid).set(
            {
              newGameSubscriptions:
                admin.firestore.FieldValue.arrayRemove(groupId),
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        } catch (err) {
          console.warn(
            '[onGroupPendingChanged] unsubscribe on leave failed',
            uid,
            err,
          );
        }
      }
      for (const uid of newJoiners) {
        // Subscription default — idempotent (arrayUnion), and we WANT it to
        // re-run on a genuine rejoin, so it stays outside the credit latch.
        try {
          await db.collection('users').doc(uid).set(
            {
              newGameSubscriptions:
                admin.firestore.FieldValue.arrayUnion(groupId),
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        } catch (err) {
          console.warn(
            '[onGroupPendingChanged] subscription default failed',
            uid,
            err,
          );
        }
        // teamsJoined — gated by a per-(group,uid) marker so at-least-once
        // redelivery can't double-count (and a rejoin of the SAME community
        // won't re-credit; teamsJoined counts distinct communities).
        try {
          const b = db.batch();
          b.create(
            db
              .collection('groups')
              .doc(groupId)
              .collection('memberCredited')
              .doc(uid),
            { at: Date.now() },
          );
          b.set(
            db.collection('users').doc(uid),
            {
              achievements: {
                teamsJoined: admin.firestore.FieldValue.increment(1),
              },
              updatedAt: Date.now(),
            },
            { merge: true },
          );
          await b.commit();
        } catch (err) {
          const code = (err as { code?: number | string }).code;
          if (code === 6 || code === 'already-exists') continue;
          console.warn(
            '[onGroupPendingChanged] teamsJoined bump failed',
            uid,
            err,
          );
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
      const ball = (after as { ballHolderIds?: string[] }).ballHolderIds ?? [];
      const jerseys =
        (after as { jerseysHolderIds?: string[] }).jerseysHolderIds ?? [];
      const ballGone = ball.filter((u) => !memberSet.has(u));
      const jerseysGone = jerseys.filter((u) => !memberSet.has(u));
      // Also prune adminRatings for departed members — otherwise a stale
      // admin-assigned rating lingers and silently re-applies (and feeds
      // rating-based auto-teams) if the person ever re-joins the community.
      const adminRatings =
        (after as { adminRatings?: Record<string, unknown> }).adminRatings ?? {};
      const ratingsGone = Object.keys(adminRatings).filter(
        (u) => !memberSet.has(u),
      );
      if (ballGone.length || jerseysGone.length || ratingsGone.length) {
        try {
          await db
            .collection('groups')
            .doc(event.params.groupId)
            .update({
              ...(ballGone.length
                ? {
                    ballHolderIds:
                      admin.firestore.FieldValue.arrayRemove(...ballGone),
                  }
                : {}),
              ...(jerseysGone.length
                ? {
                    jerseysHolderIds:
                      admin.firestore.FieldValue.arrayRemove(...jerseysGone),
                  }
                : {}),
              ...Object.fromEntries(
                ratingsGone.map((u) => [
                  `adminRatings.${u}`,
                  admin.firestore.FieldValue.delete(),
                ]),
              ),
              updatedAt: Date.now(),
            });
        } catch (err) {
          console.warn(
            '[onGroupPendingChanged] equipment/rating holder prune failed',
            event.params.groupId,
            err,
          );
        }
      }
    }

    if (playerCountChanged) {
      try {
        await db
          .collection('groupsPublic')
          .doc(event.params.groupId)
          .set(
            {
              memberCount: afterPlayers!.length,
              updatedAt: Date.now(),
            },
            { merge: true },
          );
      } catch (err) {
        console.warn(
          '[onGroupWritten] groupsPublic memberCount sync failed',
          event.params.groupId,
          err,
        );
      }

      // Growth milestone push: when memberCount crosses a threshold
      // we haven't already announced. Wired here (instead of in the
      // `newJoiners` loop above) so it fires once per write — and
      // the persistence on `notifiedMilestones[]` makes retries /
      // membership churn idempotent.
      try {
        await dispatchGrowthMilestoneIfNeeded(
          event.params.groupId,
          afterPlayers!.length,
          (after as { adminIds?: string[] }).adminIds ?? [],
          (after as { name?: string }).name || '',
        );
      } catch (err) {
        console.warn(
          '[onGroupPendingChanged] milestone dispatch failed',
          event.params.groupId,
          err,
        );
      }
    }

    const beforeIds = new Set(before?.pendingPlayerIds ?? []);
    const afterIds = after.pendingPlayerIds ?? [];
    const newcomers = afterIds.filter((id) => !beforeIds.has(id));
    if (newcomers.length === 0) return;

    const admins = after.adminIds ?? [];
    if (admins.length === 0) return;

    const groupId = event.params.groupId;
    const groupName = after.name || 'המועדון';

    // Use allSettled so a single quota / network failure on one push
    // doesn't drop the rest. Previously Promise.all rejected on the
    // first failure — leaving the requester in pendingPlayerIds with
    // NO admin notified, an effectively-silent loss of the join
    // request. Per-failure warnings are logged for monitoring.
    const ops: Promise<unknown>[] = [];
    for (const requesterId of newcomers) {
      for (const adminId of admins) {
        ops.push(
          createNotificationOnce({
            type: 'joinRequest',
            recipientId: adminId,
            payload: {
              groupId,
              groupName,
              requesterId,
            },
          }),
        );
      }
    }
    const results = await Promise.allSettled(ops);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      console.warn(
        `[onGroupPendingChanged] ${failed}/${results.length} joinRequest dispatch(es) failed for group ${groupId}`,
      );
      for (const r of results) {
        if (r.status === 'rejected') {
          console.warn('[onGroupPendingChanged] reason:', r.reason);
        }
      }
    }
    const ok = results.length - failed;
    console.log(
      `[onGroupPendingChanged] dispatched ${ok}/${results.length} joinRequest push(es) for group ${groupId}`
    );
  }
);

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
export const onGameTimerChanged = onDocumentWritten(
  'games/{id}',
  async (event) => {
    const after = event.data?.after?.data() as
      | {
          liveMatch?: {
            timerRunning?: boolean;
            timerLastStartedAt?: number | null;
            timerAccumulatedMs?: number;
            timerControlledBy?: string | null;
            timerControlledByName?: string | null;
          };
          participantIds?: string[];
          players?: string[];
          title?: string;
          status?: string;
          updatedAt?: number;
          createdBy?: string;
        }
      | undefined;
    if (!after) return;
    const before = event.data?.before?.data() as typeof after | undefined;
    const a = after.liveMatch ?? {};
    const b = before?.liveMatch ?? {};

    // Fire on a timer-primitive change (start/pause/reset) OR when the game
    // TRANSITIONS to finished/cancelled. The latter matters because ending an
    // evening while the timer is already paused changes no timer primitive — so
    // without this branch the killed-app widget/tile would stay stuck on the
    // last 'live' card forever (its own JS re-publish is dead).
    const changed =
      (a.timerRunning ?? null) !== (b.timerRunning ?? null) ||
      (a.timerLastStartedAt ?? null) !== (b.timerLastStartedAt ?? null) ||
      (a.timerAccumulatedMs ?? null) !== (b.timerAccumulatedMs ?? null);
    const isOver = after.status === 'finished' || after.status === 'cancelled';
    const wasOver = before?.status === 'finished' || before?.status === 'cancelled';
    const endedNow = isOver && !wasOver;
    if (!changed && !endedNow) return;

    const recipients = Array.isArray(after.participantIds)
      ? after.participantIds
      : Array.isArray(after.players)
        ? after.players
        : [];
    if (recipients.length === 0) return;

    const users = await loadUsers(recipients);
    const tokens = new Set<string>();
    for (const u of users) {
      // Only Android has the home widget / Wear tile this silent sync feeds.
      // Gate on `=== 'android'` (not `!== 'ios'`): a user whose platform was
      // never stamped (undefined) is NOT Android, so don't wake them.
      if (u.platform !== 'android') continue;
      (u.fcmTokens || []).forEach((t) => {
        if (typeof t === 'string' && t.length > 0) tokens.add(t);
      });
    }
    if (tokens.size === 0) return;

    const data: Record<string, string> = {
      type: 'timerSync',
      gameId: event.params.id,
      timerRunning: String(!!a.timerRunning),
      timerLastStartedAt: String(a.timerLastStartedAt ?? 0),
      timerAccumulatedMs: String(a.timerAccumulatedMs ?? 0),
      timerControlledBy: String(a.timerControlledBy ?? ''),
      timerControlledByName: String(a.timerControlledByName ?? ''),
      // Server wall clock at send time. Lets a killed-app recipient with NO
      // cached payload anchor the timer to server time (offset = serverNowMs −
      // deviceNow) instead of trusting a possibly-skewed device clock.
      serverNowMs: String(Date.now()),
      // CHANGE-time (the doc's updatedAt, stamped at WRITE time and carried per
      // write) — the ordering key for the native out-of-order guard. Must NOT be
      // this function's Date.now(): onGameTimerChanged invocations are not
      // execution-ordered, so a reordered run would stamp a larger send-time for
      // an OLDER change and defeat the guard. updatedAt is monotonic per write.
      updatedAtMs: String(after.updatedAt ?? Date.now()),
      // Game creator — lets a truly-cold recipient (fresh payload, no cached
      // viewer) recompute canControl so the admin still sees the control buttons.
      createdBy: String(after.createdBy ?? ''),
      // NOT `title`/`message`/`body`: those keys make expo-notifications
      // render a visible notification on clients that DON'T have the native
      // TeamderMessagingService yet (pre-1.0.21). `gameTitle` is inert there
      // — the message stays silent — and the native service reads this key.
      gameTitle: String(after.title ?? ''),
      // On game end, tell the native handler to CLEAR the live widget/tile
      // instead of re-writing a 'live' card (which would freeze on screen).
      ...(endedNow ? { gameEnded: 'true' } : {}),
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
      } catch (err) {
        console.warn('[onGameTimerChanged] send failed', err);
      }
    }
    console.log(
      `[onGameTimerChanged] timerSync → ${ok}/${tokens.size} token(s) for game ${event.params.id}`,
    );
  },
);

// ─── Realtime trigger: per-player wins from the live rotation ──────────
/**
 * When a "winner-stays" round ends, the client stamps the winning team's
 * registered players onto `rotation.lastRoundWinners` + a monotonic
 * `rotation.lastRoundAt`. Here we credit each of them a lifetime win
 * (`users/{uid}.stats.wins += 1`). Server-side because a client can't write
 * other users' docs. Idempotent: only fires when `lastRoundAt` advances.
 */
export const onGameRotationChanged = onDocumentWritten(
  'games/{id}',
  async (event) => {
    const after = event.data?.after?.data() as
      | {
          rotation?: {
            round?: number;
            lastRoundAt?: number;
            lastRoundWinners?: string[];
            lastRoundLosers?: string[];
          };
        }
      | undefined;
    if (!after?.rotation) return;
    const before = event.data?.before?.data() as typeof after | undefined;
    // Latch on the MONOTONIC round counter, not the wall-clock lastRoundAt: a
    // client clock that regresses (NTP/DST) or two rounds in the same ms would
    // make lastRoundAt non-increasing and silently DROP a round's win/pair
    // credit. `round` strictly increases by 1 per finalize. Fall back to
    // lastRoundAt only for legacy docs that predate the round counter.
    const ar = after.rotation.round;
    const br = before?.rotation?.round;
    if (typeof ar === 'number' && typeof br === 'number') {
      if (ar <= br) return; // no NEW round result
    } else {
      const a = after.rotation.lastRoundAt ?? 0;
      const b = before?.rotation?.lastRoundAt ?? 0;
      if (a <= b) return;
    }

    // No-op. Same-team pair stats (sameTeam / winsTogether / lossesTogether) are
    // now written by commitRoundStats in its committedRounds-latched batch (the
    // sameTeamPairs loop), on EVERY committed round — including a directly-ended
    // evening and 4-team ties, which this rotation-ADVANCE trigger used to MISS
    // (making winsTogether/sameTeam diverge from the against record). This
    // trigger's only remaining job was that pair write, so it now does nothing;
    // left as an empty handler to avoid changing the deployed function set.
    return;
  },
);

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
/**
 * Fold one evening into the club's pair rollup.
 *
 * WHY THIS IS NOT IN `commitRoundStats`. The obvious place to count pairs is
 * where the round is committed — and it is the wrong one. Mirroring the
 * same-team and against pairs into a per-club document adds n² + n(n−1)
 * operations to that batch: 45 at five a side, but 231 at eleven, on top of the
 * ~400 already there. Firestore stops a batch at 500, and the idempotency latch
 * lives in that same batch — so on a big format every retry would fail
 * identically and the round's statistics would be lost permanently. Since the
 * format picker opened up to eleven a side, that is a reachable configuration,
 * not a hypothetical.
 *
 * Collapsing the whole evening first turns roughly 450 writes into at most one
 * per pair who actually played: 105 for a fifteen-player club, measured. Those
 * go in their own batches, chunked, touching nothing the round commit owns.
 *
 * Idempotent through a marker document created in the FIRST chunk: `create()`
 * fails if it exists, so a re-delivered trigger stops before double-counting.
 */
/**
 * Is this "club" actually one person's private bucket?
 *
 * There is no such thing as a game without a community: creating a quick game
 * calls ensurePersonalGroup, which mints a real group with `isPersonal: true,
 * hidden: true`, and the game carries its id like any other. Those two flags
 * only control who can SEE the club — never the bookkeeping. So every
 * club-level write branched on the same test, `if (groupId)`, and a quick game
 * always has one.
 *
 * The result was a full club ceremony performed for an audience of one, into a
 * group nobody can open: club records, a sealed round summary, pair chemistry,
 * a public showcase. And because the personal group is PERMANENT per user,
 * every quick game anyone ever plays piles into the same fictional club — so
 * after five evenings it starts announcing club records, and after ten,
 * "10 מחזורים למועדון". Reported as the root cause behind a cluster of
 * quick-game complaints.
 *
 * Gating here rather than at the call sites, so a future caller can't miss it.
 * What a quick game still gets is everything that belongs to the PLAYER —
 * lifetime stats, the per-game table, his own evening card. What it loses is
 * the pretence that a club was involved.
 */
const personalGroupCache = new Map<string, boolean>();
async function isPersonalGroup(groupId: string): Promise<boolean> {
  if (!groupId) return false;
  const hit = personalGroupCache.get(groupId);
  if (hit !== undefined) return hit;
  let personal = false;
  try {
    const snap = await db.collection('groups').doc(groupId).get();
    personal = snap.data()?.isPersonal === true;
  } catch (err) {
    // A read failure must not silently turn a personal group into a real one.
    // Treating it as NOT personal preserves the old behaviour, which is the
    // safer direction: it writes a document nobody reads rather than skipping
    // one a real club needs.
    console.warn('[isPersonalGroup] read failed', groupId, err);
  }
  personalGroupCache.set(groupId, personal);
  return personal;
}

async function rollUpClubPairs(args: {
  gameId: string;
  groupId: string;
  at: number;
  rounds: ChemistryRound[];
}): Promise<number> {
  const { gameId, groupId, at, rounds } = args;
  if (!groupId || rounds.length === 0) return 0;
  // A personal group has one member, so "who plays well together" is a
  // question about nobody. See isPersonalGroup.
  if (await isPersonalGroup(groupId)) {
    console.log('[clubPairs] personal group — skip', gameId);
    return 0;
  }

  const markerRef = db
    .collection('communityPairRollups')
    .doc(`${groupId}__${gameId}`);
  if ((await markerRef.get()).exists) {
    console.log('[clubPairs] already rolled up — skip', gameId);
    return 0;
  }

  const pairs = pairsFromRounds(rounds);
  const entries = Object.entries(pairs);
  if (entries.length === 0) return 0;

  const inc = admin.firestore.FieldValue.increment;
  const now = Date.now();
  // 450, not 500: the marker rides in the first chunk and Firestore counts
  // every operation, so leaving headroom is cheaper than discovering the
  // ceiling on the one evening a club fields eleven a side.
  const CHUNK = 450;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = db.batch();
    if (i === 0) {
      batch.create(markerRef, {
        groupId,
        gameId,
        at,
        pairs: entries.length,
        createdAt: now,
      });
    }
    for (const [key, v] of entries.slice(i, i + CHUNK)) {
      const [a, b] = pairMembers(key);
      batch.set(
        db.collection('communityPairStats').doc(`${groupId}__${key}`),
        {
          groupId,
          a,
          b,
          sameTeam: inc(v.sameTeam),
          winsTogether: inc(v.winsTogether),
          lossesTogether: inc(v.lossesTogether),
          cleanSheetsTogether: inc(v.cleanSheetsTogether),
          against: inc(v.against),
          winsA: inc(v.winsA),
          winsB: inc(v.winsB),
          assistsAToB: inc(v.assistsAToB),
          assistsBToA: inc(v.assistsBToA),
          updatedAt: now,
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  // The window these counters cover, held in ONE place so every pair card in
  // the club quotes the same date.
  //
  // It matters because the legacy `assists` field on the same documents counts
  // MORE history and carries no direction. A card that showed that total beside
  // a directional breakdown drawn from this narrower window would print a
  // breakdown that does not add up to its own total — so the card reads only
  // the fields written here, and says which date they start from.
  const csRef2 = db.collection('communityStats').doc(groupId);
  const cs2 = await csRef2.get();
  const since = cs2.data()?.chemistrySince;
  if (typeof since !== 'number' || since <= 0 || at < since) {
    await csRef2.set({ chemistrySince: at, updatedAt: now }, { merge: true });
  }

  console.log(
    `[clubPairs] ${gameId}: ${entries.length} pair(s) in ` +
      `${Math.ceil(entries.length / CHUNK)} batch(es)`,
  );
  return entries.length;
}

/**
 * Seal the club's summary of one evening.
 *
 * Called once, from the end-of-evening hook, after every stat for the night is
 * committed. Everything it needs is either already in the caller's hands or one
 * read away; the judgement — what counts as a record, what is worth telling —
 * lives in `roundSummary.ts`, which the phone shares byte-for-byte.
 *
 * WRITE ORDER MATTERS. The summary is written FIRST and the record baseline
 * only afterwards: the summary asks "is this better than what came before", and
 * raising the baseline first would make every record look like it had merely
 * been equalled.
 */
/**
 * The club's season block, as the seal and the close-on-seal check read it.
 *
 * One shape, named once, because these two now pass it to each other instead of
 * each fetching the document for themselves.
 */
type LiveSeasonsBlock = {
  enabled?: boolean;
  currentNo?: number;
  currentId?: string;
  startedAt?: number;
  roundsAtStart?: number;
  playedRounds?: number;
  reopenedAt?: number;
  cadence?: {
    type?: string;
    months?: number;
    endsAt?: number;
    targetRounds?: number;
  };
  count?: number;
  /** Set while the season is due and waiting out its correction window. */
  pendingClose?: PendingClose;
};

/**
 * Club totals as "nothing has happened yet".
 *
 * Handed to the summary core when the club's real totals are the wrong ones to
 * measure this evening against — a forgotten evening confirmed after later
 * ones have already been played and counted. `crossed()` reports a milestone
 * only when the total REACHES the step, so a zero total reports none, which is
 * the point: better no milestone than one attached to the wrong night.
 */
const NO_CLUB_TOTALS: ClubTotals = {
  goals: 0,
  assists: 0,
  rounds: 0,
  cleanSheets: 0,
  shootoutRounds: 0,
  evenings: 0,
};

async function sealRoundSummary(args: {
  gameId: string;
  groupId: string;
  at: number;
  attendees: string[];
  evSnaps: admin.firestore.DocumentSnapshot[];
  psSnap: admin.firestore.QuerySnapshot;
  csRef: admin.firestore.DocumentReference;
  /** The evening's own season stamp, or absent for one played before the
   *  stamp existed. Decides whether this seal credits the running season. */
  seasonId?: string;
  /**
   * The club document, read at most once for the whole trigger execution.
   *
   * Sealing one evening used to read `groups/{groupId}` three times in a single
   * execution — the season stamp, this function, and the close check at the
   * bottom of it — for two fields that never change in between.
   */
  groupOnce: () => Promise<admin.firestore.DocumentSnapshot>;
  standings: {
    userId: string;
    score: number;
    rank: number | null;
    rankTotal: number | null;
    rankDelta: number | null;
  }[];
}): Promise<void> {
  const { gameId, groupId } = args;
  // No club story, no club records, for a club of one. This is the write that
  // produced "שיאי מועדון" out of a handful of quick games. See isPersonalGroup.
  if (await isPersonalGroup(groupId)) {
    console.log('[roundSummary] personal group — skip', gameId);
    return;
  }
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const summaryRef = db.collection('roundSummaries').doc(gameId);
  // Create-only. A re-delivery of the trigger must not rewrite a story anyone
  // may already have read.
  if ((await summaryRef.get()).exists) {
    console.log('[roundSummary] already sealed — skip', gameId);
    return;
  }

  // Every player row for the night, GUESTS INCLUDED: they were on the pitch and
  // their goals belong in the evening's totals. (The core leaves them out of
  // the titles, which are club standings.)
  const statSnap = await db
    .collection('gamePlayerStats')
    .where('gameId', '==', gameId)
    .get();
  const players: PlayerEvening[] = statSnap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      userId: typeof x.userId === 'string' ? x.userId : d.id.split('__')[1] ?? '',
      isGuest: x.isGuest === true,
      goals: num(x.goals),
      assists: num(x.assists),
      wins: num(x.wins),
      cleanSheets: num(x.cleanSheets),
      rounds: num(x.rounds),
    };
  }).filter((p) => p.userId);

  const rhSnap = await db
    .collection('games')
    .doc(gameId)
    .collection('roundHistory')
    .get();
  const rounds: RoundRec[] = rhSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .sort((a, b) => num(a.at) - num(b.at))
    .map((r) => ({
      teamAIndex: typeof r.teamAIndex === 'number' ? r.teamAIndex : -1,
      teamBIndex: typeof r.teamBIndex === 'number' ? r.teamBIndex : -1,
      winnerSide:
        r.winnerSide === 'A' || r.winnerSide === 'B' ? r.winnerSide : 'tie',
      goals: Array.isArray(r.goals)
        ? (r.goals as Record<string, unknown>[]).map((g) => ({
            scorerId: typeof g.scorerId === 'string' ? g.scorerId : null,
            assisterId: typeof g.assisterId === 'string' ? g.assisterId : null,
            ownGoal: g.ownGoal === true,
            team: g.team === 'B' ? ('B' as const) : ('A' as const),
          }))
        : [],
      shootout: Array.isArray(r.penalties) && r.penalties.length > 0,
    }));

  // Career rows AFTER tonight, plus each player's previous best evening. The
  // best-evening figure is maintained here rather than derived, because
  // deriving it would mean re-reading every past evening of the club on every
  // finish.
  const career: PlayerCareer[] = [];
  const personalBests: Record<string, PersonalBest> = {};
  // Everything already sealed into a closed season, added back.
  //
  // `psSnap` is communityPlayerStats, which a season rollover ZEROES — so once
  // a club runs seasons these rows stop being a career and become a season.
  // Milestones ("your 50th goal for the club") are career facts, and reading
  // them off a reset table re-congratulates a 300-goal veteran on his 50th,
  // every season, permanently. The summary is written once, so the wrong story
  // cannot be corrected afterwards.
  //
  // The archives are the missing history and they are already sealed. A club
  // with no closed season pays nothing; one with three pays three document
  // reads, once per evening.
  const archived = await archivedCareerOf(args.groupId);
  for (const d of args.psSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    const uid = typeof x.userId === 'string' ? x.userId : '';
    if (!uid) continue;
    const past = archived.get(uid);
    career.push({
      userId: uid,
      goals: num(x.goals) + (past?.goals ?? 0),
      assists: num(x.assists) + (past?.assists ?? 0),
      rounds: num(x.rounds) + (past?.rounds ?? 0),
      wins: num(x.wins) + (past?.wins ?? 0),
      cleanSheets: num(x.cleanSheets) + (past?.cleanSheets ?? 0),
      games: num(x.games) + (past?.games ?? 0),
    });
    const be = x.bestEvening as Record<string, unknown> | undefined;
    if (be && typeof be === 'object') {
      personalBests[uid] = {
        goals: typeof be.goals === 'number' ? be.goals : undefined,
        assists: typeof be.assists === 'number' ? be.assists : undefined,
        involvement:
          typeof be.involvement === 'number' ? be.involvement : undefined,
        cleanSheets:
          typeof be.cleanSheets === 'number' ? be.cleanSheets : undefined,
        wins: typeof be.wins === 'number' ? be.wins : undefined,
      };
    }
  }

  const [csDoc, recDoc] = await Promise.all([
    args.csRef.get(),
    db.collection('clubRecords').doc(groupId).get(),
  ]);
  const cs = (csDoc.data() ?? {}) as Record<string, unknown>;
  const rec = (recDoc.data() ?? {}) as Record<string, unknown>;

  // `communityStats` has no assists or clean-sheet counter, so those two club
  // totals are summed from the member rows — which is exact, just not O(1).
  let clubAssists = 0;
  let clubCleanSheets = 0;
  for (const c of career) {
    clubAssists += c.assists;
    clubCleanSheets += c.cleanSheets;
  }

  const baseline: ClubRecordBaseline | null = recDoc.exists
    ? {
        goals: rec.goals as ClubRecordBaseline['goals'],
        assists: rec.assists as ClubRecordBaseline['assists'],
        involvement: rec.involvement as ClubRecordBaseline['involvement'],
        cleanSheets: rec.cleanSheets as ClubRecordBaseline['cleanSheets'],
        wins: rec.wins as ClubRecordBaseline['wins'],
        firstEverSeen: Array.isArray(rec.firstEverSeen)
          ? (rec.firstEverSeen as string[])
          : [],
      }
    : null;

  // Only SEALED evenings count as comparable history: they are the ones whose
  // numbers went into the baseline. Evenings that predate this feature are
  // invisible to it, and saying "record" on the strength of them would be a
  // guess dressed as a fact.
  const eveningsSealed = num(rec.eveningsSealed);

  // ── Is this the club's latest evening, or one being confirmed late? ──
  //
  // The seal fires on the transition into 'happened', and that is not only the
  // night itself: `setEveningPlayed` reaches it days later by writing
  // `playVerified` on an evening the sweep auto-closed as unverified. When it
  // does, every comparison below is read AS OF THE CONFIRMATION — the club's
  // evening number, the career totals a milestone is measured on, the record
  // baseline, each player's best evening — while the story being written is
  // about a night that came before some of them.
  //
  // What that produces is not a small error. The summary calls it the club's
  // Nth evening when it was the (N−k)th; a career milestone crossed last week
  // is attached to this one; and a record the night genuinely set is WITHHELD,
  // because the baseline it is compared against already contains the evening
  // that beat it. The write is `create()` and nothing recomputes it, so the
  // wrong story is permanent.
  //
  // None of that is reconstructible here — the "before" states no longer exist
  // anywhere — so the honest move is to claim nothing that needs one. See the
  // input to `buildRoundSummary` below: what the night's own documents prove
  // (the totals, the titles, the teams, the pair) is sealed as usual, and
  // every comparison is neutralised into the state the core already treats as
  // "no baseline".
  //
  // `lastEveningAt` is written by the batch at the bottom of this function, so
  // it starts empty on every existing club and the first seal after this ships
  // seeds it. A club that seals nothing seals nothing wrongly, and one that
  // seals two evenings on the same night is not late — hence the grace, which
  // is the same span the rest of this file calls "tonight".
  const lastEveningAt = num(rec.lastEveningAt);
  const lateConfirmation =
    args.at > 0 && lastEveningAt > 0 && args.at < lastEveningAt - TONIGHT_MS;
  if (lateConfirmation) {
    console.log(
      '[roundSummary] late confirmation — comparisons suppressed',
      groupId, gameId, args.at, lastEveningAt,
    );
  }

  // Where the running season started counting, or null when the club does not
  // run seasons (in which case there is no progress to mirror).
  let seasonRoundsAtStart: number | null = null;
  // Where the LIVE TABLE was last emptied — a different question, and it took
  // a regression to notice that.
  //
  // `seasonRoundsAtStart` answers "does this evening credit the RUNNING
  // season's progress", and the evening's stamp decides it. `tableZeroedAt`
  // answers "how many evenings has the table this summary ranks people in had
  // since it was zeroed", and only the running season can answer that: the
  // close is what empties `communityPlayerStats`, whatever stamp the evening
  // in hand happens to carry.
  //
  // They were one variable, and gating it on the stamp therefore took
  // `seasonEvenings` away from any evening whose stamp is not the running
  // season — which switches OFF the one guard that exists for this
  // (`rankEventsOf`: `seasonEvenings === 1` → no rank events). Absent, the
  // field reads as 0, the guard never fires, and the summary invents the dozen
  // dramatic climbs out of an all-zero table that commit 28d0823 was written
  // to kill. Production already holds a game stamped 's3' on a club that knows
  // only 's2', so the case is reachable.
  let tableZeroedAt: number | null = null;
  /** Kept past the try, for the close check at the very bottom of this
   *  function — which used to fetch this same document all over again. */
  let liveSeasons: LiveSeasonsBlock | undefined;
  try {
    const gDoc = await args.groupOnce();
    const sea = gDoc.data()?.seasons as LiveSeasonsBlock | undefined;
    liveSeasons = sea;
    // Only for an evening that belongs to the season being credited.
    //
    // The seal fires on the transition into 'happened', which is not only the
    // night itself: an admin confirming a forgotten evening days later runs
    // exactly this path. Without the stamp check that confirmation pushed the
    // CURRENT season one evening closer to its target for an evening played in
    // a season already in the archive — while the statistics screen, which
    // does compare the stamp, did not move. Two screens, one season, two
    // numbers, which is the failure this feature keeps repeating.
    //
    // An unstamped evening belongs to season 1, the same rule the client has
    // encoded since the feature shipped: the stamp only began being written
    // when seasons landed, and a club that carried its history into season 1
    // played those nights inside it.
    if (sea?.enabled) {
      // Unconditional: the table was zeroed when the RUNNING season opened,
      // and that is true of this evening whatever it is stamped with.
      tableZeroedAt = num(sea.roundsAtStart);
      const stamp = typeof args.seasonId === 'string' ? args.seasonId : '';
      const mine = stamp ? stamp === sea.currentId : sea.currentNo === 1;
      if (mine) seasonRoundsAtStart = tableZeroedAt;
      else {
        console.log(
          '[season] seal is not for the running season — progress not credited',
          groupId, gameId, stamp, sea.currentId,
        );
      }
    }
  } catch (err) {
    console.warn('[season] progress mirror skipped', groupId, err);
  }
  // Club totals are LIFETIME here, same as the player rows above: a milestone
  // is a milestone, and the sealed seasons hold what the live document no
  // longer does. `evenings` already comes from a counter that never resets.
  const clubTotals: ClubTotals = (() => {
    const past = archivedClubTotals.get(groupId) ?? {
      goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0,
    };
    return {
      goals: num(cs.goals) + past.goals,
      assists: clubAssists + past.assists,
      rounds: num(cs.rounds) + past.rounds,
      cleanSheets: clubCleanSheets + past.cleanSheets,
      shootoutRounds: num(cs.shootoutRounds) + past.shootoutRounds,
      evenings: eveningsSealed + 1,
    };
  })();

  const summary = buildRoundSummary({
    gameId,
    groupId,
    at: args.at,
    // The night's own documents. True whenever this runs.
    players,
    rounds,
    // ── and from here down, every input is a COMPARISON ──
    //
    // Each one is emptied on a late confirmation into the exact state the core
    // already knows how to handle: no career rows → no player milestones, a
    // zeroed club total → no club milestone (`crossed()` needs the total to
    // reach the step), no baseline and `eveningsCompared: 0` → no club record,
    // no personal record and no first-ever, no standings → no rank movement.
    // The alternative was to keep computing them against a history that has
    // moved past this evening, which is how the summary came to withhold a
    // record the night actually set.
    career: lateConfirmation ? [] : career,
    club: lateConfirmation ? NO_CLUB_TOTALS : clubTotals,
    records: lateConfirmation ? null : baseline,
    personalBests: lateConfirmation ? {} : personalBests,
    standings: lateConfirmation ? [] : args.standings,
    basis: {
      since: typeof rec.since === 'number' ? rec.since : args.at,
      // 0 is the literal truth on a late confirmation: there are no past
      // evenings this summary can honestly be compared against, because the
      // window it would compare with contains evenings that came AFTER it.
      eveningsCompared: lateConfirmation ? 0 : eveningsSealed,
    },
    // Undefined for a club with no seasons, which behaves exactly as before.
    ...(tableZeroedAt !== null
      ? { seasonEvenings: eveningsSealed + 1 - tableZeroedAt }
      : {}),
    now: Date.now(),
  });

  await summaryRef.create({
    ...(summary as unknown as admin.firestore.DocumentData),
    // Carried on the document so the screen can say why the evening has no
    // records and no movement, instead of reading as a night where nothing
    // happened. Nothing renders it yet — see the note in the handover.
    ...(lateConfirmation ? { lateConfirmation: true } : {}),
  });

  // ── and only NOW does the baseline move ──
  const next = nextRecordBaseline(baseline, summary, players);
  const batch = db.batch();
  batch.set(
    db.collection('clubRecords').doc(groupId),
    {
      groupId,
      ...next,
      // INCREMENT, not `read + 1`.
      //
      // This counter is what a season's progress is measured against and what
      // the title-eligibility threshold divides — so it has to be exact, and
      // an absolute write computed from a value read at the top of this
      // function is a read-modify-write with nothing guarding it. Two evenings
      // sealing at once both read N and both write N+1, and one of them is
      // simply gone.
      //
      // Reproduced in production on the QA club: three evenings sealed within
      // a minute of each other left three summaries and a counter of two. A
      // club playing two games in a night, or draining a backlog after an
      // outage, hits exactly this.
      //
      // Safe to increment because `summaryRef.create()` above throws if the
      // evening was already sealed, so this batch runs at most once per game.
      eveningsSealed: admin.firestore.FieldValue.increment(1),
      since: typeof rec.since === 'number' ? rec.since : args.at,
      // The newest evening the club has SEALED, by when it was played rather
      // than by when it was sealed — the only thing that lets the next seal
      // tell a forgotten evening confirmed days later from tonight's. `max`
      // and not a plain write, so a late confirmation cannot rewind it and
      // make the evening after it look late in turn.
      //
      // Read-modify-write on a value read at the top of this function, unlike
      // the counter above it, because Firestore has no atomic max. Two seals
      // racing can lose the later one's stamp; the cost of that is one evening
      // that is not recognised as late, not a lost count.
      lastEveningAt: Math.max(num(rec.lastEveningAt), args.at),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  // A client-readable mirror of the season's own evening count.
  //
  // The counter the season target is actually measured against lives on
  // clubRecords, which the rules keep server-only — so the app could show a
  // rounds target but never how close the club was to it, and "העונה תסתיים
  // אחרי 24 מחזורים" read identically on evening 1 and evening 23. One field
  // on a document the app already reads, written on the same batch that seals
  // the evening, and zeroed by every path that opens a season.
  if (seasonRoundsAtStart !== null) {
    batch.set(
      db.collection('groups').doc(groupId),
      // Incremented for the same reason as the counter it mirrors — computing
      // it from the same stale read would reintroduce the lost update on the
      // number the app actually SHOWS ("2 מתוך 3 מחזורים"). Every path that
      // opens a season zeroes this field, so counting up from there is exact.
      {
        seasons: {
          playedRounds: admin.firestore.FieldValue.increment(1),
        },
      },
      { merge: true },
    );
  }
  // Each player's own high-water mark, for next time.
  for (const p of players) {
    if (p.isGuest) continue;
    const prev = personalBests[p.userId] ?? {};
    const involvement = p.goals + p.assists;
    batch.set(
      db.collection('communityPlayerStats').doc(`${groupId}__${p.userId}`),
      {
        bestEvening: {
          goals: Math.max(prev.goals ?? 0, p.goals),
          assists: Math.max(prev.assists ?? 0, p.assists),
          involvement: Math.max(prev.involvement ?? 0, involvement),
          cleanSheets: Math.max(prev.cleanSheets ?? 0, p.cleanSheets),
          wins: Math.max(prev.wins ?? 0, p.wins),
        },
      },
      { merge: true },
    );
  }
  await batch.commit();
  console.log(
    `[roundSummary] sealed ${gameId}: ${summary.stats.rounds} mini-games, ` +
      `${summary.stats.goals} goals, ${summary.events.length} event(s)`,
  );

  // The evening that meets the season's target ENDS the season — here, not at
  // the top of the next hour. `playedRounds` went up in the batch above, so
  // this is the first moment the answer can be yes, and the club is as quiet
  // as it will ever be: the evening finished a line ago. Owner: "ברגע שאני
  // מסיים את המחזור האחרון של עונה — ישר לסיים אותה, בלי שעה".
  //
  // After the commit and never inside it. The seal is the record of the
  // evening and must stand whatever happens next; the hourly sweep still
  // catches every season this does not.
  //
  // Only when this evening actually MOVED the season. `seasonRoundsAtStart` is
  // null for a club with seasons off and for an evening that belongs to a
  // season already in the archive — in both cases the batch above incremented
  // nothing, so no target can have been met that was not met an hour ago, and
  // the work below is a group read and two game queries spent to answer "no".
  if (seasonRoundsAtStart !== null && liveSeasons) {
    // The count AFTER the increment this seal just committed.
    //
    // `closeSeasonIfRoundsTargetMet` used to re-read the club document to get
    // it, which is the third read of the same document in one execution. The
    // snapshot in hand predates the batch by a few lines, so the evening just
    // sealed is added here — exactly the way `seasonEvenings` above already
    // does it for the summary.
    const playedNow =
      typeof liveSeasons.playedRounds === 'number' && liveSeasons.playedRounds >= 0
        ? liveSeasons.playedRounds + 1
        : eveningsSealed + 1 - seasonRoundsAtStart;
    const gName = (await args.groupOnce()).get('name');
    await closeSeasonIfRoundsTargetMet(groupId, gameId, {
      name: typeof gName === 'string' ? gName : '',
      seasons: liveSeasons,
      played: playedNow,
    });
  }
}

export const onGameRosterChanged = onDocumentWritten(
  'games/{gameId}',
  async (event) => {
    const before = event.data?.before?.data() as
      | {
          players?: string[];
          guests?: unknown[];
          maxPlayers?: number;
          status?: string;
          capacityNoticeSent?: boolean;
          openedNotificationSent?: boolean;
          arrivals?: Record<string, string>;
          pending?: string[];
          waitlist?: string[];
          pendingPromotion?: { uid?: string; offeredAt?: number } | null;
          registrationOpensAt?: number;
          publicOpenAt?: number;
          title?: string;
          groupId?: string;
          createdBy?: string;
        }
      | undefined;
    const after = event.data?.after?.data() as
      | {
          players?: string[];
          guests?: unknown[];
          maxPlayers?: number;
          status?: string;
          visibility?: string;
          capacityNoticeSent?: boolean;
          openedNotificationSent?: boolean;
          title?: string;
          startsAt?: number;
          groupId?: string;
          createdBy?: string;
          pendingJoinerIds?: string[];
          pendingJoinFlushAt?: number;
          arrivals?: Record<string, string>;
          pending?: string[];
          waitlist?: string[];
          pendingPromotion?: { uid?: string; offeredAt?: number } | null;
          liveMatch?: { phase?: string } | null;
          registrationOpensAt?: number;
          publicOpenAt?: number;
          // Read by enqueueGameMoments to queue the precise auto-teams task.
          // The runtime object is the whole game doc either way; declaring it
          // keeps the cast honest about what this trigger actually uses.
          autoTeamsAt?: number;
        }
      | undefined;

    if (!after) {
      // ── Game DELETED → mint the cancellation push SERVER-SIDE ────────────
      // A hard-delete removes the game doc, so the client's own
      // gameCanceledOrUpdated dispatch can't be authorised (the fan-out gate
      // reads the now-missing doc → deliver to nobody), and every registered
      // player was left showing a game that no longer exists (audit #9). Mint
      // it here from `before` with srv:true (unspoofable, no gate needed) using
      // the real last-known roster. Fires exactly once per delete.
      // Don't spam a "game cancelled" push when a FINISHED / already-cancelled
      // game is deleted (cleanup) — its participants already played / were told.
      const delStatus = before?.status;
      // ── Audit trail: record EVERY game deletion (create-once) ────────────
      // Firestore triggers carry no auth actor, so we can't see WHO issued the
      // delete here. A client build stamps the exact deleter into this same doc
      // BEFORE deleting (its create lands first → our create() below no-ops and
      // theirs wins). Until then this is the best guess: a populated game that
      // was deleted = a human admin/creator (the delete button is admin-gated);
      // an empty (0-roster) game = the hourly stale-cleanup cron.
      if (before) {
        const rosterCount = Array.from(
          new Set([
            ...(before.players ?? []),
            ...(before.waitlist ?? []),
            ...(before.pending ?? []),
          ]),
        ).length;
        const source = rosterCount === 0 ? 'auto-cleanup' : 'manual';
        try {
          await db
            .collection('gameDeletions')
            .doc(event.params.gameId)
            .create({
              gameId: event.params.gameId,
              deletedBy: source === 'manual' ? before.createdBy ?? '' : 'system:stale-cleanup',
              deletedByApprox: true, // server best-guess; a client build overwrites with the exact actor
              source,
              gameTitle: before.title ?? '',
              groupId: before.groupId ?? '',
              createdBy: before.createdBy ?? '',
              status: delStatus ?? '',
              rosterCount,
              deletedAt: Date.now(),
            });
        } catch {
          /* already recorded — a client stamped the exact deleter, or a retry */
        }
      }
      if (before && delStatus !== 'finished' && delStatus !== 'cancelled') {
        // Self-exclude the game creator: the person deleting is virtually always
        // the organiser, and they don't need "your game was cancelled" for their
        // own action (spam sensitivity). A co-admin delete still notifies them.
        const deleter = before.createdBy ?? '';
        const roster = Array.from(
          new Set([
            ...(before.players ?? []),
            ...(before.waitlist ?? []),
            ...(before.pending ?? []),
          ]),
        ).filter((uid) => uid !== deleter);
        if (roster.length > 0) {
          try {
            // createNotificationOnce mints with srv:true internally → the
            // fan-out gate trusts it without a createdByUid check.
            await createNotificationOnce({
              type: 'gameCanceledOrUpdated',
              recipientId: event.params.gameId,
              payload: {
                gameId: event.params.gameId,
                title: before.title ?? '',
                action: 'deleted',
                recipientUids: roster,
                groupId: before.groupId ?? '',
              },
            });
          } catch (err) {
            console.error(
              '[onGameRosterChanged] delete cancellation push failed',
              event.params.gameId,
              err,
            );
          }
        }
      }
      return;
    }

    const ref = event.data!.after.ref;

    // ── The club document, fetched at most once for this whole execution ──
    //
    // Four separate blocks below want something off `groups/{groupId}`: the
    // season stamp, the seal's season mirror, the close-on-target check inside
    // it, and the join-request fan-out's admin list. Each opened the document
    // for itself, so ONE sealed evening read the same 2KB document three times
    // in a single invocation — for two fields that cannot change in between,
    // since the writes in between are to the game and to the stats rows.
    //
    // Lazy, so a trigger that touches none of them still pays nothing, and by
    // promise rather than by value so two blocks racing inside the same
    // invocation share one round trip.
    //
    // The SUCCESS is memoised, never the failure. `??=` stored the promise
    // itself, so a rejected read stayed in the slot and every later consumer
    // re-threw the same error: one transient blip on `groups/{id}` cost the
    // invocation its season stamp, its season progress mirror AND the
    // join-request push to the club's admins, each degrading quietly behind
    // its own catch. Before the memo those were three independent reads and a
    // blip cost at most one of them. Clearing the slot on rejection puts that
    // back — the next caller opens a fresh round trip — while a club that
    // reads fine still pays exactly one.
    /** A season stamp this execution wrote itself — see the stamp block. */
    let stampedSeasonId = '';
    let groupSnapOnce: Promise<admin.firestore.DocumentSnapshot> | null = null;
    const groupOnce = (): Promise<admin.firestore.DocumentSnapshot> => {
      if (groupSnapOnce) return groupSnapOnce;
      const p = db
        .collection('groups')
        .doc(String(after.groupId ?? ''))
        .get();
      groupSnapOnce = p;
      // Attached here so the rejection is observed even if no consumer ever
      // awaits it — an unhandled rejection would take the whole function down.
      p.catch(() => {
        if (groupSnapOnce === p) groupSnapOnce = null;
      });
      return p;
    };

    // ── Scheduling switched OFF → open the game NOW ───────────────────────
    //
    // Turning off "תזמון פתיחת הרשמה" means the game should open on save and
    // the roster should be told, which is exactly what the reporter expected
    // and exactly what did not happen: the edit screen only ever PATCHED
    // `registrationOpensAt` while the toggle was ON, so switching it off wrote
    // nothing at all and the game stayed `scheduled` for good.
    //
    // The client now stamps `registrationOpensAt` to the moment of saving. That
    // makes the game due, and the safety-net cron would pick it up within five
    // minutes — but "after saving" is what was asked for, so the same
    // self-verifying flip runs here too. It re-reads the game, re-checks every
    // guard, and `openedNotificationSent` latches the push, so this racing the
    // cron or a Cloud Task cannot double-notify.
    try {
      if (
        after.status === 'scheduled' &&
        after.openedNotificationSent !== true &&
        typeof after.registrationOpensAt === 'number' &&
        after.registrationOpensAt > 0 &&
        after.registrationOpensAt <= Date.now() &&
        // Only on the transition. Without this every unrelated write to a due
        // game re-enters the flip.
        before?.registrationOpensAt !== after.registrationOpensAt
      ) {
        await flipScheduledGameOnce(event.params.gameId);
      }
    } catch (err) {
      console.error(
        '[onGameRosterChanged] immediate open failed',
        event.params.gameId,
        err,
      );
    }

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
      } catch (err) {
        console.error(
          '[onGameRosterChanged] spotOffered push failed',
          event.params.gameId,
          err,
        );
      }
    }

    // ── Guest promoted from the waitlist → notify the player who ADDED them ──
    // Guests have no account to push, so when a waitlisted guest becomes active
    // (admin "להרכב", or a freed seat), the adder gets the heads-up. Gated on the
    // waitlisted:true→false transition per guest; createNotificationOnce dedupes.
    try {
      const beforeGuests = (before?.guests ?? []) as Array<{
        id?: string;
        waitlisted?: boolean;
      }>;
      const afterGuests = (after.guests ?? []) as Array<{
        id?: string;
        name?: string;
        waitlisted?: boolean;
        addedBy?: string;
      }>;
      const wasWaitlisted = new Map(
        beforeGuests.map((g) => [g.id, g.waitlisted === true]),
      );
      for (const g of afterGuests) {
        if (
          g.id &&
          g.addedBy &&
          wasWaitlisted.get(g.id) === true &&
          g.waitlisted !== true
        ) {
          await createNotificationOnce({
            type: 'guestPromoted',
            recipientId: g.addedBy,
            payload: {
              gameId: event.params.gameId,
              title: after.title ?? '',
              startsAt: after.startsAt,
              guestName: g.name ?? '',
            },
          });
        }
      }
    } catch (err) {
      console.error(
        '[onGameRosterChanged] guestPromoted push failed',
        event.params.gameId,
        err,
      );
    }

    // ── Server-owned waitlist promotion + team-prune on roster shrink ──────
    // A self-cancel writes as the cancelling user, whose Firestore rule permits
    // changing ONLY their own membership — it may NOT move a waitlisted stranger
    // into players[] (audit #5) nor touch draftTeams/rotation (audit #4). So
    // when a player slot frees, the promotion (auto-admit or offer) AND pruning
    // the departed player from any drawn teams/rotation happen HERE.
    //
    // Idempotent + convergent: the transaction only writes when something
    // actually changes, and each promotion fills exactly one seat, so a re-fire
    // stops once no seat is free / nothing is left to prune. An admin path that
    // already promoted client-side is therefore a no-op here (no free seat).
    const beforePlayers = before?.players ?? [];
    const afterPlayers = after.players ?? [];
    // An ACTIVE guest occupies a real seat, so removing one frees a seat exactly
    // like a player leaving. It must trigger the same waitlist promotion (user
    // report [4ldH]: "removed someone from a full game, the waitlisted person got
    // no notification"). The guest was being removed via the guests[] array,
    // which the old rosterShrank check ignored entirely.
    const beforeActiveGuests = ((before?.guests ?? []) as { waitlisted?: boolean }[]).filter(
      (g) => !g?.waitlisted,
    ).length;
    const afterActiveGuests = ((after.guests ?? []) as { waitlisted?: boolean }[]).filter(
      (g) => !g?.waitlisted,
    ).length;
    const guestSeatFreed = afterActiveGuests < beforeActiveGuests;
    const rosterShrank =
      JSON.stringify(beforePlayers) !== JSON.stringify(afterPlayers) ||
      JSON.stringify(before?.waitlist ?? []) !==
        JSON.stringify(after.waitlist ?? []) ||
      JSON.stringify(before?.pending ?? []) !== JSON.stringify(after.pending ?? []) ||
      guestSeatFreed;
    // GameStatus is 'scheduled'|'open'|'locked'|'active'|'finished'|'cancelled'.
    // PRUNE a departed ghost from drawn teams / live rotation for any game still
    // in play (incl. 'locked' near kickoff AND 'active' live play) — a player
    // who leaves a live game must not linger on a team. Only a finished /
    // cancelled game is skipped.
    const afterStatus = after.status;
    const pruneOk =
      afterStatus === undefined ||
      afterStatus === 'open' ||
      afterStatus === 'scheduled' ||
      afterStatus === 'locked' ||
      afterStatus === 'active';
    // PROMOTE a waitlist head into a freed seat only while the game is still
    // registration-relevant — NOT once it's live ('active'). 'locked' still
    // promotes (a no-show freeing a seat near kickoff should be backfilled),
    // matching the admin removePlayer path.
    const promoteOk =
      afterStatus === undefined ||
      afterStatus === 'open' ||
      afterStatus === 'scheduled' ||
      afterStatus === 'locked';
    if (rosterShrank && pruneOk) {
      // uids that were players before and are no longer in ANY roster array now.
      const stillHere = new Set<string>([
        ...afterPlayers,
        ...(after.waitlist ?? []),
        ...(after.pending ?? []),
      ]);
      const departed = new Set<string>(
        beforePlayers.filter((p) => !stillHere.has(p)),
      );
      let promotedUid: string | null = null;
      let promotedTitle = '';
      let promotedStartsAt = 0;
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const d = snap.data() as Record<string, unknown>;
          const players = Array.isArray(d.players)
            ? [...(d.players as string[])]
            : [];
          const waitlist = Array.isArray(d.waitlist)
            ? [...(d.waitlist as string[])]
            : [];
          const pending = Array.isArray(d.pending)
            ? [...(d.pending as string[])]
            : [];
          const guests = Array.isArray(d.guests)
            ? (d.guests as { waitlisted?: boolean }[])
            : [];
          const activeGuests = guests.filter((g) => !g?.waitlisted).length;
          const updates: Record<string, unknown> = {};

          // (a) Prune the departed player(s) from drawn teams / live rotation.
          Object.assign(updates, pruneUidsFromTeamsSrv(d, departed));

          // (b) Fill a freed player seat from the waitlist head — unless an
          //     offer already reserves it. Only while the game is still
          //     registration-relevant (promoteOk); a live 'active' game prunes
          //     ghosts (above) but never backfills a seat mid-play.
          const ppUid = (d.pendingPromotion as { uid?: string } | null)?.uid;
          const occupancy = players.length + activeGuests + (ppUid ? 1 : 0);
          if (
            promoteOk &&
            // Only backfill a seat freed by a REAL departure (cancel / no-show
            // / removal). An admin who MOVES a player players→waitlist via
            // adminReorderRoster leaves them in the waitlist, so they're NOT in
            // `departed` — without this gate the trigger would auto-promote (or
            // re-offer) the seat the admin just deliberately opened, reverting
            // the manual roster action.
            (departed.size > 0 || guestSeatFreed) &&
            !ppUid &&
            waitlist.length > 0 &&
            occupancy < ((d.maxPlayers as number) ?? 15)
          ) {
            if (d.waitlistApprovalRequired === false) {
              // AUTO: admit the head straight in.
              const head = waitlist.shift() as string;
              players.push(head);
              promotedUid = head;
              promotedTitle = typeof d.title === 'string' ? d.title : '';
              promotedStartsAt =
                typeof d.startsAt === 'number' ? d.startsAt : 0;
              updates.players = players;
              updates.waitlist = waitlist;
              updates.participantIds = Array.from(
                new Set([...players, ...waitlist, ...pending]),
              );
            } else {
              // MANUAL / default: OFFER the seat to the head (the spotOffered
              // push fires on the next fire, when pendingPromotion.uid changes).
              updates.pendingPromotion = {
                uid: waitlist[0],
                offeredAt: Date.now(),
              };
            }
          }

          if (Object.keys(updates).length > 0) {
            updates.updatedAt = Date.now();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tx.update(ref, updates as any);
          }
        });
      } catch (err) {
        console.error(
          '[onGameRosterChanged] promote/prune failed',
          event.params.gameId,
          err,
        );
      }
      if (promotedUid) {
        try {
          await createNotificationOnce({
            type: 'spotOpened',
            recipientId: promotedUid,
            payload: {
              gameId: event.params.gameId,
              title: promotedTitle,
              startsAt: promotedStartsAt,
            },
          });
        } catch (err) {
          console.error(
            '[onGameRosterChanged] spotOpened push failed',
            event.params.gameId,
            err,
          );
        }
      }
    }

    // ── Count a full GAME per participant when the game FINISHES ───────────
    // Drives the community table's cumulative "games played" column. The
    // before→after status transition to 'finished' fires exactly once, so
    // this can't double-count. Uses the registered roster (players[]).
    // Gated on "was actually played" (timer started / a round ran) so a game
    // that the stale-cleanup FINISHES without ever being played in-app doesn't
    // credit everyone a phantom game — same signal the cleanup uses.
    // ── Season stamp ────────────────────────────────────────────────────
    // Which season a round belongs to is decided by WHEN IT WAS PLAYED, not
    // when it was created: a weekly fixture is cloned days ahead, and a game
    // created in one season and played in the next belongs to the next.
    //
    // Stamped here, on the server, and never by the client — 141 timestamps in
    // the client service come from the device clock, and a phone a day out
    // would file an evening under the wrong season with nothing to catch it.
    //
    // Written once. `create()` on the field is not available, so the guard is
    // the absent-check: a stamp already present is never overwritten, which
    // keeps a redelivered event and the finish backstop below idempotent.
    //
    // On the TRANSITION into those two states, not on every write while the
    // game sits in one of them. The absent-check alone can never become false
    // for a club with seasons switched off — nothing is written, so the next
    // write tries again — and a live evening is written to constantly: every
    // arrival, every mini-game, every roster edit re-opened the club document
    // to be told once more that the club does not run seasons. 191 of the
    // clubs in production have seasons off, which is nearly all of them, and
    // they were paying that read for ever.
    //
    // The two transitions are still both of them: `active` is where the stamp
    // belongs, and `finished` is the backstop for an evening whose active
    // transition lost its read. A redelivery of either event replays it.
    //
    // A status transition is not the only way back in, because it cannot be:
    // there are exactly two of them and a finished game has no more. Gating on
    // the transition alone is what the absent-check used to provide for free —
    // every write retried — and an evening that loses the group read on BOTH
    // transitions would then never be stamped at all. That is not a neutral
    // outcome: an unstamped evening resolves to season 1 for the client
    // (`src/utils/seasonScope.ts`) and for the seal alike, so a club past its
    // first season files the night under an archived one, and with finished
    // games client-read-only and the stamp write-once there is no path that
    // repairs it.
    //
    // So a failed read leaves a marker on the game and the next write to it —
    // an arrival, an admin's confirmation, the finish itself — tries again.
    // The marker is written only when it is not already there, so a club whose
    // reads keep failing writes it once and stops, rather than re-triggering
    // itself in a loop.
    const stampStatusChanged = before?.status !== after.status;
    const stampRetryPending =
      (after as { seasonStampRetry?: boolean }).seasonStampRetry === true;
    if (
      after.groupId &&
      (stampStatusChanged || stampRetryPending) &&
      !(after as { seasonId?: string }).seasonId &&
      (after.status === 'active' || after.status === 'finished')
    ) {
      try {
        const gSnap = await groupOnce();
        const seasons = (gSnap.data() as { seasons?: { enabled?: boolean; currentId?: string } } | undefined)?.seasons;
        // The marker has done its job the moment the READ succeeds, whatever
        // the answer was: a club with seasons off is not waiting for a stamp,
        // and leaving the flag on would make every later write re-read the
        // club document for ever — the cost the transition gate exists to
        // avoid for the 191 clubs that have seasons switched off.
        const clearRetry = stampRetryPending
          ? { seasonStampRetry: admin.firestore.FieldValue.delete() }
          : {};
        if (seasons?.enabled && seasons.currentId) {
          await event.data!.after.ref.update({
            seasonId: seasons.currentId,
            ...clearRetry,
          });
          // Kept for the seal further down. The in-memory `after` was captured
          // before this write, so it still has no stamp — and the seal decides
          // whether this evening credits the running season by comparing
          // exactly that field.
          stampedSeasonId = seasons.currentId;
        } else if (stampRetryPending) {
          await event.data!.after.ref.update(clearRetry);
        }
      } catch (err) {
        // A missing stamp is recoverable — the rollover resolves an unstamped
        // game to the open season. Losing the evening's stats is not, so this
        // never throws into the rest of the trigger.
        console.error('[season] stamp failed', event.params.gameId, err);
        if (!stampRetryPending) {
          try {
            await event.data!.after.ref.update({ seasonStampRetry: true });
          } catch (flagErr) {
            console.error(
              '[season] stamp retry marker failed',
              event.params.gameId,
              flagErr,
            );
          }
        }
      }
    }

    // Credit the evening the moment it BECOMES one, not the moment its status
    // flips.
    //
    // The two used to be the same event, and now they are not: an evening the
    // sweep closed with nothing to show for it is 'unverified' — finished, but
    // not counted — until an admin says it happened. That decision arrives
    // hours later as a field write, long after the status stopped changing, so
    // a gate watching the status would never see it and the confirmed evening
    // would be credited to nobody.
    //
    // Keyed on the answer instead: not-happened → happened, however it got
    // there. The `finishCredited` latch below still makes it exactly once, so
    // an evening that arrives here twice — a redelivered finish, then an
    // admin's confirmation — credits once and only once.
    const wasHappened = didEveningHappen(before as PlayableEvening | undefined);
    const isHappened = didEveningHappen(after as PlayableEvening);
    if (
      !wasHappened &&
      isHappened &&
      after.groupId &&
      Array.isArray(after.players) &&
      after.players.length > 0
    ) {
      const gid = after.groupId;
      // Exclude no-shows — the same rule the attendance‑based counts use
      // (isAttendedGame / avgAttendance / attendedTogether). Without this, the
      // community "games played" column + the 'הכי נאמן' (most‑loyal) leader
      // credited nights a player registered for but skipped, diverging from
      // the player's own Statistics screen (which strips no‑shows).
      const arrivals =
        (after.arrivals as Record<string, string> | undefined) ?? {};
      // Latched so the evening-standings block below runs EXACTLY once per
      // game (a redelivered finish event fails the games batch on the
      // finishCredited latch → creditedNow stays false → standings skip,
      // avoiding a double `lastEveningScore` overwrite that would zero the
      // next delta). Declared OUTSIDE the games try so the standings block
      // after the catch can still read gid/arrivals/creditedNow.
      let creditedNow = false;
      try {
        const batch = db.batch();
        for (const uid of after.players) {
          if (arrivals[uid] === 'no_show') continue;
          batch.set(
            db.collection('communityPlayerStats').doc(`${gid}__${uid}`),
            {
              groupId: gid,
              userId: uid,
              games: admin.firestore.FieldValue.increment(1),
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        }
        // Redelivery latch: at-least-once means this finish event can be
        // delivered twice (same before→after), double-crediting everyone.
        // A marker created IN THE SAME BATCH makes the second commit fail
        // (ALREADY_EXISTS) → credited exactly once per game.
        batch.create(
          db
            .collection('games')
            .doc(event.params.gameId)
            .collection('finishCredited')
            .doc('once'),
          { at: Date.now() },
        );
        await batch.commit();
        creditedNow = true;
      } catch (err) {
        const code = (err as { code?: number | string }).code;
        if (code === 6 || code === 'already-exists') {
          console.log(
            '[onGameRosterChanged] games already credited — skip (redelivery)',
            event.params.gameId,
          );
        } else
        console.error(
          '[onGameRosterChanged] games tally failed',
          event.params.gameId,
          err,
        );
      }

      // ── Evening standings: score delta + community rank movement ─────
      // Runs ONCE per game (creditedNow), AFTER the games credit — the ranking
      // metric (points = goals×2 + assists) is already final from
      // commitRoundStats, so ranks read here are the finalised ones (the user's
      // timing requirement). Stored per player at eveningStandings/{game__uid}
      // so the summary card reads ONE doc instead of re-ranking client-side.
      if (creditedNow) {
        try {
          const num = (v: unknown) =>
            typeof v === 'number' && Number.isFinite(v) ? v : 0;
          // SELF-based performance model — the FULL client model from
          // src/utils/eveningScore, penalties included. Goals/assists are
          // evening TOTALS measured against the community king benchmark
          // (goalsFor10/assistsFor10) — NOT per-game.
          // Keep in sync with SCORE_WEIGHTS_* + PENALTY_POINTS + eveningScore().
          //
          // ⚠️ This used to drop the penalty axis, on the belief that shootout
          // data "isn't available here". It is: commitRoundStats writes
          // penSaved/penScored/penMissed/penConceded onto the SAME
          // gamePlayerStats doc this function already reads for goals and
          // wins. The consequence was invisible while the card recomputed its
          // own score — and became real the moment the card started showing
          // the STORED one: a keeper who saved a shootout penalty saw it
          // recorded in his stats and absent from the score that ranked him.
          // Extracted to ./eveningScoreCore so the client's copy in
          // src/utils/eveningScore.ts can be held to it by a contract test
          // (tests/logic/eveningScoreParity) instead of by a comment.
          const eveningScore = eveningScoreServer;
          const attendees = after.players.filter(
            (u) => arrivals[u] !== 'no_show',
          );
          // Cumulative community rows (points already include this evening).
          const psSnap = await db
            .collection('communityPlayerStats')
            .where('groupId', '==', gid)
            .get();
          const cum = psSnap.docs
            .map((d) => {
              const x = d.data() as {
                userId?: string;
                goals?: number;
                assists?: number;
                wins?: number;
                lastEveningScore?: number;
                lastEveningAt?: number;
              };
              return {
                uid: typeof x.userId === 'string' ? x.userId : '',
                goals: num(x.goals),
                assists: num(x.assists),
                wins: num(x.wins),
                lastScore:
                  typeof x.lastEveningScore === 'number'
                    ? x.lastEveningScore
                    : null,
                // Which evening that score came from. Absent on every row
                // written before this shipped, and absence is treated as
                // "older" — which is what it almost always is, and what the
                // code assumed unconditionally until now.
                lastScoreAt:
                  typeof x.lastEveningAt === 'number' ? x.lastEveningAt : null,
              };
            })
            .filter((r) => r.uid);
          // This-evening per-player stats (for the score + the "before" ranking).
          const evSnaps = await Promise.all(
            attendees.map((u) =>
              db
                .collection('gamePlayerStats')
                .doc(`${event.params.gameId}__${u}`)
                .get(),
            ),
          );
          const evStat: Record<
            string,
            {
              goals: number;
              assists: number;
              wins: number;
              rounds: number;
              pen: { scored: number; saved: number; missed: number; conceded: number };
            }
          > = {};
          attendees.forEach((u, i) => {
            const d = evSnaps[i].exists
              ? (evSnaps[i].data() as Record<string, unknown>)
              : {};
            evStat[u] = {
              goals: num(d.goals),
              assists: num(d.assists),
              wins: num(d.wins),
              rounds: num(d.rounds),
              // Same document, written by commitRoundStats — see the note on
              // eveningScore above.
              pen: {
                scored: num(d.penScored),
                saved: num(d.penSaved),
                missed: num(d.penMissed),
                conceded: num(d.penConceded),
              },
            };
          });

          // ── Community king benchmark ─────────────────────────────────────
          // The "perfect 10" goals/assists targets = the group's HISTORICAL
          // average of the top scorer's / top assister's evening total ("מלך
          // השערים" per מחזור). Read the running totals on communityStats, fold
          // in THIS evening's kings, and use the updated average as the target —
          // so a 10 tracks what the best player in this community actually does
          // and stays reachable. The client (eveningSummaryService) reads the
          // SAME doc and derives the same average, so its displayed score and
          // this scoreDelta stay consistent. Defaults kept in sync with
          // src/utils/eveningScore DEFAULT_*_FOR_10.
          const DEFAULT_GOALS_FOR_10 = 4;
          const DEFAULT_ASSISTS_FOR_10 = 2;
          const BENCH_FLOOR = 1;
          const attGoals = attendees.map((u) => evStat[u].goals);
          const attAssists = attendees.map((u) => evStat[u].assists);
          const sessionKingGoals = attGoals.length ? Math.max(...attGoals) : 0;
          const sessionKingAssists = attAssists.length
            ? Math.max(...attAssists)
            : 0;
          const csRef = db.collection('communityStats').doc(gid);
          const csDoc = await csRef.get();
          const cs = csDoc.exists
            ? (csDoc.data() as Record<string, unknown>)
            : {};
          const addG = sessionKingGoals > 0 ? 1 : 0;
          const addA = sessionKingAssists > 0 ? 1 : 0;
          const newGCnt = num(cs.kingGoalsCount) + addG;
          const newGSum = num(cs.kingGoalsSum) + sessionKingGoals * addG;
          const newACnt = num(cs.kingAssistsCount) + addA;
          const newASum = num(cs.kingAssistsSum) + sessionKingAssists * addA;
          const goalsFor10 = Math.max(
            BENCH_FLOOR,
            newGCnt > 0 ? newGSum / newGCnt : DEFAULT_GOALS_FOR_10,
          );
          const assistsFor10 = Math.max(
            BENCH_FLOOR,
            newACnt > 0 ? newASum / newACnt : DEFAULT_ASSISTS_FOR_10,
          );

          const pts = (g: number, a: number) => g * 2 + a;
          // Rank by points desc; ties → goals, then uid (stable, deterministic).
          const rankByPoints = (pointOf: (uid: string) => number, goalOf: (uid: string) => number) =>
            [...cum].sort(
              (a, b) =>
                pointOf(b.uid) - pointOf(a.uid) ||
                goalOf(b.uid) - goalOf(a.uid) ||
                a.uid.localeCompare(b.uid),
            );
          const cumMap = new Map(cum.map((c) => [c.uid, c]));
          const nowPoints = (uid: string) => {
            const c = cumMap.get(uid);
            return c ? pts(c.goals, c.assists) : 0;
          };
          const nowGoals = (uid: string) => cumMap.get(uid)?.goals ?? 0;
          const beforePoints = (uid: string) => {
            const c = cumMap.get(uid);
            if (!c) return 0;
            const e = evStat[uid];
            return pts(c.goals - (e?.goals ?? 0), c.assists - (e?.assists ?? 0));
          };
          const beforeGoals = (uid: string) =>
            (cumMap.get(uid)?.goals ?? 0) - (evStat[uid]?.goals ?? 0);
          const nowRanked = rankByPoints(nowPoints, nowGoals);
          const beforeRanked = rankByPoints(beforePoints, beforeGoals);
          const total = cum.length;

          // ── Was there a table before tonight AT ALL? ────────────────────
          //
          // Both orderings above are derived by subtracting tonight from the
          // cumulative rows, so when every "before" value is zero the previous
          // ordering is not a ranking — it is the uid tie-break, alphabetical.
          // Two clubs are in that state constantly: one on the first evening
          // after a season close (`PLAYER_SEASON_FIELDS` zeroes goals, assists
          // and wins), and the TIMER-ONLY club, which records no goals, no
          // assists and no wins ever and therefore has an all-zero table every
          // single week.
          //
          // What came out of it: the alphabetically-first player was told
          // "שמרת על התואר מלך השערים" — that he KEPT a title — off a table
          // that had been wiped the day before or had never existed, and
          // everybody else got a ▲N for climbing past people who were never
          // ahead of them. The club summary has had a guard for this since
          // 28d0823 (`seasonEvenings === 1`); the personal card, which is the
          // shareable one, had none.
          //
          // Measured on the data rather than on the season config, because the
          // condition IS the data: no read to make, and it catches the
          // timer-only club and a brand-new club's first evening too, neither
          // of which is a season boundary.
          const hadTable = (m: Metric) =>
            cum.some((c) => cumOf(c.uid, m) - evOf(c.uid, m) > 0);
          const hadPointsTable = cum.some((c) => beforePoints(c.uid) > 0);

          // ── Per-metric movement: goals, assists, wins ────────────────────
          // The combined ranking above already answers "where am I", but not
          // the thing players actually talk about: WHO you went past tonight.
          // Both orderings are right here — before this evening and after it —
          // so the names cost nothing to derive; they were simply being thrown
          // away with only the place-count kept.
          const METRICS = ['goals', 'assists', 'wins'] as const;
          type Metric = (typeof METRICS)[number];
          const cumOf = (uid: string, m: Metric): number => {
            const c = cumMap.get(uid);
            return c ? (m === 'goals' ? c.goals : m === 'assists' ? c.assists : c.wins) : 0;
          };
          const evOf = (uid: string, m: Metric): number => {
            const e = evStat[uid];
            if (!e) return 0;
            return m === 'goals' ? e.goals : m === 'assists' ? e.assists : e.wins;
          };
          // Ties are broken by uid so the order is deterministic — otherwise a
          // tied pair could "swap" between the two sorts and look like an
          // overtake that never happened.
          const orderBy = (m: Metric, at: 'now' | 'before'): string[] => {
            const valOf = (uid: string) =>
              at === 'now' ? cumOf(uid, m) : cumOf(uid, m) - evOf(uid, m);
            return [...cum]
              .map((c) => c.uid)
              .sort((a, b) => valOf(b) - valOf(a) || a.localeCompare(b));
          };
          const orders: Record<Metric, { now: string[]; before: string[] }> = {
            goals: { now: orderBy('goals', 'now'), before: orderBy('goals', 'before') },
            assists: { now: orderBy('assists', 'now'), before: orderBy('assists', 'before') },
            wins: { now: orderBy('wins', 'now'), before: orderBy('wins', 'before') },
          };

          // Resolve the display names we're about to quote — ONE batched read
          // for every name across every attendee, not one per name.
          const nameIds = new Set<string>();
          for (const uid of attendees) {
            for (const m of METRICS) {
              // Same guard as `metricsFor`, and here it also saves the reads:
              // on an all-zero table the walk between two positions spans the
              // whole club, so this was fetching every member's name to quote
              // it in a block that is not written.
              if (!hadTable(m)) continue;
              const o = orders[m];
              const iNow = o.now.indexOf(uid);
              const iBefore = o.before.indexOf(uid);
              if (iNow < 0 || iBefore < 0) continue;
              // everyone between the two positions, plus the player just above
              const lo = Math.min(iNow, iBefore);
              const hi = Math.max(iNow, iBefore);
              for (let i = lo; i <= hi; i++) if (o.now[i] !== uid) nameIds.add(o.now[i]);
              if (iNow > 0) nameIds.add(o.now[iNow - 1]);
            }
          }
          const nameById = new Map<string, string>();
          if (nameIds.size > 0) {
            const ids = [...nameIds];
            const snaps = await db.getAll(
              ...ids.map((u) => db.collection('users').doc(u)),
            );
            snaps.forEach((sn, i) => {
              const n = (sn.data() as { name?: string } | undefined)?.name;
              if (typeof n === 'string' && n.trim()) nameById.set(ids[i], n.trim());
            });
          }
          const MAX_NAMES = 3;
          const metricsFor = (uid: string) => {
            const out: Record<string, unknown> = {};
            for (const m of METRICS) {
              // No table before tonight → no movement in it, and no title to
              // have held. The whole block is omitted rather than written with
              // a null delta: the card's reader defaults a missing delta to 0
              // and 0 is precisely the value that prints "שמרת על התואר", so
              // the honest value has to be no value at all. Nothing else on
              // the card reads this block — the overtake lists are empty by
              // construction on a zeroed table, and the per-metric place is
              // not rendered — so the only line lost is one that would have
              // been a coin-flip on uid order.
              if (!hadTable(m)) continue;
              const o = orders[m];
              const iNow = o.now.indexOf(uid);
              const iBefore = o.before.indexOf(uid);
              if (iNow < 0 || iBefore < 0) continue;
              // Who I actually went past. See computeMovement — the rule is
              // value-based on purpose; positions read a tie as an overtake.
              const { passed, passedBy } = computeMovement(uid, o.now, (id) => ({
                now: cumOf(id, m),
                tonight: evOf(id, m),
              }));
              const aboveId = iNow > 0 ? o.now[iNow - 1] : null;
              out[m] = {
                value: cumOf(uid, m),
                rank: iNow + 1,
                // + = climbed
                delta: iBefore - iNow,
                // Full counts travel alongside the capped name lists so the
                // card can say "ואב ועוד 4" without shipping 6 names.
                passedCount: passed.length,
                passedByCount: passedBy.length,
                passed: passed
                  .map((u) => nameById.get(u))
                  .filter((n): n is string => !!n)
                  .slice(0, MAX_NAMES),
                passedBy: passedBy
                  .map((u) => nameById.get(u))
                  .filter((n): n is string => !!n)
                  .slice(0, MAX_NAMES),
                aheadName: aboveId ? (nameById.get(aboveId) ?? null) : null,
                aheadGap: aboveId ? cumOf(aboveId, m) - cumOf(uid, m) : null,
              };
            }
            return out;
          };
          // ── tonight's score table ────────────────────────────────────────
          // "I got 7.1 — where does that put me among everyone who played?"
          // Scored over THIS evening's attendees only: the question is about
          // tonight, and a club-wide comparison would drag in players who
          // weren't even here.
          const scoreOf = new Map<string, number>();
          for (const uid of attendees) {
            const e = evStat[uid];
            scoreOf.set(
              uid,
              eveningScore(
                e.goals,
                e.assists,
                e.wins,
                e.rounds,
                goalsFor10,
                assistsFor10,
                e.pen,
              ),
            );
          }
          const scoreRanked = [...attendees].sort(
            (a, b) => (scoreOf.get(b) ?? 0) - (scoreOf.get(a) ?? 0) || a.localeCompare(b),
          );

          // The evening's OWN timestamp, for everything stamped below.
          //
          // `Date.now()` is the moment the trigger ran, which is the same
          // thing right up until it isn't: an admin confirming a forgotten
          // evening runs this path days later. Same source the seal beside it
          // already uses.
          const eveningAt =
            typeof after.startsAt === 'number' && after.startsAt > 0
              ? after.startsAt
              : Date.now();

          const standingBatch = db.batch();
          for (const uid of attendees) {
            const e = evStat[uid];
            const score = eveningScore(
              e.goals,
              e.assists,
              e.wins,
              e.rounds,
              goalsFor10,
              assistsFor10,
              e.pen,
            );
            // Only compare against an evening that came BEFORE this one.
            //
            // `lastEveningScore` is "the last score written", and on a late
            // confirmation the last score written belongs to an evening played
            // AFTER the one being sealed — so the arrow on the card measured
            // the night against its own future. No comparable evening is null,
            // which the card renders as no delta at all, rather than a number
            // pointing the wrong way.
            const prevRow = cumMap.get(uid);
            const prevIsOlder =
              prevRow?.lastScoreAt == null || prevRow.lastScoreAt <= eveningAt;
            const prev = prevIsOlder ? prevRow?.lastScore ?? null : null;
            const rankNow = nowRanked.findIndex((c) => c.uid === uid) + 1;
            const rankBefore = beforeRanked.findIndex((c) => c.uid === uid) + 1;
            standingBatch.set(
              db
                .collection('eveningStandings')
                .doc(`${event.params.gameId}__${uid}`),
              {
                gameId: event.params.gameId,
                userId: uid,
                groupId: gid,
                score,
                scoreDelta:
                  prev == null ? null : Math.round((score - prev) * 10) / 10,
                rank: rankNow > 0 ? rankNow : null,
                rankTotal: total > 0 ? total : null,
                // + = climbed N places since before this evening. Null when
                // there was no table before this evening — see `hadTable`:
                // the "before" ordering is then the uid tie-break and every
                // arrow drawn off it is fiction. Null is what the card already
                // reads as "no movement to show".
                //
                // …and null for a player who had no points of his OWN, even
                // when the club did. His "before" position came out of the
                // zero-block, which is ordered by user id, so a newcomer who
                // scores three goals on evening 5 was announced as having
                // "climbed N places" from a rank he only ever held
                // alphabetically. The personal card already refuses to draw
                // that arrow (`movementReal` in eveningProgress), so the two
                // surfaces were telling the same player two different stories
                // about the same night — and the club summary was the fiction.
                rankDelta:
                  hadPointsTable &&
                  beforePoints(uid) > 0 &&
                  rankNow > 0 &&
                  rankBefore > 0
                    ? rankBefore - rankNow
                    : null,
                metrics: metricsFor(uid),
                scoreRank: scoreRanked.indexOf(uid) + 1,
                scoreTotal: scoreRanked.length,
                at: eveningAt,
              },
              { merge: true },
            );
            // Remember this evening's score for next evening's delta, and
            // fold it into the season's running mean.
            //
            // The mean is why the sum exists. The MVP title is "highest AVERAGE
            // evening score this season" — and nothing was accumulating it:
            // `lastEveningScore` is only the most recent one and `bestEvening`
            // only the high-water mark, so the title was literally not
            // computable from anything we stored. Two increments, once per
            // player per evening.
            //
            // Both are season-scoped (they are in PLAYER_SEASON_FIELDS), so a
            // new season starts the average from nothing rather than dragging
            // a career of scores into it.
            standingBatch.set(
              db.collection('communityPlayerStats').doc(`${gid}__${uid}`),
              {
                // The score of the player's LATEST evening, which a late
                // confirmation must not overwrite with an older one — doing so
                // measured the next real evening's delta against a night from
                // days earlier. Stamped with the evening it came from so the
                // comparison above can tell the two apart at all; the pair is
                // written together or not at all.
                //
                // Both survive a rollover (neither is in PLAYER_SEASON_FIELDS)
                // for the same reason: the delta is "against your last night",
                // not "against your last night this season".
                ...(prevIsOlder
                  ? { lastEveningScore: score, lastEveningAt: eveningAt }
                  : {}),
                // ⚠️ Only a REAL rating is folded into the season mean.
                //
                // `eveningScoreServer` opens with `if (gamesPlayed <= 0)
                // return 6.0` — a sentinel meaning "this player played no
                // mini-game tonight, there is nothing to rate", not a score of
                // six. Both increments used to fire unconditionally, so that
                // sentinel entered the average as though it were a result, and
                // `eveningScoreCount` counted attendances rather than ratings.
                //
                // The effect was not subtle. On the one club that has closed a
                // season, 109 of its 267 stored evening standings are exactly
                // 6.0, six of its sixteen evenings ran with no rotation at all
                // and produced nothing but sentinels, and שחקן העונה ended up
                // shared by all seven members at 6.0 — the value that means
                // nothing was recorded.
                //
                // The test is `e.rounds > 0`, the same input that decides the
                // sentinel inside the formula — NOT `score > 6`. A genuine 6.0
                // is possible (the formula floors at 6 and a bad night with
                // conceded penalties can reach it), and the product rule is
                // explicit that a real 6.0 must keep counting. Only the
                // sentinel is excluded, and it is excluded by its cause rather
                // than by its value.
                //
                // Historical sums cannot be repaired from these two fields —
                // they are merged increments. They CAN be rebuilt per player
                // per evening from `games/{id}/roundHistory`, whose `teamA`
                // and `teamB` arrays say who played each mini-game. That is a
                // migration, and it is not run from here.
                ...(e.rounds > 0
                  ? {
                      eveningScoreSum: admin.firestore.FieldValue.increment(score),
                      eveningScoreCount: admin.firestore.FieldValue.increment(1),
                    }
                  : {}),
              },
              { merge: true },
            );
          }
          // Fold this evening's kings into the community benchmark (atomic
          // increments, so concurrent finishes in the same group don't clobber).
          standingBatch.set(
            csRef,
            {
              kingGoalsSum:
                admin.firestore.FieldValue.increment(sessionKingGoals * addG),
              kingGoalsCount: admin.firestore.FieldValue.increment(addG),
              kingAssistsSum:
                admin.firestore.FieldValue.increment(sessionKingAssists * addA),
              kingAssistsCount: admin.firestore.FieldValue.increment(addA),
              updatedAt: Date.now(),
            },
            { merge: true },
          );
          await standingBatch.commit();

          // ── Round summary: the club's story of the evening ──────────────
          // Sealed HERE, once, and never recomputed. Whether tonight was a
          // club record depends on what the club had done before tonight, and
          // that comparison stops being answerable the moment another evening
          // is played or an admin completes a goal that was missed. A summary
          // that recomputes itself would quietly rewrite last week's story.
          //
          // Nested try: the standings above are already committed, and a
          // failure to tell a story must not look like a failure to record the
          // night.
          try {
            await sealRoundSummary({
              gameId: event.params.gameId,
              groupId: gid,
              at: typeof after.startsAt === 'number' ? after.startsAt : Date.now(),
              attendees,
              evSnaps,
              psSnap,
              csRef,
              // The evening's own season stamp, which this call was declaring
              // an argument for and never passing.
              //
              // Absent, the seal fell back to "an unstamped evening belongs to
              // season 1", so a club on season 2 or later credited its season
              // NOTHING: `seasons.playedRounds` never moved, the card read the
              // same number all year, and a rounds season after the first could
              // never reach its target or close on a seal at all. The stamp is
              // on the game — or, when this very execution wrote it a few
              // hundred lines above, in `stampedSeasonId`, because the snapshot
              // in hand predates that write.
              seasonId:
                (after as { seasonId?: string }).seasonId || stampedSeasonId || undefined,
              groupOnce,
              // Empty when there was no table before tonight — see `hadTable`.
              // This is the ONLY thing `rankEventsOf` reads, and on an
              // all-zero table every line it can draw from it is fiction: who
              // "climbed into first place", who "jumped", who "entered the top
              // three", all off an ordering that is alphabetical by uid. The
              // club summary's own guard covers the first evening of a season;
              // it does not cover the timer-only club, whose table is all
              // zeros every week of its life.
              standings: hadPointsTable
                ? attendees.map((uid) => ({
                    userId: uid,
                    score: scoreOf.get(uid) ?? 0,
                    rank: nowRanked.findIndex((c) => c.uid === uid) + 1 || null,
                    rankTotal: nowRanked.length || null,
                    rankDelta:
                      beforeRanked.findIndex((c) => c.uid === uid) -
                      nowRanked.findIndex((c) => c.uid === uid),
                  }))
                : [],
            });
          } catch (err) {
            console.error(
              '[onGameRosterChanged] round summary failed',
              event.params.gameId,
              err,
            );
          }

          // ── Club chemistry: fold the evening into the pair rollup ───────
          // Separate try and separate batches from everything above: this is
          // the one write path whose size grows with the SQUARE of the team,
          // and it must never be able to take the round's statistics with it.
          try {
            const rhSnap2 = await db
              .collection('games')
              .doc(event.params.gameId)
              .collection('roundHistory')
              .get();
            const rounds2: ChemistryRound[] = rhSnap2.docs
              .map((d) => d.data() as Record<string, unknown>)
              .map((r) => ({
                teamA: Array.isArray(r.teamA) ? (r.teamA as string[]) : [],
                teamB: Array.isArray(r.teamB) ? (r.teamB as string[]) : [],
                scoreA: num(r.scoreA),
                scoreB: num(r.scoreB),
                winnerSide:
                  r.winnerSide === 'A' || r.winnerSide === 'B'
                    ? r.winnerSide
                    : ('tie' as const),
                goals: Array.isArray(r.goals)
                  ? (r.goals as Record<string, unknown>[]).map((g) => ({
                      scorerId: typeof g.scorerId === 'string' ? g.scorerId : null,
                      assisterId:
                        typeof g.assisterId === 'string' ? g.assisterId : null,
                      ownGoal: g.ownGoal === true,
                    }))
                  : [],
              }));
            await rollUpClubPairs({
              gameId: event.params.gameId,
              groupId: gid,
              at: typeof after.startsAt === 'number' ? after.startsAt : Date.now(),
              rounds: rounds2,
            });
          } catch (err) {
            console.error(
              '[onGameRosterChanged] club pair rollup failed',
              event.params.gameId,
              err,
            );
          }
        } catch (err) {
          console.error(
            '[onGameRosterChanged] evening standings failed',
            event.params.gameId,
            err,
          );
        }
      }

      // ── Evening-summary push ────────────────────────────────────────
      // The night is over → hand each player who actually showed up a
      // push that deep-links to their personal, shareable "סיכום הערב"
      // card. No-shows are excluded (same rule as the games tally). One
      // per (player, game) via createNotificationOnce's dedupe, so a
      // status re-write can't double-ping.
      try {
        const arrivalsForSummary =
          (after.arrivals as Record<string, string> | undefined) ?? {};
        const summaryOps: Promise<unknown>[] = [];
        for (const uid of after.players) {
          if (arrivalsForSummary[uid] === 'no_show') continue;
          summaryOps.push(
            createNotificationOnce({
              type: 'eveningSummary',
              recipientId: uid,
              entityType: 'game',
              entityId: event.params.gameId,
              reason: 'evening-summary',
              payload: { gameId: event.params.gameId },
            }),
          );
        }
        const summaryResults = await Promise.allSettled(summaryOps);
        const summaryFailed = summaryResults.filter(
          (r) => r.status === 'rejected',
        ).length;
        if (summaryFailed > 0) {
          console.warn(
            `[onGameRosterChanged] ${summaryFailed}/${summaryResults.length} eveningSummary push(es) failed for game ${event.params.gameId}`,
          );
        }
      } catch (err) {
        console.error(
          '[onGameRosterChanged] eveningSummary fan-out failed',
          event.params.gameId,
          err,
        );
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
      const beforePending = new Set<string>(
        Array.isArray(before?.pending) ? before!.pending! : [],
      );
      const afterPending = Array.isArray(after.pending) ? after.pending : [];
      const newRequesters = afterPending.filter((id) => !beforePending.has(id));
      if (newRequesters.length > 0) {
        // Recipients: the game creator plus any admins of the parent
        // community — both can approve from MatchDetails.
        const recipients = new Set<string>();
        if (typeof after.createdBy === 'string' && after.createdBy) {
          recipients.add(after.createdBy);
        }
        if (typeof after.groupId === 'string' && after.groupId) {
          try {
            const gSnap = await groupOnce();
            const gAdmins =
              (gSnap.data()?.adminIds as string[] | undefined) ?? [];
            for (const a of gAdmins) recipients.add(a);
          } catch (err) {
            console.warn(
              '[onGameRosterChanged] group admins read failed',
              after.groupId,
              err,
            );
          }
        }
        const gameTitle = after.title || 'המשחק';
        const ops: Promise<unknown>[] = [];
        for (const requesterId of newRequesters) {
          for (const adminId of recipients) {
            if (adminId === requesterId) continue; // never ping the requester
            ops.push(
              createNotificationOnce({
                type: 'joinRequest',
                recipientId: adminId,
                // Dedupe per (admin, game) so a game request never
                // collides with a community joinRequest for the same
                // group, and re-requests to different games stay
                // distinct.
                entityType: 'game',
                entityId: event.params.gameId,
                // Key the dedupe by REQUESTER too — otherwise two different
                // players requesting the SAME game within the cooldown window
                // collapse into one push and the admin never learns about the
                // second (they sit unseen in pending). Mirrors the community
                // path's `req-${requesterId}`.
                reason: `game-join-request-${requesterId}`,
                payload: {
                  gameId: event.params.gameId,
                  groupId: after.groupId,
                  // buildMessage interpolates `groupName`; pass the game
                  // title so the copy reads naturally for game requests.
                  groupName: gameTitle,
                  gameTitle,
                  requesterId,
                },
              }),
            );
          }
        }
        const results = await Promise.allSettled(ops);
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          console.warn(
            `[onGameRosterChanged] ${failed}/${results.length} game joinRequest dispatch(es) failed for game ${event.params.gameId}`,
          );
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
    const allArrUids = new Set<string>([
      ...Object.keys(beforeArr),
      ...Object.keys(afterArr),
    ]);
    for (const uid of allArrUids) {
      const prev = beforeArr[uid] ?? 'unknown';
      const next = afterArr[uid] ?? 'unknown';
      if (prev === next) continue;
      try {
        if (next === 'late') {
          const startsAt =
            typeof after.startsAt === 'number' ? after.startsAt : Date.now();
          const minutesLate = (Date.now() - startsAt) / 60_000;
          if (minutesLate > 5) {
            const cardType = minutesLate > 60 ? 'red' : 'yellow';
            await issueDisciplineCard(uid, {
              type: cardType,
              reason: 'late',
              gameId: event.params.gameId,
            });
          }
        } else if (next === 'no_show') {
          await issueDisciplineCard(uid, {
            type: 'red',
            reason: 'no_show',
            gameId: event.params.gameId,
          });
        } else if (
          (prev === 'late' || prev === 'no_show') &&
          next !== 'late' &&
          next !== 'no_show'
        ) {
          // Admin un-marked — revoke any card we issued for this game.
          await revokeDisciplineCardsFor(uid, event.params.gameId);
        }
      } catch (err) {
        console.warn(
          '[onGameRosterChanged] discipline write failed',
          uid,
          err,
        );
      }
    }

    // ── Server-side achievement bumps for the joiners. The hardened
    // /users rules block cross-user writes from the client, so this
    // is the canonical place to keep gamesJoined in sync. Best-effort
    // — a failure here doesn't impact the join itself.
    if (after.status === 'open' && after.groupId) {
      const beforePlayersSet = new Set(before?.players ?? []);
      const freshJoiners = (after.players ?? []).filter(
        (uid) => !beforePlayersSet.has(uid),
      );
      for (const uid of freshJoiners) {
        try {
          // Per-(game,uid) marker in the same batch makes the increment
          // idempotent under at-least-once redelivery (and a cancel→rejoin of
          // the SAME game won't re-credit — gamesJoined counts distinct games).
          const b = db.batch();
          b.create(
            db
              .collection('games')
              .doc(event.params.gameId)
              .collection('joinCredited')
              .doc(uid),
            { at: Date.now() },
          );
          b.set(
            db.collection('users').doc(uid),
            {
              achievements: {
                gamesJoined: admin.firestore.FieldValue.increment(1),
              },
              updatedAt: Date.now(),
            },
            { merge: true },
          );
          await b.commit();
        } catch (err) {
          const code = (err as { code?: number | string }).code;
          if (code === 6 || code === 'already-exists') continue;
          console.warn(
            '[onGameRosterChanged] gamesJoined bump failed',
            uid,
            err,
          );
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
      const newJoiners = (after.players ?? []).filter(
        (uid) => !beforePlayers.has(uid),
      );
      if (newJoiners.length > 0) {
        // Resolve display names (best-effort — push still fires without).
        let joinerNames: string[] = [];
        try {
          const snaps = await db.getAll(
            ...newJoiners.map((uid) => db.collection('users').doc(uid)),
          );
          joinerNames = snaps
            .map((s) => {
              if (!s.exists) return '';
              const d = s.data() as { name?: string; displayName?: string };
              return (d.name || d.displayName || '').trim();
            })
            .filter((n) => n.length > 0);
        } catch (err) {
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
        } catch (err) {
          console.error(
            '[onGameRosterChanged] gamePlayersJoined dispatch failed',
            event.params.gameId,
            err,
          );
        }
      }
    }

    if (after.capacityNoticeSent) return;
    if (after.status !== 'open') return;

    const max = after.maxPlayers ?? 0;
    if (max <= 0) return;

    // Count only ACTIVE guests toward occupancy — a waitlisted guest doesn't
    // hold a seat, so counting them raw could cross the "last spots" threshold
    // early or wrongly suppress at max (audit #18 class, missed site).
    const activeG = (gs: unknown): number =>
      Array.isArray(gs)
        ? (gs as { waitlisted?: boolean }[]).filter((x) => !x?.waitlisted).length
        : 0;
    const beforeCount =
      (before?.players?.length ?? 0) + activeG(before?.guests);
    const afterCount = (after.players?.length ?? 0) + activeG(after.guests);

    const threshold = Math.ceil(max * 0.9);
    const crossed = beforeCount < threshold && afterCount >= threshold;
    if (!crossed) return;

    // Don't fire if the roster is already closed (full or over). At
    // 100% the message "last spots" is misleading; new joiners would
    // hit the waitlist instead.
    if (afterCount >= max) return;

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
        if (!fresh.exists) return;
        const data = fresh.data() as { capacityNoticeSent?: boolean };
        if (data.capacityNoticeSent) return; // someone else won
        tx.update(ref, { capacityNoticeSent: true });
        claimed = true;
      });
    } catch (err) {
      console.error('[onGameRosterChanged] latch transaction failed', err);
      return;
    }
    if (!claimed) return;

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

    console.log(
      `[onGameRosterChanged] dispatched gameFillingUp for ${gameId} (${afterCount}/${max}, ${remaining} left)`
    );
  }
);

// ─── Rating: keep summary doc in sync with vote subcollection ──────────

/**
 * Vote subcollection trigger. Incremental update — we read the
 * before/after values from the event itself and apply a transactional
 * delta to the parent summary doc. No full scan of the votes
 * subcollection, so latency stays O(1) even when a community grows
 * to thousands of voters.
 */
export const onVoteWritten = onDocumentWritten(
  // GLOBAL ratings (was groups/{groupId}/ratings/...). One reputation
  // per player across the whole app.
  'ratings/{ratedUserId}/votes/{raterUserId}',
  async (event) => {
    const { ratedUserId } = event.params as {
      ratedUserId: string;
    };

    const before = event.data?.before.data() as
      | { rating?: number }
      | undefined;
    const after = event.data?.after.data() as
      | { rating?: number }
      | undefined;
    const validRating = (r: unknown): r is number =>
      typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5;
    const oldR = validRating(before?.rating) ? (before!.rating as number) : null;
    const newR = validRating(after?.rating) ? (after!.rating as number) : null;

    let countDelta = 0;
    let sumDelta = 0;
    if (oldR === null && newR !== null) {
      countDelta = 1;
      sumDelta = newR;
    } else if (oldR !== null && newR === null) {
      countDelta = -1;
      sumDelta = -oldR;
    } else if (oldR !== null && newR !== null) {
      // update — count unchanged, sum shifts by the delta
      sumDelta = newR - oldR;
    } else {
      return; // no rating before or after; nothing to do
    }

    await applyVoteDelta(
      db.collection('ratings').doc(ratedUserId),
      ratedUserId,
      countDelta,
      sumDelta,
      event.id,
    );
  },
);

// LEGACY per-group vote trigger. App versions already in the stores
// (≤1.0.11) still write votes to /groups/{gid}/ratings/{uid}/votes/{uid};
// this keeps their per-group summaries in sync so the rating action
// doesn't silently stop working during the global-ratings rollout.
// Remove once the global build is widely adopted.
export const onVoteWrittenLegacy = onDocumentWritten(
  'groups/{groupId}/ratings/{ratedUserId}/votes/{raterUserId}',
  async (event) => {
    const { groupId, ratedUserId } = event.params as {
      groupId: string;
      ratedUserId: string;
    };
    const before = event.data?.before.data() as { rating?: number } | undefined;
    const after = event.data?.after.data() as { rating?: number } | undefined;
    const validRating = (r: unknown): r is number =>
      typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5;
    const oldR = validRating(before?.rating) ? (before!.rating as number) : null;
    const newR = validRating(after?.rating) ? (after!.rating as number) : null;
    let countDelta = 0;
    let sumDelta = 0;
    if (oldR === null && newR !== null) {
      countDelta = 1;
      sumDelta = newR;
    } else if (oldR !== null && newR === null) {
      countDelta = -1;
      sumDelta = -oldR;
    } else if (oldR !== null && newR !== null) {
      sumDelta = newR - oldR;
    } else {
      return;
    }
    await applyVoteDelta(
      db
        .collection('groups')
        .doc(groupId)
        .collection('ratings')
        .doc(ratedUserId),
      ratedUserId,
      countDelta,
      sumDelta,
      event.id,
    );
  },
);

// Shared transactional count/sum/average updater for a rating summary doc.
async function applyVoteDelta(
  summaryRef: FirebaseFirestore.DocumentReference,
  ratedUserId: string,
  countDelta: number,
  sumDelta: number,
  eventId?: string,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(summaryRef);
    const data =
      snap.exists && snap.data()
        ? (snap.data() as {
            count?: number;
            sum?: number;
            appliedEvents?: string[];
          })
        : { count: 0, sum: 0, appliedEvents: [] as string[] };
    // Idempotency latch. onDocumentWritten is at-least-once: a redelivery /
    // retry of the SAME event carries the SAME event.id and identical
    // before/after snapshots, so it would recompute and re-apply the same
    // delta — double-counting a vote. Skip if we've already applied this id.
    const applied = Array.isArray(data.appliedEvents) ? data.appliedEvents : [];
    if (eventId && applied.includes(eventId)) return;
    const newCount = Math.max(0, (data.count ?? 0) + countDelta);
    const newSum = Math.max(0, (data.sum ?? 0) + sumDelta);
    const newAvg = newCount > 0 ? Math.round((newSum / newCount) * 10) / 10 : 0;
    // Keep only the most recent ids so the doc can't grow unbounded.
    const nextApplied = eventId
      ? [...applied, eventId].slice(-30)
      : applied;
    tx.set(summaryRef, {
      userId: ratedUserId,
      count: newCount,
      sum: newSum,
      average: newAvg,
      appliedEvents: nextApplied,
      updatedAt: Date.now(),
    });
  });
}

// ─── Scheduled: auto-balance teams before a game ───────────────────────

const DEFAULT_AUTO_BALANCE_MINUTES = 60;

interface BalanceGameDoc {
  id: string;
  groupId?: string;
  createdBy?: string;
  startsAt?: number;
  status?: string;
  players?: string[];
  guests?: GuestDoc[];
  format?: string; // '<n>v<n>', n = players per team (3-11)
  numberOfTeams?: number;
  autoTeamGenerationMinutesBeforeStart?: number;
  /** ms-epoch wall-clock auto-generation time (preferred over minutes-before). */
  autoTeamsAt?: number;
  /** Scheduled split method: 'rating' (internal ratings) | 'random'. */
  autoTeamsMethod?: 'rating' | 'random';
  autoTeamsGeneratedAt?: number;
  /** Present once teams were set (manually by an admin or by the scheduler). */
  draftTeams?: unknown;
  /** ms-epoch the "teams ready" push was fanned out (dedupe). */
  teamsNotifiedAt?: number;
  teamsEditedManually?: boolean;
  title?: string;
}

interface GuestDoc {
  id: string;
  name: string;
  estimatedRating?: number | null;
  addedBy: string;
  createdAt: number;
}

const GUEST_ID_PREFIX = 'guest:';

interface RatingSummaryDoc {
  count?: number;
  average?: number;
}

function perTeamSize(format: string | undefined): number {
  // Mirrors teamSizeFromFormat in src/types — "<n>v<n>", n players PER TEAM.
  // The if/else ladder this replaces stopped at 7v7 and fell through to 5 for
  // anything else, so an 8v8 game would have had its rounds sized as 5v5.
  const n = parseInt(String(format ?? ''), 10);
  return Number.isFinite(n) && n >= 3 && n <= 11 ? n : 5;
}

/** In-place Fisher–Yates shuffle. */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * rating_balanced_v2 — distribute registered players into N teams so the
 * AVERAGE rating per team is as close to equal as possible.
 *
 * - Unrated players are scored at the neutral 3.
 * - Team sizes are fixed up front, as even as possible under the `perTeam`
 *   cap, with the remainder handed to a random subset of teams.
 * - Greedy pass: strongest first, into whichever team sits furthest below its
 *   share (`total / size`, not `total` — that is what balances averages rather
 *   than sums; the old v1 balanced sums, so a team carrying an extra player
 *   was permanently weaker on average).
 * - Refinement: repeatedly apply the single cross-team swap that shrinks the
 *   average spread the most, until nothing improves.
 * - Variety: several independent splits are generated and one is picked at
 *   random among all that are within `SPREAD_EPSILON` of the fairest. v1 was
 *   deterministic in its totals — its shuffle only reordered tied ratings — so
 *   pressing "generate" again returned the same team ratings every time.
 * - Any registered player who can't fit under the cap lands on the bench.
 */
type BalanceZone =
  | 'teamA'
  | 'teamB'
  | 'teamC'
  | 'teamD'
  | 'teamE'
  | 'bench';

/**
 * Split a roster into balanced, varied teams. The algorithm itself lives in
 * `./teamBalanceCore` — a GENERATED copy of `src/utils/teamBalanceCore.ts`, so
 * the scheduled split and the one the admin triggers on the phone can never
 * drift apart. This wrapper only maps the result onto the live-match zone
 * shape the rotation screen reads.
 */
function balanceTeamsV1(
  playerIds: string[],
  ratings: Record<string, number>,
  numberOfTeams: number,
  perTeam: number,
  history?: PastSplit[],
): {
  assignments: Record<string, BalanceZone>;
  benchOrder: string[];
  teamRatings: number[];
  unratedCount: number;
  /** Diagnostics recorded on the game — see Game.teamBalanceMeta. */
  gap: number;
  band: BalanceBand;
  repeat: number;
  fallback: boolean;
} {
  const core = balanceCore({
    playerIds,
    ratings,
    numTeams: numberOfTeams,
    perTeam,
    pairWeights: history?.length ? buildPairRepeatWeights(history) : undefined,
  });

  const assignments: Record<string, BalanceZone> = {};
  const benchOrder: string[] = [...core.bench];

  // Map team index → live-match zone. The live screen renders A/B as the
  // on-field matchup and C/D/E as the waiting queue — each balanced team gets
  // its zone instead of overflow being dumped on the bench (which left "team 3"
  // visually empty even though enough players were registered).
  const ZONES: BalanceZone[] = ['teamA', 'teamB', 'teamC', 'teamD', 'teamE'];
  core.teams.forEach((ids, i) => {
    const zone = ZONES[i];
    if (!zone) {
      benchOrder.push(...ids);
      return;
    }
    ids.forEach((uid) => {
      assignments[uid] = zone;
    });
  });
  benchOrder.forEach((uid) => {
    assignments[uid] = 'bench';
  });

  const ratingOf = (id: string) => {
    const known = ratings[id];
    return typeof known === 'number' && known > 0
      ? normalizeRating(known)
      : NEUTRAL_RATING;
  };
  return {
    assignments,
    benchOrder,
    // AVERAGE per team (all teams), not the sum of the first two: the average is
    // what the balance equalises and what the app shows, so the audit trail in
    // `teamBalanceMeta` carries the same number. Diagnostics only.
    teamRatings: core.teams.map((ids) => {
      const avg = ids.reduce((s, id) => s + ratingOf(id), 0) / (ids.length || 1);
      return Math.round(avg * 10) / 10;
    }),
    unratedCount: core.unratedCount,
    gap: core.gap,
    band: core.band,
    repeat: core.repeat,
    fallback: core.fallback,
  };
}

/**
 * The club's recent stored splits, for the auto-balance variety model. Mirrors
 * the client `gameService.getRecentSplits`: one read per game-night off the
 * game document, `originalTeams` (the split as first drawn) preferred over
 * `teams` (what it became after went-home), and nights with no stored split
 * dropped so they don't consume a slot in a pair's history window.
 */
async function loadRecentSplits(
  groupId: string,
  excludeGameId: string,
  max = HISTORY_GAMES,
): Promise<PastSplit[]> {
  if (!groupId) return [];
  try {
    const snap = await db
      .collection('games')
      .where('groupId', '==', groupId)
      .where('status', '==', 'finished')
      .orderBy('startsAt', 'desc')
      .limit(max + 4)
      .get();
    const out: PastSplit[] = [];
    for (const doc of snap.docs) {
      if (out.length >= max) break;
      if (doc.id === excludeGameId) continue;
      const g = doc.data() as {
        startsAt?: number;
        draftTeams?: { teams?: DraftTeamDoc[]; originalTeams?: DraftTeamDoc[] };
      };
      const src = g.draftTeams?.originalTeams ?? g.draftTeams?.teams ?? [];
      const teams = src
        .map((t) => (t.playerIds ?? []).slice())
        .filter((ids) => ids.length > 0);
      if (teams.length === 0) continue;
      out.push({ startsAt: g.startsAt ?? 0, teams });
    }
    return out;
  } catch (err) {
    // Variety is an enhancement, never a blocker — without history the split
    // is decided on rating alone, exactly as before.
    console.warn('[autoBalance] loadRecentSplits failed', groupId, err);
    return [];
  }
}

/** Read every rating summary in the group as a uid → average map. */
async function loadGroupRatings(
  groupId: string,
  uids: string[],
): Promise<Record<string, number>> {
  if (uids.length === 0) return {};
  const out: Record<string, number> = {};
  // Firestore doesn't support an `in` query against subcollection doc
  // ids cleanly across many groups, but per-group we just batched
  // get the docs.
  const refs = uids.map((u) =>
    db.collection('groups').doc(groupId).collection('ratings').doc(u),
  );
  const snaps = await db.getAll(...refs);
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const d = s.data() as RatingSummaryDoc;
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
async function runScheduledAutoGenerateTeams(): Promise<void> {
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

  const ops: Promise<unknown>[] = [];
  for (const doc of snap.docs) {
    const g = doc.data() as BalanceGameDoc;
    g.id = doc.id;
    // Quick filters before paying for the transaction round-trip.
    if (g.autoTeamsGeneratedAt) continue;
    if (g.teamsEditedManually) continue;
    // Manual teams ALWAYS win: a captain-draft / manual split writes
    // `draftTeams`. The opt-in path already skips these; the legacy
    // minutes-before path must too, or it seeds a SECOND, conflicting team
    // model in `liveMatch.assignments` over the admin's split (B05/B16).
    if (g.draftTeams) continue;
    if (!g.groupId) continue;
    // Opt-in `autoTeamsAt` games are owned by the wall-clock path below
    // (which writes draftTeams + pushes). Don't let the legacy
    // minutes-before path race it and seed liveMatch.assignments instead.
    if (typeof g.autoTeamsAt === 'number' && g.autoTeamsAt > 0) continue;
    const players = g.players ?? [];
    if (players.length === 0) continue;
    const startsAt = g.startsAt ?? 0;
    const minutesBefore =
      g.autoTeamGenerationMinutesBeforeStart ??
      DEFAULT_AUTO_BALANCE_MINUTES;
    const triggerAt = startsAt - minutesBefore * 60 * 1000;
    // Per-game trigger: only fire when we've crossed the
    // configured window. Games whose minutesBefore is 120 (i.e.
    // they want generation 2h before kickoff) only trigger once
    // they're inside the 65-min query window — that's a documented
    // trade-off for the simpler tight-window query.
    if (now < triggerAt) continue;
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
/**
 * Generate the split for ONE game, applying exactly the guards the sweep
 * applies. Used by the precise Cloud Task so a scheduled split fires at its
 * wall-clock minute instead of waiting for the next 5-minute tick.
 *
 * Every guard here is also re-checked inside `generateDraftTeamsForGame`'s
 * transaction, so a task and a cron tick racing each other can't double-write —
 * the second one finds `autoTeamsGeneratedAt` set and does nothing.
 */
async function generateDueAutoTeamsForGame(gameId: string): Promise<string> {
  const ref = db.collection('games').doc(gameId);
  const snap = await ref.get();
  if (!snap.exists) return 'missing';
  const g = snap.data() as BalanceGameDoc;
  g.id = snap.id;
  if (g.status !== 'open') return `status:${g.status}`;
  if (!g.autoTeamsAt || g.autoTeamsAt <= 0) return 'no-autoTeamsAt';
  // Not due yet — a task can only fire early if the admin moved the time
  // later after it was queued. The sweep will take it at the new time.
  if (g.autoTeamsAt > Date.now() + 1000) return 'not-due';
  if (g.autoTeamsGeneratedAt) return 'already-generated';
  if (g.teamsEditedManually) return 'manual';
  if (g.draftTeams) return 'has-teams';
  if (!g.groupId) return 'no-group';
  if ((g.players ?? []).length === 0 && (g.guests ?? []).length === 0) {
    return 'empty-roster';
  }
  await generateDraftTeamsForGame(ref, g);
  return 'generated';
}

async function runDueAutoTeamsAt(now: number): Promise<void> {
  // Bounded circuit-breaker. The index is (status, autoTeamsAt) so results come
  // oldest-autoTeamsAt first (FIFO), and generation clears autoTeamsAt — so the
  // set drains and no due game is ever starved past a tick or two.
  const snap = await db
    .collection('games')
    .where('status', '==', 'open')
    .where('autoTeamsAt', '<=', now)
    .limit(200)
    .get();
  if (snap.empty) return;
  const ops: Promise<unknown>[] = [];
  for (const doc of snap.docs) {
    const g = doc.data() as BalanceGameDoc;
    g.id = doc.id;
    if (!g.autoTeamsAt || g.autoTeamsAt <= 0) continue;
    if (g.autoTeamsGeneratedAt) continue;
    if (g.teamsEditedManually) continue;
    // Manual teams ALWAYS win: if an admin already set a split (by any
    // method), never auto-generate over it. The transaction re-checks too.
    if (g.draftTeams) continue;
    if (!g.groupId) continue;
    if ((g.players ?? []).length === 0 && (g.guests ?? []).length === 0) {
      continue;
    }
    ops.push(generateDraftTeamsForGame(doc.ref, g));
  }
  await Promise.all(ops);
  console.log(`[autoBalance] draftTeams generated for ${ops.length} game(s)`);
}

async function generateForGame(
  ref: FirebaseFirestore.DocumentReference,
  g: BalanceGameDoc,
): Promise<void> {
  try {
    // Load ratings BEFORE the transaction so the transaction body
    // stays small and fast (transactions retry; we don't want to
    // re-read every rating doc each retry).
    const players = g.players ?? [];
    // Ratings live on the group's `adminRatings` map since the peer-vote system
    // was removed. Reading the dead `groups/{id}/ratings` subcollection returns
    // {} → everyone neutral → effectively random teams despite admin ratings
    // (audit #14). Branch on internalRating like generateDraftTeamsForGame does;
    // fall back to the legacy subcollection only for non-internal groups.
    const grpSnap = await db.collection('groups').doc(g.groupId!).get();
    const grpData = grpSnap.data() as
      | { internalRating?: boolean; adminRatings?: Record<string, number> }
      | undefined;
    let ratings: Record<string, number>;
    if (grpData?.internalRating) {
      ratings = {};
      for (const uid of players) {
        const r = grpData.adminRatings?.[uid];
        if (typeof r === 'number' && r > 0) ratings[uid] = r;
      }
    } else {
      ratings = await loadGroupRatings(g.groupId!, players);
    }
    const perTeam = perTeamSize(g.format);
    const numberOfTeams =
      typeof g.numberOfTeams === 'number' && g.numberOfTeams >= 2
        ? g.numberOfTeams
        : 2;
    // Same variety history the draft-shaped generator uses, so a club gets the
    // same "don't rebuild last week's teams" behaviour whichever path seeds its
    // teams. Read outside the transaction — a query inside joins the read set.
    const history = await loadRecentSplits(g.groupId!, ref.id);

    const wrote = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return false;
      const data = fresh.data() as BalanceGameDoc;
      // Re-check inside the transaction so a concurrent function
      // run, or a coach edit between the outer query and this write,
      // can't be clobbered.
      if (data.autoTeamsGeneratedAt) return false;
      if (data.teamsEditedManually) return false;
      // Re-check inside the transaction: a manual split may have landed between
      // the outer query and here. Never seed liveMatch.assignments over it.
      if (data.draftTeams) return false;
      // Never overwrite a liveMatch that's already past setup — this write
      // replaces the WHOLE liveMatch object, so clobbering a live/finished one
      // would wipe its score + goal log. Only generate onto a fresh/organizing
      // slot.
      const existingPhase = (data as { liveMatch?: { phase?: string } }).liveMatch?.phase;
      if (existingPhase && existingPhase !== 'organizing') return false;
      const freshPlayers = data.players ?? players;
      const freshGuests = data.guests ?? [];
      if (freshPlayers.length === 0 && freshGuests.length === 0) return false;

      // Compose the roster: real users keep their uid; guests are
      // encoded as `guest:<id>` so the roster id space is disjoint.
      // Their rating is `estimatedRating` when set, otherwise the
      // neutral 3 (handled by balanceTeamsV1's unrated branch).
      const guestRoster: string[] = freshGuests.map(
        (gu) => `${GUEST_ID_PREFIX}${gu.id}`,
      );
      const guestRatings: Record<string, number> = {};
      for (const gu of freshGuests) {
        // Accept any positive estimatedRating and normalise it onto 1–5.
        // Previously a legacy 1–10 value (e.g. 7) was rejected here and scored
        // as neutral, while the CLIENT used it raw — so the same roster split
        // differently depending on who generated it (B07). Normalising both
        // sides keeps them identical.
        if (typeof gu.estimatedRating === 'number' && gu.estimatedRating > 0) {
          guestRatings[`${GUEST_ID_PREFIX}${gu.id}`] = normalizeRating(
            gu.estimatedRating,
          );
        }
      }
      const rosterIds = [...freshPlayers, ...guestRoster];
      const combinedRatings = { ...ratings, ...guestRatings };

      const result = balanceTeamsV1(
        rosterIds,
        combinedRatings,
        numberOfTeams,
        perTeam,
        history,
      );
      const liveMatch = {
        phase: 'organizing' as const,
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
          algorithm: 'rating_balanced_v2',
          unratedCount: result.unratedCount,
          teamRatings: result.teamRatings,
          // Recorded so a split can be explained after the fact and the
          // parameters calibrated from real weeks. No UI reads these.
          gap: Math.round(result.gap * 1000) / 1000,
          band: result.band,
          repeat: Math.round(result.repeat * 100) / 100,
          fallback: result.fallback,
          historyGames: history.length,
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
  } catch (err) {
    console.error('[autoBalance] generateForGame failed', ref.id, err);
  }
}

// ─── Auto-balance into the manual-draft shape (draftTeams) + push ──────
//
// Used by the opt-in `autoTeamsAt` path AND the manual "notify players"
// callable. Balances by INTERNAL admin ratings (group.adminRatings) when the
// group uses internal rating; falls back to peer ratings otherwise. Writes
// `draftTeams` (the same DraftTeamsResult the captain-draft flow saves) so it
// flows into the live rotation / "went home" / teams screen unchanged.

interface DraftTeamDoc {
  index: number;
  captainId: string;
  playerIds: string[];
}

interface DraftTeamsResultDoc {
  method: 'snake' | 'regular';
  numTeams: number;
  createdAt: number;
  createdBy: string;
  teams: DraftTeamDoc[];
  /** Frozen snapshot of the split as first drawn — `teams` is mutated all
   *  evening (went-home / swaps) and is therefore not a record of who started
   *  together. See the client DraftTeamsResult. */
  originalTeams?: DraftTeamDoc[];
  /** Draft/publish gate — see the client DraftTeamsResult. Server auto-teams
   *  write `true` (immediately visible); absent = published (legacy). */
  published?: boolean;
}

/** Convert a balanceTeamsV1 zone map into draft teams (captain = highest
 *  rated member of each zone; `playerIds[0]` = captain). */
function buildDraftTeamsFromBalance(
  assignments: Record<string, string>,
  ratings: Record<string, number>,
  numberOfTeams: number,
  createdBy: string,
): DraftTeamDoc[] {
  const ZONES = ['teamA', 'teamB', 'teamC', 'teamD', 'teamE'];
  // Unrated → neutral 3 (the 1–5 midpoint). The old default 5.5 sat ABOVE the
  // 1–5 max, so on the new scale every unrated player out-sorted every rated
  // one and wrongly became captain (B17). Rated values are normalised off any
  // leftover 1–10 data (B06/B07).
  const ratingOf = (id: string) =>
    typeof ratings[id] === 'number' && ratings[id] > 0 ? normalizeRating(ratings[id]) : 3;
  const teams: DraftTeamDoc[] = [];
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
async function loadFirstNames(
  uids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (uids.length === 0) return out;
  const unique = Array.from(new Set(uids));
  const snaps = await db.getAll(
    ...unique.map((u) => db.collection('users').doc(u)),
  );
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const d = s.data() as { name?: string; displayName?: string };
    const full = (d.name || d.displayName || '').trim();
    if (full) out[unique[i]] = full.split(' ')[0];
  });
  return out;
}

/** Join names as "א, ב ו-ג" (Hebrew "and" before the last). */
function joinHebrewNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`;
}

// `teamsGenerated` is the ONE notification type missing from this side's
// notificationDedup mirror. The client mirror (src/services/notificationDedup.ts)
// has carried it since the fan-out shipped — 60s cooldown, entity `game`, reason
// `teams-generated` — but functions/src/notificationDedup.ts never got the entry,
// so `createNotificationOnce({type: 'teamsGenerated'})` does not type-check and
// this fan-out has always hand-rolled its own write. That divergence is what the
// two constants below exist to close; once the server mirror is back in lockstep
// this whole block should become a plain createNotificationOnce loop.
const TEAMS_READY_COOLDOWN_MS = 60 * 1000;
const TEAMS_READY_REASON = 'teams-generated';

/**
 * Doc id + dedupeKey for one (game, player) teams-ready notice, built to the
 * exact recipe of dedupeKeyFor/dedupeIdFor so a teamsGenerated doc is
 * indistinguishable from every other doc in /notifications.
 *
 * The id used to be a FIXED `${gameId}__teamsReady__${uid}`, which meant the
 * second fan-out for a game was an UPDATE of the first doc — and
 * `onNotificationCreated` is an onDocumentCreated trigger, so it never fired.
 * An admin who edited teams and tapped "הודע לשחקנים" got {ok:true} and nobody
 * was told; the overwrite also reset `delivered` to false on an already-sent
 * doc. Production held 39 such docs across three games, every one of the only
 * undelivered notifications in the whole collection, for eleven weeks. Bucketing
 * the id by the 60s cooldown restores the push: a retry or a scheduled/manual
 * race inside the window still collapses onto one doc, a deliberate re-notify
 * after that mints a new one and the trigger fires.
 */
function teamsReadyNotifId(
  gameId: string,
  uid: string,
  nowMs: number,
): { id: string; dedupeKey: string } {
  const dedupeKey = `teamsGenerated:${uid}:game:${gameId}:${TEAMS_READY_REASON}`;
  const raw = `${dedupeKey}__b${Math.floor(nowMs / TEAMS_READY_COOLDOWN_MS)}`;
  const safe = raw.replace(/[^A-Za-z0-9:_\-.]/g, '_');
  return { id: safe.length > 480 ? safe.slice(0, 480) : safe, dedupeKey };
}

/**
 * Fan out one `teamsGenerated` notification per registered player, each with
 * a personal body listing their same-team members — registered teammates AND
 * guests on that team (guests get no push of their own, but their names still
 * appear in their teammates' lists). Stamps `teamsNotifiedAt` so a later
 * edit/re-save can't re-spam.
 *
 * Returns how many docs were actually minted vs. collapsed onto an existing
 * one, so the callable can report whether a re-notify reached anybody instead
 * of answering {ok:true} either way.
 */
async function fanOutTeamsReadyPush(
  ref: FirebaseFirestore.DocumentReference,
  gameId: string,
  teams: DraftTeamDoc[],
): Promise<{ created: number; duplicate: number }> {
  // Only real users (skip guest:* ids) receive a push.
  const realByTeam = teams.map((t) =>
    t.playerIds.filter((id) => !id.startsWith(GUEST_ID_PREFIX)),
  );
  const allReal = realByTeam.flat();
  if (allReal.length === 0) return { created: 0, duplicate: 0 };
  // Resolve guest names (keyed `guest:<id>`) from the game doc so guests can be
  // listed alongside registered teammates in each push body.
  const guestNameById: Record<string, string> = {};
  try {
    const snap = await ref.get();
    const guests = (snap.data() as { guests?: GuestDoc[] } | undefined)?.guests ?? [];
    for (const gu of guests) {
      const first = (gu.name || '').trim().split(' ')[0];
      if (first) guestNameById[`${GUEST_ID_PREFIX}${gu.id}`] = first;
    }
  } catch (err) {
    console.error('[teamsReady] failed to load guest names', gameId, err);
  }
  // Guest first-names per team, in roster order.
  const guestNamesByTeam = teams.map((t) =>
    t.playerIds
      .filter((id) => id.startsWith(GUEST_ID_PREFIX))
      .map((id) => guestNameById[id])
      .filter((n): n is string => !!n),
  );
  const firstNames = await loadFirstNames(allReal);
  // ONE timestamp for the whole fan-out, so every player of a given publish
  // lands in the same cooldown bucket no matter how long the loop takes.
  const now = Date.now();
  const writes: Promise<'created' | 'duplicate'>[] = [];
  teams.forEach((t, ti) => {
    const mates = realByTeam[ti];
    mates.forEach((uid) => {
      const teammateNames = [
        ...mates
          .filter((m) => m !== uid)
          .map((m) => firstNames[m])
          .filter((n): n is string => !!n),
        ...guestNamesByTeam[ti],
      ];
      const { id, dedupeKey } = teamsReadyNotifId(gameId, uid, now);
      const notifRef = db.collection('notifications').doc(id);
      // `create`, never `set` — the same atomic write createNotificationOnce
      // uses. A racing retry loses on AlreadyExists and is swallowed below
      // instead of overwriting a doc the trigger has already delivered.
      //
      // The field list is createNotificationOnce's, verbatim. The old
      // hand-rolled write stored FIVE fields and, worse, `createdAt` as a
      // NUMBER while every other type stores a server timestamp — and
      // Firestore's total ordering puts every integer ahead of every
      // timestamp, so all 223 teamsGenerated docs sort in front of the other
      // 1,029 — which is the TAIL of a descending read, and a descending
      // `orderBy('createdAt')` is how this project reads /notifications
      // (plain list reads come back stale). The type was therefore absent
      // from every operational read of the collection, which is how the 39
      // undelivered pushes stayed invisible for eleven weeks. Putting a
      // number back in `createdAt` hides the whole type again.
      writes.push(
        notifRef
          .create({
            type: 'teamsGenerated',
            recipientId: uid,
            entityType: 'game',
            entityId: gameId,
            reason: TEAMS_READY_REASON,
            dedupeKey,
            payload: {
              gameId,
              teammates: joinHebrewNames(teammateNames),
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtMs: now,
            cooldownMs: TEAMS_READY_COOLDOWN_MS,
            read: false,
            delivered: false,
            // System-originated fan-out: no caller uid is threaded down here,
            // same convention createNotificationOnce uses for server callers.
            createdByUid: '',
            srv: true,
            schemaVersion: NOTIFICATION_SCHEMA_VERSION,
          })
          .then(() => 'created' as const)
          .catch((err) => {
            const code = (err as { code?: number | string }).code;
            if (code === 6 || code === 'already-exists') return 'duplicate';
            throw err;
          }),
      );
    });
  });
  const results = await Promise.allSettled(writes);
  let created = 0;
  let duplicate = 0;
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('[teamsReady] notification write failed', gameId, r.reason);
      continue;
    }
    if (r.value === 'created') created++;
    else duplicate++;
  }
  console.log('[teamsReady] fan-out', { gameId, created, duplicate });
  // Stamped last, on its own, best-effort. It used to ride the same batch as
  // the notifications; now that the pushes are already out, failing the whole
  // call over the debounce stamp would show the admin an error for a fan-out
  // that worked. Losing the stamp only costs the 30s double-tap guard, and the
  // bucketed doc ids above still collapse a re-tap inside the same minute.
  try {
    await ref.update({ teamsNotifiedAt: now });
  } catch (err) {
    console.warn('[teamsReady] teamsNotifiedAt stamp failed', gameId, err);
  }
  return { created, duplicate };
}

/**
 * Balance one game by internal rating into `draftTeams`, then push. The write
 * is transactional and re-checks the generation flags so a concurrent run or
 * a coach edit can't be clobbered.
 */
async function generateDraftTeamsForGame(
  ref: FirebaseFirestore.DocumentReference,
  g: BalanceGameDoc,
): Promise<void> {
  try {
    const groupId = g.groupId!;
    const grpSnap = await db.collection('groups').doc(groupId).get();
    if (!grpSnap.exists) return;
    const grp = grpSnap.data() as {
      internalRating?: boolean;
      adminRatings?: Record<string, number>;
    };
    const players = g.players ?? [];

    // Ratings depend on the admin-picked method:
    //  • 'random' → no ratings at all → balanceTeamsV1 splits evenly + random.
    //  • 'rating' (default) → internal admin ratings (or peer-vote fallback).
    let ratings: Record<string, number>;
    if (g.autoTeamsMethod === 'random') {
      ratings = {};
    } else if (grp.internalRating) {
      ratings = {};
      for (const uid of players) {
        const r = grp.adminRatings?.[uid];
        if (typeof r === 'number' && r > 0) ratings[uid] = r;
      }
    } else {
      ratings = await loadGroupRatings(groupId, players);
    }

    const perTeam = perTeamSize(g.format);
    const numberOfTeams =
      typeof g.numberOfTeams === 'number' && g.numberOfTeams >= 2
        ? g.numberOfTeams
        : 2;

    // Loaded outside the transaction on purpose: a query inside one joins the
    // read set and would make the whole generation contend on every past game.
    const history = await loadRecentSplits(groupId, ref.id);

    const built = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return null;
      const data = fresh.data() as BalanceGameDoc;
      if (data.autoTeamsGeneratedAt) return null;
      if (data.teamsEditedManually) return null;
      // Manual teams win — never overwrite a split an admin already made.
      if (data.draftTeams) return null;
      const freshPlayers = data.players ?? players;
      const freshGuests = data.guests ?? [];
      if (freshPlayers.length === 0 && freshGuests.length === 0) return null;

      const guestRoster = freshGuests.map((gu) => `${GUEST_ID_PREFIX}${gu.id}`);
      const guestRatings: Record<string, number> = {};
      for (const gu of freshGuests) {
        // Accept any positive estimatedRating and normalise it onto 1–5.
        // Previously a legacy 1–10 value (e.g. 7) was rejected here and scored
        // as neutral, while the CLIENT used it raw — so the same roster split
        // differently depending on who generated it (B07). Normalising both
        // sides keeps them identical.
        if (typeof gu.estimatedRating === 'number' && gu.estimatedRating > 0) {
          guestRatings[`${GUEST_ID_PREFIX}${gu.id}`] = normalizeRating(
            gu.estimatedRating,
          );
        }
      }
      const rosterIds = [...freshPlayers, ...guestRoster];
      // Never make more teams than players — otherwise a roster smaller than
      // numberOfTeams (e.g. 3 players, 4 teams) leaves empty zones with an
      // empty captainId. Need at least 2 players to form two teams.
      if (rosterIds.length < 2) return null;
      const effTeams = Math.min(numberOfTeams, rosterIds.length);
      const combinedRatings = { ...ratings, ...guestRatings };
      // Size so nobody benches — mirrors the client `balanceTeams`.
      const fitPerTeam = Math.max(
        perTeam,
        Math.ceil(rosterIds.length / effTeams),
      );
      const result = balanceTeamsV1(
        rosterIds,
        combinedRatings,
        effTeams,
        fitPerTeam,
        // 'random' is meant to be a genuine draw — no ratings, no history.
        g.autoTeamsMethod === 'random' ? undefined : history,
      );
      const teams = buildDraftTeamsFromBalance(
        result.assignments,
        combinedRatings,
        effTeams,
        g.createdBy ?? 'system',
      ).filter((t) => t.playerIds.length > 0); // defensive: drop any empty zone
      const draftTeams: DraftTeamsResultDoc = {
        method: 'snake',
        numTeams: teams.length,
        createdAt: Date.now(),
        createdBy: g.createdBy ?? 'system',
        teams,
        // Freeze the split as generated. `teams` is mutated all evening by
        // went-home / swaps, so it is NOT a record of who started together —
        // and that record is what the next split's variety logic reads. The
        // client's saveDraftTeams captures the same snapshot; a server-generated
        // split used to carry none at all.
        originalTeams: teams.map((t) => ({ ...t, playerIds: [...t.playerIds] })),
        // Scheduled auto-teams are meant to be visible immediately (the push
        // fires here too) → publish straight away, never a hidden draft.
        published: true,
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
          algorithm: 'rating_balanced_v2',
          unratedCount: result.unratedCount,
          teamRatings: result.teamRatings,
          // Recorded so a split can be explained after the fact and the
          // parameters calibrated from real weeks. No UI reads these.
          gap: Math.round(result.gap * 1000) / 1000,
          band: result.band,
          repeat: Math.round(result.repeat * 100) / 100,
          fallback: result.fallback,
          historyGames: history.length,
        },
        updatedAt: Date.now(),
      });
      return teams;
    });

    if (built) {
      console.log(`[autoBalance] draftTeams seeded for ${ref.id}`);
      await fanOutTeamsReadyPush(ref, ref.id, built);
    }
  } catch (err) {
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
/**
 * The project owner, and the only account that may run a maintenance hook.
 *
 * Not a club admin and not a role — one person, hard-coded, because the
 * operations gated on it are ones that a club admin must never be able to
 * reach from the app: bumping the force-update floor for every install, and
 * (since 20.09.2026) pulling a closed season back open.
 *
 * Extracted from `updateAppConfig`, which has always carried this uid inline,
 * so the two cannot drift apart.
 */
const OPERATOR_UID = '1IdtNEjbEXfiRSqvLrJVn99NsfI2'; // matan

export const updateAppConfig = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  if (request.auth?.uid !== OPERATOR_UID) {
    throw new HttpsError('permission-denied', 'admin only');
  }
  const data = (request.data ?? {}) as {
    platform?: string;
    latestVersion?: string;
    minimumSupportedVersion?: string;
  };
  const platform = data.platform === 'ios' ? 'ios' : 'android';
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
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
export const setGuestRating = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required');
    }
    const uid = auth.uid;
    const data = (request.data ?? {}) as {
      gameId?: unknown;
      guestId?: unknown;
      rating?: unknown;
    };
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const guestId = typeof data.guestId === 'string' ? data.guestId : '';
    if (!gameId || gameId.length > 128 || !guestId || guestId.length > 128) {
      throw new HttpsError('invalid-argument', 'invalid gameId or guestId');
    }
    // rating: a number in (0,5] (one-decimal granularity, sub-1 allowed) or
    // null to clear. The slider's far-left 0 means unrated → treated as clear.
    let rating: number | null;
    if (data.rating === null || data.rating === undefined || data.rating === 0) {
      rating = null;
    } else if (
      typeof data.rating === 'number' &&
      Number.isFinite(data.rating) &&
      data.rating > 0 &&
      data.rating <= 5
    ) {
      rating = Math.round(data.rating * 10) / 10;
    } else {
      throw new HttpsError('invalid-argument', 'rating must be within (0,5] or null');
    }

    const ref = db.collection('games').doc(gameId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'game not found');
      const g = snap.data() as { guests?: Array<Record<string, unknown>> };
      const guests = Array.isArray(g.guests) ? g.guests : [];
      const idx = guests.findIndex(
        (x) => (x as { id?: string }).id === guestId,
      );
      if (idx < 0) throw new HttpsError('not-found', 'guest not found');
      const guest = guests[idx] as {
        addedBy?: string;
        estimatedRating?: number;
      };
      if (guest.addedBy !== uid) {
        throw new HttpsError(
          'permission-denied',
          'only the player who added this guest can rate them',
        );
      }
      const updated: Record<string, unknown> = { ...guest };
      if (rating === null) delete updated.estimatedRating;
      else updated.estimatedRating = rating;
      const next = [
        ...guests.slice(0, idx),
        updated,
        ...guests.slice(idx + 1),
      ];
      tx.update(ref, { guests: next, updatedAt: Date.now() });
    });
    return { ok: true };
  },
);

// Full account deletion — server-side, atomic-per-step, run to completion.
// The client calls this ONLY after a successful re-auth, then signs out; the
// callable does ALL cleanup and deletes the Auth user last. This fixes two
// bugs in the old client-only flow: (1) a re-auth CANCEL used to leave the
// user already swept out of every game (partial destruction); now nothing
// happens unless this callable is reached. (2) deletion never removed the
// user from COMMUNITIES, bricking a sole-admin community forever and leaking
// the social graph; now communities, games, friends and chat names are all
// cleaned here.
export const deleteMyAccount = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required');
    }
    const uid = auth.uid;
    const now = Date.now();

    // ── 1) Communities ── remove uid from every group's arrays; hand off or
    // dissolve ownership so no community is left orphaned.
    try {
      const seenGroups = new Set<string>();
      for (const field of ['adminIds', 'playerIds', 'pendingPlayerIds']) {
        const snap = await db
          .collection('groups')
          .where(field, 'array-contains', uid)
          .get();
        for (const gd of snap.docs) {
          if (seenGroups.has(gd.id)) continue;
          seenGroups.add(gd.id);
          const g = gd.data() as {
            adminIds?: string[];
            playerIds?: string[];
            pendingPlayerIds?: string[];
            creatorId?: string;
          };
          const admins = (g.adminIds ?? []).filter((x) => x !== uid);
          const players = (g.playerIds ?? []).filter((x) => x !== uid);
          const pending = (g.pendingPlayerIds ?? []).filter((x) => x !== uid);
          const isCreator = (g.creatorId ?? (g.adminIds ?? [])[0]) === uid;
          if (isCreator && admins.length === 0 && players.length === 0) {
            // Sole member/owner → dissolve the community + its games + mirror.
            const games = await db
              .collection('games')
              .where('groupId', '==', gd.id)
              .get();
            let b = db.batch();
            let n = 0;
            const bump = async () => {
              if (++n >= 450) { await b.commit(); b = db.batch(); n = 0; }
            };
            for (const game of games.docs) { b.delete(game.ref); await bump(); }
            b.delete(db.collection('groupsPublic').doc(gd.id)); await bump();
            b.delete(db.collection('communityShowcase').doc(gd.id)); await bump();
            b.delete(gd.ref);
            await b.commit();
          } else {
            const update: Record<string, unknown> = {
              adminIds: admins,
              playerIds: players,
              pendingPlayerIds: pending,
              updatedAt: now,
            };
            if (isCreator) {
              // Hand ownership to a remaining admin, else promote the oldest
              // remaining player to admin+creator.
              if (admins.length > 0) {
                update.creatorId = admins[0];
              } else {
                update.adminIds = [players[0]];
                update.creatorId = players[0];
              }
            }
            await gd.ref.update(update);
          }
        }
      }
    } catch (err) {
      console.error('[deleteMyAccount] community sweep failed', uid, err);
    }

    // ── 2) Games ── remove uid from every game roster.
    try {
      const games = await db
        .collection('games')
        .where('participantIds', 'array-contains', uid)
        .get();
      for (const gd of games.docs) {
        const g = gd.data() as {
          players?: string[];
          waitlist?: string[];
          pending?: string[];
        };
        const players = (g.players ?? []).filter((x) => x !== uid);
        const waitlist = (g.waitlist ?? []).filter((x) => x !== uid);
        const pending = (g.pending ?? []).filter((x) => x !== uid);
        await gd.ref.update({
          players,
          waitlist,
          pending,
          participantIds: Array.from(new Set([...players, ...waitlist, ...pending])),
          updatedAt: now,
        });
      }
    } catch (err) {
      console.error('[deleteMyAccount] game sweep failed', uid, err);
    }

    // ── 3) Friends ── bilateral removal.
    try {
      const meSnap = await db.collection('users').doc(uid).get();
      const myFriends = (meSnap.data()?.friends as string[] | undefined) ?? [];
      for (const fid of myFriends) {
        await db
          .collection('users')
          .doc(fid)
          .update({ friends: admin.firestore.FieldValue.arrayRemove(uid) })
          .catch(() => {});
      }
    } catch (err) {
      console.error('[deleteMyAccount] friends cleanup failed', uid, err);
    }

    // ── 4) Chat display name ── anonymise the user's name on ALL their messages
    // so deletion actually erases the PII. Paginated past the old single-batch
    // 450 cap: a prolific poster kept their real name/avatar on every older
    // message forever after a "permanent deletion" (GDPR/store gap, audit #17).
    // Loop over startAfter batches until exhausted; bounded by a generous cap so
    // a runaway can't spin forever.
    try {
      const PAGE = 450;
      const MAX_BATCHES = 200; // up to 90k messages — far beyond any real user
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (let i = 0; i < MAX_BATCHES; i++) {
        let q = db
          .collectionGroup('messages')
          .where('senderId', '==', uid)
          .orderBy('__name__')
          .limit(PAGE);
        if (cursor) q = q.startAfter(cursor);
        const msgs = await q.get();
        if (msgs.empty) break;
        const b = db.batch();
        msgs.docs.forEach((m) =>
          b.update(m.ref, {
            senderName: 'משתמש שהוסר',
            senderAvatarId: '',
            senderPhotoUrl: '',
          }),
        );
        await b.commit();
        if (msgs.size < PAGE) break; // last page
        cursor = msgs.docs[msgs.docs.length - 1];
      }
    } catch (err) {
      // A missing collection-group index just means we skip this best-effort step.
      console.warn('[deleteMyAccount] chat anonymise skipped', uid, err);
    }

    // ── 5) Anonymise the /users doc, then delete the Auth user LAST.
    try {
      await db.collection('users').doc(uid).set(
        {
          name: 'משתמש שהוסר',
          email: admin.firestore.FieldValue.delete(),
          photoUrl: admin.firestore.FieldValue.delete(),
          // Wipe availability + push tokens so a deleted account stops surfacing
          // as an "available player" invite candidate (findAvailablePlayers /
          // the filler sweep filter on availability) and stops receiving pushes
          // to tokens the client's best-effort single-device removal missed.
          availability: admin.firestore.FieldValue.delete(),
          fcmTokens: admin.firestore.FieldValue.delete(),
          deletedAt: now,
        },
        { merge: true },
      );
      // Push tokens also live in a private sub-doc — remove it entirely.
      await db
        .collection('users')
        .doc(uid)
        .collection('private')
        .doc('push')
        .delete()
        .catch(() => {});
    } catch (err) {
      console.error('[deleteMyAccount] user doc anonymise failed', uid, err);
    }
    try {
      await admin.auth().deleteUser(uid);
    } catch (err) {
      console.error('[deleteMyAccount] auth delete failed', uid, err);
      throw new HttpsError('internal', 'account data cleared but auth delete failed');
    }
    return { ok: true };
  },
);

// Report a chat message. IDs only — the server loads the REAL message and
// stores its actual text/author on the report. Previously the client wrote
// the report doc directly with client-supplied messageText/senderId, so a
// reporter could fabricate abusive text and frame an innocent user in the
// moderation queue. Now the report content is authoritative.
export const reportChatMessage = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required to report');
    }
    const data = (request.data ?? {}) as {
      scope?: unknown;
      parentId?: unknown;
      messageId?: unknown;
    };
    const scope = typeof data.scope === 'string' ? data.scope : '';
    const parentId = typeof data.parentId === 'string' ? data.parentId : '';
    const messageId =
      typeof data.messageId === 'string' ? data.messageId : '';
    if (
      !parentId ||
      parentId.length > 128 ||
      !messageId ||
      messageId.length > 128 ||
      !['game', 'community', 'dm'].includes(scope)
    ) {
      throw new HttpsError('invalid-argument', 'invalid report target');
    }
    const collByScope: Record<string, string> = {
      game: 'games',
      community: 'groups',
      dm: 'dmConversations',
    };
    const msgSnap = await db
      .collection(collByScope[scope])
      .doc(parentId)
      .collection('messages')
      .doc(messageId)
      .get();
    if (!msgSnap.exists) {
      throw new HttpsError('not-found', 'message not found');
    }
    const m = msgSnap.data() as {
      text?: unknown;
      senderId?: unknown;
      senderName?: unknown;
    };
    await db.collection('chatReports').add({
      reporterId: auth.uid,
      scope,
      parentId,
      messageId,
      // Authoritative — copied from the real message, not the caller.
      messageText: String(m.text ?? '').slice(0, 2000),
      senderId: typeof m.senderId === 'string' ? m.senderId : '',
      senderName: typeof m.senderName === 'string' ? m.senderName : '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    });
    return { ok: true };
  },
);

export const sendGameInvite = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  // 1) Auth
  const auth = request.auth;
  if (!auth?.uid) {
    throw new HttpsError(
      'unauthenticated',
      'sign-in required to send invites',
    );
  }
  const senderUid = auth.uid;

  // 2) Input shape — IDs only. Anything textual the function loads
  //    server-side from canonical state.
  const data = (request.data ?? {}) as {
    recipientId?: unknown;
    gameId?: unknown;
  };
  const recipientId = typeof data.recipientId === 'string' ? data.recipientId : '';
  const gameId = typeof data.gameId === 'string' ? data.gameId : '';
  if (
    recipientId.length === 0 ||
    recipientId.length > 128 ||
    gameId.length === 0 ||
    gameId.length > 128
  ) {
    throw new HttpsError('invalid-argument', 'invalid recipientId or gameId');
  }
  if (recipientId === senderUid) {
    throw new HttpsError('invalid-argument', 'cannot invite yourself');
  }

  // 3) Server-side rate limit. Single transactional read+write so two
  //    fast invocations can't both pass under the cap. The counter lives in
  //    /serverRateLimits (deny-all from the client) so a malicious client
  //    cannot reset it the way it could for /rateLimits (same hardening as
  //    createGroupCallable).
  const limitRef = db
    .collection('serverRateLimits')
    .doc(`${senderUid}_inviteToGame`);
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
    const cur = snap.data() as {
      windowStart?: number;
      count?: number;
    };
    const expired =
      typeof cur.windowStart !== 'number' ||
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
      throw new HttpsError(
        'resource-exhausted',
        'too many invites — try again later',
      );
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
    throw new HttpsError('failed-precondition', 'sender profile missing');
  }
  if (!gameSnap.exists) {
    throw new HttpsError('failed-precondition', 'game not found');
  }
  if (!recipientSnap.exists) {
    throw new HttpsError('failed-precondition', 'recipient not found');
  }
  const sender = senderSnap.data() as { name?: string };
  const game = gameSnap.data() as {
    title?: string;
    groupId?: string;
    startsAt?: number;
    status?: string;
    visibility?: string;
    players?: string[];
    waitlist?: string[];
    pending?: string[];
  };

  // 5) Permission: caller must be allowed to see + invite to the game.
  //    For community games we require that they're a group member or
  //    admin (matching the read rule for /games). For public games any
  //    signed-in user can already read, so we accept them as inviters.
  if (game.visibility !== 'public') {
    if (!game.groupId) {
      throw new HttpsError('permission-denied', 'game has no community');
    }
    const groupSnap = await db
      .collection('groups')
      .doc(game.groupId)
      .get();
    if (!groupSnap.exists) {
      throw new HttpsError('permission-denied', 'community missing');
    }
    const grp = groupSnap.data() as {
      playerIds?: string[];
      adminIds?: string[];
    };
    const ids = new Set<string>([
      ...(grp.playerIds ?? []),
      ...(grp.adminIds ?? []),
    ]);
    if (!ids.has(senderUid)) {
      throw new HttpsError(
        'permission-denied',
        'not a member of this community',
      );
    }
  }

  // 6) Lifecycle: don't invite to a terminal or in-progress game.
  if (game.status === 'finished' || game.status === 'cancelled') {
    throw new HttpsError(
      'failed-precondition',
      'game is no longer accepting invites',
    );
  }

  // 7) Recipient already in roster? Don't spam them.
  const inRoster = new Set<string>([
    ...(game.players ?? []),
    ...(game.waitlist ?? []),
    ...(game.pending ?? []),
  ]);
  if (inRoster.has(recipientId)) {
    throw new HttpsError(
      'failed-precondition',
      'recipient is already registered',
    );
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
  } catch (err) {
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
    await db.collection('users').doc(senderUid).set(
      {
        achievements: {
          invitesSent: admin.firestore.FieldValue.increment(1),
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  } catch (err) {
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
export const adminAddPlayers = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required');
    }
    const callerUid = auth.uid;

    const data = (request.data ?? {}) as { gameId?: unknown; userIds?: unknown };
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const userIds = Array.isArray(data.userIds)
      ? (data.userIds.filter((x) => typeof x === 'string' && x.length > 0) as string[])
      : [];
    if (gameId.length === 0 || gameId.length > 128) {
      throw new HttpsError('invalid-argument', 'invalid gameId');
    }
    if (userIds.length === 0 || userIds.length > 40) {
      throw new HttpsError('invalid-argument', 'userIds must be 1..40');
    }
    const targets = Array.from(new Set(userIds)); // dedupe

    // Load game + caller's name.
    const [gameSnap, callerSnap] = await Promise.all([
      db.collection('games').doc(gameId).get(),
      db.collection('users').doc(callerUid).get(),
    ]);
    if (!gameSnap.exists) {
      throw new HttpsError('failed-precondition', 'game not found');
    }
    const game = gameSnap.data() as {
      title?: string;
      groupId?: string;
      createdBy?: string;
      status?: string;
      startsAt?: number;
      maxPlayers?: number;
    };
    if (game.status === 'finished' || game.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'game is no longer open');
    }
    if (!game.groupId) {
      throw new HttpsError('failed-precondition', 'game has no community');
    }

    // Permission: caller must be the organiser OR a community admin, and we
    // also need the member set so we only add genuine community members.
    const groupSnap = await db.collection('groups').doc(game.groupId).get();
    if (!groupSnap.exists) {
      throw new HttpsError('permission-denied', 'community missing');
    }
    const grp = groupSnap.data() as { playerIds?: string[]; adminIds?: string[] };
    const adminIds = new Set(grp.adminIds ?? []);
    const isAdmin = callerUid === game.createdBy || adminIds.has(callerUid);
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'admins only');
    }
    const memberIds = new Set<string>([...(grp.playerIds ?? []), ...(grp.adminIds ?? [])]);

    // Transaction: append eligible targets to players (then waitlist when the
    // game is full), keeping participantIds + joinedAt in sync.
    const result = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(gameSnap.ref);
      const g = fresh.data() as {
        players?: string[];
        waitlist?: string[];
        pending?: string[];
        participantIds?: string[];
        joinedAt?: Record<string, number>;
        maxPlayers?: number;
        guests?: { waitlisted?: boolean }[];
        pendingPromotion?: { uid?: string } | null;
      };
      const players = [...(g.players ?? [])];
      const waitlist = [...(g.waitlist ?? [])];
      const pending = [...(g.pending ?? [])];
      const joinedAt = { ...(g.joinedAt ?? {}) };
      const cap = typeof g.maxPlayers === 'number' && g.maxPlayers > 0 ? g.maxPlayers : Infinity;
      // Occupancy must count ACTIVE guests and a live promotion offer — not just
      // players.length — or an admin add would over-fill past maxPlayers when
      // guests/an offer already hold the remaining seats (audit #19).
      const activeGuests = Array.isArray(g.guests)
        ? g.guests.filter((x) => !x?.waitlisted).length
        : 0;
      const offerHeld = g.pendingPromotion?.uid ? 1 : 0;
      let occupancy = players.length + activeGuests + offerHeld;
      const inRoster = new Set<string>([...players, ...waitlist, ...pending]);
      const now = Date.now();

      const addedToPlayers: string[] = [];
      const addedToWaitlist: string[] = [];
      for (const uid of targets) {
        if (!memberIds.has(uid)) continue; // not a community member → skip
        if (inRoster.has(uid)) continue; // already registered → skip
        inRoster.add(uid);
        joinedAt[uid] = now;
        if (occupancy < cap) {
          players.push(uid);
          occupancy += 1;
          addedToPlayers.push(uid);
        } else {
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
    const adderName = (callerSnap.data() as { name?: string } | undefined)?.name ?? '';
    const title = typeof game.title === 'string' ? game.title : 'המשחק';
    const startsAt = typeof game.startsAt === 'number' ? game.startsAt : 0;
    const pushOne = (uid: string, waitlisted: boolean) => {
      // Don't notify an admin that they registered THEMSELVES — they just did
      // the action, a "<me> רשם אותך" push to myself is noise (user report).
      if (uid === callerUid) return Promise.resolve();
      return createNotificationOnce({
        type: 'addedToGame',
        recipientId: uid,
        payload: { gameId, gameTitle: title, adderName, startsAt, waitlisted },
        createdByUid: callerUid,
      }).catch((err) => console.warn('[adminAddPlayers] push failed', uid, err));
    };
    await Promise.all([
      ...result.addedToPlayers.map((uid) => pushOne(uid, false)),
      ...result.addedToWaitlist.map((uid) => pushOne(uid, true)),
    ]);

    return {
      ok: true,
      addedToPlayers: result.addedToPlayers.length,
      addedToWaitlist: result.addedToWaitlist.length,
    };
  },
);

// ─── Callable: admin reorders / moves players between roster & waitlist ──
// Full roster management (feature). The client sends the DESIRED players[] and
// waitlist[] (after a drag / move / reorder); the server validates it's the
// SAME set of participants — pure reorder/repartition, never an add or remove
// (those have their own guarded ops) — enforces capacity, and writes. Reorder
// of the waitlist matters: waitlist[0] is who gets offered a freed spot next.
export const adminReorderRoster = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'sign-in required');
    const callerUid = auth.uid;
    const data = (request.data ?? {}) as {
      gameId?: unknown;
      players?: unknown;
      waitlist?: unknown;
    };
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const asIds = (v: unknown): string[] =>
      Array.isArray(v)
        ? (v.filter((x) => typeof x === 'string' && x.length > 0) as string[])
        : [];
    const nextPlayers = asIds(data.players);
    const nextWaitlist = asIds(data.waitlist);
    if (gameId.length === 0 || gameId.length > 128) {
      throw new HttpsError('invalid-argument', 'invalid gameId');
    }
    if (nextPlayers.length + nextWaitlist.length > 500) {
      throw new HttpsError('invalid-argument', 'roster too large');
    }

    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) throw new HttpsError('failed-precondition', 'game not found');
    const game = gameSnap.data() as { groupId?: string; createdBy?: string; status?: string };
    if (game.status === 'finished' || game.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'game is no longer editable');
    }
    if (!game.groupId) throw new HttpsError('failed-precondition', 'game has no community');
    const groupSnap = await db.collection('groups').doc(game.groupId).get();
    const grp = (groupSnap.data() ?? {}) as { adminIds?: string[] };
    const isAdmin =
      callerUid === game.createdBy || (grp.adminIds ?? []).includes(callerUid);
    if (!isAdmin) throw new HttpsError('permission-denied', 'admins only');

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(gameSnap.ref);
      const g = fresh.data() as {
        players?: string[];
        waitlist?: string[];
        pending?: string[];
        maxPlayers?: number;
        guests?: { waitlisted?: boolean }[];
        pendingPromotion?: { uid?: string } | null;
      };
      // No duplicates within/across the two target lists.
      const uniq = new Set([...nextPlayers, ...nextWaitlist]);
      if (uniq.size !== nextPlayers.length + nextWaitlist.length) {
        throw new HttpsError('invalid-argument', 'duplicate uid in roster');
      }
      // Same multiset as before — reorder/repartition only, no add/remove.
      const oldSet = [...(g.players ?? []), ...(g.waitlist ?? [])].sort();
      const newSet = [...nextPlayers, ...nextWaitlist].sort();
      if (
        oldSet.length !== newSet.length ||
        oldSet.some((v, i) => v !== newSet[i])
      ) {
        throw new HttpsError('failed-precondition', 'roster set changed — reorder only');
      }
      // Capacity: players + active guests + a held promotion offer must fit.
      // BUT if the admin's reorder itself promotes the offered uid into
      // players[], the offer is being fulfilled — don't double-count its
      // reserved seat, and clear the now-stale pendingPromotion so it can't
      // later re-add the uid (duplicate).
      const cap =
        typeof g.maxPlayers === 'number' && g.maxPlayers > 0 ? g.maxPlayers : Infinity;
      const activeGuests = Array.isArray(g.guests)
        ? g.guests.filter((x) => !x?.waitlisted).length
        : 0;
      const offeredUid = g.pendingPromotion?.uid;
      const offerFulfilled = !!offeredUid && nextPlayers.includes(offeredUid);
      const offerHeld = offeredUid && !nextPlayers.includes(offeredUid) ? 1 : 0;
      if (nextPlayers.length + activeGuests + offerHeld > cap) {
        throw new HttpsError('failed-precondition', 'over capacity');
      }
      const participantIds = Array.from(
        new Set([...nextPlayers, ...nextWaitlist, ...(g.pending ?? [])]),
      );
      tx.update(gameSnap.ref, {
        players: nextPlayers,
        waitlist: nextWaitlist,
        participantIds,
        updatedAt: Date.now(),
        ...(offerFulfilled ? { pendingPromotion: null } : {}),
      });
    });
    return { ok: true };
  },
);

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
// Auth: the cancelling user must be signed in AND must currently be a
// participant of the game (no proxy cancellations). Recipients are the
// game's createdBy PLUS every community admin (group.adminIds) — so the
// whole admin team is notified, not just whoever opened the game. The
// canceller is always excluded from the recipients (an organiser cancelling
// themselves out of their own game needs no push about their own action).
export const notifyPlayerCancelled = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const callerUid = request.auth.uid;
    const data = request.data as
      | { gameId?: unknown; reason?: unknown }
      | undefined;
    const gameId = typeof data?.gameId === 'string' ? data.gameId : '';
    if (!gameId || gameId.length > 128) {
      throw new HttpsError('invalid-argument', 'invalid gameId');
    }
    const reason = typeof data?.reason === 'string' ? data.reason : '';
    if (reason.length > 60) {
      throw new HttpsError('invalid-argument', 'reason too long');
    }

    const [gameSnap, userSnap] = await Promise.all([
      db.collection('games').doc(gameId).get(),
      db.collection('users').doc(callerUid).get(),
    ]);
    if (!gameSnap.exists) {
      throw new HttpsError('not-found', 'game does not exist');
    }
    const game = gameSnap.data() as {
      createdBy?: string;
      groupId?: string;
      title?: string;
      startsAt?: number;
      players?: string[];
      waitlist?: string[];
      pending?: string[];
      cancellations?: Record<string, number>;
    };
    // Only a real participant may fire a cancel notification. The cancel flow
    // removes the player from the roster BEFORE calling this, so accept either
    // a current roster membership OR a just-stamped cancellations[uid] entry.
    // Without this, an attacker could enumerate gameIds and spam every
    // organiser with fake "X cancelled" pushes.
    const related =
      (game.players ?? []).includes(callerUid) ||
      (game.waitlist ?? []).includes(callerUid) ||
      (game.pending ?? []).includes(callerUid) ||
      !!(game.cancellations && game.cancellations[callerUid]);
    if (!related) {
      return { ok: true, skipped: 'not-a-participant' };
    }

    // Recipients = the game creator + EVERY community admin, so the whole
    // admin team hears about a cancellation — not just whoever opened the
    // game (user request). Deduped; the canceller never notifies themselves
    // (an organiser cancelling out of their own game needs no push).
    const recipients = new Set<string>();
    if (game.createdBy) recipients.add(game.createdBy);
    if (game.groupId) {
      const grpSnap = await db.collection('groups').doc(game.groupId).get();
      const adminIds = (grpSnap.data()?.adminIds as string[] | undefined) ?? [];
      for (const a of adminIds) if (typeof a === 'string' && a) recipients.add(a);
    }
    recipients.delete(callerUid);
    if (recipients.size === 0) {
      // No admin to notify (legacy game / canceller is the only admin).
      return { ok: true, skipped: 'no-recipients' };
    }

    const cancellingUserName =
      (userSnap.exists &&
        typeof userSnap.data()?.name === 'string' &&
        (userSnap.data()!.name as string).slice(0, 60)) ||
      '';

    // One aggregated notification per recipient — the dedupeKey namespaces by
    // recipientId, so each admin gets their own count-aggregated doc.
    const results = await Promise.all(
      Array.from(recipients).map((recipientId) =>
        createNotificationOnce({
          type: 'playerCancelled',
          recipientId,
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
        }),
      ),
    );
    return { ok: true, recipients: recipients.size, results };
  },
);

// ─── Callable: notify players their auto-balanced teams are ready ──────
//
// Admin-triggered from the teams screen after a manual auto-balance + review.
// Fans out one personalized `teamsGenerated` push per registered player
// ("אתה בקבוצה עם …"). Gated to the game's organiser / a group admin.
export const notifyTeamsReady = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const callerUid = request.auth.uid;
    const data = request.data as { gameId?: unknown } | undefined;
    const gameId = typeof data?.gameId === 'string' ? data.gameId : '';
    if (!gameId || gameId.length > 128) {
      throw new HttpsError('invalid-argument', 'invalid gameId');
    }
    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) {
      throw new HttpsError('not-found', 'game does not exist');
    }
    const game = gameSnap.data() as {
      createdBy?: string;
      groupId?: string;
      draftTeams?: { teams?: DraftTeamDoc[] };
      teamsNotifiedAt?: number;
    };
    // Authorize: organiser or a group admin.
    let authorized = game.createdBy === callerUid;
    if (!authorized && game.groupId) {
      const grpSnap = await db.collection('groups').doc(game.groupId).get();
      const grp = grpSnap.data() as { adminIds?: string[] } | undefined;
      authorized = !!grp?.adminIds?.includes(callerUid);
    }
    if (!authorized) {
      throw new HttpsError('permission-denied', 'admin only');
    }
    // Debounce a double-tap. The window is TEAMS_READY_COOLDOWN_MS, not the
    // 30s it used to be, so it matches the cooldown bucket the fan-out's doc
    // ids are keyed on. With the two numbers apart, a re-notify at t=45s fell
    // past the debounce but back onto the same bucket id, so it wrote nothing
    // and pushed nobody while still answering {ok:true} — the same silent
    // no-op the bucketing was introduced to end. Anything beyond the window is
    // a deliberate re-notify and really does reach the roster again.
    if (
      typeof game.teamsNotifiedAt === 'number' &&
      Date.now() - game.teamsNotifiedAt < TEAMS_READY_COOLDOWN_MS
    ) {
      return { ok: true, skipped: 'debounce', notified: 0 };
    }
    const teams = game.draftTeams?.teams ?? [];
    if (teams.length === 0) {
      throw new HttpsError('failed-precondition', 'no teams to notify');
    }
    const { created } = await fanOutTeamsReadyPush(gameSnap.ref, gameId, teams);
    return { ok: true, notified: created };
  },
);

// ─── Callable: ensure personal (hidden) community for orphan games ─────
//
// Returns the caller's `personalGroupId`, creating it lazily if missing.
// All games created via the "ללא קהילה" wizard path land in this group
// so the rest of the app (rules, queries, CFs) keeps working unchanged.
// The group is `isPersonal: true, hidden: true` so it never surfaces in
// feeds, search, or discovery.
export const ensurePersonalGroup = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'user doc missing');
    }
    const userData = userSnap.data() as {
      personalGroupId?: string;
      name?: string;
    };

    // Fast path: already provisioned. Verify the group still exists AND is
    // still a personal group — if it was deleted, OR PROMOTED to a real
    // community (isPersonal flipped to false), we re-provision rather than
    // handing back its id. Otherwise the next one-off game would be created
    // INSIDE that public community (its members, chat, feed) — the personal
    // group id is never reset on promotion.
    if (
      typeof userData.personalGroupId === 'string' &&
      userData.personalGroupId.length > 0
    ) {
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
    const userName =
      typeof userData.name === 'string' && userData.name.length > 0
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
    await userRef.set(
      { personalGroupId: groupRef.id, updatedAt: now },
      { merge: true },
    );
    return { groupId: groupRef.id, created: true };
  },
);

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
export const getServerTime = onCall(
  { enforceAppCheck: false },
  async () => {
    return { now: Date.now() };
  },
);

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
export const promoteOrphanToGroup = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const callerUid = request.auth.uid;
    const data = request.data as {
      groupId?: unknown;
      name?: unknown;
      description?: unknown;
      isOpen?: unknown;
      rules?: unknown;
      contactPhone?: unknown;
      city?: unknown;
      inviteUserIds?: unknown;
    };
    const groupId = typeof data.groupId === 'string' ? data.groupId : '';
    const name =
      typeof data.name === 'string' ? data.name.trim().slice(0, 60) : '';
    const description =
      typeof data.description === 'string'
        ? data.description.trim().slice(0, 500)
        : '';
    const isOpen = data.isOpen === true;
    const rules =
      typeof data.rules === 'string' ? data.rules.trim().slice(0, 2000) : '';
    const contactPhone =
      typeof data.contactPhone === 'string'
        ? data.contactPhone.trim().slice(0, 30)
        : '';
    const city =
      typeof data.city === 'string' ? data.city.trim().slice(0, 80) : '';
    const inviteUserIds = Array.isArray(data.inviteUserIds)
      ? (data.inviteUserIds as unknown[])
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
          .slice(0, 100)
      : [];
    // The specific orphan game this community is being created FROM. Used
    // to scope the community's inherited stats to just that game (see below).
    const fromGameId =
      typeof (data as { fromGameId?: unknown }).fromGameId === 'string'
        ? ((data as { fromGameId: string }).fromGameId).slice(0, 128)
        : '';

    if (!groupId || groupId.length > 128) {
      throw new HttpsError('invalid-argument', 'invalid groupId');
    }
    if (name.length < 2) {
      throw new HttpsError('invalid-argument', 'name too short');
    }

    const groupRef = db.collection('groups').doc(groupId);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) {
      throw new HttpsError('not-found', 'group does not exist');
    }
    const group = groupSnap.data() as {
      adminIds?: string[];
      isPersonal?: boolean;
      hidden?: boolean;
      playerIds?: string[];
    };
    if (!Array.isArray(group.adminIds) || !group.adminIds.includes(callerUid)) {
      throw new HttpsError('permission-denied', 'admin only');
    }
    if (group.isPersonal !== true) {
      throw new HttpsError(
        'failed-precondition',
        'group is not a personal group',
      );
    }

    const now = Date.now();
    // The participants we invite go into `pendingPlayerIds` — we never
    // auto-accept them into `playerIds`. Each user gets a push that
    // links into the community-details "המתנה לאישור" flow on tap.
    const dedupedInvitees = Array.from(
      new Set(inviteUserIds.filter((u) => u !== callerUid)),
    );
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
        let best: { id: string; startsAt: number } | null = null;
        for (const d of finished.docs) {
          const sa = (d.data() as { startsAt?: number }).startsAt ?? 0;
          if (!best || sa > best.startsAt) best = { id: d.id, startsAt: sa };
        }
        if (best) effectiveFromGameId = best.id;
      } catch (err) {
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
        const keep = new Map<
          string,
          {
            goals: number;
            assists: number;
            rounds: number;
            wins: number;
            losses: number;
            games: number;
          }
        >();
        let totalGoals = 0;
        for (const d of gpsSnap.docs) {
          const x = d.data() as {
            userId?: string;
            goals?: number;
            assists?: number;
            rounds?: number;
            wins?: number;
            losses?: number;
          };
          if (!x.userId) continue;
          const goals = x.goals ?? 0;
          const assists = x.assists ?? 0;
          const rounds = x.rounds ?? 0;
          const wins = x.wins ?? 0;
          const losses = x.losses ?? 0;
          // The community is created FROM this one game → games played = 1.
          keep.set(x.userId, { goals, assists, rounds, wins, losses, games: 1 });
          totalGoals += goals;
        }
        // Chunked commits — a personal group accumulates a communityPlayerStats
        // row per distinct player across every one-off game, which can exceed
        // the 500-op batch cap. A single batch would throw and silently leave
        // the stats commingled (the exact bug this reset fixes).
        let batch = db.batch();
        let opCount = 0;
        const bump = async () => {
          opCount++;
          if (opCount >= 450) {
            await batch.commit();
            batch = db.batch();
            opCount = 0;
          }
        };
        // Drop every commingled row that doesn't belong to the promoting game.
        for (const d of cpsSnap.docs) {
          const x = d.data() as { userId?: string };
          if (x.userId && keep.has(x.userId)) continue;
          batch.delete(d.ref);
          await bump();
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
          await bump();
        }
        // Club totals = this game's mini-games (committed rounds) + goals +
        // ties (so the new club's draw-rate fun fact isn't stuck at 0%).
        const tiedRounds = roundsSnap.docs.filter(
          (d) => (d.data() as { winnerSide?: string }).winnerSide === 'tie',
        ).length;
        batch.set(db.collection('communityStats').doc(groupId), {
          groupId,
          rounds: roundsSnap.size,
          goals: totalGoals,
          tiedRounds,
          updatedAt: now,
        });
        await batch.commit();
      } catch (err) {
        console.error(
          '[promoteOrphanToGroup] stats reset failed',
          groupId,
          effectiveFromGameId,
          err,
        );
      }
    }

    // Every OTHER club-scoped artefact from the personal-group era.
    //
    // A personal group is stable per user, so all of that user's quick games
    // over all time land in it. The reset above rebuilt communityPlayerStats
    // and communityStats from the promoting game — but records, chemistry,
    // sealed round summaries and evening standings were left behind, so a
    // brand-new club opened with club records and a chemistry history earned
    // in one-off games nobody in it ever played.
    //
    // (bestEvening, lastEveningScore and chemistrySince need no work here:
    // they live ON the two docs above, and both are rewritten with a
    // non-merge `set`, which drops them.)
    //
    // Pair stats are wiped rather than rebuilt for the promoting game. The
    // club's chemistry card is anchored to `chemistrySince`, which the
    // communityStats overwrite just cleared and the next sealed evening will
    // re-stamp — so "no pairs yet, counting from <next evening>" is the one
    // self-consistent state. Rebuilding a single game's pairs would instead
    // show a total dated from a window it doesn't cover.
    try {
      const [pairSnap, standSnap, gamesSnap] = await Promise.all([
        db.collection('communityPairStats').where('groupId', '==', groupId).get(),
        db.collection('eveningStandings').where('groupId', '==', groupId).get(),
        db.collection('games').where('groupId', '==', groupId).get(),
      ]);
      let b = db.batch();
      let n = 0;
      const step = async () => {
        if (++n >= 450) {
          await b.commit();
          b = db.batch();
          n = 0;
        }
      };
      for (const d of pairSnap.docs) {
        b.delete(d.ref);
        await step();
      }
      for (const d of standSnap.docs) {
        b.delete(d.ref);
        await step();
      }
      // Sealed summaries + rollup markers are keyed by game id, so they're
      // addressed directly — no field query and no index needed.
      for (const g of gamesSnap.docs) {
        b.delete(db.collection('roundSummaries').doc(g.id));
        await step();
        b.delete(db.collection('communityPairRollups').doc(`${groupId}__${g.id}`));
        await step();
      }
      b.delete(db.collection('clubRecords').doc(groupId));
      await step();
      await b.commit();
    } catch (err) {
      console.error('[promoteOrphanToGroup] club artefact purge failed', groupId, err);
    }

    // Write the /groupsPublic mirror so the new community shows up in
    // discovery. Mirror the same shape the createGroup callable uses.
    await db
      .collection('groupsPublic')
      .doc(groupId)
      .set(
        {
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
        },
        { merge: true },
      );

    // Send a per-recipient `groupInvitation` push. The CF helper
    // ensures dedupe and aggregation; failures don't block the
    // promotion.
    const inviter = await db.collection('users').doc(callerUid).get();
    const inviterName =
      (inviter.exists &&
        typeof inviter.data()?.name === 'string' &&
        (inviter.data()!.name as string).slice(0, 60)) ||
      '';
    await Promise.allSettled(
      dedupedInvitees.map((recipientUid) =>
        createNotificationOnce({
          type: 'groupInvitation',
          recipientId: recipientUid,
          payload: {
            groupId,
            groupName: name,
            inviterName,
            inviterId: callerUid,
          },
          createdByUid: callerUid,
        }),
      ),
    );

    return { ok: true, invited: dedupedInvitees.length };
  },
);

// ─── Scheduled: promote-prompt cron ─────────────────────────────────────
//
// Once an hour, scan for finished games hosted in a personal group
// whose creator hasn't yet been prompted to promote. The push is
// fire-and-forget — if the creator dismisses, the latch keeps it from
// re-firing. If the personal group has already been promoted (no
// longer `isPersonal: true`), we skip.
async function runSendPromotePrompts(): Promise<void> {
  const now = Date.now();
  const lower = now - 6 * 60 * 60 * 1000; // 6h window — catch slow cron
  const upper = now - 30 * 60 * 1000;     // wait 30m post-game so the
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
    const g = doc.data() as {
      groupId?: string;
      createdBy?: string;
      promotePromptSent?: boolean;
      title?: string;
      isOrphanContext?: boolean;
    };
    if (g.promotePromptSent) continue;
    if (!g.groupId || !g.createdBy) continue;
    if (g.isOrphanContext !== true) continue;

    // Verify the host group is still a personal one. If the user
    // already promoted it manually (or via this same cron racing
    // against itself), skip.
    const gSnap = await db.collection('groups').doc(g.groupId).get();
    if (!gSnap.exists) continue;
    const grp = gSnap.data() as { isPersonal?: boolean };
    if (grp.isPersonal !== true) continue;

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
    } catch (err) {
      console.error('[sendPromotePrompts] dispatch failed', doc.id, err);
    }
  }

  console.log(`[sendPromotePrompts] dispatched ${dispatched}`);
}

// Random 6-char alphanumeric invite code. Mirror of the helper used by
// `createGroup` — duplicated locally to keep this section self-contained.
function randomInviteCode(): string {
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

// Slim input shape — matches the new wizard's responsibility split:
// the community owns identity + membership + general info; field /
// schedule / format / recurring are per-Game concerns and were
// removed. Old clients that still send the legacy fields will have
// them silently ignored (the validator only reads what it needs).
interface CreateGroupInput {
  // Identity
  name: string;
  description?: string;
  isOpen?: boolean;
  internalRating?: boolean;
  hideInternalRating?: boolean;
  // Info
  rules?: string;
  contactPhone?: string;
  city?: string;
  maxMembers?: number;
  // Per-community cards feature (master switch + validity in days, null = no expiry)
  cardsEnabled?: boolean;
  yellowCardValidityDays?: number | null;
  redCardValidityDays?: number | null;
}

function genInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normaliseGroupName(name: string): string {
  return name.trim().toLowerCase();
}

function pickShortString(
  v: unknown,
  max: number,
  field: string,
  required: boolean,
): string | undefined {
  if (v == null) {
    if (required) {
      throw new HttpsError('invalid-argument', `${field} is required`);
    }
    return undefined;
  }
  if (typeof v !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`);
  }
  const trimmed = v.trim();
  if (required && trimmed.length === 0) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  if (trimmed.length > max) {
    throw new HttpsError(
      'invalid-argument',
      `${field} too long (max ${max})`,
    );
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
export const uploadGroupCover = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as {
      groupId?: string;
      imageBase64?: string;
      contentType?: string;
    };
    const groupId = typeof data.groupId === 'string' ? data.groupId : '';
    const imageBase64 =
      typeof data.imageBase64 === 'string' ? data.imageBase64 : '';
    const contentType =
      typeof data.contentType === 'string' ? data.contentType : 'image/jpeg';
    if (!groupId || !imageBase64) {
      throw new HttpsError('invalid-argument', 'groupId + imageBase64 required');
    }
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
      throw new HttpsError('invalid-argument', 'unsupported content type');
    }

    // Admin gate — Admin SDK read is not subject to App Check.
    const gSnap = await db.collection('groups').doc(groupId).get();
    if (!gSnap.exists) {
      throw new HttpsError('not-found', 'group not found');
    }
    const adminIds = (gSnap.data()?.adminIds as string[] | undefined) ?? [];
    if (!adminIds.includes(uid)) {
      throw new HttpsError('permission-denied', 'group admins only');
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'image missing or too large');
    }

    const token = randomUUID();
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
    } catch (err) {
      console.error('[uploadGroupCover] save failed', groupId, err);
      throw new HttpsError('internal', 'upload failed');
    }
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    return { url };
  },
);

export const createGroupCallable = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required');
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
        ? (snap.data() as {
            windowStart?: number;
            count?: number;
          })
        : {};
      const windowStart = cur.windowStart ?? 0;
      const inWindow = now - windowStart < CREATE_GROUP_RATE_WINDOW_MS;
      const count = inWindow ? (cur.count ?? 0) : 0;
      if (count >= CREATE_GROUP_RATE_CAP) {
        throw new HttpsError(
          'resource-exhausted',
          'יצירת מועדונים מוגבלת ל-5 ביום. נסה שוב מאוחר יותר.',
        );
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
    const input = (request.data ?? {}) as Partial<CreateGroupInput>;
    const name = pickShortString(input.name, 80, 'name', true)!;
    const description = pickShortString(
      input.description,
      500,
      'description',
      false,
    );
    const city = pickShortString(input.city, 80, 'city', false);
    const contactPhone = pickShortString(
      input.contactPhone,
      40,
      'contactPhone',
      false,
    );
    const rulesText = pickShortString(input.rules, 2000, 'rules', false);

    const maxMembers =
      typeof input.maxMembers === 'number' && input.maxMembers > 0
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
    const sanitizeValidity = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v > 0
        ? Math.min(Math.floor(v), 3650)
        : null;
    const yellowCardValidityDays = sanitizeValidity(input.yellowCardValidityDays);
    const redCardValidityDays = sanitizeValidity(input.redCardValidityDays);

    // Location (for the "nearby" discovery radius) + cover image. The client
    // builds these but they used to be dropped here, so every new community
    // had no coordinates (radius filter fell back to city-name) and a blank
    // cover on its discovery card.
    const geo = input as { lat?: unknown; lng?: unknown; coverImageId?: unknown };
    const validCoord = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const lat = validCoord(geo.lat);
    const lng = validCoord(geo.lng);
    const hasGeo = lat !== undefined && lng !== undefined;
    const coverImageId = pickShortString(geo.coverImageId, 200, 'coverImageId', false);

    // 3) Generate id + invite code. Server-controlled to prevent
    //    duplicate-code attacks (Audit Finding #2 / Sec #9 followup).
    const groupRef = db.collection('groups').doc();
    const groupId = groupRef.id;
    const createdAt = now;

    const groupDoc: Record<string, unknown> = {
      id: groupId,
      name,
      normalizedName: normaliseGroupName(name),
      creatorId: uid,
      adminIds: [uid],
      playerIds: [uid],
      pendingPlayerIds: [],
      // Stamp the founder's membership + admin dates at creation (the
      // stampMembershipDates CF only sees LATER additions, not the initial
      // create), so the founder's timeline shows הצטרף/מונה like everyone else.
      joinedAt: { [uid]: createdAt },
      adminSince: { [uid]: createdAt },
      inviteCode: genInviteCode(),
      isOpen,
      internalRating,
      hideInternalRating,
      createdAt,
      updatedAt: createdAt,
    };
    if (description !== undefined) groupDoc.description = description;
    if (city !== undefined) groupDoc.city = city;
    if (contactPhone !== undefined) groupDoc.contactPhone = contactPhone;
    if (rulesText !== undefined) groupDoc.rules = rulesText;
    if (maxMembers !== undefined) groupDoc.maxMembers = maxMembers;
    if (cardsEnabled) groupDoc.cardsEnabled = true;
    if (yellowCardValidityDays !== null) groupDoc.yellowCardValidityDays = yellowCardValidityDays;
    if (redCardValidityDays !== null) groupDoc.redCardValidityDays = redCardValidityDays;
    if (hasGeo) {
      groupDoc.lat = lat;
      groupDoc.lng = lng;
    }
    if (coverImageId !== undefined) groupDoc.coverImageId = coverImageId;

    const publicDoc: Record<string, unknown> = {
      id: groupId,
      name,
      normalizedName: normaliseGroupName(name),
      memberCount: 1,
      isOpen,
      createdAt,
      updatedAt: createdAt,
    };
    if (description !== undefined) publicDoc.description = description;
    if (city !== undefined) publicDoc.city = city;
    if (contactPhone !== undefined) publicDoc.contactPhone = contactPhone;
    if (maxMembers !== undefined) publicDoc.maxMembers = maxMembers;
    if (hasGeo) {
      publicDoc.lat = lat;
      publicDoc.lng = lng;
    }
    if (coverImageId !== undefined) publicDoc.coverImageId = coverImageId;

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
      await db.collection('users').doc(uid).set(
        {
          achievements: {
            teamsCreated: admin.firestore.FieldValue.increment(1),
          },
          updatedAt: now,
        },
        { merge: true },
      );
    } catch (err) {
      console.warn('[createGroupCallable] teamsCreated bump failed', err);
    }

    return { ok: true, groupId };
  },
);

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
export const backfillGroupCreatorIdsOnce = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const ALLOWED_UID = '1IdtNEjbEXfiRSqvLrJVn99NsfI2'; // matan
    if (request.auth?.uid !== ALLOWED_UID) {
      throw new HttpsError('permission-denied', 'admin only');
    }
    const snap = await db.collection('groups').get();
    let touched = 0;
    let skipped = 0;
    let failed = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as {
        creatorId?: string;
        adminIds?: string[];
      };
      if (typeof data.creatorId === 'string' && data.creatorId.length > 0) {
        skipped += 1;
        continue;
      }
      const fallback =
        Array.isArray(data.adminIds) && data.adminIds.length > 0
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
      } catch (err) {
        console.warn(
          '[backfillGroupCreatorIdsOnce] update failed',
          doc.id,
          err,
        );
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
  },
);

// ─── Discipline helpers (server-side, Admin SDK) ────────────────────────
//
// Mirror of the (now-broken-from-client) `disciplineService.issueCard`
// + `revokeCard` logic. Called from `onGameRosterChanged` whenever a
// game's `arrivals[uid]` transitions to 'late' / 'no_show' or back.
// The hardened /users rules block cross-user writes from the client,
// so these need to live server-side.

interface DisciplineEventDoc {
  id: string;
  userId: string;
  type: 'yellow' | 'red';
  reason: 'late' | 'no_show' | 'manual';
  gameId?: string;
  createdAt: number;
}

async function issueDisciplineCard(
  uid: string,
  input: {
    type: 'yellow' | 'red';
    reason: 'late' | 'no_show' | 'manual';
    gameId?: string;
  },
): Promise<void> {
  if (!uid) return;
  const userRef = db.collection('users').doc(uid);
  const event: DisciplineEventDoc = {
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
    const data = (snap.exists ? snap.data() : {}) as {
      discipline?: {
        yellowCards?: number;
        redCards?: number;
        events?: DisciplineEventDoc[];
      };
    };
    const cur = data.discipline ?? {};
    const events = Array.isArray(cur.events) ? cur.events : [];
    // Idempotency: don't double-issue for the same (uid, gameId, reason).
    if (
      input.gameId &&
      events.some(
        (e) => e.gameId === input.gameId && e.reason === input.reason,
      )
    ) {
      return;
    }
    const yellowCards = (cur.yellowCards ?? 0) + (input.type === 'yellow' ? 1 : 0);
    const redCards = (cur.redCards ?? 0) + (input.type === 'red' ? 1 : 0);
    tx.set(
      userRef,
      {
        discipline: {
          yellowCards,
          redCards,
          events: [...events, event],
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  });
}

// ─── Public community showcase: maintain /communityShowcase/{gid} ──────
//
// Powers the publicly shareable web page at teamderfc.web.app/c/{gid}.
// The page is a static client-rendered HTML that reads this doc via the
// Firestore REST API (no auth — see firestore.rules for /communityShowcase).
// The doc is a denormalised projection of state already visible in-app:
// finished/cancelled game tallies, recent games, top attenders, member
// roster. No private fields (fcmTokens, notif prefs, join requests) are
// mirrored.
//
// Triggers:
//   • /games/{id} writes — when status flips to finished/cancelled, the
//     aggregates change. We also recompute on roster/title edits to a
//     terminal game so historical fixes flow through.
//   • /groups/{gid} writes — name/description/city/playerIds/adminIds
//     changes affect the hero + member list.
//
// Strategy: a single recompute() function reads the canonical /groups/{gid},
// queries up to 200 most recent terminal /games for this community, and
// hydrates user docs for the people referenced in the top-attenders /
// member list (capped at ~50 hydrations per recompute). Worst-case ~250
// reads per affected event. With realistic write patterns (a few games
// per community per week) this is a few hundred reads/community/week —
// well inside free tier.
//
// We DO NOT make this CF responsible for deciding when to re-render —
// every relevant write triggers a recompute. If two writes land
// concurrently we may end up with two recomputes; the last-writer-wins
// outcome on /communityShowcase is fine since both reads see the same
// canonical state ± a few hundred ms.

interface ShowcaseTopAttender {
  uid: string;
  name: string;
  photoUrl?: string | null;
  avatarId?: string | null;
  gamesPlayed: number;
  attendancePct: number;
}

interface ShowcaseMember {
  uid: string;
  name: string;
  photoUrl?: string | null;
  avatarId?: string | null;
  isAdmin: boolean;
  joinedAt?: number | null;
  gamesPlayed: number;
}

interface ShowcaseRecentGame {
  id: string;
  title: string;
  startsAt: number | null;
  fieldName?: string | null;
  status: 'finished' | 'cancelled';
  attendedCount: number;
}

interface ShowcaseDoc {
  groupId: string;
  name: string;
  description?: string | null;
  city?: string | null;
  fieldName?: string | null;
  fieldAddress?: string | null;
  isOpen: boolean;
  foundedAt: number;
  totalGamesFinished: number;
  totalGamesCancelled: number;
  organizationRatePct: number;
  thisMonthGames: number;
  avgAttendance: number;
  totalMembers: number;
  activeMembersThisMonth: number;
  activeMembersThisYear: number;
  topAttenders: ShowcaseTopAttender[];
  recentGames: ShowcaseRecentGame[];
  members: ShowcaseMember[];
  updatedAt: number;
}

async function recomputeCommunityShowcase(
  groupId: string,
  preloaded?: FirebaseFirestore.DocumentSnapshot,
): Promise<void> {
  if (!groupId) return;
  // 1) Canonical group doc — reuse the trigger's already-loaded snapshot
  //    when given (saves one read per fire), else fetch. If missing, the
  //    community has been deleted: tear down the showcase mirror.
  const groupSnap = preloaded ?? (await db.collection('groups').doc(groupId).get());
  if (!groupSnap.exists) {
    try {
      await db.collection('communityShowcase').doc(groupId).delete();
    } catch (err) {
      console.warn(
        '[updateCommunityShowcase] showcase teardown failed',
        groupId,
        err,
      );
    }
    return;
  }
  // A hidden, one-member personal group is not a community and must never
  // acquire a public showcase card. Tear one down if it somehow exists.
  if (groupSnap.data()?.isPersonal === true) {
    try {
      await db.collection('communityShowcase').doc(groupId).delete();
    } catch {
      /* nothing to tear down */
    }
    return;
  }
  const group = groupSnap.data() as {
    name?: string;
    description?: string | null;
    city?: string | null;
    fieldName?: string | null;
    fieldAddress?: string | null;
    isOpen?: boolean;
    playerIds?: string[];
    adminIds?: string[];
    createdAt?: number;
  };

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
  const attendedTally: Record<string, number> = {};
  const activeMonth = new Set<string>();
  const activeYear = new Set<string>();
  const recentGamesRaw: Array<{
    id: string;
    title: string;
    startsAt: number | null;
    fieldName?: string | null;
    status: 'finished' | 'cancelled';
    attendedCount: number;
  }> = [];

  for (const doc of gamesSnap.docs) {
    const g = doc.data() as {
      id?: string;
      title?: string;
      startsAt?: number;
      fieldName?: string | null;
      status?: string;
      players?: string[];
      arrivals?: Record<string, string>;
    };
    const status = g.status === 'cancelled' ? 'cancelled' : 'finished';
    // The showcase counts the club's evenings and its organisation rate, so it
    // asks the same question the rest of the app does rather than reading the
    // status. An evening the sweep closed with nothing on it is neither one
    // the club held nor one it called off: it belongs to neither half of the
    // fraction until an admin says which.
    const played = eveningPlayState(g as PlayableEvening);
    if (played === 'unverified') continue;
    if (status === 'cancelled' || played === 'notHappened') {
      totalCancelled += 1;
    } else {
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
        if (arrivals[uid] === 'no_show') continue;
        attendedHere += 1;
        attendedTally[uid] = (attendedTally[uid] ?? 0) + 1;
        if (within30) activeMonth.add(uid);
        if (within365) activeYear.add(uid);
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

  const organizationRatePct =
    totalFinished + totalCancelled > 0
      ? Math.round(
          (totalFinished / (totalFinished + totalCancelled)) * 100,
        )
      : 0;
  const avgAttendance =
    totalFinished > 0
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
  const hydrateSet = new Set<string>([...memberSlice, ...topUidsRanked]);
  const hydrateIds = Array.from(hydrateSet);

  const userByUid: Record<
    string,
    {
      name?: string;
      photoUrl?: string | null;
      avatarId?: string | null;
      createdAt?: number;
    }
  > = {};
  // Firestore `getAll` with up to 500 refs is one round-trip — cheaper
  // than N separate gets. We chunk to be safe.
  const chunkSize = 100;
  for (let i = 0; i < hydrateIds.length; i += chunkSize) {
    const chunk = hydrateIds.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const refs = chunk.map((uid) => db.collection('users').doc(uid));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data() as {
        name?: string;
        photoUrl?: string | null;
        avatarId?: string | null;
        createdAt?: number;
      };
      userByUid[s.id] = {
        name: d.name,
        photoUrl: d.photoUrl ?? null,
        avatarId: d.avatarId ?? null,
        createdAt: typeof d.createdAt === 'number' ? d.createdAt : undefined,
      };
    }
  }

  const topAttenders: ShowcaseTopAttender[] = topUidsRanked.map((uid) => {
    const u = userByUid[uid] ?? {};
    const games = attendedTally[uid] ?? 0;
    const pct =
      totalFinished > 0 ? Math.round((games / totalFinished) * 100) : 0;
    return {
      uid,
      name: u.name || 'שחקן',
      photoUrl: u.photoUrl ?? null,
      avatarId: u.avatarId ?? null,
      gamesPlayed: games,
      attendancePct: pct,
    };
  });

  const members: ShowcaseMember[] = memberSlice.map((uid) => {
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
    if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
    return (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0);
  });

  const recentGames: ShowcaseRecentGame[] = recentGamesRaw.slice(0, 5);

  // Privacy: the showcase doc is world-readable (unauthenticated share
  // preview). Do NOT expose the EXACT field address to the open internet —
  // city + field NAME are enough for a preview; the precise address is a
  // physical-safety concern. And for CLOSED communities, publish NO member
  // roster / name leaderboard publicly — only aggregate stats. Open
  // communities keep the player showcase (that's the marketing feature).
  const publicMembers = group.isOpen ? members : [];
  const publicTopAttenders = group.isOpen ? topAttenders : [];
  // Closed communities also must NOT leak their recent game titles or the field
  // NAME publicly — only aggregate counts. (Open communities keep them as part
  // of the marketing showcase.)
  const publicRecentGames = group.isOpen ? recentGames : [];
  const showcase: ShowcaseDoc = {
    groupId,
    name: group.name ?? 'מועדון',
    description: group.description ?? null,
    city: group.city ?? null,
    fieldName: group.isOpen ? (group.fieldName ?? null) : null,
    fieldAddress: null,
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
    topAttenders: publicTopAttenders,
    recentGames: publicRecentGames,
    members: publicMembers,
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
] as const;
function showcaseGroupFieldsChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return SHOWCASE_GROUP_FIELDS.some(
    (f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]),
  );
}

export const updateShowcaseOnGroupChange = onDocumentWritten(
  'groups/{groupId}',
  async (event) => {
    const groupId = event.params.groupId as string;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    // Recompute only when a showcase-relevant field changed, or on
    // create/delete. Skips the cascade from pending/milestone/updatedAt writes.
    if (before && after && !showcaseGroupFieldsChanged(before, after)) return;
    try {
      await recomputeCommunityShowcase(groupId, event.data?.after);
    } catch (err) {
      console.warn(
        '[updateShowcaseOnGroupChange] recompute failed',
        groupId,
        err,
      );
    }
  },
);

/**
 * Recompute the public showcase whenever a /games doc changes its
 * terminal state. We narrow the trigger to writes that flip the game
 * INTO finished/cancelled, or edit a game that's already terminal —
 * mid-flow writes (open → locked → active) don't change any showcase
 * field, so re-running the aggregation on every roster join would be
 * wasteful (a popular community can see hundreds of joins/cancels per
 * week per game).
 */
export const updateShowcaseOnGameChange = onDocumentWritten(
  'games/{gameId}',
  async (event) => {
    const before = event.data?.before?.data() as
      | { status?: string; groupId?: string }
      | undefined;
    const after = event.data?.after?.data() as
      | { status?: string; groupId?: string }
      | undefined;
    const groupId = (after?.groupId || before?.groupId || '') as string;
    if (!groupId) return;
    const beforeTerminal =
      before?.status === 'finished' || before?.status === 'cancelled';
    const afterTerminal =
      after?.status === 'finished' || after?.status === 'cancelled';
    // Only recompute when the doc is/was terminal — that's the only
    // shape that contributes to showcase aggregates.
    if (!beforeTerminal && !afterTerminal) return;
    // Edit to an ALREADY-terminal game (retro-goal, arrival fix, an unrelated
    // field edit): only recompute if a field the showcase actually reads
    // changed. Otherwise every such write triggered a ~250-read aggregation.
    if (beforeTerminal && afterTerminal) {
      const b = event.data?.before?.data() as Record<string, unknown> | undefined;
      const a = event.data?.after?.data() as Record<string, unknown> | undefined;
      const showcaseKeys = ['status', 'players', 'arrivals', 'title', 'startsAt'];
      const changed = showcaseKeys.some(
        (k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]),
      );
      if (!changed) return;
    }
    try {
      await recomputeCommunityShowcase(groupId);
    } catch (err) {
      console.warn(
        '[updateShowcaseOnGameChange] recompute failed',
        groupId,
        err,
      );
    }
  },
);

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

const COMMUNITY_TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  'templates',
  'community.html',
);
const INVITE_TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  'templates',
  'invite.html',
);
const templateCache: Record<string, string> = {};
function loadTemplate(filePath: string): string {
  if (templateCache[filePath]) return templateCache[filePath];
  templateCache[filePath] = fs.readFileSync(filePath, 'utf8');
  return templateCache[filePath];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ShowcaseSummary {
  name: string;
  description: string | null;
  city: string | null;
  totalGamesFinished: number;
  totalMembers: number;
  /** Group cover image URL — surfaced for `og:image` so WhatsApp /
   *  Telegram / Facebook show the community's cover in the share
   *  preview. Read from /groups/{id} since communityShowcase doesn't
   *  carry it; one extra Firestore read per uncached page hit. */
  coverPhotoUrl: string | null;
}

async function loadShowcaseSummary(
  groupId: string,
): Promise<ShowcaseSummary | null> {
  try {
    // Two parallel reads — showcase (name/desc/city/counts) + the raw
    // group doc (cover). Both cached for 5-10min downstream so this
    // doesn't run on every share-link click.
    const [showSnap, groupSnap] = await Promise.all([
      db.collection('communityShowcase').doc(groupId).get(),
      db.collection('groups').doc(groupId).get(),
    ]);
    if (!showSnap.exists) return null;
    const d = showSnap.data() as Record<string, unknown>;
    const name = typeof d.name === 'string' ? d.name : '';
    if (!name) return null;
    const groupData = groupSnap.exists
      ? (groupSnap.data() as Record<string, unknown>)
      : {};
    const cover =
      typeof groupData.coverPhotoUrl === 'string'
        ? groupData.coverPhotoUrl
        : null;
    return {
      name,
      description:
        typeof d.description === 'string' ? d.description : null,
      city: typeof d.city === 'string' ? d.city : null,
      totalGamesFinished:
        typeof d.totalGamesFinished === 'number'
          ? d.totalGamesFinished
          : 0,
      totalMembers:
        typeof d.totalMembers === 'number' ? d.totalMembers : 0,
      coverPhotoUrl: cover,
    };
  } catch (err) {
    console.warn(
      '[serveCommunityPage] showcase fetch failed',
      groupId,
      err,
    );
    return null;
  }
}

function buildMetaBlock(summary: ShowcaseSummary | null): {
  title: string;
  description: string;
} {
  if (!summary) {
    return {
      title: 'מועדון ב־Teamder',
      description:
        'צפו בסטטיסטיקות המועדון, השחקנים הכי נאמנים, והמשחקים האחרונים.',
    };
  }
  const title = `${summary.name} · Teamder`;
  let description: string;
  if (summary.description && summary.description.trim().length > 0) {
    description = summary.description.trim();
  } else {
    const parts: string[] = [];
    if (summary.city) parts.push(summary.city);
    parts.push(`${summary.totalGamesFinished} משחקים`);
    parts.push(`${summary.totalMembers} חברי סגל`);
    description = `מועדון כדורגל ב־Teamder · ${parts.join(' · ')}`;
  }
  return { title, description };
}

function injectMeta(
  html: string,
  title: string,
  description: string,
  imageUrl: string | null,
): string {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = imageUrl ? escapeHtml(imageUrl) : null;
  let out = html;

  // <title> — a single replacement on the literal default works because
  // the static template has exactly one <title> tag.
  out = out.replace(
    /<title>[^<]*<\/title>/,
    `<title>${safeTitle}</title>`,
  );
  // <meta name="description"> — page-level description (used by Google +
  // some link-preview crawlers as a fallback when og:description is
  // missing).
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${safeDesc}" />`,
  );
  // og:title / og:description / twitter:* — replace the static
  // defaults the crawlers see.
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${safeTitle}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${safeDesc}" />`,
  );
  // og:image / twitter:image — the community's cover photo so the
  // WhatsApp / Telegram preview card shows the actual group image
  // instead of the generic Teamder logo. Only rewritten when we
  // have a URL — the static fallback to /logo.png stays for groups
  // without a cover.
  if (safeImage) {
    out = out.replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${safeImage}" />`,
    );
    out = out.replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:image" content="${safeImage}" />`,
    );
  }
  // twitter:title / twitter:description if present (invite.html has
  // them; community.html relies on og:* fallback).
  out = out.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${safeTitle}" />`,
  );
  out = out.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${safeDesc}" />`,
  );

  return out;
}

export const serveCommunityPage = onRequest(
  { region: 'us-central1', memory: '256MiB' },
  async (req, res) => {
    try {
      // Hosting forwards the original path verbatim. We support TWO
      // route families that both need SSR OG injection:
      //   /c/{groupId}    → community showcase (full stats page)
      //   /team/{groupId} → invite landing (open-in-app / install card)
      // The template differs, the OG injection logic is shared.
      const raw = (req.path || '').replace(/^\/+/, '');
      const parts = raw.split('/').filter(Boolean);
      const isInvite = parts[0] === 'team';
      const groupId =
        parts[0] === 'c' || parts[0] === 'team'
          ? parts[1] || ''
          : parts[0] || '';

      const html = loadTemplate(
        isInvite ? INVITE_TEMPLATE_PATH : COMMUNITY_TEMPLATE_PATH,
      );

      let summary: ShowcaseSummary | null = null;
      if (groupId) {
        summary = await loadShowcaseSummary(groupId);
      }
      const { title, description } = buildMetaBlock(summary);
      const rendered = injectMeta(
        html,
        title,
        description,
        summary?.coverPhotoUrl ?? null,
      );

      // 5min browser, 10min edge cache. Hosting-side CDN keys on the
      // full URL, so each /c/{id} caches independently. When a
      // community renames itself the CF re-runs after the cache
      // expires — acceptable lag for share previews.
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set(
        'Cache-Control',
        'public, max-age=300, s-maxage=600',
      );
      res.status(200).send(rendered);
    } catch (err) {
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
      } catch {
        res.status(500).send('internal error');
      }
    }
  },
);

/**
 * Resolves a SHORT invite link `/i/<code>` → the real target. Reads
 * `inviteLinks/{code}` = {type, targetId, invitedBy}, serves the SAME invite
 * landing template with OG injected AND `window.__INVITE__` set, so the short
 * link keeps full attribution (install referrer / clipboard) + WhatsApp preview.
 * A pure alias — no redirect, so the short URL stays in the address bar.
 */
export const serveInviteCode = onRequest(
  { region: 'us-central1', memory: '256MiB' },
  async (req, res) => {
    try {
      const raw = (req.path || '').replace(/^\/+/, '');
      const parts = raw.split('/').filter(Boolean);
      const code = (parts[0] === 'i' ? parts[1] : parts[0]) || '';

      let type = 'app';
      let targetId = '';
      let invitedBy = '';
      if (code) {
        const snap = await db.collection('inviteLinks').doc(code).get();
        if (snap.exists) {
          const d = snap.data() as {
            type?: string;
            targetId?: string;
            invitedBy?: string;
          };
          if (d.type === 'session' || d.type === 'team' || d.type === 'app') {
            type = d.type;
          }
          targetId = typeof d.targetId === 'string' ? d.targetId : '';
          invitedBy = typeof d.invitedBy === 'string' ? d.invitedBy : '';
          // Count the click (per short link). Fire-and-forget.
          snap.ref
            .set(
              { clicks: admin.firestore.FieldValue.increment(1), lastClickAt: Date.now() },
              { merge: true },
            )
            .catch(() => {});
          // …AND the per-INVITER counter the dashboard profile reads for
          // "קליקים על הקישור". trackLinkClick's legacy `?inviter=` path bumps
          // this, but short links (`/i/<code>`) used to skip it — so a person's
          // profile undercounted (7) while the daily aggregate below was right
          // (15). Bump it here too so the two never diverge again. Modern shares
          // are almost all short links, so without this the profile counter is
          // effectively dead. (inviteLinks.invitedBy is the trusted inviter.)
          if (invitedBy) {
            db.collection('inviteClicks')
              .doc(invitedBy)
              .set(
                { clicks: admin.firestore.FieldValue.increment(1), lastClickAt: Date.now() },
                { merge: true },
              )
              .catch(() => {});
          }
          // …and into the cross-source daily aggregate the dashboard reads,
          // attributed to the inviter (or the short-code when anonymous).
          bumpLinkClickAggregate(admin.firestore(), Date.now(), {
            inviterId: invitedBy || undefined,
            code: code || undefined,
            kind: 'invite',
          }).catch(() => {});
        }
      }

      // Situation-aware OG preview so the WhatsApp/crawler card matches the
      // link TYPE — a personal invite must NOT show the community default
      // ("מועדון ב־Teamder"). Mirrors the page-body variant selection:
      // session→game, team→community, else invitedBy→personal, else generic.
      let summary: ShowcaseSummary | null = null;
      let meta: { title: string; description: string };
      let ogImage: string | null = null;
      if (type === 'team' && targetId) {
        summary = await loadShowcaseSummary(targetId).catch(() => null);
        meta = buildMetaBlock(summary);
        ogImage = summary?.coverPhotoUrl ?? null;
      } else if (type === 'session' && targetId) {
        const g = await db
          .collection('games')
          .doc(targetId)
          .get()
          .catch(() => null);
        const gd = g && g.exists ? (g.data() as Record<string, unknown>) : null;
        const gt =
          gd && typeof gd.title === 'string' && gd.title.trim()
            ? gd.title.trim()
            : '';
        const where =
          gd && typeof gd.fieldName === 'string' && gd.fieldName
            ? gd.fieldName
            : gd && typeof gd.city === 'string'
            ? (gd.city as string)
            : '';
        meta = {
          title: gt ? `הוזמנת למשחק: ${gt}` : 'הוזמנת למשחק כדורגל ב־Teamder',
          description: where
            ? `משחק כדורגל ב־Teamder · ${where} · ראה מי מגיע והצטרף בלחיצה.`
            : 'משחק כדורגל ב־Teamder · ראה מי מגיע והצטרף בלחיצה אחת.',
        };
      } else if (invitedBy) {
        const u = await db
          .collection('users')
          .doc(invitedBy)
          .get()
          .catch(() => null);
        const nm =
          u && u.exists && typeof (u.data() as { name?: string })?.name === 'string'
            ? ((u.data() as { name?: string }).name as string).trim()
            : '';
        meta = {
          title: nm ? `${nm} מזמין אותך ל־Teamder` : 'הזמנה אישית ל־Teamder',
          description:
            'הצטרף לחברים שלך ב־Teamder — האפליקציה שמארגנת את הכדורגל כדי שרק תגיעו לשחק.',
        };
      } else {
        meta = {
          title: 'Teamder · כדורגל קבוע בלי כאב ראש',
          description:
            'פותחים משחק, החבר׳ה נרשמים ו־Teamder מטפלת בכל השאר.',
        };
      }
      const html = loadTemplate(INVITE_TEMPLATE_PATH);
      const rendered = injectMeta(html, meta.title, meta.description, ogImage);
      // Inject the resolved target BEFORE the page's inline script runs, so
      // invite.html reads window.__INVITE__ instead of the (target-less) path.
      const inject = `<script>window.__INVITE__=${JSON.stringify({
        type,
        id: targetId,
        invitedBy,
      })};</script>`;
      const out = rendered.replace('</head>', `${inject}</head>`);

      res.set('Content-Type', 'text/html; charset=utf-8');
      // Short cache — the click counter + resolved target should stay fresh.
      res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
      res.status(200).send(out);
    } catch (err) {
      console.error('[serveInviteCode] render failed', err);
      try {
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(loadTemplate(INVITE_TEMPLATE_PATH));
      } catch {
        res.status(500).send('internal error');
      }
    }
  },
);

async function revokeDisciplineCardsFor(
  uid: string,
  gameId: string,
): Promise<void> {
  if (!uid || !gameId) return;
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return;
    const data = snap.data() as {
      discipline?: {
        yellowCards?: number;
        redCards?: number;
        events?: DisciplineEventDoc[];
      };
    };
    const cur = data.discipline ?? {};
    const events = Array.isArray(cur.events) ? cur.events : [];
    const remaining = events.filter((e) => e.gameId !== gameId);
    if (remaining.length === events.length) return;
    const removed = events.filter((e) => e.gameId === gameId);
    const yellowDelta = removed.filter((e) => e.type === 'yellow').length;
    const redDelta = removed.filter((e) => e.type === 'red').length;
    tx.set(
      userRef,
      {
        discipline: {
          yellowCards: Math.max(0, (cur.yellowCards ?? 0) - yellowDelta),
          redCards: Math.max(0, (cur.redCards ?? 0) - redDelta),
          events: remaining,
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
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
/** Default availability radius (km) when a user hasn't set one. Shared by the
 *  count (availabilityCounts) and the pulse so both apply the SAME geo test. */
const DEFAULT_AVAIL_RADIUS_KM = 25;
/** Latch on the "no candidates" fallback push so we don't spam the
 *  admin every 30 minutes. */
const FILLER_NO_CANDIDATES_COOLDOWN_MS = 6 * FILLER_HOUR_MS;

// Shared, module-level cache of the opted-in candidate pool. The pool is
// IDENTICAL for every caller (only the per-caller radius filter differs) and
// is read by three hot paths: the availabilityCounts callable (home screen),
// every pulse batch (every 2 min per active game), and the 15-min sweep.
// Re-reading the whole `acceptsFillerPush==true` collection on each would be a
// severe read-cost regression on this branch. A warm Cloud Functions instance
// reuses this cache across invocations, collapsing the dominant scan to at
// most once per TTL per instance. Staleness ≤ TTL is fine — a freshly opted-in
// user simply isn't counted/invited for a couple of minutes.
const CANDIDATE_POOL_TTL_MS = 3 * 60 * 1000;
let candidatePoolCache: {
  at: number;
  docs: FirebaseFirestore.QueryDocumentSnapshot[];
} | null = null;
async function getFillerCandidatePool(): Promise<
  FirebaseFirestore.QueryDocumentSnapshot[]
> {
  const now = Date.now();
  if (candidatePoolCache && now - candidatePoolCache.at < CANDIDATE_POOL_TTL_MS) {
    return candidatePoolCache.docs;
  }
  const docs = (
    await db
      .collection('users')
      .where('availability.acceptsFillerPush', '==', true)
      .get()
  ).docs;
  candidatePoolCache = { at: now, docs };
  return docs;
}

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
async function computeTrustScoreServerSide(
  uid: string,
): Promise<number | null> {
  if (!uid) return null;
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
    const g = doc.data() as {
      status?: string;
      startsAt?: number;
      cancelDeadlineHours?: number;
      cancellations?: Record<string, number>;
      players?: string[];
      arrivals?: Record<string, string>;
    };
    if (g.status !== 'finished' && g.status !== 'cancelled') continue;
    const startsAt = typeof g.startsAt === 'number' ? g.startsAt : 0;
    if (startsAt >= now) continue;

    const cancelTs = g.cancellations?.[uid];
    if (typeof cancelTs === 'number') {
      const deadline =
        typeof g.cancelDeadlineHours === 'number'
          ? startsAt - g.cancelDeadlineHours * FILLER_HOUR_MS
          : null;
      if (deadline !== null && cancelTs > deadline) {
        hardCancels += 1;
      } else {
        softCancels += 1;
      }
      continue;
    }
    if (g.status !== 'finished') continue;
    if (!(g.players ?? []).includes(uid)) continue;
    registered += 1;
    if (g.arrivals?.[uid] !== 'no_show') attended += 1;
  }

  if (registered < TRUST_MIN_GAMES) return null;
  const rate = attended / registered;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(rate * 100) -
        softCancels * TRUST_SOFT_PENALTY -
        hardCancels * TRUST_HARD_PENALTY,
    ),
  );
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

const NOMINATIM_BASE =
  'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT =
  'Teamder/1.0 (studiogameslime@gmail.com)';

function normaliseCityKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s ]+/g, '-') // collapse all whitespace into '-'
    .replace(/-+/g, '-'); // collapse runs of '-'
}

async function getCityCoords(
  city: string,
): Promise<{ lat: number; lng: number } | null> {
  const trimmed = city.trim();
  if (!trimmed) return null;
  const key = normaliseCityKey(trimmed);
  if (!key) return null;
  // Cache hit: read fast path.
  try {
    const cacheRef = db.collection('cityGeocode').doc(key);
    const snap = await cacheRef.get();
    if (snap.exists) {
      const d = snap.data() as {
        lat?: number;
        lng?: number;
        notFound?: boolean;
      };
      if (d.notFound) return null;
      if (typeof d.lat === 'number' && typeof d.lng === 'number') {
        return { lat: d.lat, lng: d.lng };
      }
    }
  } catch (err) {
    console.warn('[getCityCoords] cache read failed', city, err);
  }
  // Cache miss → Nominatim.
  let coords: { lat: number; lng: number } | null = null;
  try {
    const url =
      `${NOMINATIM_BASE}` +
      `?q=${encodeURIComponent(trimmed)}` +
      `&format=json&limit=1&countrycodes=il`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as Array<{
        lat?: string;
        lon?: string;
      }>;
      const hit = Array.isArray(data) ? data[0] : null;
      const lat = hit?.lat ? parseFloat(hit.lat) : NaN;
      const lng = hit?.lon ? parseFloat(hit.lon) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        coords = { lat, lng };
      }
    }
  } catch (err) {
    console.warn('[getCityCoords] Nominatim fetch failed', city, err);
  }
  // Persist outcome (positive AND negative) so we don't re-query
  // unknown names on every run.
  try {
    await db
      .collection('cityGeocode')
      .doc(key)
      .set(
        coords
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
            },
        { merge: true },
      );
  } catch (err) {
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
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371; // Earth radius (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

interface FillerGameDoc {
  id?: string;
  title?: string;
  status?: string;
  startsAt?: number;
  groupId?: string;
  createdBy?: string;
  city?: string;
  fieldAddress?: string;
  acceptsFillers?: boolean;
  fillerMinTrust?: number;
  players?: string[];
  /** Registered guests. They occupy real spots on the pitch, so every
   *  occupancy test here has to count them — see `occupancyOf`. */
  guests?: unknown[];
  waitlist?: string[];
  pending?: string[];
  maxPlayers?: number;
  minPlayers?: number;
  fillerPushHistory?: Record<string, number>;
  fillerNoCandidatesAt?: number;
}

// `occupancyOf` and `inFillerQuietHours` live in ./fillerRules — both caused a
// production bug, and both are pure, so they belong where a test can reach them.


async function runFindFillerCandidates(): Promise<void> {
  const now = Date.now();
  if (inFillerQuietHours(now)) {
    console.log('[findFillerCandidates] quiet hours — skipping this tick');
    return;
  }
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
  let candidateDocs: FirebaseFirestore.QueryDocumentSnapshot[] | null = null;

  for (const doc of snap.docs) {
    const game = doc.data() as FillerGameDoc;
    if (game.acceptsFillers !== true) continue;
    const players = game.players ?? [];
    // Guests INCLUDED — a guest holds a spot exactly like a registered player.
    const taken = occupancyOf(game);
    const maxPlayers = game.maxPlayers ?? 0;
    if (maxPlayers <= 0) continue;
    if (taken >= maxPlayers) continue; // already full

    // Shortage threshold:
    //  • if `minPlayers` set: shortage when taken < minPlayers
    //  • else: shortage when taken < 80% of maxPlayers
    const threshold =
      typeof game.minPlayers === 'number' && game.minPlayers > 0
        ? game.minPlayers
        : Math.floor(maxPlayers * 0.8);
    if (taken >= threshold) continue;

    processed += 1;

    // Matcher key is the STRICT `game.city` field (picked from
    // autocomplete in the wizard). The free-text `game.fieldAddress`
    // is street/landmark detail and would feed garbage to the
    // distance computation, so we deliberately don't fall back to it.
    // Legacy games without `city` are skipped — admin should re-edit
    // through the wizard to populate the strict field.
    const city =
      typeof game.city === 'string' ? game.city.trim() : '';
    if (!city) continue;

    // Geocode the game's city ONCE per matcher run (cached in
    // /cityGeocode/{normName}). Without coords we can't compute
    // distance to candidates — fall back to a name-equality match
    // so the user still gets some coverage.
    const gameCoords = await getCityCoords(city);

    // Declared-availability keys (Asia/Jerusalem) — only push to candidates who
    // marked this weekday + window free, matching the pulse + the home count so
    // we don't spam people about slots they never chose.
    const gameIlSweep =
      typeof game.startsAt === 'number' ? israelParts(game.startsAt) : null;
    const gameWeekdaySweep = gameIlSweep?.weekday;
    const gameWindowSweep = gameIlSweep ? hourToAvailWindow(gameIlSweep.hour) : null;
    const sweepTodayKey = fillerDayKey(now);

    // Candidate query: opted-in users only — loaded once per run and reused
    // across all shortage games (see candidateDocs above). The pool is small
    // (only users who toggled on `acceptsFillerPush`), so filtering by distance
    // in code is cheaper than a geo index for the MVP.
    if (!candidateDocs) {
      candidateDocs = await getFillerCandidatePool();
    }

    // Exclude users already in the community or game.
    let memberSet = new Set<string>();
    if (game.groupId) {
      const gSnap = await db
        .collection('groups')
        .doc(game.groupId)
        .get();
      if (gSnap.exists) {
        const grp = gSnap.data() as {
          playerIds?: string[];
          adminIds?: string[];
          pendingPlayerIds?: string[];
        };
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

    const newlyPushed: Record<string, number> = {};
    let pushesThisGame = 0;

    for (const userDoc of candidateDocs) {
      if (pushesThisGame >= FILLER_PUSH_LIMIT_PER_GAME) break;
      const uid = userDoc.id;
      if (memberSet.has(uid)) continue;
      if (inGame.has(uid)) continue;
      if (alreadyPushed[uid]) continue;

      // Geographic gate — distance from user's home city to the
      // game's city must be within the user's chosen radius.
      // Strict graceful-degradation policy:
      //   • both have coords → Haversine, compare to radius
      //   • either is missing coords → fall back to name match
      //     (user.homeCity === game.city). This covers the period
      //     before geocoding has populated, and unknown cities.
      const userData = userDoc.data() as {
        availability?: {
          homeCity?: string;
          homeCityLat?: number;
          homeCityLng?: number;
          availabilityRadiusKm?: number;
          cities?: string[];
          preferredCity?: string;
          preferredDays?: number[];
          preferredTimes?: string[];
          availabilitySlots?: Record<string, string[]> | null;
          fillerPushDay?: string;
          fillerPushCount?: number;
        };
      };
      const av = userData.availability ?? {};

      // Declared-availability match — prefers the precise per-day grid, falls
      // back to legacy days×times (empty = "any"). Same rule as the pulse.
      if (!availabilityCovers(av, gameWeekdaySweep, gameWindowSweep)) continue;

      // Best-effort daily-cap pre-filter (authoritative reservation is the txn
      // below) — avoids a transaction for obviously-capped candidates.
      const usedTodayS =
        av.fillerPushDay === sweepTodayKey ? av.fillerPushCount ?? 0 : 0;
      if (usedTodayS >= FILLER_DAILY_CAP) continue;

      const userCity = av.homeCity ?? av.preferredCity ?? av.cities?.[0];
      if (!userCity) continue;
      const radiusKm =
        typeof av.availabilityRadiusKm === 'number' &&
        av.availabilityRadiusKm > 0
          ? av.availabilityRadiusKm
          : DEFAULT_AVAIL_RADIUS_KM;
      let withinRange = false;
      if (
        gameCoords &&
        typeof av.homeCityLat === 'number' &&
        typeof av.homeCityLng === 'number'
      ) {
        const distKm = haversineKm(
          { lat: av.homeCityLat, lng: av.homeCityLng },
          gameCoords,
        );
        withinRange = distKm <= radiusKm;
      } else {
        // Fallback: treat exact city-name equality as "in range".
        withinRange =
          normaliseCityKey(userCity) === normaliseCityKey(city);
      }
      if (!withinRange) continue;

      // (Trust filtering removed — candidates are matched purely by
      // availability + geography now. Trust is still computed
      // elsewhere but no longer gates the filler pool.)

      // Respect the per-user daily cap, shared atomically with the pulse
      // engine so a player never receives more than FILLER_DAILY_CAP filler
      // pushes across BOTH matchers in a day.
      const reserved = await reserveFillerPush(uid, fillerDayKey(now));
      if (!reserved) continue;

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
          // Open spots until the game is FULL (maxPlayers − taken), e.g.
          // 10/15 → 5. NOT `threshold − taken` (threshold is the shortage
          // trigger = minPlayers or 80%, which overstated the gap), and NOT
          // `maxPlayers − players.length`, which ignored guests and announced
          // "חסרים 20 שחקנים" for a game that was already full of them.
          shortBy: Math.max(0, maxPlayers - taken),
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
      await doc.ref.set(
        {
          fillerPushHistory: { ...alreadyPushed, ...newlyPushed },
          // Grant each pushed candidate PERMANENT read access to this game —
          // the games read rule honours `invitedUserIds`, so tapping the
          // fillerOpportunity push always reaches the "הגש מועמדות" CTA, even
          // if `acceptsFillers` later toggles off (game filled / started).
          // Without this the push dead-ended on the "משחק לסגל בלבד" wall
          // (Pulse feat-1).
          ...(pushedUids.length
            ? {
                invitedUserIds:
                  admin.firestore.FieldValue.arrayUnion(...pushedUids),
              }
            : {}),
          updatedAt: now,
        },
        { merge: true },
      );
    }
    // (No "no candidates" admin push anymore — without a trust filter
    // there's no threshold for the admin to lower, so the fallback
    // notification was removed.)
  }

  console.log(
    `[findFillerCandidates] scanned ${snap.size} games, processed ${processed} shortage games, pushed ${pushed} opportunities, ${fallbackPushed} fallback admin pushes`,
  );
}

// ─── Pulse-invite engine (on-demand, accelerated filler matcher) ───────
//
// When a game is created (or its roster drops) short-handed AND within the
// recruitment window, we fire batches of `fillerOpportunity` pushes to
// nearby available players — PULSE_BATCH at a time, every PULSE_INTERVAL,
// until the game FILLS, the candidate pool is EXHAUSTED, or kickoff is
// within PULSE_STOP_BEFORE. Each batch is a self-rescheduling Cloud Task.
//
// This COMPLEMENTS the 15-minute `runFindFillerCandidates` sweep (which
// only covers the 3–12h window and pushes slowly): the pulse also covers
// imminent (<3h) games — exactly the "quick game for tonight" case the
// home availability calendar creates — and delivers invites far faster.
// The two share `fillerPushHistory`, so no user is ever double-pushed, and
// the sweep remains the safety net if the pulse stops early.
// Master switch for the on-demand pulse engine. Default OFF so deploying the
// code does NOT start pushing to real users on prod — the existing 15-min sweep
// keeps working unchanged. Flip to true (and redeploy) to activate the fast
// pulse once the availability feature ships to clients.
const PULSE_ENGINE_ENABLED = false;
const PULSE_BATCH = 10;
const PULSE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes between batches
const PULSE_STOP_BEFORE_MS = 30 * 60 * 1000; // stop pulsing 30 min pre-kickoff
const PULSE_MAX_LEAD_MS = FILLER_WINDOW_LATEST_HOURS * FILLER_HOUR_MS; // 12h
const FILLER_DAILY_CAP = 3; // max filler pushes a player receives per calendar day

// Local YYYYMMDD key (server timezone) for the per-user daily push cap.
function fillerDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// (Invites are sent in RANDOM order — the shared `shuffleInPlace` helper
// above — so no candidate is systematically favoured across pulses.)

// Run ONE pulse batch for a single game. Returns a reschedule delay when
// the game should be pulsed again, or null when pulsing must stop (full /
// exhausted / out of window / terminal).
// Atomically reserve one daily filler-push slot for a recipient. Returns true
// if the reservation succeeded (recipient was under FILLER_DAILY_CAP for today
// and the counter was incremented), false if already capped or on txn error
// (fail-closed — never over-push). The transaction serialises overlapping
// pulse batches so the cap holds under concurrency.
async function reserveFillerPush(
  uid: string,
  todayKey: string,
): Promise<boolean> {
  const uref = db.collection('users').doc(uid);
  try {
    return await db.runTransaction(async (tx) => {
      const s = await tx.get(uref);
      const av = (s.data()?.availability ?? {}) as {
        acceptsFillerPush?: boolean;
        fillerPushDay?: string;
        fillerPushCount?: number;
      };
      // Re-check opt-in on the FRESH doc — the candidate pool is cached up to a
      // few minutes, so a user who just toggled filler pushes off must not be
      // pushed on stale data.
      if (av.acceptsFillerPush !== true) return false;
      const used = av.fillerPushDay === todayKey ? av.fillerPushCount ?? 0 : 0;
      if (used >= FILLER_DAILY_CAP) return false;
      tx.set(
        uref,
        { availability: { fillerPushDay: todayKey, fillerPushCount: used + 1 } },
        { merge: true },
      );
      return true;
    });
  } catch (err) {
    console.error('[reserveFillerPush] txn failed', uid, err);
    return false;
  }
}

async function runFillerPulseBatch(
  gameId: string,
): Promise<{ rescheduleInMs: number } | null> {
  const now = Date.now();
  const ref = db.collection('games').doc(gameId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const game = snap.data() as FillerGameDoc & {
    status?: string;
    startsAt?: number;
    title?: string;
    groupId?: string;
    city?: string;
  };

  // Stop conditions — re-checked every batch so a game that filled or
  // moved past the window between pulses is dropped immediately.
  if (game.acceptsFillers !== true) return null;
  if (game.status !== 'open') return null;
  const startsAt = typeof game.startsAt === 'number' ? game.startsAt : 0;
  if (!startsAt) return null;
  const lead = startsAt - now;
  if (lead <= PULSE_STOP_BEFORE_MS) return null; // too close to kickoff
  // A MANUAL admin "send to all" (chain marked manual) may run any time before
  // kickoff — admins asked to not be limited to the 12h window. The AUTOMATIC
  // sweep still defers games further than PULSE_MAX_LEAD_MS out; they enter the
  // pulse engine once inside the window.
  const chainSnap = await db.collection('fillerPulseChains').doc(gameId).get();
  const isManualChain =
    chainSnap.exists && (chainSnap.data() as { manual?: boolean }).manual === true;
  if (!isManualChain && lead > PULSE_MAX_LEAD_MS) return null; // too far out — sweep handles it

  const players = game.players ?? [];
  const maxPlayers = game.maxPlayers ?? 0;
  if (maxPlayers <= 0) return null;
  if (players.length >= maxPlayers) return null; // FULL → stop

  const city = typeof game.city === 'string' ? game.city.trim() : '';
  if (!city) return null;
  const gameCoords = await getCityCoords(city);

  // The game's own weekday + window — we only invite players who declared
  // they're free THEN, so the invite population matches the home-calendar
  // count (and we don't spam people about slots they never marked). Computed in
  // Asia/Jerusalem (the runtime clock is UTC, 2–3h off) so the window matches
  // the client, which set startsAt from the device's local wall clock.
  const gameIl = israelParts(startsAt);
  const gameWeekday = gameIl.weekday;
  const gameWindow = hourToAvailWindow(gameIl.hour);

  // Opted-in candidate pool — shared, cached snapshot (see getFillerCandidatePool).
  const candidateDocs = await getFillerCandidatePool();

  // Exclude community members and anyone already tied to the game.
  let memberSet = new Set<string>();
  if (game.groupId) {
    const gSnap = await db.collection('groups').doc(game.groupId).get();
    if (gSnap.exists) {
      const grp = gSnap.data() as {
        playerIds?: string[];
        adminIds?: string[];
        pendingPlayerIds?: string[];
      };
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
  const todayKey = fillerDayKey(now);

  // Build the eligible pool (geo + declared-availability match + not-member +
  // not-in-game + not-already-pushed + best-effort under daily cap), in RANDOM
  // order, capped at PULSE_BATCH. The daily cap is enforced AUTHORITATIVELY at
  // push time via a transaction (reserveFillerPush); the check here is only a
  // best-effort pre-filter off the cached snapshot to avoid needless txns.
  const eligibleUids: string[] = [];
  const pool = candidateDocs.slice();
  shuffleInPlace(pool);
  for (const userDoc of pool) {
    if (eligibleUids.length >= PULSE_BATCH) break;
    const uid = userDoc.id;
    if (memberSet.has(uid)) continue;
    if (inGame.has(uid)) continue;
    if (alreadyPushed[uid]) continue;

    const userData = userDoc.data() as {
      availability?: {
        homeCity?: string;
        homeCityLat?: number;
        homeCityLng?: number;
        availabilityRadiusKm?: number;
        cities?: string[];
        preferredCity?: string;
        preferredDays?: number[];
        preferredTimes?: string[];
        availabilitySlots?: Record<string, string[]> | null;
        fillerPushDay?: string;
        fillerPushCount?: number;
      };
    };
    const av = userData.availability ?? {};

    // Declared-availability match — only invite players free THIS weekday+window.
    // Prefers the precise per-day grid; falls back to legacy days×times (empty =
    // "any") so users who haven't re-saved keep matching exactly as before.
    if (!availabilityCovers(av, gameWeekday, gameWindow)) continue;

    // Best-effort daily-cap pre-filter (authoritative check is in the txn).
    const usedToday = av.fillerPushDay === todayKey ? av.fillerPushCount ?? 0 : 0;
    if (usedToday >= FILLER_DAILY_CAP) continue;

    const userCity = av.homeCity ?? av.preferredCity ?? av.cities?.[0];
    if (!userCity) continue;
    const radiusKm =
      typeof av.availabilityRadiusKm === 'number' && av.availabilityRadiusKm > 0
        ? av.availabilityRadiusKm
        : DEFAULT_AVAIL_RADIUS_KM;
    let withinRange = false;
    if (
      gameCoords &&
      typeof av.homeCityLat === 'number' &&
      typeof av.homeCityLng === 'number'
    ) {
      withinRange =
        haversineKm({ lat: av.homeCityLat, lng: av.homeCityLng }, gameCoords) <=
        radiusKm;
    } else {
      withinRange = normaliseCityKey(userCity) === normaliseCityKey(city);
    }
    if (!withinRange) continue;

    eligibleUids.push(uid);
  }

  // Pool exhausted for now → stop. The scheduled sweep is the safety net
  // if new candidates opt in or move into range later.
  if (eligibleUids.length === 0) return null;

  const newlyPushed: Record<string, number> = {};
  for (const uid of eligibleUids) {
    // Reserve a daily-cap slot ATOMICALLY. Overlapping batches (or a
    // re-delivered task) can't push the same recipient past FILLER_DAILY_CAP
    // because the read-check-increment runs inside one transaction. On a full
    // cap or a txn error, reserve() returns false and we skip the push.
    const reserved = await reserveFillerPush(uid, todayKey);
    if (!reserved) continue;
    await createNotificationOnce({
      type: 'fillerOpportunity',
      recipientId: uid,
      payload: {
        gameId,
        groupId: game.groupId,
        gameTitle: game.title,
        startsAt: game.startsAt,
        city,
        shortBy: maxPlayers - players.length,
      },
    });
    newlyPushed[uid] = now;
  }

  // Every eligible candidate was capped (or reservation failed) → nothing was
  // pushed. Stop rather than reschedule forever on an un-pushable pool.
  if (Object.keys(newlyPushed).length === 0) return null;

  // Persist dedup history + grant the pushed users read access to the game
  // (same as the sweep — the games read rule honours invitedUserIds so the
  // push always reaches the "הגש מועמדות" CTA).
  const pushedUids = Object.keys(newlyPushed);
  await ref.set(
    {
      fillerPushHistory: { ...alreadyPushed, ...newlyPushed },
      invitedUserIds: admin.firestore.FieldValue.arrayUnion(...pushedUids),
      updatedAt: now,
    },
    { merge: true },
  );

  // We pushed at least one — schedule another batch. The next run re-checks
  // all stop conditions, so a filled / exhausted / out-of-window game halts
  // on its own.
  return { rescheduleInMs: PULSE_INTERVAL_MS };
}

// Cloud Task: run a pulse batch, then self-reschedule until done.
export const fillerPulseTask = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 6 },
  },
  async (req) => {
    const gameId = (req.data as { gameId?: string } | undefined)?.gameId;
    if (!gameId) return;
    // No PULSE_ENGINE_ENABLED gate here — the flag only controls the AUTOMATIC
    // on-creation pulse (maybeStartFillerPulse). A chain that's already running
    // (auto, once enabled, OR a manual admin "send to all") should complete.
    // NOTE: we deliberately do NOT swallow errors here — a throw lets
    // onTaskDispatched retry per retryConfig instead of silently killing the
    // self-rescheduling chain. runFillerPulseBatch already catches its own
    // per-recipient txn errors, so only genuinely transient failures propagate.
    const res = await runFillerPulseBatch(gameId);
    if (res?.rescheduleInMs) {
      await getGcpFunctions()
        .taskQueue('fillerPulseTask')
        .enqueue(
          { gameId },
          { scheduleTime: new Date(Date.now() + res.rescheduleInMs) },
        );
    } else {
      // Chain finished (full / exhausted / out-of-window / terminal) → drop the
      // create-once marker so fillerPulseChains doesn't grow unbounded.
      try {
        await db.collection('fillerPulseChains').doc(gameId).delete();
      } catch {
        /* best-effort cleanup */
      }
    }
  },
);

// Kick off a pulse for a freshly-created game when it wants fillers and is
// imminent enough. Called from onGameCreatedAlert. Games created further
// than PULSE_MAX_LEAD_MS out are left to the scheduled sweep, which picks
// them up once they enter the 3–12h window.
async function maybeStartFillerPulse(
  gameId: string,
  g: {
    acceptsFillers?: boolean;
    status?: string;
    startsAt?: number;
    players?: string[];
    maxPlayers?: number;
  },
): Promise<void> {
  if (!PULSE_ENGINE_ENABLED) return; // master switch — off on prod until enabled
  if (g.acceptsFillers !== true) return;
  if (g.status && g.status !== 'open') return;
  const startsAt = typeof g.startsAt === 'number' ? g.startsAt : 0;
  if (!startsAt) return;
  const lead = startsAt - Date.now();
  if (lead <= PULSE_STOP_BEFORE_MS || lead > PULSE_MAX_LEAD_MS) return;
  const players = g.players ?? [];
  const maxPlayers = g.maxPlayers ?? 0;
  if (maxPlayers <= 0 || players.length >= maxPlayers) return;
  // Create-once marker: the creation trigger is at-least-once, so a duplicate
  // delivery must NOT fork a second (permanent, self-rescheduling) pulse
  // chain. `.create()` throws ALREADY_EXISTS if a chain is already running.
  try {
    await db
      .collection('fillerPulseChains')
      .doc(gameId)
      .create({ startedAt: Date.now() });
  } catch {
    return; // a chain already exists for this game
  }
  try {
    await getGcpFunctions()
      .taskQueue('fillerPulseTask')
      // Small delay lets the creation transaction settle before the first read.
      .enqueue({ gameId }, { scheduleTime: new Date(Date.now() + 15 * 1000) });
  } catch (err) {
    console.error('[maybeStartFillerPulse] enqueue failed', gameId, err);
    // Roll back the marker so the chain isn't permanently blocked — the sweep
    // (or a later trigger) can still start it.
    try {
      await db.collection('fillerPulseChains').doc(gameId).delete();
    } catch {
      /* best-effort */
    }
  }
}

// Manual "send to everyone available, in pulses" — an admin triggers the pulse
// engine for a game on demand (from the game's invite screen). Unlike the
// automatic on-creation pulse (maybeStartFillerPulse, gated by
// PULSE_ENGINE_ENABLED), this is an explicit admin action, so it always runs.
// Returns a structured result the client maps to a friendly message.
export const startGameFillerPulse = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    const gameId = (request.data as { gameId?: string } | undefined)?.gameId;
    if (!gameId) throw new HttpsError('invalid-argument', 'gameId required');

    const ref = db.collection('games').doc(gameId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'game not found');
    const game = snap.data() as {
      createdBy?: string;
      groupId?: string;
      status?: string;
      startsAt?: number;
      players?: string[];
      maxPlayers?: number;
      acceptsFillers?: boolean;
      city?: string;
    };

    // Authorize: game creator OR a community admin.
    let isAdmin = game.createdBy === uid;
    if (!isAdmin && game.groupId) {
      const grp = (
        await db.collection('groups').doc(game.groupId).get()
      ).data() as { adminIds?: string[] } | undefined;
      isAdmin = (grp?.adminIds ?? []).includes(uid);
    }
    if (!isAdmin) throw new HttpsError('permission-denied', 'admins only');

    // Preconditions → structured reasons (client shows a friendly message).
    if (game.status && game.status !== 'open') return { started: false, reason: 'GAME_NOT_OPEN' };
    if (!game.city) return { started: false, reason: 'NO_CITY' };
    const startsAt = typeof game.startsAt === 'number' ? game.startsAt : 0;
    const lead = startsAt - Date.now();
    if (!startsAt || lead <= PULSE_STOP_BEFORE_MS) return { started: false, reason: 'TOO_LATE' };
    // No upper-bound (12h) gate on the MANUAL pulse — admins can send to all
    // available players any time before kickoff. The chain is marked `manual`
    // below so runFillerPulseBatch also bypasses the 12h window when sending.
    const players = game.players ?? [];
    const maxPlayers = game.maxPlayers ?? 0;
    if (maxPlayers > 0 && players.length >= maxPlayers) return { started: false, reason: 'GAME_FULL' };

    // Make sure the engine will accept fillers for this game.
    if (game.acceptsFillers !== true) {
      await ref.set({ acceptsFillers: true, updatedAt: Date.now() }, { merge: true });
    }
    // Create-once marker + enqueue the first batch. If a chain is already
    // running (auto or a prior manual tap), report that instead of forking.
    try {
      await db
        .collection('fillerPulseChains')
        .doc(gameId)
        .create({ startedAt: Date.now(), manual: true });
    } catch {
      return { started: true, alreadyRunning: true };
    }
    try {
      await getGcpFunctions()
        .taskQueue('fillerPulseTask')
        .enqueue({ gameId }, { scheduleTime: new Date(Date.now() + 2000) });
    } catch (err) {
      console.error('[startGameFillerPulse] enqueue failed', gameId, err);
      await db.collection('fillerPulseChains').doc(gameId).delete().catch(() => undefined);
      throw new HttpsError('internal', 'could not start');
    }
    return { started: true };
  },
);

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

interface ShortageGameDoc {
  title?: string;
  status?: string;
  startsAt?: number;
  maxPlayers?: number;
  minPlayers?: number;
  format?: string; // '<n>v<n>', n = players per team (3-11)
  numberOfTeams?: number;
  players?: string[];
  guests?: unknown[];
  groupId?: string;
  createdBy?: string;
  shortageWarningSentAt?: number;
}

function playersPerTeamForFormat(format: string | undefined): number {
  // Mirrors teamSizeFromFormat in src/types — "<n>v<n>", n players PER TEAM.
  // The if/else ladder this replaces stopped at 7v7 and fell through to 5 for
  // anything else, so an 8v8 game would have had its rounds sized as 5v5.
  const n = parseInt(String(format ?? ''), 10);
  return Number.isFinite(n) && n >= 3 && n <= 11 ? n : 5;
}

async function runSendShortageWarnings(): Promise<void> {
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
    const g = doc.data() as ShortageGameDoc;
    if (!g.createdBy) continue;
    if (g.shortageWarningSentAt) continue;
    const registered = (g.players?.length ?? 0) + (g.guests?.length ?? 0);
    // Shortage threshold: can't fill TWO teams in the configured
    // format. That's the minimum to actually play a match; below
    // it the admin almost certainly wants to cancel.
    const perTeam = playersPerTeamForFormat(g.format);
    const required = perTeam * 2;
    if (registered >= required) continue;
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
      await doc.ref.set(
        { shortageWarningSentAt: now, updatedAt: now },
        { merge: true },
      );
      pushed += 1;
    } catch (err) {
      console.error(
        '[shortageWarnings] dispatch failed',
        doc.id,
        err,
      );
    }
  }
  console.log(
    `[shortageWarnings] scanned ${snap.size} games, pushed ${pushed}`,
  );
}

export const onFillerInterestCreated = onDocumentCreated(
  'games/{gameId}/fillerInterests/{uid}',
  async (event) => {
    const data = event.data?.data() as
      | { status?: string; userId?: string }
      | undefined;
    if (!data) return;
    if (data.status !== 'pending') return;

    const gameId = event.params.gameId;
    const candidateUid = event.params.uid;

    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) return;
    const game = gameSnap.data() as {
      createdBy?: string;
      title?: string;
      groupId?: string;
    };
    const adminUid = game.createdBy;
    if (!adminUid) return;

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
  },
);

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

// ── availabilityCounts — powers the home "פנויים לשחק לידך" calendar ─────────
// For today + the next 6 days, count how many opted-in players are available in
// each time-window WITHIN THE CALLER'S radius and NOT already registered to a
// game in that window. Counts only — no identities leave the server (privacy).
// Reuses the same acceptsFillerPush pool + haversine as the filler matcher.
const AVAIL_WINDOWS = ['morning', 'noon', 'evening'] as const;
type AvailWindow = (typeof AVAIL_WINDOWS)[number];
function hourToAvailWindow(hour: number): AvailWindow {
  if (hour >= 7 && hour < 12) return 'morning'; // 07:00–11:59
  if (hour >= 12 && hour < 18) return 'noon'; // 12:00–17:59
  return 'evening'; // 18:00–06:59 (also absorbs the small hours)
}

/**
 * True if the user's declared availability covers (weekday, window). Prefers
 * the PRECISE per-day grid (`availabilitySlots`) when the user has one; falls
 * back to the legacy decoupled `preferredDays` × `preferredTimes` cross-product
 * (empty arrays = "any") so users who haven't re-saved keep matching EXACTLY as
 * before — no one's existing availability is broken by the grid rollout.
 */
function availabilityCovers(
  av: {
    availabilitySlots?: Record<string, string[]> | null;
    preferredDays?: number[];
    preferredTimes?: string[];
  },
  weekday: number | undefined,
  window: AvailWindow | null,
): boolean {
  const slots = av.availabilitySlots;
  const hasGrid =
    !!slots &&
    typeof slots === 'object' &&
    Object.values(slots).some((a) => Array.isArray(a) && a.length > 0);
  if (hasGrid) {
    if (weekday === undefined) return true; // no time anchor → don't exclude
    // Firestore serialises numeric keys as strings; read defensively.
    const daySlots =
      (slots as Record<string, string[]>)[String(weekday)] ??
      (slots as Record<string, string[]>)[weekday as unknown as string] ??
      [];
    if (daySlots.length === 0) return false; // nothing ticked that day
    if (!window) return true; // day matches, window unknown → allow
    return daySlots.includes(window);
  }
  // Legacy fallback — decoupled arrays, empty = "any".
  const pdays = Array.isArray(av.preferredDays) ? av.preferredDays : [];
  if (weekday !== undefined && pdays.length > 0 && !pdays.includes(weekday)) {
    return false;
  }
  const ptimes = Array.isArray(av.preferredTimes) ? av.preferredTimes : [];
  if (window && ptimes.length > 0 && !ptimes.includes(window)) return false;
  return true;
}

export const availabilityCounts = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');

    // Caller's home + radius. No coords → the client shows the "set location"
    // prompt instead of an empty grid.
    const meSnap = await db.collection('users').doc(uid).get();
    const me = (meSnap.data()?.availability ?? {}) as {
      homeCity?: string;
      preferredCity?: string;
      cities?: string[];
      homeCityLat?: number;
      homeCityLng?: number;
      availabilityRadiusKm?: number;
    };
    const radiusKm =
      typeof me.availabilityRadiusKm === 'number' && me.availabilityRadiusKm > 0
        ? me.availabilityRadiusKm
        : DEFAULT_AVAIL_RADIUS_KM;
    // The caller's own city — threaded into the quick-game prefill so a game
    // opened from the calendar has a city, without which the pulse engine
    // (which geocodes game.city) would invite nobody.
    const viewerCity =
      (me.homeCity ?? me.preferredCity ?? me.cities?.[0] ?? '').trim() || null;
    if (typeof me.homeCityLat !== 'number' || typeof me.homeCityLng !== 'number') {
      return { radiusKm, hasLocation: false, viewerCity, days: [] };
    }
    const myLoc = { lat: me.homeCityLat, lng: me.homeCityLng };

    // Build today..+6 at Asia/Jerusalem local midnight (the runtime clock is
    // UTC, 2–3h off, so raw setHours(0) would give the wrong day boundary). Each
    // weekday appears exactly once in a 7-day span → weekday → dayIndex is clean.
    const nowMs = Date.now();
    const todayMidnight = israelMidnight(nowMs);
    const days = Array.from({ length: 7 }, (_, i) => {
      // Snap each day to its true Israel midnight — a +i*24h guess can drift an
      // hour across a DST boundary, so re-derive the local date for the guess.
      const dateMs = israelMidnight(todayMidnight + i * 86_400_000 + 3_600_000);
      return {
        dateMs,
        weekday: israelParts(dateMs).weekday,
        isToday: i === 0,
        windows: { morning: 0, noon: 0, evening: 0 } as Record<
          AvailWindow,
          number
        >,
      };
    });
    const weekdayToIndex = new Map<number, number>();
    days.forEach((d, i) => weekdayToIndex.set(d.weekday, i));

    // Who's ALREADY registered to a game in each (dayIndex, window) — so a
    // committed player isn't counted as free. Keyed `${dayIndex}:${window}`.
    const rangeStart = days[0].dateMs;
    const rangeEnd = days[6].dateMs + 26 * 3_600_000; // past the last local day
    const gamesSnap = await db
      .collection('games')
      .where('startsAt', '>=', rangeStart)
      .where('startsAt', '<', rangeEnd)
      .get();
    const registered = new Map<string, Set<string>>();
    for (const g of gamesSnap.docs) {
      const gd = g.data() as {
        startsAt?: number;
        status?: string;
        players?: string[];
        participantIds?: string[];
      };
      if (gd.status === 'cancelled' || gd.status === 'finished') continue;
      const sa = gd.startsAt;
      if (typeof sa !== 'number') continue;
      const gil = israelParts(sa);
      const di = weekdayToIndex.get(gil.weekday);
      if (di === undefined) continue;
      const dayStart = days[di].dateMs;
      const dayEnd = di < 6 ? days[di + 1].dateMs : rangeEnd;
      if (sa < dayStart || sa >= dayEnd) continue; // exact local date
      const key = `${di}:${hourToAvailWindow(gil.hour)}`;
      let set = registered.get(key);
      if (!set) registered.set(key, (set = new Set<string>()));
      for (const p of [...(gd.players ?? []), ...(gd.participantIds ?? [])]) {
        set.add(p);
      }
    }

    // Candidate pool — opted-in users (matches who'd actually be pushable),
    // from the shared cached snapshot so the home screen doesn't re-scan the
    // whole collection on every load.
    const usersDocs = await getFillerCandidatePool();
    for (const u of usersDocs) {
      if (u.id === uid) continue;
      const a = (u.data().availability ?? {}) as {
        homeCityLat?: number;
        homeCityLng?: number;
        availabilityRadiusKm?: number;
        preferredDays?: number[];
        preferredTimes?: string[];
        availabilitySlots?: Record<string, string[]> | null;
      };
      if (typeof a.homeCityLat !== 'number' || typeof a.homeCityLng !== 'number') {
        continue;
      }
      // Filter by the VIEWER's radius — per the spec the calendar shows "players
      // available within MY radius", which also keeps the "רדיוס X ק״מ" chip
      // honest (it labels exactly this threshold). This is a deliberately
      // different lens from the pulse (which invites players whose OWN radius
      // reaches the game): the count is an approximate "who's around me" signal,
      // not a precise invite-count.
      if (haversineKm(myLoc, { lat: a.homeCityLat, lng: a.homeCityLng }) > radiusKm) {
        continue;
      }
      // Count every (day, window) the player is free in — via availabilityCovers
      // so the PRECISE per-day grid is honoured, and legacy days×times still
      // behaves as "empty = any". Mirrors the pulse candidate filter exactly, so
      // the count reflects the same population that would actually be invited.
      for (const d of days) {
        const di = weekdayToIndex.get(d.weekday);
        if (di === undefined) continue;
        for (const w of AVAIL_WINDOWS) {
          if (!availabilityCovers(a, d.weekday, w)) continue;
          if (registered.get(`${di}:${w}`)?.has(u.id)) continue; // already playing
          days[di].windows[w] += 1;
        }
      }
    }

    return { radiusKm, hasLocation: true, viewerCity, days };
  },
);

export const submitFillerInterest = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required');
    }
    const uid = auth.uid;
    const data = (request.data ?? {}) as { gameId?: string };
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    if (!gameId) {
      throw new HttpsError('invalid-argument', 'gameId required');
    }

    // Validate game state. The candidate may have taken minutes /
    // hours to tap the push — meanwhile the game might have filled
    // up, been cancelled, or the admin disabled fillers.
    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) {
      throw new HttpsError('not-found', 'game not found');
    }
    const game = gameSnap.data() as {
      status?: string;
      acceptsFillers?: boolean;
      players?: string[];
      waitlist?: string[];
      pending?: string[];
      groupId?: string;
      maxPlayers?: number;
      startsAt?: number;
    };
    if (game.acceptsFillers !== true) {
      throw new HttpsError(
        'failed-precondition',
        'game is not accepting fillers',
      );
    }
    if (game.status !== 'open') {
      throw new HttpsError(
        'failed-precondition',
        'game is no longer open',
      );
    }
    if (
      typeof game.startsAt === 'number' &&
      game.startsAt < Date.now()
    ) {
      throw new HttpsError(
        'failed-precondition',
        'game already started',
      );
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
        const grp = grpSnap.data() as {
          playerIds?: string[];
          adminIds?: string[];
        };
        if (
          (grp.playerIds ?? []).includes(uid) ||
          (grp.adminIds ?? []).includes(uid)
        ) {
          throw new HttpsError(
            'failed-precondition',
            'community members should join the regular way',
          );
        }
      }
    }
    const inGame =
      (game.players ?? []).includes(uid) ||
      (game.waitlist ?? []).includes(uid) ||
      (game.pending ?? []).includes(uid);
    if (inGame) {
      throw new HttpsError('already-exists', 'already in this game');
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
    if (
      existing.exists &&
      (existing.data() as { status?: string }).status === 'pending'
    ) {
      await interestRef.set(
        { updatedAt: Date.now() },
        { merge: true },
      );
      return { ok: true, alreadyPending: true };
    }

    await interestRef.set({
      userId: uid,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
);

export const approveFiller = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required');
    }
    const callerUid = auth.uid;
    const data = (request.data ?? {}) as {
      gameId?: string;
      candidateUid?: string;
    };
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const candidateUid =
      typeof data.candidateUid === 'string' ? data.candidateUid : '';
    if (!gameId || !candidateUid) {
      throw new HttpsError(
        'invalid-argument',
        'gameId and candidateUid required',
      );
    }

    // Run the entire roster mutation inside a transaction so two
    // concurrent admin approvals can't both push the roster past
    // maxPlayers, and the interest doc + game doc stay in sync.
    // Captured out of the transaction so the push below tells the truth
    // (was hardcoded to 'players' even when the approve landed on waitlist).
    let landedInPlayers = false;
    await db.runTransaction(async (tx) => {
      const gameRef = db.collection('games').doc(gameId);
      const interestRef = gameRef
        .collection('fillerInterests')
        .doc(candidateUid);

      const gameSnap = await tx.get(gameRef);
      if (!gameSnap.exists) {
        throw new HttpsError('not-found', 'game not found');
      }
      const game = gameSnap.data() as {
        status?: string;
        groupId?: string;
        createdBy?: string;
        players?: string[];
        waitlist?: string[];
        pending?: string[];
        participantIds?: string[];
        maxPlayers?: number;
      };

      // Authorization: caller must be the game's creator OR an
      // admin of the parent community. We need to read the group
      // doc to check adminIds — outside the per-game transaction
      // scope is fine since adminIds rarely changes during a
      // single write.
      let isAuthorized = game.createdBy === callerUid;
      if (!isAuthorized && game.groupId) {
        const grpSnap = await tx.get(
          db.collection('groups').doc(game.groupId),
        );
        if (grpSnap.exists) {
          const grp = grpSnap.data() as { adminIds?: string[] };
          if ((grp.adminIds ?? []).includes(callerUid)) {
            isAuthorized = true;
          }
        }
      }
      if (!isAuthorized) {
        throw new HttpsError(
          'permission-denied',
          'caller is not the game admin',
        );
      }

      if (game.status !== 'open') {
        throw new HttpsError(
          'failed-precondition',
          'game is no longer open',
        );
      }

      const players = game.players ?? [];
      const waitlist = game.waitlist ?? [];
      const maxPlayers = game.maxPlayers ?? 0;
      // Idempotency: if the candidate is already in players, just
      // make sure the interest is marked approved and exit.
      if (players.includes(candidateUid)) {
        tx.set(
          interestRef,
          { status: 'approved', updatedAt: Date.now() },
          { merge: true },
        );
        return;
      }
      if (waitlist.includes(candidateUid)) {
        tx.set(
          interestRef,
          { status: 'approved', updatedAt: Date.now() },
          { merge: true },
        );
        return;
      }

      // Decide bucket: players if there's room, otherwise waitlist.
      // Occupancy must count ACTIVE guests and a live promotion offer — not
      // just players.length — or approving a filler would over-fill past
      // maxPlayers when guests/an offer already hold the remaining seats
      // (audit #19; same fix as adminAddPlayers / reconcileGameJoins).
      const gameCap = game as {
        guests?: Array<{ waitlisted?: boolean }>;
        pendingPromotion?: { uid?: string };
      };
      const activeGuests = Array.isArray(gameCap.guests)
        ? gameCap.guests.filter((x) => !x?.waitlisted).length
        : 0;
      const offerHeld = gameCap.pendingPromotion?.uid ? 1 : 0;
      const occupancy = players.length + activeGuests + offerHeld;
      const goesToPlayers = maxPlayers > 0 && occupancy < maxPlayers;
      landedInPlayers = goesToPlayers;
      const newPlayers = goesToPlayers
        ? [...players, candidateUid]
        : players;
      const newWaitlist = goesToPlayers
        ? waitlist
        : [...waitlist, candidateUid];
      // Maintain the participantIds invariant (denormalised union
      // of all three rosters) so the existing rule guards still
      // hold on subsequent self-cancel writes by this candidate.
      const newParticipants = Array.from(
        new Set([
          ...newPlayers,
          ...newWaitlist,
          ...(game.pending ?? []),
        ]),
      );

      tx.update(gameRef, {
        players: newPlayers,
        waitlist: newWaitlist,
        participantIds: newParticipants,
        updatedAt: Date.now(),
      });
      tx.set(
        interestRef,
        {
          status: 'approved',
          bucket: goesToPlayers ? 'players' : 'waitlist',
          approvedAt: Date.now(),
          approvedBy: callerUid,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    });

    // Push the candidate so they know they're in. Fire-and-forget
    // outside the transaction.
    try {
      await createNotificationOnce({
        type: 'approved',
        recipientId: candidateUid,
        payload: {
          gameId,
          // The approved-handler in `buildMessage` reads `bucket` and renders
          // a different body for waitlist vs players — use the ACTUAL bucket
          // the transaction assigned (was hardcoded 'players', so a filler
          // approved onto a full game's waitlist got a false "you're in").
          bucket: landedInPlayers ? 'players' : 'waitlist',
        },
        createdByUid: callerUid,
      });
    } catch (err) {
      console.warn('[approveFiller] notif dispatch failed', err);
    }

    return { ok: true };
  },
);

export const declineFiller = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign-in required');
    }
    const callerUid = auth.uid;
    const data = (request.data ?? {}) as {
      gameId?: string;
      candidateUid?: string;
    };
    const gameId = typeof data.gameId === 'string' ? data.gameId : '';
    const candidateUid =
      typeof data.candidateUid === 'string' ? data.candidateUid : '';
    if (!gameId || !candidateUid) {
      throw new HttpsError(
        'invalid-argument',
        'gameId and candidateUid required',
      );
    }

    // Auth check: same as approveFiller.
    const gameSnap = await db.collection('games').doc(gameId).get();
    if (!gameSnap.exists) {
      throw new HttpsError('not-found', 'game not found');
    }
    const game = gameSnap.data() as {
      groupId?: string;
      createdBy?: string;
    };
    let isAuthorized = game.createdBy === callerUid;
    if (!isAuthorized && game.groupId) {
      const grpSnap = await db
        .collection('groups')
        .doc(game.groupId)
        .get();
      if (grpSnap.exists) {
        const grp = grpSnap.data() as { adminIds?: string[] };
        if ((grp.adminIds ?? []).includes(callerUid)) {
          isAuthorized = true;
        }
      }
    }
    if (!isAuthorized) {
      throw new HttpsError(
        'permission-denied',
        'caller is not the game admin',
      );
    }

    await db
      .collection('games')
      .doc(gameId)
      .collection('fillerInterests')
      .doc(candidateUid)
      .set(
        {
          status: 'rejected',
          rejectedAt: Date.now(),
          rejectedBy: callerUid,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    // No push to the candidate — quiet rejection.
    return { ok: true };
  },
);

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

export const onFriendRequestCreated = onDocumentCreated(
  'friendRequests/{rid}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const req = snap.data() as {
      fromUserId?: string;
      toUserId?: string;
      status?: string;
    };
    if (!req?.fromUserId || !req?.toUserId || req.status !== 'pending') return;
    // Canonical sender name read server-side — the recipient's push can
    // never carry a spoofed display name.
    let fromName = 'שחקן';
    try {
      const u = await db.collection('users').doc(req.fromUserId).get();
      const n = u.exists ? (u.data() as { name?: string }).name : '';
      if (typeof n === 'string' && n.length > 0) fromName = n;
    } catch {
      /* best-effort */
    }
    await createNotificationOnce({
      type: 'friendRequest',
      recipientId: req.toUserId,
      payload: { fromUserId: req.fromUserId, fromName },
      createdByUid: req.fromUserId,
    });
  },
);

export const acceptFriendRequest = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid; // the accepter (= request.toUserId)
    const fromUserId = String(
      (request.data as { fromUserId?: string })?.fromUserId || '',
    );
    if (!fromUserId || fromUserId === uid) {
      throw new HttpsError('invalid-argument', 'bad fromUserId');
    }
    const reqRef = db.collection('friendRequests').doc(`${fromUserId}__${uid}`);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) {
      throw new HttpsError('not-found', 'request not found');
    }
    const req = reqSnap.data() as { toUserId?: string; status?: string };
    if (req.toUserId !== uid) {
      throw new HttpsError('permission-denied', 'not your request');
    }
    if (req.status === 'declined') {
      throw new HttpsError('failed-precondition', 'request was declined');
    }
    const now = Date.now();
    const batch = db.batch();
    batch.set(reqRef, { status: 'accepted', updatedAt: now }, { merge: true });
    batch.set(
      db.collection('users').doc(uid),
      {
        friends: admin.firestore.FieldValue.arrayUnion(fromUserId),
        updatedAt: now,
      },
      { merge: true },
    );
    batch.set(
      db.collection('users').doc(fromUserId),
      {
        friends: admin.firestore.FieldValue.arrayUnion(uid),
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();
    // Push the original sender that their request was accepted.
    let accepterName = 'שחקן';
    try {
      const u = await db.collection('users').doc(uid).get();
      const n = u.exists ? (u.data() as { name?: string }).name : '';
      if (typeof n === 'string' && n.length > 0) accepterName = n;
    } catch {
      /* best-effort */
    }
    await createNotificationOnce({
      type: 'friendRequestAccepted',
      recipientId: fromUserId,
      payload: { fromUserId: uid, fromName: accepterName },
      createdByUid: uid,
    });
    return { ok: true };
  },
);

export const removeFriendship = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const otherUserId = String(
      (request.data as { otherUserId?: string })?.otherUserId || '',
    );
    if (!otherUserId || otherUserId === uid) {
      throw new HttpsError('invalid-argument', 'bad otherUserId');
    }
    const now = Date.now();
    const batch = db.batch();
    batch.set(
      db.collection('users').doc(uid),
      {
        friends: admin.firestore.FieldValue.arrayRemove(otherUserId),
        updatedAt: now,
      },
      { merge: true },
    );
    batch.set(
      db.collection('users').doc(otherUserId),
      {
        friends: admin.firestore.FieldValue.arrayRemove(uid),
        updatedAt: now,
      },
      { merge: true },
    );
    // Clear any lingering request docs in either direction so a future
    // re-friend starts clean. Deleting a missing doc is a no-op.
    batch.delete(db.collection('friendRequests').doc(`${uid}__${otherUserId}`));
    batch.delete(db.collection('friendRequests').doc(`${otherUserId}__${uid}`));
    await batch.commit();
    return { ok: true };
  },
);

// ─── Callable: invite app-friends to an existing community ─────────────
//
// The caller (a member or admin of the group) picks friends from their
// friends list; each is added to `pendingPlayerIds` and receives a
// `groupInvitation` push. Server-side guards: caller must belong to the
// group, and only the caller's actual friends who aren't already in the
// group are invited (so this can't be used to spam strangers).
export const inviteFriendsToGroup = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'sign in required');
    }
    const uid = request.auth.uid;
    const data = request.data as { groupId?: string; friendIds?: string[] };
    const groupId = String(data?.groupId || '');
    const friendIds = Array.isArray(data?.friendIds)
      ? data.friendIds.filter((x): x is string => typeof x === 'string')
      : [];
    if (!groupId || friendIds.length === 0) {
      throw new HttpsError('invalid-argument', 'groupId + friendIds required');
    }
    const groupRef = db.collection('groups').doc(groupId);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) {
      throw new HttpsError('not-found', 'group not found');
    }
    const g = groupSnap.data() as {
      name?: string;
      adminIds?: string[];
      playerIds?: string[];
      pendingPlayerIds?: string[];
      isOpen?: boolean;
      maxMembers?: number;
    };
    // Authorization: only APPROVED members (admins + players) may invite —
    // NOT someone merely sitting in pendingPlayerIds. Before, a user could
    // self-add to a closed group's pending queue and immediately invite their
    // friends into it, acting as an inviter for a community they hadn't joined.
    const approvedMembers = new Set([
      ...(g.adminIds || []),
      ...(g.playerIds || []),
    ]);
    if (!approvedMembers.has(uid)) {
      throw new HttpsError('permission-denied', 'not a member of this group');
    }
    // For the "already in group" exclusion below, pending counts too (don't
    // re-invite someone with a request already in flight).
    const members = new Set([
      ...approvedMembers,
      ...(g.pendingPlayerIds || []),
    ]);
    const inviterSnap = await db.collection('users').doc(uid).get();
    const inviterData = inviterSnap.data() as {
      friends?: string[];
      name?: string;
    } | undefined;
    const inviterFriends = new Set(inviterData?.friends || []);
    const inviterName =
      typeof inviterData?.name === 'string' && inviterData.name.length > 0
        ? inviterData.name
        : 'חבר';
    // Only real friends who aren't already in the group.
    const toInvite = friendIds.filter(
      (fid) => inviterFriends.has(fid) && !members.has(fid),
    );
    // Enforce the community's member cap. The old cap (200 − pendingCount) both
    // used a fixed 200 and measured the WRONG array (pending) for open groups —
    // where invitees land straight in playerIds — so an open club could be
    // pushed well past maxMembers, after which the admin could no longer edit it
    // (GROUP_MAX_BELOW_CURRENT). Count everyone already in the community and cap
    // by maxMembers (hard-limited to 500 for the gRPC/arrayUnion safety) (#8).
    const maxMembers =
      typeof g.maxMembers === 'number' && g.maxMembers > 0
        ? Math.min(g.maxMembers, 500)
        : 500;
    const currentCount =
      (g.playerIds?.length || 0) + (g.pendingPlayerIds?.length || 0);
    const room = Math.max(0, maxMembers - currentCount);
    const accepted = toInvite.slice(0, room);
    if (accepted.length === 0) return { invited: 0 };
    // OPEN community → add invitees straight to playerIds (they'd auto-join
    // anyway). Dropping them into pendingPlayerIds instead created membership
    // drift (a user could end up in BOTH lists once they self-joined) and made
    // admins get a bogus "wants to join" push for a member's invitee.
    await groupRef.set(
      {
        [g.isOpen ? 'playerIds' : 'pendingPlayerIds']:
          admin.firestore.FieldValue.arrayUnion(...accepted),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    await Promise.all(
      accepted.map((fid) =>
        createNotificationOnce({
          type: 'groupInvitation',
          recipientId: fid,
          payload: {
            groupId,
            groupName: g.name || '',
            inviterName,
            inviterId: uid,
          },
          createdByUid: uid,
        }),
      ),
    );
    return { invited: accepted.length };
  },
);

// ─── Founder real-time alerts ─────────────────────────────────────────────
// Event-driven FCM pushes to the founder's Pulse device(s). Each respects the
// per-type on/off toggle in adminConfig/prefs (server-side — see adminPush.ts).

// "מישהו נרשם!" — the instant a /users doc is created.
export const onNewUserJoined = onDocumentCreated('users/{uid}', async (event) => {
  const user = event.data?.data() as { name?: string } | undefined;
  if (!user) return;
  const uid = event.params.uid;
  const name =
    user.name && user.name !== 'משתמש שהוסר' ? user.name : 'משתמש חדש';

  // Attribution is written by SEPARATE client updates ~1-3s after signup
  // (applyInviteAttributionIfFresh / applyAcquisitionIfFresh), so neither is
  // on the doc at create time. Poll briefly to catch a referrer (`invitedBy`)
  // or a campaign-link (`acquisition.campaign`), exiting as soon as one lands
  // (organic signups just wait out the window).
  let inviterId: string | undefined;
  let campaign: string | undefined;
  let linkId: string | undefined;
  let source: string | undefined;
  for (const waitMs of [3000, 5000, 6000]) {
    await new Promise((r) => setTimeout(r, waitMs));
    const d = (await db.collection('users').doc(uid).get()).data();
    const v = d?.invitedBy;
    if (typeof v === 'string' && v && v !== uid) inviterId = v;
    const acq = d?.acquisition as
      | { campaign?: string; linkId?: string; source?: string }
      | undefined;
    if (acq?.campaign && typeof acq.campaign === 'string') campaign = acq.campaign;
    if (acq?.linkId && typeof acq.linkId === 'string') linkId = acq.linkId;
    if (acq?.source && typeof acq.source === 'string') source = acq.source;
    if (inviterId || campaign || linkId) break;
  }

  // Build the "via" suffix. A tracked Pulse link (carries a `linkId`) wins —
  // show its friendly name ("דרך קישור מגרשי כדורגל") rather than a person,
  // because these installs came from a distribution link we created, not a
  // personal invite. Then a personal referral, then a bare campaign/source.
  let via = '';
  if (linkId) {
    let linkName: string | null = null;
    try {
      const link = (await db.collection('adLinks').doc(linkId).get()).data();
      const n = link?.name;
      if (typeof n === 'string' && n.trim()) linkName = n.trim();
    } catch {
      // ignore — fall back to the source token decoded from the link
    }
    if (!linkName && source) linkName = source;
    via = linkName ? ` · דרך קישור ${linkName}` : ' · דרך קישור';
  } else if (inviterId) {
    try {
      const inv = (await db.collection('users').doc(inviterId).get()).data();
      const invName =
        inv?.name && inv.name !== 'משתמש שהוסר' ? (inv.name as string) : null;
      via = invName ? ` · דרך ${invName}` : ' · דרך הזמנה';
    } catch {
      via = ' · דרך הזמנה';
    }
  } else if (campaign) {
    via = ` · דרך קמפיין ${campaign}`;
  } else if (source) {
    via = ` · דרך קישור ${source}`;
  }

  await pushToAdmins(
    'newUser',
    'Teamder',
    `מישהו נרשם לאפליקציה! 🎉 (${name})${via}`,
    { uid },
  );
});

// ── Founder activity alerts: game/community create + join ──
// All honor the per-type toggle in adminConfig/prefs (Pulse Settings).
async function adminAlertUserName(uid: string): Promise<string> {
  try {
    const d = await admin.firestore().collection('users').doc(uid).get();
    const n = (d.data() as { name?: string } | undefined)?.name;
    return n && n !== 'משתמש שהוסר' ? n : 'מישהו';
  } catch {
    return 'מישהו';
  }
}

export const onGameCreatedAlert = onDocumentCreated('games/{id}', async (event) => {
  const g = event.data?.data() as
    | {
        createdBy?: string;
        title?: string;
        acceptsFillers?: boolean;
        status?: string;
        startsAt?: number;
        players?: string[];
        maxPlayers?: number;
      }
    | undefined;
  if (!g) return;
  const who = g.createdBy ? await adminAlertUserName(g.createdBy) : 'מישהו';
  await pushToAdmins('gameCreate', 'Teamder', `${who} יצר משחק חדש ⚽`, { id: event.params.id });
  // If the new game wants fillers and is imminent, start the pulse-invite
  // engine so nearby available players get invited right away.
  await maybeStartFillerPulse(event.params.id, g);
});

export const onGameJoinedAlert = onDocumentUpdated('games/{id}', async (event) => {
  const before = event.data?.before.data() as Record<string, unknown> | undefined;
  const after = event.data?.after.data() as Record<string, unknown> | undefined;
  if (!before || !after) return;
  const arr = (d: Record<string, unknown>): string[] => [
    ...((d.players as string[] | undefined) ?? []),
    ...((d.participantIds as string[] | undefined) ?? []),
  ];
  const had = new Set(arr(before));
  const added = [...new Set(arr(after))].filter((u) => !had.has(u));
  if (!added.length) return;
  const who = await adminAlertUserName(added[0]);
  const extra = added.length > 1 ? ` +${added.length - 1}` : '';
  // Name the game so the alert says WHICH game was joined. Titled (quick)
  // games carry `title`; community games fall back to the field/location,
  // then a generic "משחק".
  const gameTitle = typeof after.title === 'string' ? after.title.trim() : '';
  const gameField = typeof after.fieldName === 'string' ? after.fieldName.trim() : '';
  const gameLabel = gameTitle || gameField || 'משחק';
  await pushToAdmins(
    'gameJoin',
    'Teamder',
    `${who}${extra} נרשם ל${gameLabel} 🙋`,
    { id: event.params.id },
  );
});

export const onCommunityCreatedAlert = onDocumentCreated('groups/{id}', async (event) => {
  const grp = event.data?.data() as
    | { isPersonal?: boolean; name?: string; creatorId?: string; adminIds?: string[] }
    | undefined;
  if (!grp || grp.isPersonal === true) return; // skip personal/orphan groups
  const owner = grp.creatorId ?? grp.adminIds?.[0];
  const who = owner ? await adminAlertUserName(owner) : 'מישהו';
  await pushToAdmins('communityCreate', 'Teamder', `${who} יצר מועדון: ${grp.name ?? ''} 🏟️`, { id: event.params.id });
});

export const onCommunityJoinedAlert = onDocumentUpdated('groups/{id}', async (event) => {
  const before = event.data?.before.data() as { playerIds?: string[] } | undefined;
  const after = event.data?.after.data() as { playerIds?: string[]; name?: string } | undefined;
  if (!before || !after) return;
  const had = new Set(before.playerIds ?? []);
  const added = (after.playerIds ?? []).filter((u) => !had.has(u));
  if (!added.length) return;
  const who = await adminAlertUserName(added[0]);
  const extra = added.length > 1 ? ` +${added.length - 1}` : '';
  await pushToAdmins('communityJoin', 'Teamder', `${who}${extra} הצטרף למועדון ${after.name ?? ''} 👥`, { id: event.params.id });
});

// Stamp the real join / admin-promotion dates on the group as members and
// admins are ADDED, so the per-community player timeline can show "הצטרף
// למועדון" / "מונה למנהל" with an accurate date. Runs server-side (Admin SDK,
// bypasses rules) so it covers EVERY membership path — including the open-
// community self-join whose security rule only permits touching `playerIds`.
//
// Idempotent + loop-safe: only fills a MISSING entry (never overwrites), and
// writes nothing when there's nothing new — so the write it makes doesn't
// re-trigger itself into a loop (the second pass finds the uid already in the
// previous `playerIds`, so it's not "newly added", and the entry already set).
export const stampMembershipDates = onDocumentUpdated('groups/{id}', async (event) => {
  const before = event.data?.before.data() as
    | { playerIds?: string[]; adminIds?: string[] }
    | undefined;
  const after = event.data?.after.data() as
    | {
        playerIds?: string[];
        adminIds?: string[];
        joinedAt?: Record<string, number>;
        adminSince?: Record<string, number>;
      }
    | undefined;
  if (!before || !after) return;

  const now = Date.now();
  const existingJoined = after.joinedAt ?? {};
  const existingAdmin = after.adminSince ?? {};
  // Write ONLY the newly-added keys via dotted field paths, so a concurrent
  // write to a sibling key isn't clobbered by a whole-map overwrite (lost
  // update). Field-path updates merge into the map.
  const patch: Record<string, number> = {};

  const hadPlayers = new Set(before.playerIds ?? []);
  for (const uid of after.playerIds ?? []) {
    if (!hadPlayers.has(uid) && existingJoined[uid] === undefined) {
      patch[`joinedAt.${uid}`] = now;
    }
  }
  const hadAdmins = new Set(before.adminIds ?? []);
  for (const uid of after.adminIds ?? []) {
    if (!hadAdmins.has(uid) && existingAdmin[uid] === undefined) {
      patch[`adminSince.${uid}`] = now;
    }
  }
  if (Object.keys(patch).length === 0) return;
  await event.data!.after.ref.update(patch);
});

// Founder alert: a user updated their availability (days / times / city /
// invitable). Event-driven — fires only on THIS user's write, so NO scan and
// NO Firestore reads on the common no-op path (it compares the before/after
// snapshots it already has and early-returns when availability is unchanged).
export const onAvailabilityUpdated = onDocumentUpdated('users/{uid}', async (event) => {
  const before = event.data?.before.data() as
    | { availability?: Record<string, unknown> }
    | undefined;
  const after = event.data?.after.data() as
    | { availability?: Record<string, unknown>; name?: string }
    | undefined;
  if (!before || !after) return;
  const a = after.availability;
  if (!a || typeof a !== 'object') return;
  // Signature only the MEANINGFUL fields (ignore coords/noise) so an unrelated
  // profile write (lastActive, stats…) never triggers a spurious alert.
  const sig = (x: Record<string, unknown> | undefined): string => {
    const o = x ?? {};
    return JSON.stringify({
      d: (o.preferredDays as unknown[]) ?? [],
      t: (o.preferredTimes as unknown[]) ?? [],
      c: o.homeCity ?? '',
      inv: o.isAvailableForInvites,
      af: o.acceptsFillerPush,
    });
  };
  if (sig(before.availability) === sig(a)) return;
  const who =
    after.name && after.name !== 'משתמש שהוסר' ? after.name : 'מישהו';
  const days = Array.isArray(a.preferredDays)
    ? (a.preferredDays as unknown[]).length
    : 0;
  const daysTxt = days > 0 ? ` (${days} ימים)` : '';
  const city =
    typeof a.homeCity === 'string' && a.homeCity ? ` · ${a.homeCity}` : '';
  await pushToAdmins(
    'availabilityUpdate',
    'Teamder',
    `${who} עדכן זמינות${daysTxt}${city} 🗓️`,
    { uid: event.params.uid },
  );
});

// New ERROR signature — /errors is fingerprint-aggregated, so onCreate fires
// only on a genuinely new kind of failure (not every repeat occurrence).
export const onErrorLogged = onDocumentCreated('errors/{fp}', async (event) => {
  const e = event.data?.data() as
    | { title?: string; category?: string; operation?: string; lastScreen?: string }
    | undefined;
  if (!e) return;
  const emoji =
    e.category === 'crash' ? '💥' : e.category === 'silent' ? '⚠️' : '❌';
  const title = e.title || e.operation || 'שגיאה';
  const where = e.lastScreen ? ` · ${e.lastScreen}` : '';
  await pushToAdmins('error', `${emoji} שגיאה חדשה`, `${title}${where}`, {
    fp: event.params.fp,
  });
});

// Admin push campaign created in Pulse → send immediately if due (future-
// dated ones wait for the cron sweep). Rate-limited + idempotent inside.
export const onCampaignCreated = onDocumentCreated(
  'campaigns/{id}',
  async (event) => {
    await processCampaign(event.params.id, Date.now());
  },
);

// Engagement reporting — the app calls this when a push is tapped or a
// popup is shown / clicked / dismissed. Increments campaigns/{id}.metrics.*
// so Pulse can show received-vs-clicked per campaign. Append-only counters;
// a signed-in user can only nudge a count up, never read or alter campaigns.
export const trackCampaignEvent = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'sign in required');
    const campaignId = request.data?.campaignId;
    const event = request.data?.event;
    if (typeof campaignId !== 'string' || typeof event !== 'string') {
      throw new HttpsError('invalid-argument', 'campaignId + event required');
    }
    await recordCampaignMetric(campaignId, event);
    return { ok: true };
  },
);

// Public click beacon for tracked share links. The /go landing page fires
// a fire-and-forget fetch here on load, so we count CLICKS (people who
// tapped the link + reached the page) independently of installs. Keyed by
// the link id `l` when present (per-link), else by source `s` (per-source).
// Public, READ-ONLY landing-page preview. Resolves a short invite CODE (never
// a raw gameId) to a strictly-whitelisted, non-personal summary so the landing
// page can show real game/community context. Returns ONLY: title, date/time,
// city/field, community name, status, free spots (game) or name/city/cover/
// member-count (community). NEVER player names, uids, phones, participants,
// notes, or admin data. Any invalid code / deleted target / error → { type:
// 'generic' } so the page falls back to the generic Teamder version.
export const getInvitePreview = onRequest(
  { region: 'us-central1', memory: '256MiB', cors: true },
  async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    try {
      const code =
        typeof req.query.code === 'string' ? req.query.code.trim() : '';
      if (!code) {
        res.json({ type: 'generic' });
        return;
      }
      const linkSnap = await db.collection('inviteLinks').doc(code).get();
      if (!linkSnap.exists) {
        res.json({ type: 'generic' });
        return;
      }
      const link = linkSnap.data() as {
        type?: string;
        targetId?: string;
        invitedBy?: string;
      };
      const targetId =
        typeof link.targetId === 'string' ? link.targetId : '';
      const inviterId =
        typeof link.invitedBy === 'string' ? link.invitedBy : '';

      if (link.type === 'session' && targetId) {
        const g = await db.collection('games').doc(targetId).get();
        const d = g.exists ? (g.data() as Record<string, unknown>) : null;
        if (!d) {
          res.json({ type: 'generic' });
          return;
        }
        const players = Array.isArray(d.players) ? d.players.length : 0;
        const guests = Array.isArray(d.guests)
          ? (d.guests as Array<{ canceled?: boolean; waitlisted?: boolean }>)
              .filter((x) => !x?.canceled && !x?.waitlisted).length
          : 0;
        const held = (d.pendingPromotion as { uid?: string })?.uid ? 1 : 0;
        const maxPlayers =
          typeof d.maxPlayers === 'number' ? d.maxPlayers : 0;
        const occ = players + guests + held;
        // Also carry the parent community so the landing page can gracefully
        // fall back to "join the community" when THIS game has already passed
        // (a finished/cancelled/past game shouldn't be pitched as joinable —
        // the community usually has a fresh upcoming instance).
        let communityName: string | undefined;
        let communityId: string | undefined;
        let communityCity: string | undefined;
        let communityMembersCount: number | undefined;
        if (typeof d.groupId === 'string' && d.groupId) {
          const gp = await db
            .collection('groupsPublic')
            .doc(d.groupId)
            .get();
          const gpd = gp.exists
            ? (gp.data() as { name?: string; city?: string; memberCount?: number })
            : undefined;
          if (gpd && typeof gpd.name === 'string') {
            communityName = gpd.name;
            communityId = d.groupId;
            if (typeof gpd.city === 'string') communityCity = gpd.city;
            if (typeof gpd.memberCount === 'number')
              communityMembersCount = gpd.memberCount;
          }
        }
        res.json({
          type: 'game',
          id: targetId, // lets the page deep-link to THIS game (footy://session/<id>)
          gameTitle: typeof d.title === 'string' ? d.title : undefined,
          startsAt: typeof d.startsAt === 'number' ? d.startsAt : undefined,
          fieldName: typeof d.fieldName === 'string' ? d.fieldName : undefined,
          city: typeof d.city === 'string' ? d.city : undefined,
          communityName,
          communityId,
          communityCity,
          communityMembersCount,
          status: typeof d.status === 'string' ? d.status : undefined,
          maxPlayers: maxPlayers > 0 ? maxPlayers : undefined,
          availableSpots:
            maxPlayers > 0 ? Math.max(0, maxPlayers - occ) : undefined,
        });
        return;
      }

      if (link.type === 'team' && targetId) {
        const gp = await db.collection('groupsPublic').doc(targetId).get();
        const d = gp.exists
          ? (gp.data() as Record<string, unknown>)
          : null;
        if (!d) {
          res.json({ type: 'generic' });
          return;
        }
        res.json({
          type: 'community',
          id: targetId, // deep-link to THIS community (footy://team/<id>)
          communityName: typeof d.name === 'string' ? d.name : undefined,
          city: typeof d.city === 'string' ? d.city : undefined,
          communityCover:
            typeof d.coverUrl === 'string' ? d.coverUrl : undefined,
          communityMembersCount:
            typeof d.memberCount === 'number' ? d.memberCount : undefined,
        });
        return;
      }

      // Personal invite (app-type link that carries an inviter) → return the
      // inviter's display NAME only (no uid/phone), so the hero can say
      // "{name} הזמין אותך". Safe: name is public-facing display text.
      if ((link.type === 'app' || !link.type) && inviterId) {
        let inviterName: string | undefined;
        try {
          const u = await db.collection('users').doc(inviterId).get();
          const un = u.exists ? (u.data() as { name?: string }).name : undefined;
          if (typeof un === 'string' && un.trim()) inviterName = un.trim();
        } catch {
          /* name is optional */
        }
        res.json({ type: 'personal', inviterName });
        return;
      }

      // app/go/unknown → generic; the page shows the universal Teamder version.
      res.json({ type: 'generic' });
    } catch {
      // Never leak an internal error — degrade to the generic page.
      res.json({ type: 'generic' });
    }
  },
);

export const trackLinkClick = onRequest(
  { region: 'us-central1', memory: '256MiB', cors: true },
  async (req, res) => {
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
        await db.collection('adLinks').doc(l).set(
          { clicks: inc, lastClickAt: now }, { merge: true },
        );
      } else if (s) {
        // Old links with no id — bucket clicks by source.
        await db.collection('linkClicks').doc(s).set(
          { clicks: inc, lastClickAt: now }, { merge: true },
        );
      }
      // Independent of l/s: a personal link's inviter click is always counted.
      if (inviter) {
        await db.collection('inviteClicks').doc(inviter).set(
          { clicks: inc, lastClickAt: now }, { merge: true },
        );
      }
      // Cross-source daily aggregate so the dashboard can show clicks by
      // today / yesterday / this week (the per-link `clicks` fields are running
      // totals with no history). One click = one request = one bump. Attributed
      // to the inviter (personal link) or the ad link/source (campaign).
      await bumpLinkClickAggregate(db, now, {
        inviterId: inviter || undefined,
        linkId: l || undefined,
        source: s || undefined,
        kind: l || s ? 'ad' : 'invite',
      });
    } catch {
      /* best-effort beacon — never error the user's redirect */
    }
    res.set('Cache-Control', 'no-store');
    res.status(204).send('');
  },
);

/**
 * Cross-source link-click aggregate at `metrics/linkClicks`:
 *   • `total`            — all-time running count (seeded once from the existing
 *                          per-link counters via a backfill).
 *   • `days.<YYYY-MM-DD>` — per-day count, keyed in Israel time so the
 *                          dashboard's "today"/"yesterday" match the operator's
 *                          clock. Only NEW clicks (from deploy onward) populate
 *                          the daily map; `total` stays accurate historically.
 */
// Attribution for a single click — who/what the link belongs to. Drives the
// per-day per-link breakdown the dashboard uses for "top link today + whose".
interface LinkClickAttribution {
  inviterId?: string; // a person's link (invitedBy uid) — takes precedence
  code?: string; // /i/<code> short-link id (when no inviter)
  linkId?: string; // ad link id (l=)
  source?: string; // legacy source bucket (s=)
  kind?: string; // 'invite' | 'ad'
}

// Canonical, map-safe key identifying the link for the daily breakdown.
// Preference: person > short-code > ad-link > source. Sanitised so it's always
// a valid Firestore map key (Firestore map keys can't be empty or contain
// `.`, `/`, `~`, `*`, `[`, `]`).
function linkAggKey(a: LinkClickAttribution): string {
  const clean = (s: string) => s.replace(/[.\/~*[\]]/g, '_').slice(0, 120);
  if (a.inviterId) return `u:${clean(a.inviterId)}`;
  if (a.code) return `c:${clean(a.code)}`;
  if (a.linkId) return `l:${clean(a.linkId)}`;
  if (a.source) return `s:${clean(a.source)}`;
  return '';
}

async function bumpLinkClickAggregate(
  db: FirebaseFirestore.Firestore,
  now: number,
  attribution?: LinkClickAttribution,
): Promise<void> {
  const inc = admin.firestore.FieldValue.increment(1);
  const dayKey = new Date(now).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Jerusalem',
  }); // → "YYYY-MM-DD"
  // NOTE: nested `days: { [dayKey]: inc }` — NOT `{ [`days.${dayKey}`]: inc }`.
  // In set(..., {merge:true}) a key is a LITERAL field name, so a dotted key
  // creates a flat top-level field "days.2026-07-16" instead of a nested map,
  // and the per-day breakdown (today/yesterday/week) reads empty. The nested
  // object form merges into the `days` map, bumping only that day's sub-field.
  // Per-day, per-link breakdown → dashboard "🔥 top link today + whose".
  // Stored as nested fields INSIDE this same doc (not a separate per-day doc):
  //   byDayLinks.<dayKey>.<linkKey> = count
  //   byDayMeta.<dayKey>.<linkKey>  = { kind, inviterId?, code?, linkId?, source? }
  // The previous `db.doc('metrics/linkClicksByDay/<day>')` was a 3-segment path
  // (odd) → the Admin SDK treats it as a COLLECTION and throws; the best-effort
  // catch swallowed it, so nothing was ever written. Keeping it in this doc also
  // means the dashboard reads it from the same fetch it already does.
  const doc: Record<string, unknown> = {
    total: inc,
    days: { [dayKey]: inc },
    lastClickAt: now,
  };
  if (attribution) {
    const key = linkAggKey(attribution);
    if (key) {
      const meta: Record<string, unknown> = { kind: attribution.kind ?? 'link' };
      if (attribution.inviterId) meta.inviterId = attribution.inviterId;
      if (attribution.code) meta.code = attribution.code;
      if (attribution.linkId) meta.linkId = attribution.linkId;
      if (attribution.source) meta.source = attribution.source;
      doc.byDayLinks = { [dayKey]: { [key]: inc } };
      doc.byDayMeta = { [dayKey]: { [key]: meta } };
    }
  }
  await db.doc('metrics/linkClicks').set(doc, { merge: true });
}

// User feedback — bug report / feature suggestion (separate toggles).
export const onFeedbackSubmitted = onDocumentCreated(
  'feedback/{id}',
  async (event) => {
    const f = event.data?.data() as
      | { type?: string; message?: string; userName?: string }
      | undefined;
    if (!f) return;
    const isBug = f.type !== 'suggestion';
    const label = isBug ? '🐛 דיווח על תקלה' : '💡 הצעה לשיפור';
    const body =
      (f.userName ? f.userName + ': ' : '') + (f.message || '').slice(0, 140);
    await pushToAdmins(isBug ? 'bug' : 'suggestion', label, body || 'דיווח חדש', {
      id: event.params.id,
    });
  },
);

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

async function runSweep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[cron] sweep "${label}" failed`, err);
  }
}

// ── Persistent, race-free "run this at most every N hours" ──────────────────
//
// A sweep that should fire once a day rides an HOURLY dispatcher, so something
// has to say "not yet". That something cannot be a module-level variable: Cloud
// Functions instances are created, recycled and run in parallel, so an
// in-memory counter resets on every cold start and is not shared between
// instances — a "once per 20 hours" sweep written that way runs as often as the
// dispatcher ticks, on whichever instance happens to be cold. (That is exactly
// what `lastActivitySweep` did — audit P1-5.)
//
// It also cannot be a plain read-then-write on a marker document: two
// dispatcher ticks landing together both read the old timestamp, both decide
// they are due, and the sweep runs twice. The claim has to be atomic, so the
// timestamp is read AND advanced inside one transaction — whoever commits it
// owns this window, and everyone else is told to stand down.
//
// The claim is staked BEFORE the work runs, deliberately. A sweep that dies
// half-way waits for the next window instead of being retried immediately by
// the next tick: every one of these sweeps is idempotent and self-healing on
// the following run, and a delete-heavy job looping on failure is the worse
// outcome.
async function claimCronWindow(name: string, dueAfterMs: number): Promise<boolean> {
  const ref = db.collection('cronMeta').doc(name);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const lastRunAt = (snap.exists ? (snap.data()?.lastRunAt as number) : 0) ?? 0;
      const now = Date.now();
      if (typeof lastRunAt === 'number' && now - lastRunAt < dueAfterMs) return false;
      tx.set(ref, { lastRunAt: now, claimedBy: process.env.K_REVISION ?? null }, { merge: true });
      return true;
    });
  } catch (err) {
    // A contended transaction that cannot commit means someone else claimed the
    // window. Not being due is the safe answer.
    console.warn(`[cron] could not claim window "${name}"`, err);
    return false;
  }
}

/** Run `fn` only if its window is due, claiming it atomically first. */
async function runIfDue(name: string, dueAfterMs: number, fn: () => Promise<void>): Promise<void> {
  if (!(await claimCronWindow(name, dueAfterMs))) return;
  await fn();
}

// dailyCleanup was its own `every 24 hours` job. Folded into the hourly
// dispatcher but gated by a Firestore marker so the (delete-heavy) sweep
// still fires at most once per ~23h instead of every hour.
async function runDailyCleanupIfDue(): Promise<void> {
  await runIfDue('dailyCleanup', 23 * 60 * 60 * 1000, runDailyCleanup);
}

// Every 5 minutes — latency-sensitive game-state transitions.
export const cronEvery5Min = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Asia/Jerusalem' },
  async () => {
    await runSweep('flipScheduledGames', runFlipScheduledGames);
    await runSweep('flipPublicGames', runFlipPublicGames);
    // Series-driven fixtures first; the legacy game-to-game clone then runs
    // only for recurring games that have no series yet.
    await runSweep('createSeriesOccurrences', runCreateSeriesOccurrences);
    await runSweep('cloneRecurringGames', runCloneRecurringGames);
    await runSweep('scheduledAutoGenerateTeams', runScheduledAutoGenerateTeams);
    await runSweep('expireStaleOffers', runExpireStaleOffers);
    await runSweep('sweepDueCampaigns', () => sweepDueCampaigns(Date.now()));
  },
);

// Every 15 minutes — reminders, nudges, shortage + filler matching.
// Carries findFillerCandidates' heavier runtime budget (was 512MiB / 540s).
export const cronEvery15Min = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Jerusalem',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [ASC_P8, PLAY_SA],
  },
  async () => {
    await runSweep('sendGameReminders', runSendGameReminders);
    await runSweep('sendRsvpNudges', runSendRsvpNudges);
    await runSweep('sendShortageWarnings', runSendShortageWarnings);
    await runSweep('sendRateReminders', runSendRateReminders);
    await runSweep('findFillerCandidates', runFindFillerCandidates);
    // Near-real-time store-review alerts → FCM to the founder's Pulse.
    await runSweep('reviewAlerts', () =>
      runReviewAlerts(ASC_P8.value(), PLAY_SA.value()),
    );
  },
);

// Every 60 minutes — cleanup, promote prompts, and the gated daily sweep.
/**
 * Club activity counters for the communities feed.
 *
 * The card shows פעיל / פעיל מאוד / לא פעיל, and the only honest source is
 * games the club actually PLAYED. The client can't compute this: a non-member
 * cannot read /groups/{id} at all, let alone its games — correctly, because a
 * club's fixtures are private. So the counts are derived here and denormalised
 * onto the PUBLIC projection.
 *
 * Only two integers are published. Not dates, not titles, not headcounts —
 * "how active" is exactly what the badge claims and nothing more leaks.
 *
 * Counted by KICKOFF time (`startsAt`), not by when the game was created: a
 * fixture opened in January for a March match is March's activity. Only
 * `finished` games count — an opened game nobody turned up to isn't activity.
 */
const ACTIVITY_30 = 30 * 24 * 60 * 60 * 1000;
const ACTIVITY_60 = 60 * 24 * 60 * 60 * 1000;

async function runClubActivitySweep(): Promise<void> {
  const now = Date.now();
  // ONE range query over the last 60 days, then grouped in memory. Per-club
  // queries would be N reads for a feed that is read constantly.
  const snap = await db
    .collection('games')
    .where('startsAt', '>=', now - ACTIVITY_60)
    .get();

  const per = new Map<string, { d30: number; d60: number }>();
  for (const doc of snap.docs) {
    const g = doc.data() as { groupId?: string; startsAt?: number; status?: string };
    if (g.status !== 'finished') continue;
    const gid = typeof g.groupId === 'string' ? g.groupId : '';
    const at = typeof g.startsAt === 'number' ? g.startsAt : 0;
    if (!gid || at <= 0 || at > now) continue;
    const row = per.get(gid) ?? { d30: 0, d60: 0 };
    row.d60 += 1;
    if (at >= now - ACTIVITY_30) row.d30 += 1;
    per.set(gid, row);
  }

  // Every club with a public projection gets written, INCLUDING the ones with
  // no games — otherwise a club that goes quiet keeps yesterday's "פעיל" badge
  // forever, which is worse than saying nothing.
  const pubs = await db.collection('groupsPublic').select().get();
  let batch = db.batch();
  let n = 0;
  for (const p of pubs.docs) {
    const row = per.get(p.id) ?? { d30: 0, d60: 0 };
    batch.set(
      p.ref,
      { gamesLast30: row.d30, gamesLast60: row.d60, activityAt: now },
      { merge: true },
    );
    if (++n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`[clubActivity] ${pubs.size} clubs, ${per.size} with games`);
}

/** Once a day is plenty — an activity badge does not need to be live.
 *
 *  This used to throttle on a module-level `lastActivitySweep` variable. In a
 *  serverless runtime that is not a throttle at all: the value dies with the
 *  instance and is not shared across the instances the dispatcher may fan out
 *  to, so a sweep meant to run once per 20 hours ran on every cold start —
 *  potentially hourly, each time rewriting `gamesLast30`/`gamesLast60` across
 *  every public club. Now it claims the window in Firestore, atomically, the
 *  same way dailyCleanup does. */
async function runClubActivityIfDue(): Promise<void> {
  await runIfDue('clubActivity', 20 * 60 * 60 * 1000, runClubActivitySweep);
}

export const cronEvery60Min = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Jerusalem',
    // The default is 60 seconds, and this job now contains the season sweep —
    // the only unattended path in the app that destroys production data. A
    // close is a transaction per player plus a transaction per pair plus a
    // batch of titles; for a sixty-player club that is comfortably past a
    // minute, and being killed halfway is exactly the half-closed state the
    // resume path exists to recover from. Better not to need it.
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    await runSweep('cleanupStaleGames', runCleanupStaleGames);
    await runSweep('sendPromotePrompts', runSendPromotePrompts);
    await runSweep('holidayGameNotices', runHolidayGameNotices);
    await runSweep('dailyCleanup', runDailyCleanupIfDue);
    await runSweep('clubActivity', runClubActivityIfDue);
    await runSweep('seasonRollovers', runSeasonRollovers);
  },
);

/**
 * Which of my friends are in these clubs.
 *
 * The card wants "3 חברים שלך כאן" on clubs the user has NOT joined — and that
 * is exactly where the client is blind: /groups/{id} is readable only by its
 * own members, so `playerIds` is out of reach for every club this could apply
 * to. Resolved here with the Admin SDK instead of loosening that rule.
 *
 * Returns only friends' names and avatars, and only for clubs the caller is
 * NOT in. Nothing about the club's roster beyond the caller's own friends
 * crosses the wire.
 */
export const getFriendsInClubs = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
    const ids = (request.data?.groupIds ?? []) as unknown;
    const groupIds = Array.isArray(ids)
      ? ids.filter((x): x is string => typeof x === 'string' && !!x).slice(0, 30)
      : [];
    if (groupIds.length === 0) return { clubs: {} };

    const me = await db.collection('users').doc(uid).get();
    const friends = ((me.data()?.friends ?? []) as unknown[]).filter(
      (x): x is string => typeof x === 'string' && !!x,
    );
    if (friends.length === 0) return { clubs: {} };
    const friendSet = new Set(friends);

    const groups = await db.getAll(
      ...groupIds.map((g) => db.collection('groups').doc(g)),
    );
    const wanted = new Set<string>();
    const perClub = new Map<string, string[]>();
    for (const g of groups) {
      const d = g.data() as { playerIds?: string[]; adminIds?: string[] } | undefined;
      if (!d) continue;
      const members = new Set([...(d.playerIds ?? []), ...(d.adminIds ?? [])]);
      // The caller's own clubs are skipped: the card hides the friends row
      // there anyway, and this keeps the response to what it's for.
      if (members.has(uid)) continue;
      const hits = friends.filter((f) => members.has(f));
      if (hits.length === 0) continue;
      perClub.set(g.id, hits);
      hits.slice(0, 5).forEach((h) => wanted.add(h));
    }
    if (perClub.size === 0) return { clubs: {} };

    const profiles = await db.getAll(
      ...[...wanted].map((u) => db.collection('users').doc(u)),
    );
    const byId = new Map<string, { id: string; name: string; photoUrl?: string; avatarId?: string }>();
    for (const p of profiles) {
      const d = p.data() as { name?: string; photoUrl?: string; avatarId?: string } | undefined;
      if (!d || !friendSet.has(p.id)) continue;
      byId.set(p.id, {
        id: p.id,
        name: typeof d.name === 'string' ? d.name : '',
        ...(typeof d.photoUrl === 'string' ? { photoUrl: d.photoUrl } : {}),
        ...(typeof d.avatarId === 'string' ? { avatarId: d.avatarId } : {}),
      });
    }

    const clubs: Record<string, { total: number; friends: unknown[] }> = {};
    for (const [gid, hits] of perClub) {
      clubs[gid] = {
        total: hits.length,
        friends: hits.slice(0, 5).map((h) => byId.get(h)).filter(Boolean),
      };
    }
    return { clubs };
  },
);

/**
 * An admin's verdict on an evening the system closed with nothing to show.
 *
 * This is the ONLY way an 'unverified' evening leaves that state, and the only
 * question the app ever asks about whether a מחזור happened. It is not asked on
 * an ordinary close: ending the evening is already an answer, and so is a
 * timer, a goal or a committed round.
 *
 * A callable rather than a client write, because the rules deliberately forbid
 * every client update to a finished game (`resource.data.status != 'finished'`)
 * — the same reason addRetroGoal is one. Loosening that rule to let an app
 * write two fields onto a closed evening would open every other field on it.
 *
 * Crediting is NOT done here. Setting `playVerified: true` makes
 * `eveningPlayState` answer 'happened', and onGameRosterChanged is watching
 * exactly that transition — so confirming an evening runs the same attendance
 * credit, the same standings, the same summary and the same season progress
 * that an ordinary evening gets, through the same code, behind the same
 * `finishCredited` latch. One path, so a confirmed evening cannot be credited
 * differently from one that never needed asking.
 */
export const setEveningPlayed = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
    const { gameId, played } = (request.data ?? {}) as {
      gameId?: string;
      played?: boolean;
    };
    if (!gameId) throw new HttpsError('invalid-argument', 'gameId required');
    if (typeof played !== 'boolean') {
      throw new HttpsError('invalid-argument', 'played must be a boolean');
    }

    const ref = db.collection('games').doc(gameId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'game not found');
    const game = snap.data() as Record<string, unknown>;

    const groupId = typeof game.groupId === 'string' ? game.groupId : '';
    if (!groupId) {
      throw new HttpsError('failed-precondition', 'game has no community');
    }
    const grp = await db.collection('groups').doc(groupId).get();
    const admins = (grp.data()?.adminIds as string[] | undefined) ?? [];
    if (!admins.includes(uid)) {
      throw new HttpsError('permission-denied', 'community admin only');
    }
    // §12 — a closed season is closed to this too.
    //
    // Answering "did this evening happen" is the single most consequential
    // correction in the app: a "yes" credits the whole night's stats and adds
    // one to the season's round count, a "no" removes it from the club's
    // history. Doing either to an evening from a season that has already been
    // archived changes the RUNNING season's counters while the sealed archive
    // stays as it was — the two then disagree permanently, and the round count
    // that decides when the current season ends is off by one for ever.
    assertSeasonOpenForGame(grp.data(), game);

    // Read and write in ONE transaction.
    //
    // The check and the write used to straddle two network round-trips, which
    // is a real window on a screen two admins can both be looking at: the
    // second verdict would overwrite the first, and since a "no" deletes the
    // evening from the club's history for good, the loser of that race never
    // finds out. Inside a transaction the second call re-reads, sees the
    // question already answered, and changes nothing.
    const outcome = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return { changed: false, state: 'pending' as const };
      const cur = fresh.data() as Record<string, unknown>;
      const state = eveningPlayState(cur as PlayableEvening);
      // An evening already answered is left exactly as it is — a double tap is
      // not an error, and neither is arriving second.
      //
      // With ONE exception, and it is deliberately one-way. A mis-tapped "לא
      // התקיים" deletes a night from the club's history with no way back: the
      // rows are already excluded everywhere, and nothing in the app can ask
      // again. Letting an admin correct that to "כן" is safe precisely because
      // a "no" never credited anything — the confirmation runs the ordinary
      // credit path from a clean slate.
      //
      // The reverse is NOT allowed. Undoing a "yes" would mean taking back
      // attendance, standings, a sealed summary and a season's progress, and
      // the seal is written once and never recomputed. An admin who wants that
      // is asking for something this callable must not pretend to do.
      const correctingAMistap =
        state === 'notHappened' && cur.playVerified === false && played;
      if (state !== 'unverified' && !correctingAMistap) {
        return { changed: false, state };
      }
      tx.update(ref, {
        playVerified: played,
        playVerifiedBy: uid,
        playVerifiedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return {
        changed: true,
        state: played ? ('happened' as const) : ('notHappened' as const),
      };
    });
    return { ok: true, ...outcome };
  },
);

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
const isReal = (id: string) =>
  typeof id === 'string' &&
  id.length > 0 &&
  !id.startsWith(GUEST_PREFIX) &&
  !RAW_GUEST_RE.test(id);

export const commitRoundStats = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
    const {
      gameId,
      roundId,
      sideA,
      sideB,
      teamAIndex,
      teamBIndex,
      winnerSide,
      goals,
      penalties,
    } = (request.data ?? {}) as {
      gameId?: string;
      roundId?: number | string | null;
      sideA?: string[];
      sideB?: string[];
      // Bib-colour indices of the two sides (0=red,1=blue,2=green,…). Stored on
      // the round-history doc so the recap shows real colours, not א׳/ב׳.
      teamAIndex?: number;
      teamBIndex?: number;
      winnerSide?: 'A' | 'B' | 'tie';
      goals?: {
        scorerId?: string | null;
        assisterId?: string | null;
        ownGoal?: boolean;
        minute?: number;
        // The side that GETS the point (beneficiary) — mirrors the live score,
        // which increments this side unconditionally. Forwarded so own goals
        // (null scorer) and guest goals attribute to a team even though the
        // server can't derive it from side membership. Legacy clients omit it.
        team?: 'A' | 'B';
      }[];
      // Penalty-shootout kicks (kicker + keeper + scored). These credit ONLY
      // the penalty-specific stat fields — never goals/score (the shootout is a
      // tiebreaker, its kicks are not mini-game goals).
      penalties?: {
        kickerId?: string | null;
        keeperId?: string | null;
        scored?: boolean;
      }[];
    };
    if (!gameId || (winnerSide !== 'A' && winnerSide !== 'B' && winnerSide !== 'tie')) {
      throw new HttpsError('invalid-argument', 'gameId + winnerSide required');
    }
    const snap = await db.collection('games').doc(gameId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'game not found');
    const game = snap.data() as Record<string, unknown>;
    // Authorize: only the game creator or a community admin may commit stats.
    //
    // The club document is read ONCE and used twice — for the admin list and
    // for the closed-season guard below. It used to be fetched only when the
    // caller was not the creator; the guard needs it on every call, and
    // fetching it once here is cheaper than the alternative of reading it
    // again a few lines down.
    const groupId = game.groupId as string | undefined;
    const grpSnap = groupId
      ? await db.collection('groups').doc(groupId).get()
      : null;
    const grpData = grpSnap?.data();
    const isAdmin =
      game.createdBy === uid ||
      ((grpData?.adminIds as string[] | undefined) ?? []).includes(uid);
    if (!isAdmin) throw new HttpsError('permission-denied', 'admin only');

    // §12 — results cannot be written into a season that has been archived.
    //
    // The realistic route here is not an admin editing history; it is a RETRY.
    // A commit that failed on a phone with no signal sits in the client's
    // queue and goes out when the phone reconnects, which can be hours later
    // and on the far side of a season close. The archive is sealed by then, so
    // the mini-game's goals, wins and pair stats would land on the season that
    // opened after it — credited to players for a night played in a season
    // they are no longer in.
    if (grpData) assertSeasonOpenForGame(grpData, game);

    // Bind the credited sides to the game's ACTUAL registered roster. Without
    // this an admin of a throwaway game could name ANY uid on a side and
    // credit — or DEFAME — that person's GLOBAL profile stats. The same
    // roster guard addRetroGoal already applies. (Faking your OWN stats inside
    // your own real game is still possible; touching a non-participant's
    // numbers is not.) Goals/assists are filtered through onField below, so a
    // scorer/assister off the roster is dropped automatically.
    const roster = new Set<string>([
      ...((game.players as string[] | undefined) ?? []),
      ...((game.waitlist as string[] | undefined) ?? []),
    ]);
    // Build the sides deduped AND disjoint: a uid may appear at most once, and
    // never on both sides. Without this a duplicated/both-sides uid (a client
    // team-assignment bug or forged payload) was credited a WIN and a LOSS in
    // the same round, plus a self-pair (uid vs uid) polluting nemesis/duo.
    // Exclude players marked no-show: setArrival can flip a still-assigned player
    // to 'no_show' at any time, and the games-count / showcase already strip them
    // — so crediting them rounds/wins/goals here (while games:0 elsewhere) left a
    // self-contradictory table (rounds=3, games=0). Skip them on both sides; since
    // onField = A∪B gates goals/assists too, their stats drop out consistently.
    // Cap the goal log, the way `penalties` is already capped. It was
    // unbounded: every distinct ASSISTED pair adds a communityPairStats
    // document to the round batch, so a long (or forged) goals[] grew the
    // batch without limit — straight into the 500-op wall that cannot be
    // retried past. 60 is far beyond any real mini-game (the stored copy was
    // already sliced at 100; the busiest round in production is single digits).
    const MAX_GOALS_PER_ROUND = 60;
    const cappedGoals = (goals ?? []).slice(0, MAX_GOALS_PER_ROUND);
    const arrivals = (game.arrivals as Record<string, string> | undefined) ?? {};
    // Sides + the scorer-restoration rule, in ./roundSides so they can be
    // tested rather than trusted — see that file for why a substituted scorer
    // is put back rather than dropped.
    const { A, B, restored } = buildRoundSides({
      sideA: sideA ?? [],
      sideB: sideB ?? [],
      goals: cappedGoals,
      roster,
      arrivals,
      isReal,
    });
    if (restored.length) {
      console.log(
        `[round] restored ${restored.length} player(s) who scored or assisted ` +
          `and were no longer on a side: ${restored.join(', ')}`,
      );
    }
    // Bound the sides before anything is written. This batch holds
    // against-pairs (|A|×|B|) + same-team pairs + per-player tallies + the
    // latch, roughly 2n² + 15n, which crosses Firestore's 500-op ceiling
    // around n≈13 — and because the idempotency latch is IN the batch, a
    // commit that overflows cannot be retried past. Checked AFTER the
    // restoration, which is the only step that can grow a side.
    const MAX_SIDE = 11;
    if (A.length > MAX_SIDE || B.length > MAX_SIDE) {
      throw new HttpsError(
        'invalid-argument',
        `side too large (A=${A.length}, B=${B.length}, max ${MAX_SIDE})`,
      );
    }
    const onField = new Set<string>([...A, ...B]);
    // The game's registered guests (roster ids are `guest:<id>`). Used to
    // validate a guest actually belongs to THIS game before listing them / a
    // guest scorer before crediting — same anti-forgery guard `roster` gives
    // real players.
    const guestRoster = new Set<string>();
    for (const gg of (game.guests as { id?: string }[] | undefined) ?? []) {
      if (gg?.id) guestRoster.add(`guest:${gg.id}`);
    }
    // FULL display rosters (guests INCLUDED) — a guest is a full player in the
    // cycle, so "מי שיחק" in the match-history recap must show them. Kept
    // separate from A/B (real-only, for stat crediting). Same guards as A/B: a
    // real id must be on the game roster and not a no-show; a guest id must be a
    // registered guest of this game. Deduped + disjoint, capped for doc size.
    const okForDisplay = (id: string) =>
      isReal(id)
        ? roster.has(id) && arrivals[id] !== 'no_show'
        : guestRoster.has(id);
    // Same ceiling the stored roster was already sliced to. Enforced during
    // the BUILD now, not only on the stored copy, because every guest on a side
    // also costs one gamePlayerStats operation in the round batch — an
    // unbounded guest list was an unbounded batch.
    const MAX_DISPLAY_SIDE = 25;
    const fseen = new Set<string>();
    const fullA: string[] = [];
    const fullB: string[] = [];
    for (const id of sideA ?? []) {
      if (fullA.length >= MAX_DISPLAY_SIDE) break;
      if (typeof id === 'string' && id && !fseen.has(id) && okForDisplay(id)) { fseen.add(id); fullA.push(id); }
    }
    for (const id of sideB ?? []) {
      if (fullB.length >= MAX_DISPLAY_SIDE) break;
      if (typeof id === 'string' && id && !fseen.has(id) && okForDisplay(id)) { fseen.add(id); fullB.push(id); }
    }
    const inc = (n: number) => admin.firestore.FieldValue.increment(n);
    const now = Date.now();
    // ONE write per DOCUMENT, not one per stat. See functions/src/statBatch.ts:
    // a WriteBatch charges an operation for every set() even when several land
    // on the same row, and the old shape spent up to five ops on a single
    // player's gamePlayerStats. At 11-a-side with a full shootout that pushed
    // the total OVER Firestore's 500-op ceiling — an unrecoverable failure,
    // because the idempotency latch lives in this same batch, so every retry
    // fails identically and the round's stats are lost for good. Folding the
    // increments per document is arithmetically identical and makes the count
    // bounded and computable (asserted below before we commit).
    const sb = new StatBatch();
    const uRef = (id: string) => db.collection('users').doc(id);
    const cpsRef = (id: string) =>
      db.collection('communityPlayerStats').doc(`${groupId}__${id}`);
    const gpsRef = (id: string) =>
      db.collection('gamePlayerStats').doc(`${gameId}__${id}`);
    const pairKey = (x: string, y: string) => [x, y].sort().join('__');

    // Idempotency latch — record this round's commit marker via create() in the
    // same batch. A retry / partial-failure re-press (or an SDK auto-retry of a
    // timed-out call) commits the SAME goals + against-pairs again; the create
    // then fails ALREADY_EXISTS and the whole batch is rejected, so increments
    // never double-apply. Skipped only for legacy callers that send no roundId.
    if (roundId !== undefined && roundId !== null) {
      sb.create(
        db.collection('games').doc(gameId).collection('committedRounds').doc(String(roundId)),
        { committedAt: now, by: uid, winnerSide },
      );
    }

    // 1) goals → scorer.stats.goals + community tally
    const byScorer: Record<string, number> = {};
    for (const g of cappedGoals) {
      if (g.ownGoal || !g.scorerId || !isReal(g.scorerId)) continue;
      if (!onField.has(g.scorerId)) continue; // not on a playing side → skip
      byScorer[g.scorerId] = (byScorer[g.scorerId] ?? 0) + 1;
    }
    const totalGoalsThisRound = Object.values(byScorer).reduce((a, b) => a + b, 0);

    // 1b) GUEST goals → NOT credited to any real/community stat (guests have no
    // cross-cycle identity), but they DO earn a per-game scorer row (so the
    // finished-game table lists them) and feed the club "goals by guests"
    // counter. Own goals excluded (they belong to no one). Validated against the
    // game's guest roster so a forged guest id can't inflate the counter.
    const byGuest: Record<string, number> = {};
    for (const g of cappedGoals) {
      if (g.ownGoal || !g.scorerId || isReal(g.scorerId)) continue;
      if (!guestRoster.has(g.scorerId)) continue;
      byGuest[g.scorerId] = (byGuest[g.scorerId] ?? 0) + 1;
    }
    const guestGoalsThisRound = Object.values(byGuest).reduce((a, b) => a + b, 0);

    // 1c) OWN goals → credit the OWN-GOAL scorer (the player who put it into
    // their own net; on the CONCEDING team, so still on-field). NOT a striker
    // goal — a separate `ownGoals` stat. Real players only (a guest own-goal
    // just displays in history). Inverse of the byScorer guard (ownGoal only).
    const byOwnScorer: Record<string, number> = {};
    for (const g of cappedGoals) {
      if (!g.ownGoal || !g.scorerId || !isReal(g.scorerId)) continue;
      if (!onField.has(g.scorerId)) continue;
      byOwnScorer[g.scorerId] = (byOwnScorer[g.scorerId] ?? 0) + 1;
    }
    const totalOwnGoalsThisRound = Object.values(byOwnScorer).reduce((a, b) => a + b, 0);

    // ── Phase-2 evening-summary data (roundHistory + team goal split) ────────
    // Credited team goals per side → drives each player's per-evening
    // contribution% (their goals ÷ their team's goals). The actual mini-game
    // score (incl. own goals, which credit the OPPONENT) is stored separately
    // for roundHistory display / GF-GA.
    const creditedForSide = (side: string[]) =>
      side.reduce((s, id) => s + (byScorer[id] ?? 0), 0);
    const creditedA = creditedForSide(A);
    const creditedB = creditedForSide(B);
    // Stored round score = count each goal for its `team` (the beneficiary side
    // the client already used to move the live score). This is the ONLY way own
    // goals and guest goals count toward the stored score — deriving from a real
    // on-field scorer dropped both. Legacy payloads (no `team`) fall back to the
    // old scorer-side derivation so older app versions still store a score.
    let scoreA = 0;
    let scoreB = 0;
    for (const g of cappedGoals) {
      if (g.team === 'A') { scoreA++; continue; }
      if (g.team === 'B') { scoreB++; continue; }
      // Legacy (no team): real on-field scorer only; own goal credits the other.
      if (!g.scorerId || !isReal(g.scorerId) || !onField.has(g.scorerId)) continue;
      const onA = A.includes(g.scorerId);
      const onB = B.includes(g.scorerId);
      if (!onA && !onB) continue;
      const forA = g.ownGoal ? onB : onA;
      if (forA) scoreA++;
      else scoreB++;
    }
    // Build the round-history doc (written AFTER the stats batch commits — see
    // below). It is deliberately kept OUT of the atomic batch: (a) it would add
    // an op to a batch that is already near Firestore's 500-write cap for a full
    // 11-a-side round, and (b) an unbounded goals[] array could push the doc
    // toward the 1 MiB limit and abort the latched stats batch. The goal log is
    // length-capped for the same reason. It is a display convenience, not a
    // stat of record, so a rare write failure loses only summary richness.
    const roundHistoryDoc =
      roundId !== undefined && roundId !== null
        ? {
            roundId: String(roundId),
            // FULL rosters (guests included) so "מי שיחק" shows everyone who
            // played. Sliced for doc-size safety. (A/B — real only — remain the
            // basis for stat crediting above, not for this display roster.)
            teamA: fullA.slice(0, 25),
            teamB: fullB.slice(0, 25),
            // Bib-colour indices (0=red,1=blue,2=green,…) so the recap shows the
            // real colours. Default −1 → the client falls back to א׳/ב׳.
            teamAIndex: typeof teamAIndex === 'number' ? teamAIndex : -1,
            teamBIndex: typeof teamBIndex === 'number' ? teamBIndex : -1,
            scoreA,
            scoreB,
            winnerSide,
            // Store EVERY goal for the recap — real, guest AND own (null
            // scorer). A goal is kept if it carries a `team` (new payloads) or,
            // for legacy payloads, if it has a real on-field scorer. `team`
            // comes from the payload; legacy falls back to scorer-side.
            goals: cappedGoals
              .filter(
                (g) =>
                  g.team === 'A' ||
                  g.team === 'B' ||
                  (g.scorerId && isReal(g.scorerId) && onField.has(g.scorerId)),
              )
              .slice(0, 100)
              .map((g) => ({
                // null for own goals; the guest/real id otherwise.
                scorerId: g.scorerId ?? null,
                assisterId:
                  g.assisterId && isReal(g.assisterId) && onField.has(g.assisterId)
                    ? g.assisterId
                    : null,
                ownGoal: !!g.ownGoal,
                minute:
                  typeof g.minute === 'number' && g.minute > 0
                    ? Math.floor(g.minute)
                    : 0,
                team:
                  g.team === 'A' || g.team === 'B'
                    ? g.team
                    : A.includes(g.scorerId as string)
                      ? 'A'
                      : 'B',
              })),
            // Store EVERY kick for the recap — guests INCLUDED. This used to
            // gate on `isReal`, the rule for stat CREDITING, and reused it as
            // the rule for DOCUMENTATION: an evening whose shootouts were
            // taken by guests wrote an empty array, so the match-history screen
            // showed two 0:0 mini-games with "לא נרשמו גולים" and no trace that
            // penalties had happened at all (Eliran's report). Guests still earn
            // no penalty stats — that gating lives in the §1c loop below, which
            // reads the `penalties` INPUT, not this display array.
            //
            // `okForDisplay` is the same anti-forgery gate the roster uses, and
            // the side comes from `fullA` (guests included) — `A` is real-only,
            // so every guest kicker would have been labelled team B.
            penalties: (penalties ?? [])
              .filter((p) => p.kickerId && okForDisplay(p.kickerId))
              .slice(0, 100)
              .map((p) => ({
                kickerId: p.kickerId as string,
                keeperId:
                  p.keeperId && okForDisplay(p.keeperId) ? p.keeperId : null,
                scored: !!p.scored,
                team: fullA.includes(p.kickerId as string) ? 'A' : 'B',
              })),
            at: now,
          }
        : null;

    for (const [scorer, n] of Object.entries(byScorer)) {
      sb.bump(uRef(scorer), {}, { 'stats.goals': n });
      if (groupId)
        sb.bump(cpsRef(scorer), { groupId, userId: scorer, updatedAt: now }, { goals: n });
      // Per-GAME tally → drives the in-game championship (shown once the
      // game is finished). Same idempotent batch, so a retry can't double.
      sb.bump(gpsRef(scorer), { gameId, userId: scorer, updatedAt: now }, { goals: n });
    }

    // GUEST scorers get a per-GAME row ONLY (so the finished-game scorers table
    // lists them). Deliberately NOT written to users.stats / communityPlayerStats
    // — guests have no account and no cross-cycle identity, so they never join
    // the club's ranked table. `isGuest` marks the row so the read side can
    // resolve the name from game.guests instead of /users.
    for (const [guest, n] of Object.entries(byGuest)) {
      sb.bump(
        gpsRef(guest),
        { gameId, userId: guest, isGuest: true, updatedAt: now },
        { goals: n },
      );
    }

    // OWN-GOAL scorers → the `ownGoals` stat across the SAME three stores as a
    // normal goal (a dubious honour, but a real per-player stat). NEVER touches
    // `goals` — an own goal is not a scoring achievement.
    for (const [owner, n] of Object.entries(byOwnScorer)) {
      sb.bump(uRef(owner), {}, { 'stats.ownGoals': n });
      if (groupId)
        sb.bump(cpsRef(owner), { groupId, userId: owner, updatedAt: now }, { ownGoals: n });
      sb.bump(gpsRef(owner), { gameId, userId: owner, updatedAt: now }, { ownGoals: n });
    }

    // Community-level rollup for the club's stats + championship table:
    // total mini-games (rounds) and total goals scored THROUGH this club's
    // games. In the same idempotent batch, so a retry can't double-count.
    if (groupId) {
      sb.bump(
        db.collection('communityStats').doc(groupId),
        { groupId, updatedAt: now },
        {
          rounds: 1,
          goals: totalGoalsThisRound,
          // Goals scored by GUESTS this round → drives the "X גולים ע"י אורחים"
          // fun fact. Kept OUT of the `goals` total above (guests aren't in the
          // ranked table); this is a separate breakout. Counts from deploy on.
          ...(guestGoalsThisRound > 0 ? { guestGoals: guestGoalsThisRound } : {}),
          // Own goals scored this round → the club "X שערים עצמיים" fun fact.
          // Also separate from `goals` (an own goal isn't a scoring goal).
          ...(totalOwnGoalsThisRound > 0 ? { ownGoals: totalOwnGoalsThisRound } : {}),
          // Ties get their own counter → drives the club's draw-rate fun fact.
          tiedRounds: winnerSide === 'tie' ? 1 : 0,
          // Mini-games decided by a penalty SHOOTOUT (a drawn round the admin
          // resolved with penalties). Identified by a non-empty penalties[]
          // payload — those commits carry a real winnerSide (the shootout
          // winner), so they DON'T count as ties. Drives the "% decided by
          // penalties" fun fact. Counts from deploy onward.
          shootoutRounds: (penalties?.length ?? 0) > 0 ? 1 : 0,
          // Scoreless mini-games (ended 0:0 in regulation) → the "% ended 0:0"
          // fun fact. Counts from deploy onward — round-level scores aren't
          // stored historically, so old 0:0 rounds can't be backfilled.
          scorelessRounds: scoreA === 0 && scoreB === 0 ? 1 : 0,
        },
      );
    }

    // 1c) PENALTY-SHOOTOUT stats (tiebreaker kicks only). Kicker:
    //     taken/scored/missed. Keeper: faced/saved/conceded. Shootout kicks are
    //     NOT mini-game goals — they never touch score/goals, only these
    //     pen-specific fields. Both kicker + keeper gated through `onField`,
    //     exactly like goals/assists. Deduped per player so each writes once.
    //     CAP: the batch already runs near Firestore's 500-op ceiling at 11-a-
    //     side (~385 ops). A cap of 16 kicks bounds the added ops to ≤ 16
    //     kickers + 16 keepers × 3 stores ≈ 96 (total stays < 500). A
    //     forged/oversized payload is clipped rather than overflowing the batch.
    // ⚠️ This loop MIRRORS `aggregatePenalties` in src/utils/penaltyStats.ts
    //    (the unit-tested canonical spec). Keep the two in sync.
    const pens = (penalties ?? []).slice(0, 16);
    const kickerPen: Record<string, { taken: number; scored: number; missed: number }> = {};
    const keeperPen: Record<string, { faced: number; saved: number; conceded: number }> = {};
    for (const p of pens) {
      const scored = !!p.scored;
      const k = p.kickerId;
      if (k && isReal(k) && onField.has(k)) {
        const s = (kickerPen[k] ??= { taken: 0, scored: 0, missed: 0 });
        s.taken += 1;
        if (scored) s.scored += 1;
        else s.missed += 1;
      }
      const gk = p.keeperId;
      if (gk && isReal(gk) && onField.has(gk)) {
        const s = (keeperPen[gk] ??= { faced: 0, saved: 0, conceded: 0 });
        s.faced += 1;
        if (scored) s.conceded += 1;
        else s.saved += 1;
      }
    }
    for (const [kicker, s] of Object.entries(kickerPen)) {
      const fields = { penTaken: s.taken, penScored: s.scored, penMissed: s.missed };
      sb.bump(uRef(kicker), {}, {
        'stats.penTaken': s.taken,
        'stats.penScored': s.scored,
        'stats.penMissed': s.missed,
      });
      if (groupId)
        sb.bump(cpsRef(kicker), { groupId, userId: kicker, updatedAt: now }, fields);
      sb.bump(gpsRef(kicker), { gameId, userId: kicker, updatedAt: now }, fields);
    }
    for (const [keeper, s] of Object.entries(keeperPen)) {
      const fields = { penFaced: s.faced, penSaved: s.saved, penConceded: s.conceded };
      sb.bump(uRef(keeper), {}, {
        'stats.penFaced': s.faced,
        'stats.penSaved': s.saved,
        'stats.penConceded': s.conceded,
      });
      if (groupId)
        sb.bump(cpsRef(keeper), { groupId, userId: keeper, updatedAt: now }, fields);
      sb.bump(gpsRef(keeper), { gameId, userId: keeper, updatedAt: now }, fields);
    }

    // 1b) assists → assister.stats.assists + community tally + directional
    //     head-to-head ("X assisted Y") on the sorted pair doc.
    //
    // ⚠️ The scorer does NOT have to be a registered user. This used to skip
    // the goal entirely when `!isReal(scorerId)`, so setting up a GUEST cost
    // the assister his assist — it showed in the match history (written on a
    // separate path) and never reached his stats or the club table. Reported
    // on a real evening: a player laid on two goals for a guest and both
    // vanished. A guest is a full player in the cycle; feeding one is the
    // same act of football as feeding anyone else.
    //
    // What still gates: the scorer must have legitimately played this round —
    // a real on-field player, or a guest actually registered to THIS game
    // (`guestRoster`, the same anti-forgery check a real roster gives).
    const scorerPlayed = (id: string) =>
      (isReal(id) && onField.has(id)) || guestRoster.has(id);
    const byAssister: Record<string, number> = {};
    // Guest assisters, kept separate: they get the per-GAME row (so the round
    // table counts them like anyone else) and nothing lifetime or club-wide,
    // exactly like guest GOALS above. The scorer side already accepted a guest;
    // the assist side rejected one, so a guest who set up a goal showed 0.
    const byGuestAssister: Record<string, number> = {};
    const assistPairs: { assister: string; scorer: string }[] = [];
    for (const g of cappedGoals) {
      if (g.ownGoal || !g.scorerId || !scorerPlayed(g.scorerId)) continue;
      if (!g.assisterId || g.assisterId === g.scorerId) continue;
      if (!isReal(g.assisterId)) {
        // Same anti-forgery guard the guest SCORER path uses: the id must be a
        // registered guest of this game.
        if (guestRoster.has(g.assisterId)) {
          byGuestAssister[g.assisterId] = (byGuestAssister[g.assisterId] ?? 0) + 1;
        }
        continue;
      }
      if (!onField.has(g.assisterId)) continue; // assister not on a playing side (B12)
      byAssister[g.assisterId] = (byAssister[g.assisterId] ?? 0) + 1;
      // The head-to-head pair still needs BOTH sides to be real accounts: a
      // pair doc keyed on a guest id belongs to nobody and would pollute the
      // "X assisted Y" stats with a name that has no profile.
      if (isReal(g.scorerId)) {
        assistPairs.push({ assister: g.assisterId, scorer: g.scorerId });
      }
    }
    for (const [assister, n] of Object.entries(byAssister)) {
      sb.bump(uRef(assister), {}, { 'stats.assists': n });
      if (groupId)
        sb.bump(cpsRef(assister), { groupId, userId: assister, updatedAt: now }, { assists: n });
      // Per-GAME assist tally (mirrors the per-game goals write above).
      sb.bump(gpsRef(assister), { gameId, userId: assister, updatedAt: now }, { assists: n });
    }
    for (const [guest, n] of Object.entries(byGuestAssister)) {
      sb.bump(
        gpsRef(guest),
        { gameId, userId: guest, isGuest: true, updatedAt: now },
        { assists: n },
      );
    }

    // 1c-clean) "שער נקי" — a mini-game whose side finished with nothing
    //     conceded. A TEAM outcome credited to every participant, not a claim
    //     about who defended: 2:0 credits each player on the winning side once
    //     (one clean sheet, not two), 0:0 credits BOTH sides, 3:1 credits
    //     nobody. Uses the same A/B participation sets as rounds/wins below, so
    //     a player can never have more clean sheets than mini-games.
    //     `scoreA`/`scoreB` are the stored round score, which counts own goals
    //     and guest goals for the side that benefited — so an own goal denies
    //     the conceding side its clean sheet, as it should.
    //     A round decided by a penalty shootout still keeps the 0:0 of regular
    //     play, and credits both sides: the shootout is a tiebreaker, and its
    //     kicks are deliberately not goals anywhere else either.
    // ⚠️ MIRRORED in src/utils/cleanSheets.ts (the unit-tested canonical spec)
    //    and scripts/backfill_clean_sheets.py. Keep the three in sync.
    const cleanA = scoreB === 0;
    const cleanB = scoreA === 0;
    const cleanSheetFor = (uid: string) =>
      (cleanA && A.includes(uid)) || (cleanB && B.includes(uid));

    // 1c) mini-games PLAYED — every on-field player this round (both teams)
    //     gets a +1 `rounds` tally, per-community and per-game. Drives the
    //     championship's "games played" column + its score-per-game average.
    //     Counts everyone who played, not just scorers/assisters.
    //     The clean sheet rides along in the SAME writes: it is credited to
    //     exactly the players who are getting a round here, and adds no
    //     operations to a batch that is already sized against Firestore's
    //     500-op ceiling at 11-a-side.
    for (const uid of new Set([...A, ...B])) {
      const clean = cleanSheetFor(uid);
      if (groupId)
        sb.bump(
          cpsRef(uid),
          { groupId, userId: uid, updatedAt: now },
          {
            rounds: 1,
            ...(clean ? { cleanSheets: 1 } : {}),
            // Coverage denominators. `cleanSheets` and `assists` only count the
            // times something HAPPENED, so dividing either by `rounds` silently
            // includes mini-games from before that metric was collected at all
            // — clean sheets began 17.08, assists 21.06, the app 28.04. In the
            // big club that is 229 of 1,044 player-rounds (22%) with no clean
            // sheet data, so `cleanSheets / rounds` understates every affected
            // player by roughly a fifth and looks like a real number.
            //
            // These two say "the metric was being measured for this round",
            // regardless of outcome. Both metrics are always collected today,
            // so from here they simply track `rounds`; the gap is historical
            // and scripts/backfill_coverage_rounds.py closes it.
            //
            // They ride the SAME write to the SAME document — zero extra
            // Firestore operations, zero read cost, no pressure on the 500-op
            // batch ceiling. See the efficiency table (§12 of the seasons
            // spec), which requires the denominator of the measured period.
            csRounds: 1,
            asRounds: 1,
          },
        );
      // Per-GAME rounds + this player's team goals for/against this round.
      // teamGoalsFor is the contribution% denominator (player.goals ÷ team.goals
      // over the evening); teamGoalsAgainst rounds out GF/GA. Folded into the
      // existing per-game write so it adds no extra Firestore op.
      const onA = A.includes(uid);
      sb.bump(
        gpsRef(uid),
        { gameId, userId: uid, updatedAt: now },
        {
          rounds: 1,
          ...(clean ? { cleanSheets: 1 } : {}),
          teamGoalsFor: onA ? creditedA : creditedB,
          teamGoalsAgainst: onA ? creditedB : creditedA,
        },
      );
      // Lifetime tally, in the SAME latched batch as the other two so the three
      // counters can never diverge — the rule `stats.wins` follows.
      if (clean) {
        sb.bump(uRef(uid), {}, { 'stats.cleanSheets': 1 });
      }
    }

    // 1c-guest) The SAME per-game tallies for GUESTS.
    //
    // A/B are real-only (isReal), so a guest was credited goals and nothing
    // else: the round table listed them at 0 rounds / 0 wins next to a
    // team-mate on the very same side showing 3/3. Reported from a live evening
    // — "לאורח צריך להיספר הכל כמו לשחקן רגיל בטבלת המחזור".
    //
    // Deliberately per-GAME only. `users.stats` and `communityPlayerStats` stay
    // real-only: a guest has no account and no cross-cycle identity, so they
    // never join the club's ranked table. That part was never the bug.
    //
    // Kept OUT of A/B rather than merged into them, because A/B also drive the
    // pair writes (|A|×|B| against-pairs + same-team pairs). Adding guests there
    // would grow the batch quadratically against the 500-op ceiling that
    // MAX_SIDE is sized for; this pass costs exactly one op per guest.
    const guestsOnA = fullA.filter((id) => !isReal(id));
    const guestsOnB = fullB.filter((id) => !isReal(id));
    for (const [side, guestsOnSide] of [
      ['A', guestsOnA],
      ['B', guestsOnB],
    ] as const) {
      const onA = side === 'A';
      const clean = onA ? cleanA : cleanB;
      const result =
        winnerSide === side
          ? 'wins'
          : winnerSide === 'A' || winnerSide === 'B'
            ? 'losses'
            : 'ties';
      for (const gid of guestsOnSide) {
        sb.bump(
          gpsRef(gid),
          { gameId, userId: gid, isGuest: true, updatedAt: now },
          {
            rounds: 1,
            ...(clean ? { cleanSheets: 1 } : {}),
            ...(result ? { [result]: 1 } : {}),
            teamGoalsFor: onA ? creditedA : creditedB,
            teamGoalsAgainst: onA ? creditedB : creditedA,
          },
        );
      }
    }

    // 1d) mini-games WON / LOST — the winning side's players get a +1 `wins`
    //     tally and the losing side a +1 `losses`, per-community + per-game.
    //     Drives the community table's wins/losses columns. (A tie credits
    //     neither side.)
    const roundWinners =
      winnerSide === 'A' ? A : winnerSide === 'B' ? B : [];
    const roundLosers =
      winnerSide === 'A' ? B : winnerSide === 'B' ? A : [];
    // A DRAWN mini-game credits everyone who played it. This used to credit
    // nobody: `roundWinners` and `roundLosers` are both empty on a tie, so the
    // result simply fell on the floor. The consequence was visible in the club
    // table — a player with 10 mini-games and 3 draws showed 4 wins and 3
    // losses, and nothing on screen accounted for the missing three.
    const roundDrawers = winnerSide === 'tie' ? [...A, ...B] : [];
    const tallyResult = (uid: string, field: 'wins' | 'losses' | 'ties') => {
      if (groupId)
        sb.bump(cpsRef(uid), { groupId, userId: uid, updatedAt: now }, { [field]: 1 });
      sb.bump(gpsRef(uid), { gameId, userId: uid, updatedAt: now }, { [field]: 1 });
    };
    for (const uid of roundWinners) {
      tallyResult(uid, 'wins');
      // Lifetime per-player wins are written HERE — in the SAME idempotent,
      // committedRounds-latched batch as the community/game win tallies —
      // instead of the onGameRotationChanged trigger. That guarantees the
      // three win counters (lifetime / community / game) can never diverge:
      // they all commit together, or none of them on a failure.
      sb.bump(uRef(uid), {}, { 'stats.wins': 1 });
    }
    for (const uid of roundLosers) tallyResult(uid, 'losses');
    for (const uid of roundDrawers) {
      tallyResult(uid, 'ties');
      sb.bump(uRef(uid), {}, { 'stats.ties': 1 });
    }

    // Directional pair assists: assistsAToB = sorted-first player assisted the
    // sorted-second; assistsBToA = the reverse. The player card reads its side.
    for (const { assister, scorer } of assistPairs) {
      const [pa, pb] = [assister, scorer].sort();
      const field = assister === pa ? 'assistsAToB' : 'assistsBToA';
      sb.bump(
        db.collection('pairStats').doc(pairKey(assister, scorer)),
        { a: pa, b: pb, updatedAt: now },
        { [field]: 1 },
      );
      // Per-COMMUNITY assist pair → drives the club's "deadly duo" fun fact.
      // (pairStats is global/cross-group; this one is scoped to the club.)
      if (groupId) {
        sb.bump(
          db.collection('communityPairStats').doc(`${groupId}__${pairKey(assister, scorer)}`),
          { groupId, a: pa, b: pb, updatedAt: now },
          { assists: 1 },
        );
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
        sb.bump(
          db.collection('pairStats').doc(pairKey(w, l)),
          {
            // Write a/b so against-ONLY pairs (never same-team) are still
            // discoverable by the Statistics screen's `where('a'|'b','==',uid)`
            // queries — otherwise the rival/nemesis cards would miss them.
            a: pa,
            b: pb,
            updatedAt: now,
          },
          {
            against: 1,
            [sideAWinsField]: aWon ? 1 : 0,
            [sideBWinsField]: bWon ? 1 : 0,
          },
        );
      }

    // Same-team pairs — "played together" + won/lost together. MOVED here from
    // the onGameRotationChanged trigger so it's written on EVERY committed round
    // in the SAME idempotency-latched batch as goals/assists/against. The old
    // trigger fired only when the rotation ADVANCED, so a directly-ended evening
    // (endEvening commits the final round WITHOUT advancing) and a 4-team tie
    // (which empties lastRoundWinners/Losers) silently dropped same-team — making
    // winsTogether/sameTeam diverge from the against record for the same rounds.
    const sameTeamPairs = (team: string[], won: boolean, lost: boolean) => {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const [pa, pb] = [team[i], team[j]].sort();
          sb.bump(
            db.collection('pairStats').doc(pairKey(team[i], team[j])),
            { a: pa, b: pb, updatedAt: now },
            {
              sameTeam: 1,
              ...(won ? { winsTogether: 1 } : {}),
              ...(lost ? { lossesTogether: 1 } : {}),
            },
          );
        }
      }
    };
    // A tie (winnerSide==='tie') credits sameTeam for both sides with NO
    // together-win/loss — a case the old rotation trigger couldn't represent.
    sameTeamPairs(A, aWon, bWon);
    sameTeamPairs(B, bWon, aWon);

    // ── Batch-size guard, computed rather than assumed ──────────────────────
    // `sb.opCount` is the exact operation count the commit will issue. Firestore
    // rejects a batch over 500, and that rejection is UNRECOVERABLE here: the
    // idempotency latch is inside this batch, so it never lands, and every
    // retry of the same payload overflows identically. MAX_SIDE bounds the
    // quadratic pair writes and the caps on goals/penalties bound the rest, so
    // this should be unreachable — which is exactly why it must shout if it
    // ever isn't, instead of silently overflowing.
    if (sb.opCount > MAX_ROUND_BATCH_OPS) {
      console.error(
        `[commitRoundStats] batch too large: ${sb.opCount} ops ` +
          `(A=${A.length} B=${B.length} goals=${cappedGoals.length} pens=${pens.length})`,
      );
      throw new HttpsError(
        'resource-exhausted',
        `round too large to commit atomically (${sb.opCount} ops)`,
      );
    }

    // ── Round history FIRST, then the latched stats batch ───────────────────
    // The ordering, and the reasoning behind it, live in ./commitProtocol —
    // where they are unit-tested against every failure window rather than only
    // described in a comment here.
    const roundHistoryRef = roundHistoryDoc
      ? db
          .collection('games')
          .doc(gameId)
          .collection('roundHistory')
          .doc(roundHistoryDoc.roundId)
      : null;

    const latchRef =
      roundId !== undefined && roundId !== null
        ? db
            .collection('games')
            .doc(gameId)
            .collection('committedRounds')
            .doc(String(roundId))
        : null;

    const outcome = await commitRoundInOrder({
      isAlreadyCommitted: latchRef
        ? async () => (await latchRef.get()).exists
        : undefined,
      writeHistory:
        roundHistoryRef && roundHistoryDoc
          ? async () => {
              await roundHistoryRef.set(roundHistoryDoc);
            }
          : undefined,
      commitStats: async () => {
        await sb.build(db.batch(), inc).commit();
      },
      healHistory:
        roundHistoryRef && roundHistoryDoc
          ? async () => {
              try {
                // create(), never set() — an existing document is the one the
                // original commit agreed with, and a later retry could carry a
                // different (edited) payload.
                await roundHistoryRef.create(roundHistoryDoc);
                console.log(
                  '[commitRoundStats] healed missing roundHistory',
                  gameId,
                  roundId,
                );
              } catch {
                // Already there — the normal case for a duplicate press.
              }
            }
          : undefined,
      isAlreadyExists: (err) => {
        const code = (err as { code?: unknown } | undefined)?.code;
        return code === 6 || code === 'already-exists';
      },
      historyFailure: (err) => {
        console.error('roundHistory write failed', gameId, roundId, err);
        return new HttpsError('unavailable', 'could not store round history');
      },
    });
    if (outcome.alreadyCommitted) return { ok: true, alreadyCommitted: true };

    // Stamp "this evening was played" from the server, if the app never did.
    //
    // A committed round is the strongest proof there is: real goals, by real
    // players, on two real sides. The app is supposed to have stamped it at
    // kickoff, but that write swallows its own failures — and while it was the
    // ONLY record, a single dropped request on a bad pitch connection erased
    // the whole evening from the club's history with everything on screen
    // carrying on as normal.
    //
    // Outside the stats batch on purpose. This is a repair, not part of the
    // round: it must not consume one of the batch's counted operations, and it
    // must never be the reason a round of real goals fails to commit. If it
    // fails, `wasActuallyPlayed` still reaches the right answer from the
    // rotation this round left behind — a written fact is simply better than
    // an inferred one, and this is the moment the fact is known.
    //
    // Only when absent, so a second round never moves a kickoff already
    // recorded, and dated to kickoff rather than now, so a round committed at
    // midnight does not claim the evening began then.
    try {
      const patch: Record<string, unknown> = {
        // Evidence the server wrote itself.
        //
        // A committed round is the strongest proof an evening was played:
        // real goals, by real players, on two real sides. Everything else
        // `eveningPlayState` reads is written by the phone, and the phone can
        // fail to write — which is how an evening could disappear from a
        // club's history while every screen carried on working.
        //
        // A count, deliberately. It is read as "at least one round was
        // aggregated", and it also says how many without a subcollection read.
        committedRoundCount: admin.firestore.FieldValue.increment(1),
        updatedAt: now,
      };
      // And repair the kickoff stamp if the app never landed it. Only when
      // absent, so a later round never moves a kickoff already recorded, and
      // dated to kickoff rather than to now — a round committed at midnight
      // does not mean the evening began then.
      if (
        typeof (game.liveMatch as { startedAt?: number } | undefined)
          ?.startedAt !== 'number'
      ) {
        patch.liveMatch = {
          startedAt: typeof game.startsAt === 'number' ? game.startsAt : now,
          // Marks the stamp as a repair rather than a real kickoff press.
          startedAtBy: 'server',
        };
      }
      // Outside the stats batch on purpose: this is a record OF the round, not
      // part of it, and it must never be the reason a round of real goals
      // fails to commit.
      await db.collection('games').doc(gameId).set(patch, { merge: true });
    } catch (err) {
      console.error('[commitRoundStats] played-stamp failed', gameId, err);
    }

    return { ok: true, scorers: Object.keys(byScorer).length };
  },
);

// ── Physical stats (wearables) ───────────────────────────────────────────────
// A player's own post-game physical metrics + running heatmap, ingested from
// their watch / Health Connect / HealthKit (NOT the phone's sensors) and stored
// at games/{gameId}/physical/{uid}. Client rules keep this collection
// write:false, so this callable is the ONLY write path — it hard-binds the doc
// id to the CALLER's uid, so nobody can post physical data under someone else's
// name. All numbers are clamped to sane bounds; heatGrid is length-capped.
export const saveGamePhysical = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
    const { gameId, metrics } = (request.data ?? {}) as {
      gameId?: string;
      metrics?: Record<string, unknown>;
    };
    if (!gameId || !metrics || typeof metrics !== 'object') {
      throw new HttpsError('invalid-argument', 'gameId + metrics required');
    }
    const snap = await db.collection('games').doc(gameId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'game not found');
    const game = snap.data() as Record<string, unknown>;
    // Only someone who actually played (registered roster) may post metrics.
    const roster = new Set<string>([
      ...((game.players as string[] | undefined) ?? []),
      ...((game.waitlist as string[] | undefined) ?? []),
    ]);
    if (!roster.has(uid)) {
      throw new HttpsError('permission-denied', 'not a participant');
    }
    // Server-side guard (defense-in-depth; the client already gates on this):
    // only a FINISHED game accepts physical metrics. A mid-game/replayed call
    // would otherwise land partial data — and, via the non-destructive merge
    // below, could pin a low value before the evening even ends. Legacy games
    // with no status are still accepted (mirrors the client's gate).
    const gameStatus = game.status as string | undefined;
    if (gameStatus && gameStatus !== 'finished') {
      throw new HttpsError('failed-precondition', 'game not finished');
    }

    // Clamp a numeric field to [0, max] (drops NaN/negatives/absurd values).
    const num = (v: unknown, max: number): number => {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      return Math.max(0, Math.min(max, n));
    };

    // Non-destructive merge: re-opening the summary after a permission was
    // revoked (or a partial Health Connect read) would otherwise write 0 over a
    // good stored value. A single finished game's totals only ever grow across
    // re-syncs, so keep the MAX of stored vs incoming per numeric field — a
    // degraded read can never lower a previously-recorded metric.
    const ref = db.collection('games').doc(gameId).collection('physical').doc(uid);
    const prev = ((await ref.get()).data() ?? {}) as Record<string, unknown>;
    const prevNum = (k: string): number => {
      const n = prev[k];
      return typeof n === 'number' && Number.isFinite(n) ? n : 0;
    };
    const keepMax = (k: string, incoming: number): number => Math.max(prevNum(k), incoming);
    const prevZones = (prev.hrZones ?? {}) as Record<string, unknown>;
    const prevZone = (k: string): number => {
      const n = prevZones[k];
      return typeof n === 'number' && Number.isFinite(n) ? n : 0;
    };

    // Anti-forgery: bound movement metrics by the REAL timer-active duration the
    // server already trusts (liveMatch.activeIntervals, the same windows the
    // honest client scoped its Health Connect read to). A human can't out-run
    // ~12 m/s, out-step ~4/s, or out-sprint ~1 per 8 s — so anything beyond that
    // for the known active seconds is fabricated. Only clamp when the duration is
    // known (activeMs>0); legacy games with no intervals keep the static caps.
    const lm = (game.liveMatch ?? {}) as {
      activeIntervals?: Array<{ s?: unknown; e?: unknown }>;
    };
    let activeMs = 0;
    if (Array.isArray(lm.activeIntervals)) {
      for (const iv of lm.activeIntervals) {
        const s = typeof iv?.s === 'number' ? iv.s : NaN;
        const e = typeof iv?.e === 'number' ? iv.e : NaN;
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) activeMs += e - s;
      }
    }
    const activeSec = activeMs / 1000;
    const capDist = activeSec > 0 ? 12 * activeSec : Infinity;
    const capSteps = activeSec > 0 ? 4 * activeSec : Infinity;
    const capSprints = activeSec > 0 ? Math.ceil(activeSec / 8) : Infinity;
    // Clamp incoming AND the max-merged result so a value forged before this
    // guard (already stored high) can't survive via keepMax.
    const bounded = (cap: number, k: string, incoming: number): number =>
      Math.min(cap, keepMax(k, Math.min(cap, incoming)));
    const src = String((metrics as { source?: unknown }).source ?? 'wear');
    const source = ['wear', 'healthkit', 'healthconnect'].includes(src) ? src : 'wear';
    const zonesIn = (metrics.hrZones ?? {}) as Record<string, unknown>;

    // Heat grid: bounded rows/cols, values clamped to 0..1, length must match.
    const rows = Math.max(0, Math.min(40, Math.round(num(metrics.gridRows, 40))));
    const cols = Math.max(0, Math.min(40, Math.round(num(metrics.gridCols, 40))));
    const rawGrid = Array.isArray(metrics.heatGrid) ? metrics.heatGrid : [];
    let heatGrid: number[] = [];
    if (rows > 0 && cols > 0 && rawGrid.length === rows * cols && rawGrid.length <= 1600) {
      heatGrid = rawGrid.map((v) => num(v, 1));
    }

    const doc = {
      gameId,
      userId: uid,
      distanceM: bounded(capDist, 'distanceM', num(metrics.distanceM, 50_000)),
      topSpeedKmh: keepMax('topSpeedKmh', num(metrics.topSpeedKmh, 45)),
      avgSpeedKmh: keepMax('avgSpeedKmh', num(metrics.avgSpeedKmh, 45)),
      sprints: Math.round(bounded(capSprints, 'sprints', num(metrics.sprints, 500))),
      steps: Math.round(bounded(capSteps, 'steps', num(metrics.steps, 100_000))),
      calories: Math.round(keepMax('calories', num(metrics.calories, 10_000))),
      maxHr: Math.round(keepMax('maxHr', num(metrics.maxHr, 230))),
      avgHr: Math.round(keepMax('avgHr', num(metrics.avgHr, 230))),
      effortScore: Math.round(keepMax('effortScore', num(metrics.effortScore, 100))),
      hrZones: {
        light: Math.round(Math.max(prevZone('light'), num(zonesIn.light, 300))),
        moderate: Math.round(Math.max(prevZone('moderate'), num(zonesIn.moderate, 300))),
        intense: Math.round(Math.max(prevZone('intense'), num(zonesIn.intense, 300))),
        peak: Math.round(Math.max(prevZone('peak'), num(zonesIn.peak, 300))),
      },
      source,
      ...(heatGrid.length ? { heatGrid, gridRows: rows, gridCols: cols } : {}),
      updatedAt: Date.now(),
    };
    await ref.set(doc, { merge: true });
    return { ok: true };
  },
);

// ── Pitch calibration (heatmap) ──────────────────────────────────────────────
// Stores the community's real-world pitch rectangle (4 GPS corners) on the
// group doc so every future game's heatmap normalizes into the same fixed
// rectangle (calibrated ONCE per field, reused forever). Any member of the
// community may (re)calibrate. Corners are validated as 4 finite lat/lng pairs.
export const savePitchCalibration = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
    const { groupId, corners } = (request.data ?? {}) as {
      groupId?: string;
      corners?: Array<{ lat?: unknown; lng?: unknown }>;
    };
    if (!groupId || !Array.isArray(corners) || corners.length !== 4) {
      throw new HttpsError('invalid-argument', 'groupId + 4 corners required');
    }
    const clean = corners.map((c) => {
      const lat = typeof c?.lat === 'number' && Number.isFinite(c.lat) ? c.lat : NaN;
      const lng = typeof c?.lng === 'number' && Number.isFinite(c.lng) ? c.lng : NaN;
      if (
        Number.isNaN(lat) || Number.isNaN(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        throw new HttpsError('invalid-argument', 'invalid corner coords');
      }
      return { lat, lng };
    });
    const grp = await db.collection('groups').doc(groupId).get();
    if (!grp.exists) throw new HttpsError('not-found', 'group not found');
    // Admin-only: pitchCalibration lives on the admin-gated group doc and is
    // reused by EVERY future game's heatmap, so a single bad write would corrupt
    // the whole community's heatmaps. Match the admin gate the group doc uses
    // everywhere else (creator or adminIds) — not plain membership.
    const isAdmin =
      grp.data()?.creatorId === uid ||
      ((grp.data()?.adminIds as string[] | undefined) ?? []).includes(uid);
    if (!isAdmin) throw new HttpsError('permission-denied', 'admin only');
    await db.collection('groups').doc(groupId).set(
      { pitchCalibration: { corners: clean, by: uid, at: Date.now() } },
      { merge: true },
    );
    return { ok: true };
  },
);

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
async function loadRetroGameContext(
  uid: string | undefined,
  gameId?: string,
): Promise<{ game: Record<string, unknown>; groupId: string }> {
  if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
  if (!gameId) throw new HttpsError('invalid-argument', 'gameId required');
  const snap = await db.collection('games').doc(gameId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'game not found');
  const game = snap.data() as Record<string, unknown>;
  // Post-match only — a retro goal is a correction to a finished evening.
  if (game.status !== 'finished') {
    throw new HttpsError('failed-precondition', 'game is not finished');
  }
  const groupId = game.groupId as string | undefined;
  if (!groupId) throw new HttpsError('failed-precondition', 'game has no community');
  const grpSnap = await db.collection('groups').doc(groupId).get();
  const grp = grpSnap.data() as Record<string, unknown> | undefined;
  // Personal / one-off hidden groups are excluded: promoteOrphanToGroup HARD-
  // resets their stats, which would orphan a retro marker + its counters.
  if (!grp || grp.isPersonal === true) {
    throw new HttpsError('failed-precondition', 'retro goals are only for real communities');
  }
  const adminIds = (grp.adminIds as string[] | undefined) ?? [];
  const isAdmin = game.createdBy === uid || adminIds.includes(uid);
  if (!isAdmin) throw new HttpsError('permission-denied', 'community admin only');

  // A correction belongs to the season the evening was played in.
  //
  // Retro goals write straight into communityPlayerStats and communityStats,
  // and those are the SEASON's counters. Correcting a goal from an evening in
  // a season that has since closed therefore lands in the wrong season twice
  // over: the sealed archive stays wrong, and the running season is credited
  // with a goal nobody scored in it. Removing one is worse — the counter it
  // decrements may be at zero, and Firestore's increment happily goes
  // negative, so a club table starts showing −1 goals.
  //
  // The season stamp has been on every game since the feature landed; nothing
  // read it until now.
  assertSeasonOpenForGame(grp, game);
  return { game, groupId };
}

/**
 * Refuse a statistical correction to an evening whose season has closed (§12).
 *
 * ⚠️ Every path that changes a recorded result must call this. It began life
 * inside the retro-goal loader, guarding one callable; §12 makes it the rule
 * for all of them, so it lives here and is applied at each write path rather
 * than being re-derived — a second copy of this rule is a second place for it
 * to be subtly different.
 *
 * Why it matters, in the retro-goal case that produced it: those writes go
 * straight into `communityPlayerStats` and `communityStats`, which are the
 * SEASON's counters. Correcting a goal from a season that has since closed
 * lands in the wrong season twice over — the sealed archive stays wrong, and
 * the running season is credited with a goal nobody scored in it. Removing one
 * is worse: the counter it decrements may already be at zero, and Firestore's
 * increment goes negative without complaint, so a club table starts showing
 * −1 goals.
 *
 * An UNSTAMPED evening belongs to season 1. The stamp only began being written
 * when seasons shipped, so every evening a club played before that has none —
 * on the one club that has run seasons, 19 of 22. Treating "no stamp" as
 * "current season" let a correction to an evening from June be credited to
 * season 2.
 *
 * A season that is merely WAITING to close is still open to corrections, and
 * that is the whole point of the window (§13): during `pendingClose` the
 * season is still `currentId`, so this guard admits the write.
 */
function assertSeasonOpenForGame(
  grp: Record<string, unknown> | undefined,
  game: Record<string, unknown>,
): void {
  const seasons = grp?.seasons as
    | { enabled?: boolean; currentId?: string; currentNo?: number }
    | undefined;
  if (!seasons?.enabled) return;
  const gameSeason = typeof game.seasonId === 'string' ? game.seasonId : '';
  const belongsTo =
    gameSeason || (seasons.currentNo === 1 ? seasons.currentId ?? '' : 's1');
  if (belongsTo !== seasons.currentId) {
    throw new HttpsError(
      'failed-precondition',
      'closedSeasonGame: this evening belongs to a season that has already closed',
    );
  }
}

const isAlreadyExists = (err: unknown): boolean => {
  const e = err as { code?: number | string; message?: string };
  return (
    e?.code === 6 ||
    e?.code === 'already-exists' ||
    (typeof e?.message === 'string' && e.message.includes('ALREADY_EXISTS'))
  );
};

export const addRetroGoal = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    const { gameId, scorerId, assisterId, retroGoalId } = (request.data ?? {}) as {
      gameId?: string;
      scorerId?: string;
      assisterId?: string | null;
      retroGoalId?: string;
    };
    if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
    if (!retroGoalId) throw new HttpsError('invalid-argument', 'retroGoalId required');
    if (!scorerId || !isReal(scorerId)) {
      throw new HttpsError('invalid-argument', 'a real (non-guest) scorer is required');
    }
    // Assister optional; ignore a guest / self-assist rather than failing.
    const assister =
      assisterId && isReal(assisterId) && assisterId !== scorerId ? assisterId : null;
    const { game, groupId } = await loadRetroGameContext(uid, gameId);
    // Scorer (and assister) must be on the game's registered roster — includes
    // players who went home (they stay in players[]); excludes guests already.
    const players = (game.players as string[] | undefined) ?? [];
    if (!players.includes(scorerId)) {
      throw new HttpsError('invalid-argument', 'scorer is not on this game roster');
    }
    if (assister && !players.includes(assister)) {
      throw new HttpsError('invalid-argument', 'assister is not on this game roster');
    }
    const inc = (n: number) => admin.firestore.FieldValue.increment(n);
    const now = Date.now();
    const batch = db.batch();
    // Idempotency marker + audit (create → collides on retry/double-tap).
    batch.create(
      db.collection('games').doc(gameId as string).collection('retroGoals').doc(retroGoalId),
      { scorerId, assisterId: assister, addedBy: uid, at: now },
    );
    // Goal → the SAME four stores commitRoundStats writes (no rounds/wins/pairs).
    batch.set(db.collection('users').doc(scorerId), { stats: { goals: inc(1) } }, { merge: true });
    batch.set(
      db.collection('communityPlayerStats').doc(`${groupId}__${scorerId}`),
      { groupId, userId: scorerId, goals: inc(1), updatedAt: now },
      { merge: true },
    );
    batch.set(
      db.collection('gamePlayerStats').doc(`${gameId}__${scorerId}`),
      { gameId, userId: scorerId, goals: inc(1), updatedAt: now },
      { merge: true },
    );
    batch.set(
      db.collection('communityStats').doc(groupId),
      { groupId, goals: inc(1), updatedAt: now },
      { merge: true },
    );
    if (assister) {
      batch.set(
        db.collection('users').doc(assister),
        { stats: { assists: inc(1) } },
        { merge: true },
      );
      batch.set(
        db.collection('communityPlayerStats').doc(`${groupId}__${assister}`),
        { groupId, userId: assister, assists: inc(1), updatedAt: now },
        { merge: true },
      );
      batch.set(
        db.collection('gamePlayerStats').doc(`${gameId}__${assister}`),
        { gameId, userId: assister, assists: inc(1), updatedAt: now },
        { merge: true },
      );
    }
    try {
      await batch.commit();
    } catch (err) {
      // Marker already existed → this exact retro goal was already applied.
      // Treat as success (idempotent) instead of double-counting.
      if (isAlreadyExists(err)) return { ok: true, duplicate: true };
      throw err;
    }
    return { ok: true };
  },
);

export const removeRetroGoal = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    const { gameId, retroGoalId } = (request.data ?? {}) as {
      gameId?: string;
      retroGoalId?: string;
    };
    if (!uid) throw new HttpsError('unauthenticated', 'sign in required');
    if (!retroGoalId) throw new HttpsError('invalid-argument', 'retroGoalId required');
    const { groupId } = await loadRetroGameContext(uid, gameId);
    const inc = (n: number) => admin.firestore.FieldValue.increment(n);
    const now = Date.now();
    const markerRef = db
      .collection('games')
      .doc(gameId as string)
      .collection('retroGoals')
      .doc(retroGoalId);
    await db.runTransaction(async (tx) => {
      const m = await tx.get(markerRef);
      if (!m.exists) return; // already removed / never existed → no-op
      const d = m.data() as { scorerId?: string; assisterId?: string | null };
      const scorerId = d.scorerId;
      const assister = d.assisterId ?? null;
      tx.delete(markerRef);
      if (scorerId && isReal(scorerId)) {
        tx.set(db.collection('users').doc(scorerId), { stats: { goals: inc(-1) } }, { merge: true });
        tx.set(
          db.collection('communityPlayerStats').doc(`${groupId}__${scorerId}`),
          { goals: inc(-1), updatedAt: now },
          { merge: true },
        );
        tx.set(
          db.collection('gamePlayerStats').doc(`${gameId}__${scorerId}`),
          { goals: inc(-1), updatedAt: now },
          { merge: true },
        );
        tx.set(
          db.collection('communityStats').doc(groupId),
          { goals: inc(-1), updatedAt: now },
          { merge: true },
        );
      }
      if (assister && isReal(assister)) {
        tx.set(
          db.collection('users').doc(assister),
          { stats: { assists: inc(-1) } },
          { merge: true },
        );
        tx.set(
          db.collection('communityPlayerStats').doc(`${groupId}__${assister}`),
          { assists: inc(-1), updatedAt: now },
          { merge: true },
        );
        tx.set(
          db.collection('gamePlayerStats').doc(`${gameId}__${assister}`),
          { assists: inc(-1), updatedAt: now },
          { merge: true },
        );
      }
    });
    return { ok: true };
  },
);

// ── Reports → the Pulse task list ────────────────────────────────────────
//
// Every in-app report a tester files becomes a task the moment it's written,
// so the owner's work list is complete without Pulse having to scan the
// `feedback` collection on every open. That scan is exactly what the tasks
// screen replaced: one collection read instead of four.
//
// The task carries the reporter's own category (they picked it in the sheet)
// but NOT a priority — urgency is the owner's call, so everything lands at
// 'normal' and gets promoted by hand in Pulse.
export const onFeedbackCreated = onDocumentCreated(
  'feedback/{feedbackId}',
  async (event) => {
    const d = event.data?.data() as
      | {
          message?: string;
          screen?: string;
          image?: string;
          category?: string;
          userName?: string;
          userId?: string;
          appVersion?: string;
          type?: string;
        }
      | undefined;
    if (!d) return;

    const feedbackId = event.params.feedbackId;
    // Deterministic id: a retry of this trigger (Cloud Functions guarantees
    // at-least-once, not exactly-once) rewrites the SAME doc instead of
    // creating a second task for one report.
    const taskId = `fb-${feedbackId}`;
    const ref = db.collection('tasks').doc(taskId);
    if ((await ref.get()).exists) return;

    const category =
      d.category === 'ui' || d.category === 'feature' ? d.category : 'bug';
    const title = (d.message ?? '').trim().slice(0, 200) || 'דיווח מהאפליקציה';
    const now = Date.now();
    const who = (d.userName ?? '').trim();
    const version = (d.appVersion ?? '').trim();
    // Provenance goes in the body, not the title — the title is what the list
    // shows, and "מ־דני · 1.0.91" in every row would crowd out the actual report.
    const notes = [who && `דיווח מ${who}`, version && `גרסה ${version}`]
      .filter(Boolean)
      .join(' · ');

    await ref.set({
      title,
      notes,
      category,
      status: 'new',
      priority: 'normal',
      source: 'teamder',
      images: typeof d.image === 'string' && d.image ? [d.image] : [],
      screen: typeof d.screen === 'string' ? d.screen : '',
      sourceId: feedbackId,
      // WHO reported. Without this the task is a dead end — you can read the
      // complaint but have no way to get back to the person who filed it.
      reporterId: typeof d.userId === 'string' ? d.userId : '',
      reporterName: who,
      createdAt: now,
      updatedAt: now,
      doneAt: 0,
    });
  },
);

/**
 * What every player did in this club's CLOSED seasons.
 *
 * Empty for the overwhelming majority of clubs — the ones that do not run
 * seasons have no archives, and the query returns nothing. A club with closed
 * seasons pays one read per closed season, once per evening, and gets back the
 * history its live table no longer holds.
 *
 * Fails soft: if the archives cannot be read the summary is still written, just
 * from the season's own numbers. A missing milestone is a smaller wrong than no
 * summary at all.
 */
const archNum = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

interface ArchivedClub {
  goals: number;
  assists: number;
  rounds: number;
  cleanSheets: number;
  shootoutRounds: number;
}

/** Filled by the same pass as the player rows — the CLUB's sealed totals. */
const archivedClubTotals = new Map<string, ArchivedClub>();

async function archivedCareerOf(groupId: string): Promise<
  Map<string, { goals: number; assists: number; rounds: number; wins: number; cleanSheets: number; games: number }>
> {
  const out = new Map<
    string,
    { goals: number; assists: number; rounds: number; wins: number; cleanSheets: number; games: number }
  >();
  archivedClubTotals.set(groupId, {
    goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0,
  });
  if (!groupId) return out;
  try {
    const snap = await db
      .collection('seasonSummary')
      .where('groupId', '==', groupId)
      .get();
    const club: ArchivedClub = {
      goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0,
    };
    for (const doc of snap.docs) {
      // The CLUB's history too. Its milestones ("the club's 1,000th goal") and
      // its badges read communityStats, which the close zeroes — so without
      // this a club re-earns its bronze badge and re-announces its thousandth
      // goal every season, and its level drops the morning after a close.
      const t = (doc.data()?.totals ?? {}) as Record<string, unknown>;
      club.goals += archNum(t.goals);
      club.assists += archNum(t.assists);
      club.rounds += archNum(t.rounds);
      club.cleanSheets += archNum(t.cleanSheets);
      club.shootoutRounds += archNum(t.shootoutRounds);
      const players = (doc.data()?.players ?? {}) as Record<string, Record<string, unknown>>;
      for (const [uid, row] of Object.entries(players)) {
        const cur = out.get(uid) ?? {
          goals: 0, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 0,
        };
        cur.goals += archNum(row.goals);
        cur.assists += archNum(row.assists);
        cur.rounds += archNum(row.rounds);
        cur.wins += archNum(row.wins);
        cur.cleanSheets += archNum(row.cleanSheets);
        cur.games += archNum(row.games);
        out.set(uid, cur);
      }
    }
    archivedClubTotals.set(groupId, club);
  } catch (err) {
    console.error('[season] archived career read failed', groupId, err);
  }
  return out;
}

/**
 * Report a SERVER failure into the same inbox the app writes to.
 *
 * There was no such thing. Every server failure went to `console.error`, and
 * the only unattended path in the app that destroys production data — the
 * season sweep — swallowed its errors there. A club whose season had failed to
 * roll for two months was discoverable by scrolling Cloud Logging and no other
 * way: no Crashlytics, no alerting, and the dev inbox that exists precisely for
 * this only ever heard from clients.
 *
 * Deliberately narrow. This is not a general server logger — it is for the
 * handful of unattended operations whose silent failure is itself the bug.
 * Mirrors the client's aggregated shape (fingerprint + count + first/lastSeen)
 * so the inbox groups a recurring failure into one row instead of a flood.
 */
async function reportServerError(args: {
  operation: string;
  err: unknown;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const e = args.err as { message?: string; code?: string | number; stack?: string };
    const message = String(e?.message ?? args.err ?? 'unknown');
    // Signature, not incident: the same failure on the same club every hour is
    // one row with a count, which is what makes it readable.
    const fp = `srv_${args.operation}_${String(args.context?.groupId ?? '')}`
      .replace(/[^\w]/g, '')
      .slice(0, 80);
    const ref = db.collection('errors').doc(fp);
    const now = admin.firestore.Timestamp.now();
    const common = {
      operation: args.operation,
      title: `שגיאת שרת · ${args.operation}`,
      category: 'server',
      lastMessage: message.slice(0, 500),
      lastCode: e?.code != null ? String(e.code) : null,
      lastStack: (e?.stack ?? '').slice(0, 2000) || null,
      lastContext: args.context ?? {},
      lastUserId: null,
      lastScreen: null,
      platform: 'server',
      osVersion: '',
      appVersion: 'functions',
      lastSeen: now,
    };
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (cur.exists) {
        tx.set(ref, { ...common, count: (cur.get('count') ?? 0) + 1 }, { merge: true });
      } else {
        tx.set(ref, {
          ...common,
          fingerprint: fp,
          count: 1,
          status: 'new',
          firstSeen: now,
        });
      }
    });
  } catch (reportErr) {
    // The reporter must never be the thing that breaks the caller.
    console.error('[reportServerError] failed', args.operation, reportErr);
  }
}

// ─── Seasons ─────────────────────────────────────────────────────────────
//
// Three admin actions and one sweep. Every one of them funnels into the same
// `closeSeason`, because a second closing path is a second set of bugs and the
// one that runs unattended is the one nobody would be watching.


/**
 * Tell everyone who played that the season is over.
 *
 * One push per player, deep-linking to THEIR card — the summary is per person,
 * so a shared body would be a lie about somebody. Recipients are read from the
 * archive rather than from the club's membership: the season belongs to whoever
 * played it, including someone who has since left, and excluding a member who
 * never turned up (whose "summary" would be a screen of zeros).
 *
 * Best-effort by design. A failed push must not roll back a season that has
 * already been archived and zeroed — the card is reachable without it.
 */
async function announceSeasonClosed(args: {
  groupId: string;
  groupName: string;
  seasonId: string;
  seasonNo: number;
}): Promise<void> {
  const { groupId, groupName, seasonId, seasonNo } = args;
  try {
    const snap = await db
      .collection('seasonSummary')
      .doc(`${groupId}__${seasonId}`)
      .get();
    if (!snap.exists) return;
    const players = (snap.data()?.players ?? {}) as Record<
      string,
      { rounds?: unknown; games?: unknown }
    >;
    const ops: Promise<unknown>[] = [];
    for (const [uid, row] of Object.entries(players)) {
      // Turned up, or played a mini-game. `rounds` counts משחקונים and is
      // written only by the advanced live screen, so filtering on it alone
      // meant a club running the plain timer closed its season and told
      // NOBODY — the one push the whole feature builds towards, reaching zero
      // people, on exactly the clubs the archive already documents as having
      // no mini-games. `games` is evenings attended, which every club records.
      const rounds = typeof row?.rounds === 'number' ? row.rounds : 0;
      const evenings = typeof row?.games === 'number' ? row.games : 0;
      if (rounds <= 0 && evenings <= 0) continue;
      ops.push(
        createNotificationOnce({
          type: 'seasonSummary',
          recipientId: uid,
          entityType: 'group',
          entityId: groupId,
          reason: `season-${seasonId}`,
          payload: { groupId, seasonId, seasonNo, groupName },
        }),
      );
    }
    const results = await Promise.allSettled(ops);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      console.warn(
        `[season] ${failed}/${results.length} seasonSummary push(es) failed for ${groupId} ${seasonId}`,
      );
    }
  } catch (err) {
    console.error('[season] summary fan-out failed', groupId, seasonId, err);
  }
}

/** Is the club quiet enough to close a season right now? */
/**
 * The cadence a newly-opened season should carry.
 *
 * A rounds target needs nothing: it is measured from `roundsAtStart`, so the
 * same number means "another N rounds" for every season.
 *
 * A DATE target does. The end date belongs to the season that just closed, and
 * inheriting it hands the new season a deadline in the past — which makes it
 * due the moment it opens. With the hourly sweep running, that is a club that
 * archives one empty season every hour, forever, each one pushing every player
 * a summary of nothing. The season is re-based to the same LENGTH from now.
 *
 * A legacy cadence with no `months` (written before the length was stored)
 * falls back to the length of the season that just ended, and to six months
 * when even that is unknowable — anything but a date already behind us.
 */
/** `null` is admitted on the unused half of a cadence because that is how a
 *  merge:true write CLEARS a field the previous cadence left behind. */
type Cadence = {
  type?: string;
  months?: number | null;
  endsAt?: number | null;
  targetRounds?: number | null;
  /** The calendar boundaries. Absent from this type is how `endsOn` came to
   *  survive a rollover untouched — see rebaseCadence. */
  startsOn?: CalendarDate | null;
  endsOn?: CalendarDate | null;
};

function rebaseCadence(
  cadence: Cadence | undefined,
  seasonStartedAt: number,
  now: number,
): Cadence & { type: string } {
  if (!cadence || cadence.type !== 'date') {
    return (cadence ?? { type: 'date', months: 6 }) as {
      type: string;
      months?: number;
      endsAt?: number;
      targetRounds?: number;
    };
  }
  let months = isValidSeasonMonths(Number(cadence.months))
    ? Number(cadence.months)
    : 0;
  if (!months && seasonStartedAt > 0 && typeof cadence.endsAt === 'number') {
    const ranMs = cadence.endsAt - seasonStartedAt;
    const ranMonths = Math.round(ranMs / (30 * 24 * 60 * 60 * 1000));
    months = isValidSeasonMonths(ranMonths) ? ranMonths : 0;
  }
  if (!months) months = 6;
  // targetRounds cleared for the same reason the enable path clears it: this
  // is written into a merge:true map, so an omitted field keeps whatever the
  // club's previous cadence left there.
  //
  // And `endsOn` for exactly that reason — it was the one field this function
  // never returned. The sweep asks `endsOn` FIRST when deciding whether a
  // season is over, so the new season inherited the date the old one died on,
  // was due the moment it opened, and closed again on the next pass. Every
  // hour, forever, archiving an empty season each time. Six independent
  // reviewers found it; the club I tested it on had already produced one junk
  // archive entry this way.
  const startsOn = todayIn(undefined, now);
  return {
    type: 'date',
    months,
    endsAt: addMonthsClampedServer(now, months),
    startsOn,
    endsOn: seasonEndDate(startsOn, months),
    targetRounds: null,
  };
}

/** How long after kickoff a game still counts as "tonight". Past this it is
 *  stale, not in progress, and the cleanup sweep owns it. */
const TONIGHT_MS = 12 * 60 * 60 * 1000;

/** How long a just-reopened season is left alone, so the admin can move the
 *  target that closed it before the sweep closes it again. */
const REOPEN_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * How long a season sits between meeting its finish line and actually closing.
 *
 * The spec's correction window (§4, §5). A season that comes due does NOT
 * close: it enters `seasons.pendingClose` and waits a day, during which admins
 * can fix a wrong score, a missed goal or a mis-recorded attendance, and no
 * evening may be STARTED anywhere in the club. Titles are decided from the
 * numbers as they stand when the window shuts, so anything corrected inside it
 * counts and anything corrected after it does not — which is the whole point
 * of having a window rather than closing on the final whistle.
 */
const PENDING_CLOSE_MS = 24 * 60 * 60 * 1000;

/**
 * The season is due and waiting out its correction window.
 *
 * ⚠️ There is deliberately NO scheduled task behind this. The spec (§24) asks
 * that an old close must not be able to fire after the season has been
 * extended, and the usual answer — enqueue a task, remember its name, cancel
 * it on extend — has a failure mode that cannot be tested away: a cancel that
 * does not land leaves a live task holding a decision that is no longer true.
 *
 * So the decision is not held anywhere. It is DERIVED, every hour, from this
 * field: the sweep closes a season when `pendingClose.closeAt` has passed and
 * `pendingClose.seasonId` is still the current season. Extending the season
 * deletes the field, and with it the close — there is nothing left to fire.
 * Re-entering the window writes a fresh `closeAt`, so an extension that is
 * later met again gets a fresh day, not the remains of the old one.
 *
 * The cost is that the close lands within an hour of the deadline rather than
 * on it, because `cronEvery60Min` is what notices. On a 24-hour window that is
 * the right trade.
 */
type PendingClose = {
  /** The season this window belongs to. A window never outlives its season. */
  seasonId: string;
  /** When the finish line was met. */
  dueAt: number;
  /** When the window shuts and the close may run. */
  closeAt: number;
  /** What ended it — for the message the admin reads. */
  reason: 'rounds' | 'date';
};

/** The window that belongs to THIS season, or null. A stamp left behind by a
 *  previous season is not a window — it is litter, and reading it as one would
 *  close a fresh season the moment it opened. */
function currentPendingClose(
  seasons: { currentId?: string; pendingClose?: PendingClose } | undefined,
): PendingClose | null {
  const p = seasons?.pendingClose;
  if (!p || !seasons?.currentId) return null;
  if (p.seasonId !== seasons.currentId) return null;
  if (!Number.isFinite(p.closeAt)) return null;
  return p;
}

/** Open the correction window. Idempotent: an existing window for this season
 *  is left exactly as it is, so a season that is due for the twentieth hourly
 *  sweep in a row does not get its deadline pushed back twenty times. */
async function openPendingClose(
  groupId: string,
  seasonId: string,
  reason: PendingClose['reason'],
  now: number,
): Promise<PendingClose> {
  const pending: PendingClose = {
    seasonId,
    dueAt: now,
    closeAt: now + PENDING_CLOSE_MS,
    reason,
  };
  await db
    .collection('groups')
    .doc(groupId)
    .set({ seasons: { pendingClose: pending } }, { merge: true });
  console.log(
    '[season] correction window opened',
    groupId,
    seasonId,
    reason,
    new Date(pending.closeAt).toISOString(),
  );
  return pending;
}

/** Shut the window without closing the season — an extension, an early manual
 *  close, or the season ceasing to be due because its target moved. */
async function clearPendingClose(groupId: string): Promise<void> {
  await db
    .collection('groups')
    .doc(groupId)
    .set(
      { seasons: { pendingClose: admin.firestore.FieldValue.delete() } },
      { merge: true },
    );
}

/** An evening this old is not waiting for its seal any more. Generous: the seal
 *  fires on the roster trigger within seconds, so a day is already three orders
 *  of magnitude of slack. */
const STALE_SEAL_MS = 24 * 60 * 60 * 1000;

/** How far ahead still counts as "about to be played". A game can be started
 *  before its scheduled kickoff, so a window that ends at `now` misses it. */
const STARTING_SOON_MS = 3 * 60 * 60 * 1000;

async function clubIsQuiet(
  groupId: string,
  /** `afterSeal` is the moment an evening has just been sealed. The evening the
   *  season would be split across is the one that ended a second ago, so the
   *  only thing that may still block is another evening genuinely mid-play —
   *  not next week's clone, and not tonight's second game sitting unstarted.
   *  The hourly sweep keeps the wider guard, where "is anything about to
   *  happen" is the only question it can ask. */
  opts?: { mode?: 'sweep' | 'afterSeal'; exceptGameId?: string },
): Promise<{
  ok: boolean;
  blocker?: 'openGame' | 'unsealedGame';
}> {
  // What must not happen is closing ACROSS an evening: each mini-game commits
  // separately, so rounds 1-3 would land in the old season and 4-6 in the new,
  // while the player's career total — written in the same batch — keeps the
  // whole. That is a game already under way, not a game on the calendar.
  //
  // This used to block on any game in scheduled/open/locked/active, with no
  // time bound. Nearly every real club runs a recurring fixture, so next
  // week's clone always sits in `scheduled` or `open` — and the season could
  // therefore never close, on any path, for any of them. The gap between two
  // evenings is exactly when a season SHOULD close.
  //
  // Bounded below as well as above: a game left open days ago is stale (the
  // cleanup sweep owns those) and must not hold a club's season hostage
  // forever.
  const now = Date.now();
  const afterSeal = opts?.mode === 'afterSeal';
  const open = await db
    .collection('games')
    .where('groupId', '==', groupId)
    .where(
      'status',
      'in',
      afterSeal ? ['active'] : ['scheduled', 'open', 'locked', 'active'],
    )
    // Forward as well as back. An evening that kicked off early — the teams
    // turned up at 19:40 for a 20:00 game and pressed start — has a startsAt in
    // the future while the rotation is already running, and an upper bound of
    // `now` walked straight past it. The window is the evening, not the clock.
    .where('startsAt', '<=', now + STARTING_SOON_MS)
    .where('startsAt', '>=', now - TONIGHT_MS)
    .limit(2)
    .get();
  if (open.docs.some((d) => d.id !== opts?.exceptGameId)) {
    return { ok: false, blocker: 'openGame' };
  }

  // Finished but not yet sealed. Closing in that gap makes sealRoundSummary
  // compare tonight against a table with no history, so every stat reads as a
  // brand-new club record — and the summary is written once, so the wrong
  // story is permanent.
  const recent = await db
    .collection('games')
    .where('groupId', '==', groupId)
    .where('status', '==', 'finished')
    .orderBy('startsAt', 'desc')
    .limit(3)
    .get();
  for (const g of recent.docs) {
    // The evening that has JUST been sealed is not an evening waiting to be.
    //
    // `exceptGameId` was passed on the afterSeal path and could never match
    // anything: the query above admits only 'active' games and the evening the
    // seal just finished is 'finished'. Applied here it finally does what its
    // name says — this is the query the sealed game actually appears in, it is
    // the newest row in it, and skipping it saves the `roundSummaries` read
    // that exists only to confirm the summary this very execution wrote.
    if (g.id === opts?.exceptGameId) continue;
    const data = g.data() as PlayableEvening & { startsAt?: unknown };
    // Only a game that was actually played gets sealed; one the cleanup
    // finished without play never will, so it must not block forever. Same
    // evidence the seal itself uses — if these two ever disagreed, a club
    // would be blocked from closing a season by an evening that was never
    // going to be sealed, or would close over one still waiting to be.
    if (!didEveningHappen(data)) continue;
    // …and neither will an evening that was closed before the seal existed.
    //
    // `roundSummaries` began on 26.08.2026. Every evening finished before that
    // carries no `endedBy` — that absence is exactly what `isLegacyClose`
    // reads to call it 'happened' — and no summary will ever be written for
    // it, because nothing will ever run the seal over a terminal game again.
    // So "finished but not yet sealed" was permanently true for them, and this
    // guard refused to let the club close a season, enable the feature, or
    // undo a close, for ever, while the Hebrew told the admin to wait for an
    // update that had already finished eight weeks earlier.
    //
    // Measured on production: 24 of the 30 clubs that have ever finished a
    // game were blocked by this, permanently. The window only advances when
    // the club plays a NEW evening, and these games are terminal.
    if (data.endedBy !== 'admin' && data.endedBy !== 'auto') continue;
    // A second floor, for the same failure shape from a different cause: the
    // seal runs on the roster trigger within seconds of the close, so an
    // evening that finished yesterday and still has no summary is not waiting
    // for one — something dropped it, and a dropped seal must not hold the
    // club's season hostage in perpetuity either.
    const startsAt = typeof data.startsAt === 'number' ? data.startsAt : 0;
    if (startsAt > 0 && now - startsAt > STALE_SEAL_MS) continue;
    const summary = await db.collection('roundSummaries').doc(g.id).get();
    if (!summary.exists) {
      return { ok: false, blocker: 'unsealedGame' };
    }
  }
  return { ok: true };
}

/** The club's ALL-TIME sealed evenings. Never resets.
 *
 *  From the counter and not from a query over games: deleting a game
 *  decrements nothing, so a live count drifts below the evenings that were
 *  actually credited. */
async function sealedEveningsOf(groupId: string): Promise<number> {
  const rec = await db.collection('clubRecords').doc(groupId).get();
  const n = (rec.data() as { eveningsSealed?: number } | undefined)?.eveningsSealed;
  return typeof n === 'number' && n > 0 ? n : 0;
}

/**
 * How many evenings a season has actually held, counted from the GAMES that
 * carry its stamp.
 *
 * `seasons.playedRounds` is a mirror, and a mirror can drift. It drifted badly
 * on a real club: a season reopened from an archive whose `completedRounds`
 * had itself inherited the club's lifetime count came back holding 22 while
 * the stats screen — which counts stamped games — showed 0 for the same
 * season. Two screens, one season, two numbers, and nothing to arbitrate.
 *
 * The games are the arbiter. Every game is stamped with the open season's id
 * the moment it goes active (see onGameRosterChanged), so the stamp is the
 * only record of which season an evening was played in, and
 * `didEveningHappen` is the only thing allowed to say whether it happened.
 */
async function playedEveningsOfSeason(
  groupId: string,
  seasonId: string,
  /**
   * Season 1 owns the evenings played before the stamp existed.
   *
   * The stamp only began being written when the feature shipped, so a club
   * that carried its history into season 1 has evenings that belong to it and
   * carry nothing — nineteen of twenty-two on the one real club. Counting only
   * the stamped ones brought that season back holding 3, which is the same
   * defect as the counter subtraction this replaced, from the other side. The
   * client has encoded this rule since the feature shipped
   * (`src/utils/seasonScope.ts`, which the club screen's scan uses); the
   * server had not, and the two are now run side by side over the same games
   * in tests/logic/seasonCounterReconciliation.test.ts.
   */
  seasonNo?: number,
): Promise<number> {
  if (!seasonId) return 0;
  try {
    const snap = await db
      .collection('games')
      .where('groupId', '==', groupId)
      .where('status', 'in', ['finished', 'cancelled'])
      .orderBy('startsAt', 'desc')
      .limit(300)
      .get();
    // The rule itself lives in `seasonCounters`, with the client's copy of it
    // under the same test. This function is the query.
    const games: StampedEvening[] = snap.docs.map(
      (d) => d.data() as StampedEvening,
    );
    return countSeasonEvenings(games, seasonId, seasonNo);
  } catch (err) {
    // A failed count must not become a zero: returning -1 lets the caller keep
    // whatever it already had rather than wiping a season's progress because
    // one query failed.
    console.warn('[season] season count failed', groupId, seasonId, err);
    return -1;
  }
}

/**
 * How many evenings a club has actually played, counted from the GAMES.
 *
 * `clubRecords.eveningsSealed` only began on 26.08.2026, when evening-sealing
 * shipped, so it cannot see a club's earlier history: a club with 19 finished
 * evenings had a counter of 7. That is fine for measuring a season FORWARD —
 * it increments on every seal — and useless for answering "what has this club
 * already played", which is exactly what season 1 is seeded with.
 *
 * So the history is counted where it actually lives. Bounded to the same 200
 * terminal documents the club-stats scan reads, and asked of the one module
 * that decides whether an evening happened, so this number can never disagree
 * with the "מפגשים שנערכו" the club screen has shown all along.
 */
async function playedEveningsFromGames(groupId: string): Promise<number> {
  try {
    const snap = await db
      .collection('games')
      .where('groupId', '==', groupId)
      .where('status', 'in', ['finished', 'cancelled'])
      .orderBy('startsAt', 'desc')
      .limit(200)
      .get();
    return countPlayedEvenings(snap.docs.map((d) => d.data() as PlayableEvening));
  } catch (err) {
    // Never fatal: a failed count falls back to the counter, which is the
    // behaviour this replaced rather than something worse.
    console.warn('[season] history count failed', groupId, err);
    return 0;
  }
}

/**
 * A season's progress.
 *
 * `seasons.playedRounds` is the number the club is SHOWN, seeded when the
 * season opens and incremented by every seal. Reading it here means the sweep
 * closes a season on the same number the card displays — they used to be
 * computed two different ways, so a club could read "19 מתוך 24" while the
 * sweep measured 7.
 *
 * Falls back to the old derivation for a season opened before this shipped,
 * which has no seeded mirror to read.
 *
 * Either way the number is relative to where the season started. The counter
 * behind the fallback is all-time and never resets, so a season has to
 * remember its own zero: `roundsAtStart` is stamped when the season opens — 0
 * when the season continues the club's history (season 1 of an existing club
 * owns everything played so far, which is what "continue" means), and the
 * all-time count at that moment for every season opened after a close. Without
 * the offset a rounds target is broken for every season after the first:
 * season 2 of a club with 200 sealed evenings would be measured against 200
 * and be "due" the instant it opened, over and over.
 */
async function completedRoundsOf(
  groupId: string,
  roundsAtStart?: number,
  playedRounds?: number,
): Promise<number> {
  // The choice between the mirror and the fallback is the whole of this
  // function, and it is made in `seasonCounters` where a test can reach it.
  // Reading the counter only when the fallback is actually taken keeps the
  // common case free of a `clubRecords` read.
  if (typeof playedRounds === 'number' && playedRounds >= 0) {
    return completedRoundsFrom(0, roundsAtStart, playedRounds);
  }
  return completedRoundsFrom(await sealedEveningsOf(groupId), roundsAtStart);
}

async function requireClubAdmin(groupId: unknown, uid: string) {
  if (typeof groupId !== 'string' || !groupId) {
    throw new HttpsError('invalid-argument', 'groupId required');
  }
  const snap = await db.collection('groups').doc(groupId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'club not found');
  const g = snap.data() as { adminIds?: string[]; name?: string; seasons?: unknown };
  if (!Array.isArray(g.adminIds) || !g.adminIds.includes(uid)) {
    throw new HttpsError('permission-denied', 'admin only');
  }
  return { ref: snap.ref, group: g };
}

/** The chips the settings screen offers. NOT the range the server accepts —
 *  that is isValidSeasonMonths (1–24), the same rule the client validates a
 *  custom length against. These three were used as an acceptance list, and
 *  anything outside them was silently rewritten to 6: an admin who chose an
 *  8-month winter league got a 6-month one, approved a sheet that said 8, and
 *  was never told. Seven independent reviewers found this. */
const MONTH_CHOICES = [1, 3, 6, 12];

/** Add months, clamped to the last valid day. Mirrors src/utils/seasonLifecycle
 *  so both sides agree; there is no month arithmetic anywhere else here. */
function addMonthsClampedServer(from: number, months: number): number {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

/**
 * Switch seasons on for a club.
 *
 * Everything already played becomes season 1. The admin then chooses whether
 * to seal it now — history gets its champions and season 2 starts empty — or
 * to carry season 1 on to a target.
 *
 * Carrying on is the subtle one: the target is measured from THIS MOMENT, not
 * from the club's first game. A two-year-old club choosing six months would
 * otherwise be handed a deadline eighteen months past and season 1 would close
 * on save, which is the exact opposite of "continue".
 */
/**
 * Close every season that has reached its target.
 *
 * Until this existed, a season's finish line was a decoration: both cadences
 * could be set, shown and moved, and nothing ever acted on them — only the
 * admin's manual "end now" actually closed anything.
 *
 * Three rules, and each of them is here because the alternative is worse:
 *
 *   DUE, not overdue. A date target fires the first hour after it passes; a
 *   rounds target the first hour after the count is reached. There is no grace
 *   period — a season that has met its terms is over.
 *
 *   QUIET, or wait. `clubIsQuiet` is checked per club and a busy one is simply
 *   skipped until the next run. Closing across a live evening splits it between
 *   two seasons: each mini-game commits separately, so the first rounds land in
 *   the old season and the rest in the new. Waiting an hour costs nothing;
 *   splitting an evening cannot be undone.
 *
 *   ONE AT A TIME, and never fatally. Each club is wrapped on its own, because
 *   a single club whose close throws must not stop the sweep from reaching the
 *   others. `closeSeason` is idempotent on its own (the archive is a create()),
 *   so a retry after a partial failure cannot double-archive.
 */
/**
 * Close one season and open the next: archive, re-base, announce.
 *
 * Extracted because there are now TWO ways in. The hourly sweep is the
 * backstop — it catches date cadences and anything the other path missed — and
 * the seal of an evening is the fast one: the moment a club finishes the round
 * that meets its target, the season is over, and waiting up to an hour to say
 * so made the app look like it had not noticed. One implementation, because a
 * second way to close a season is a second set of bugs on the only unattended
 * path that destroys production data.
 */
async function performSeasonClose(args: {
  groupId: string;
  groupName: string;
  seasonId: string;
  seasonNo: number;
  startedAt: number;
  played: number;
  roundsAtStart: number;
  cadence: { type?: string; months?: number; endsAt?: number; targetRounds?: number };
  count: number;
  now: number;
}): Promise<boolean> {
  const { groupId, groupName, seasonId, seasonNo, cadence, now } = args;
  const groupRef = db.collection('groups').doc(groupId);

  // ── Pre-flight: is this season still the one that is running? ───────────
  //
  // Both callers arrive holding a snapshot they took earlier — the sweep's is
  // from the top of a run that walks every club in the app, which can be
  // minutes old. Two things can have changed underneath it, and both are
  // destructive:
  //
  //   • The admin switched seasons OFF. The close write does not carry
  //     `enabled`, so the club got its table wiped, its titles awarded and
  //     everybody pushed, and was left with seasons off and an archive no
  //     screen can reach.
  //   • Another path already closed this season. The seal closes a rounds
  //     season the instant the evening meets it (`closeSeasonIfRoundsTargetMet`)
  //     and the sweep is the backstop for the same season; they overlap by
  //     design, and the sweep's stale snapshot would then close a season that
  //     is already in the archive.
  //
  // One read, on a path that runs a handful of times a year per club.
  const preSnap = await groupRef.get();
  const pre = (preSnap.data() as { seasons?: Record<string, unknown> } | undefined)
    ?.seasons;
  if (pre?.enabled !== true || pre?.currentId !== seasonId) {
    console.log(
      '[season] close abandoned — the club moved under us',
      groupId,
      seasonId,
      { enabled: pre?.enabled, currentId: pre?.currentId },
    );
    return false;
  }

  // Sealed WITH the season, because the block's copy is reset to [] two dozen
  // lines below and the archive is then the only place it exists.
  const targetHistory = Array.isArray(pre.targetHistory)
    ? (pre.targetHistory as unknown[])
    : [];
  // An admin moved the finish line to where the club already stood. That is a
  // close, and `updateSeasonTarget` recorded who did it precisely so the
  // archive can say so rather than presenting a cut-short season as one that
  // ran its course. Same three fields `endSeasonNow` seals.
  const movedToClose = pre.targetMovedToClose as
    | { at?: number; by?: string; byName?: string }
    | undefined;

  const result = await closeSeason({
    db,
    groupId,
    groupName,
    seasonId,
    seasonNo,
    startsAt: args.startedAt,
    completedRounds: args.played,
    roundsAtStart: args.roundsAtStart,
    originalTarget: cadence as { type: string; endsAt?: number; targetRounds?: number },
    targetHistory,
    ...(movedToClose
      ? {
          endedEarly: true,
          ...(movedToClose.by ? { closedBy: movedToClose.by } : {}),
          ...(movedToClose.byName ? { closedByName: movedToClose.byName } : {}),
        }
      : {}),
    now,
  });

  // ── The lifecycle write, behind the same identity check ─────────────────
  //
  // `closeSeason` has its own `archived:false` latch for a redelivery, and it
  // guards the ARCHIVE — not this. So a seal-close and a sweep racing on the
  // same club both fell through to here and the loser re-wrote the lifecycle
  // of the season the winner had just OPENED: `startedAt` moved to now,
  // `playedRounds` back to 0, `targetHistory` erased, and `count` incremented
  // past anything the club has ever played — which is the number the undo
  // button uses to decide which season to reopen, so it then pointed at one
  // that does not exist.
  //
  // In a transaction, and re-checking `currentId`, because that is the only
  // field that says which season the club is on. The loser now finds it
  // already advanced and writes nothing.
  const nextNo = seasonNo + 1;
  const nextRoundsAtStart = await sealedEveningsOf(groupId);
  const nextCadence = rebaseCadence(cadence, args.startedAt, now);
  const advanced = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(groupRef);
    const sea = (fresh.data() as
      | { seasons?: { currentId?: string; count?: number } }
      | undefined)?.seasons;
    if (sea?.currentId !== seasonId) return false;
    // Counted from what the document holds NOW, not from the caller's
    // snapshot. `count` is what the undo button uses to decide which season to
    // reopen, and the sweep's copy of it can be minutes old.
    const closedSoFar = archNum(sea.count ?? args.count);
    tx.set(
      groupRef,
      {
        seasons: {
          currentNo: nextNo,
          currentId: `s${nextNo}`,
          startedAt: now,
          roundsAtStart: nextRoundsAtStart,
          playedRounds: 0,
          reopenedAt: 0,
          // The whole reason the sweep is safe to run hourly: without a re-based
          // end date it would close this club again next hour, and the hour
          // after that, forever.
          cadence: nextCadence,
          targetHistory: [],
          // Both are facts about the season that just ended, and the new one
          // inherits neither: a stale `targetMovedToClose` would mark the NEXT
          // archive as cut short, and a stale `dueBlockedSince` would report a
          // fresh season as stuck the moment it opened.
          targetMovedToClose: admin.firestore.FieldValue.delete(),
          dueBlockedSince: admin.firestore.FieldValue.delete(),
          // The window closed with the season it belonged to. Left behind it
          // would name a season that no longer exists, and `currentPendingClose`
          // would refuse it — but the sweep would then open a fresh window on
          // the NEW season the first hour it came due, on top of litter. Delete
          // it in the same write that advances the lifecycle, so the two can
          // never disagree.
          pendingClose: admin.firestore.FieldValue.delete(),
          count: closedSoFar + 1,
        },
      },
      { merge: true },
    );
    return true;
  });
  if (!advanced) {
    console.log('[season] lifecycle already advanced by another path', groupId, seasonId);
  }
  if (result.archived) {
    await announceSeasonClosed({ groupId, groupName, seasonId, seasonNo });
  }
  return advanced;
}

/**
 * The evening just sealed was the one the season was waiting for — so end it
 * now, not at the top of the next hour.
 *
 * Only a ROUNDS cadence can be finished by an evening; a date cadence is
 * finished by a date, and that is the sweep's job. Best-effort throughout: the
 * seal has already committed, and a season that fails to close here is closed
 * by the sweep within the hour exactly as before.
 */
async function closeSeasonIfRoundsTargetMet(
  groupId: string,
  sealedGameId: string,
  /**
   * What the seal already read.
   *
   * This used to open `groups/{groupId}` for itself, which was the third read
   * of that one document inside a single trigger execution — the season stamp
   * took the first, the seal the second. `played` arrives already counting the
   * evening that has just been sealed, because the caller committed that
   * increment a few lines before calling and its own snapshot predates it.
   */
  known: { name: string; seasons: LiveSeasonsBlock; played: number },
): Promise<void> {
  try {
    const g = { name: known.name, seasons: known.seasons };
    const seasons = g.seasons;
    if (!seasons?.enabled || !seasons.currentId) return;
    const cadence = seasons.cadence ?? {};
    // Only a ROUNDS finish line can be met by an evening, and it is read
    // through the same function the sweep uses: the two used to classify a
    // cadence independently, so an admin could be told one thing by the card
    // and closed on another by whichever path got there first.
    const line = seasonFinishLine(cadence);
    if (line.kind !== 'rounds') return;
    const target = line.target;

    const played = known.played;
    if (played < target) return;

    // An admin who has just pulled the season back open gets their grace here
    // too, for the same reason: they reopened it because it met its target,
    // and closing it again on the next evening's seal would be the app
    // arguing.
    const reopenedAt = archNum(seasons.reopenedAt);
    const now = Date.now();
    if (reopenedAt > 0 && now - reopenedAt < REOPEN_GRACE_MS) return;

    // ⚠️ Meeting the target no longer CLOSES the season — it opens the 24-hour
    // correction window (§4). The close used to run right here, seconds after
    // the final whistle, which left an admin who spotted a wrong score with no
    // way to fix it: the archive was sealed and the titles handed out before
    // anyone had looked at the sheet.
    //
    // The seal is still the right moment to notice. It is no longer the moment
    // to decide. The sweep runs the close a day later, from state — see the
    // note on `PendingClose` for why there is no scheduled task to cancel.
    //
    // No quiet check here: the window is allowed to open mid-evening. What the
    // quiet check guards is the CLOSE, and that is an hour of sweep away.
    if (currentPendingClose(seasons)) return;
    await openPendingClose(groupId, seasons.currentId, 'rounds', now);
    console.log(
      `[season] correction window opened on seal: ${groupId} ${seasons.currentId} at ${played}/${target}`,
    );
    void sealedGameId;
  } catch (err) {
    console.error('[season] close-on-seal failed', groupId, err);
    await reportServerError({
      operation: 'closeSeasonOnSeal',
      err,
      context: { groupId, gameId: sealedGameId },
    });
  }
}

/**
 * How many clubs the scan pulls at a time.
 *
 * The scan used to be one unbounded `.get()` — every club with seasons on,
 * materialised into a single array inside a 512MiB function, before a line of
 * work was done. It answers "is this club due" from two fields, so the page
 * size is about bounding the array and the round trip, not about the work.
 */
const SEASON_SCAN_PAGE = 200;

/**
 * How many seasons one sweep will actually close.
 *
 * A close is the most expensive thing this job does — every player row, every
 * pair row, a batch of titles and a push per participant — and this sweep runs
 * LAST inside `cronEvery60Min`, sharing one 540-second budget with everything
 * before it. Without a ceiling, one sixty-player club with a few thousand pair
 * documents can spend the whole remainder and the clubs after it in the scan
 * are never reached — silently, because the job simply times out.
 *
 * A season that does not close this hour closes next hour. The sweep has never
 * been the fast path (the seal is), so the cost of deferring is an hour and the
 * cost of not deferring is an unbounded, invisible starvation.
 */
const MAX_CLOSES_PER_SWEEP = 5;

/**
 * How long a DUE season may sit blocked before it stops being "busy tonight"
 * and starts being a fault somebody has to look at.
 *
 * Both blockers are supposed to be transient — an evening in play, an evening
 * waiting for its seal — and `clubIsQuiet` already has floors that release a
 * stale game. So a season still blocked a day after it came due is blocked by
 * something those floors do not cover, and it will stay blocked for ever.
 */
const DUE_BLOCKED_STUCK_MS = 24 * 60 * 60 * 1000;

async function runSeasonRollovers(): Promise<void> {
  const now = Date.now();

  let closed = 0;
  let waiting = 0;
  let noFinishLine = 0;
  /** Seasons that met their finish line this hour and began their window. */
  let pendingOpened = 0;
  /** Seasons sitting inside a window that has not shut yet. */
  let pendingWaiting = 0;
  let scanned = 0;
  let deferred = 0;
  let cursor: admin.firestore.QueryDocumentSnapshot | null = null;

  // Paged, and only the two fields the decision is made from.
  //
  // The scan used to fetch whole club documents — 2,259 bytes measured where
  // 666 are needed — with no `.select()`, no `.limit()` and no cursor, for
  // every club with seasons on, every hour. `name` is the only other field it
  // uses, and only on the rare club it actually closes.
  //
  // Ordered by document id so the cursor is total and stable; the equality
  // filter plus `__name__` is served by the automatic single-field index, so
  // this needs no composite index of its own.
  for (;;) {
    let q = db
      .collection('groups')
      .where('seasons.enabled', '==', true)
      .select('name', 'seasons')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(SEASON_SCAN_PAGE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;
    cursor = page.docs[page.docs.length - 1];

    for (const doc of page.docs) {
      scanned += 1;
      const g = doc.data() as {
        name?: string;
        seasons?: {
          enabled?: boolean;
          currentNo?: number;
          currentId?: string;
          startedAt?: number;
          roundsAtStart?: number;
          /** The number the club is SHOWN, and now the one the sweep closes on. */
          playedRounds?: number;
          reopenedAt?: number;
          cadence?: { type?: string; months?: number; endsAt?: number; targetRounds?: number };
          count?: number;
          /** When this season first came due and could not be closed. */
          dueBlockedSince?: number;
          /** Set while the season is waiting out its 24-hour correction window. */
          pendingClose?: PendingClose;
        };
      };
      const seasons = g.seasons;
      if (!seasons?.enabled || !seasons.currentId) continue;
      const cadence = seasons.cadence ?? {};

      try {
        // A DATE cadence is answered from the club document already in hand. Only
        // a rounds cadence needs the counter, so the common case — every club
        // that is simply not due yet — costs no read at all.
        //
        // `played` is computed ONCE. It used to be derived here to answer "is it
        // due", thrown away, and derived again identically three lines later to
        // pass to the close — two identical calls, each of which can cost a
        // `clubRecords` read on a season with no seeded mirror.
        let played = -1;
        const playedOnce = async (): Promise<number> => {
          if (played < 0) {
            played = await completedRoundsOf(
              doc.id,
              seasons.roundsAtStart,
              seasons.playedRounds,
            );
          }
          return played;
        };

        // What ends this season, decided by `seasonFinishLine` — the same
        // function the close-on-seal path asks, so the hourly backstop and the
        // seal can no longer read one cadence two ways.
        const line = seasonFinishLine(cadence);
        if (line.kind === 'none') {
          // A cadence with no finish line is a season that can never end, and
          // nothing anywhere said so. It used to be a bare `continue` — the
          // only branch in this function that produced no output at all, which
          // is how a club could sit in a season that was never going to close
          // and look exactly like a club that simply was not due yet.
          noFinishLine += 1;
          console.warn(
            '[season] cadence has no finish line — this season cannot end',
            doc.id,
            seasons.currentId,
            line.cadence,
          );
          continue;
        }
        // The count is asked for ONLY by a rounds line, so every club that is
        // simply not due yet still costs no read.
        const due = isSeasonDue(line, {
          played: line.kind === 'rounds' ? await playedOnce() : 0,
          now,
          today: todayIn(undefined, now),
        });
        if (!due) {
          // Whatever was blocking it is moot now — the finish line moved, or the
          // count was corrected. Clearing costs a write only on the rare club
          // that actually carries the stamp.
          if (archNum(seasons.dueBlockedSince) > 0) {
            await db
              .collection('groups')
              .doc(doc.id)
              .set(
                { seasons: { dueBlockedSince: admin.firestore.FieldValue.delete() } },
                { merge: true },
              );
          }
          continue;
        }

        // A season an admin has just REOPENED is due the instant it comes back —
        // it met its target, that is why it closed. Closing it again within the
        // hour would make the undo button useless and look like the app arguing.
        // The grace is for the admin to move the finish line; after it, a target
        // that is still met still closes the season, which is correct.
        const reopenedAt = archNum(seasons.reopenedAt);
        if (reopenedAt > 0 && now - reopenedAt < REOPEN_GRACE_MS) {
          console.log('[season] due but just reopened — holding', doc.id);
          continue;
        }

        // ── The correction window (§4, §5) ────────────────────────────────
        //
        // Due does not mean closing. A season that has just met its finish
        // line opens a 24-hour window in which admins fix what the evening got
        // wrong and nobody may start a new one; only when that window has shut
        // does this sweep go on to the quiet check and the close.
        //
        // Everything is decided from `pendingClose` on the club document, so
        // an extension that deletes the field deletes the close with it. There
        // is no task in flight to outlive the decision that created it.
        const pending = currentPendingClose(seasons);
        if (!pending) {
          // A DATE season that is due while an evening is still running waits
          // for the whistle before its window starts (§5): the evening belongs
          // to this season and the admin cannot correct it until it is over.
          // A ROUNDS season cannot be in this position — the thing that made
          // it due was an evening ending.
          if (line.kind === 'date') {
            const clear = await clubIsQuiet(doc.id);
            if (!clear.ok) {
              console.log(
                '[season] date reached but an evening is still running — window waits',
                doc.id,
                clear.blocker,
              );
              continue;
            }
          }
          await openPendingClose(
            doc.id,
            seasons.currentId,
            line.kind === 'date' ? 'date' : 'rounds',
            now,
          );
          pendingOpened += 1;
          continue;
        }
        if (now < pending.closeAt) {
          // Still inside the window. Nothing to do and nothing wrong.
          pendingWaiting += 1;
          continue;
        }

        const quiet = await clubIsQuiet(doc.id);
        if (!quiet.ok) {
          // Not a failure the FIRST time. The club is mid-evening; it will be due
          // next hour too.
          //
          // But it was never anything else either, and that was the bug: a season
          // that is permanently blocked emitted one `console.log` an hour, for
          // ever, while a season that THROWS is written to the `errors` inbox a
          // person actually reads. So on the one unattended path that destroys
          // data, the transient failure was the loud one and the permanent
          // failure was silent — and the production `errors` collection has never
          // held a single seasons entry.
          //
          // `dueBlockedSince` is stamped once, the first hour a due season cannot
          // close, and cleared by the close or by the season ceasing to be due.
          // Past a day it is not "busy tonight" any more and it is reported.
          waiting += 1;
          const blockedSince = archNum(seasons.dueBlockedSince);
          if (blockedSince <= 0) {
            await db
              .collection('groups')
              .doc(doc.id)
              .set({ seasons: { dueBlockedSince: now } }, { merge: true });
            console.log('[season] due but busy — waiting', doc.id, quiet.blocker);
          } else if (now - blockedSince >= DUE_BLOCKED_STUCK_MS) {
            const hours = Math.round((now - blockedSince) / (60 * 60 * 1000));
            console.error(
              '[season] due and blocked for',
              hours,
              'hours',
              doc.id,
              quiet.blocker,
            );
            // Reported, not thrown: the sweep must still reach every other club.
            // `reportServerError` folds repeats into one row with a count, so an
            // hourly re-report is one line in the inbox that keeps growing rather
            // than a hundred rows nobody reads.
            await reportServerError({
              operation: 'seasonRolloverBlocked',
              err: new Error(
                `season ${seasons.currentId} is due and has been blocked by ` +
                  `${quiet.blocker} for ${hours}h`,
              ),
              context: {
                groupId: doc.id,
                seasonId: seasons.currentId ?? '',
                blocker: quiet.blocker ?? '',
                blockedSince,
              },
            });
          } else {
            console.log('[season] due but busy — waiting', doc.id, quiet.blocker);
          }
          continue;
        }

        if (closed >= MAX_CLOSES_PER_SWEEP) {
          // Deliberately after the quiet check, so the log says a club was ready
          // and deferred rather than that it was skipped for an unknown reason.
          deferred += 1;
          continue;
        }

        const seasonId = seasons.currentId;
        const seasonNo = seasons.currentNo ?? 1;
        const didClose = await performSeasonClose({
          groupId: doc.id,
          groupName: g.name ?? '',
          seasonId,
          seasonNo,
          startedAt: seasons.startedAt ?? 0,
          played: await playedOnce(),
          roundsAtStart: seasons.roundsAtStart ?? 0,
          cadence,
          count: seasons.count ?? 0,
          now,
        });
        if (didClose) closed += 1;
      } catch (err) {
        console.error('[season] rollover failed', doc.id, err);
        // And into the inbox a person actually reads. A season that fails to
        // roll is invisible otherwise, on the one path that destroys data.
        await reportServerError({
          operation: 'seasonRollover',
          err,
          context: { groupId: doc.id, seasonId: seasons.currentId ?? '' },
        });
      }
    }

    if (page.size < SEASON_SCAN_PAGE) break;
  }

  if (closed || waiting || noFinishLine || deferred || pendingOpened || pendingWaiting) {
    console.log(
      `[season] rollovers: ${closed} closed, ${pendingOpened} entered the ` +
        `correction window, ${pendingWaiting} inside it, ${waiting} waiting, ` +
        `${deferred} deferred, ${noFinishLine} with no finish line, ` +
        `${scanned} scanned`,
    );
  }
}

export const enableClubSeasons = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    // Runs closeSeason (or its inverse): a transaction per player, one per
    // pair, and a batch of titles. The onCall default is 60 seconds, and a
    // sixty-player club is comfortably past it — being killed halfway leaves
    // the half-closed state the resume path exists to recover from.
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    const data = (request.data ?? {}) as {
      groupId?: unknown;
      closeFirstNow?: unknown;
      cadenceType?: unknown;
      months?: unknown;
      targetRounds?: unknown;
      /** 'continue' carries season 1 on; 'sealNow' seals it and opens 2. */
      historyChoice?: unknown;
      /** Chosen last day of season 1, when carrying it on under a date cadence. */
      season1EndsOn?: unknown;
    };
    const { ref, group } = await requireClubAdmin(data.groupId, uid);
    const groupId = data.groupId as string;

    const existing = group.seasons as
      | { count?: number; enabled?: boolean; roundsAtStart?: number }
      | undefined;
    if (existing?.enabled) {
      throw new HttpsError('failed-precondition', 'seasons already on');
    }

    const now = Date.now();
    // Offset by whatever a previous run of seasons already sealed.
    //
    // Un-offset this is the club's ALL-TIME evening count, and it feeds two
    // things that then get it wrong for a club switching seasons back on: the
    // "continue" branch clamps its rounds target to `played + 1`, so an admin
    // choosing 24 silently gets 201; and the seal branch hands it to the close
    // as the season's length.
    const played = await completedRoundsOf(groupId, existing?.roundsAtStart);
    // The ABSOLUTE sealed count, which is a different number from `played`.
    //
    // `played` is season-relative: all-time minus the previous run's offset.
    // `roundsAtStart` is subtracted FROM the all-time count by
    // completedRoundsOf, so stamping the relative number there double-counts
    // the offset. A club with 200 sealed evenings whose last run started at
    // 180 has played 20; stamping 20 makes its next season read 180 evenings
    // as already played, and a 24-round target is due the hour it opens —
    // precisely the failure the comment beside that stamp warns about.
    const sealedAllTime = await sealedEveningsOf(groupId);
    const type = data.cadenceType === 'rounds' ? 'rounds' : 'date';

    // `null` and not `undefined` on the unused half: this map is written with
    // merge:true, and only an explicit null clears a field a previous cadence
    // left behind.
    let cadence: {
      type: string;
      months?: number | null;
      endsAt?: number | null;
      /** First and LAST day of the season, in the club's calendar. */
      startsOn?: CalendarDate | null;
      endsOn?: CalendarDate | null;
      targetRounds?: number | null;
    };
    if (type === 'rounds') {
      const asked = Number(data.targetRounds);
      if (!Number.isFinite(asked) || asked <= 0) {
        throw new HttpsError('invalid-argument', 'targetRounds required');
      }
      // The OTHER type's fields are cleared explicitly, not left out.
      //
      // The seasons block is written with merge:true, and a merge into a
      // nested map merges field by field — so simply omitting `endsAt` leaves
      // whatever a previous configuration put there. A club that switched from
      // a date season to a rounds season kept an `endsAt` on a cadence that
      // has no date at all. Nothing reads it today (both the sweep and the
      // card branch on `type` first), which is exactly why it would have sat
      // there until something did.
      cadence = {
        type: 'rounds',
        targetRounds: Math.round(asked),
        months: null,
        endsAt: null,
        endsOn: null,
        startsOn: null,
      };
    } else {
      // Any length the CLIENT would accept, because the client is where the
      // admin chose it. Refusing here would be honest; rewriting silently is
      // not, and 6 was neither what they picked nor what they confirmed.
      const askedM = Number(data.months);
      const months = isValidSeasonMonths(askedM) ? askedM : 6;
      // `months` is stored beside the date, not just the date. Without it a
      // season that rolls over has no way to compute its OWN end date, and
      // inherits a deadline that has already passed — see rebaseCadence.
      // Calendar boundaries alongside the legacy epoch.
      //
      // `endsOn` is the LAST day the season is valid, in the club's calendar:
      // three months from 16.09 runs through 15.12, and the next season begins
      // on the 16th. `endsAt` is still written so a client that predates this
      // keeps rendering something, and so the club already running a season on
      // it does not have its dates moved underneath it.
      const startsOn = todayIn(undefined, now);
      cadence = {
        type: 'date',
        months,
        startsOn,
        endsOn: seasonEndDate(startsOn, months),
        endsAt: addMonthsClampedServer(now, months),
        targetRounds: null,
      };
    }

    // Numbering CONTINUES across the feature being switched off and on again:
    // a club that ran seasons 1-3 and re-enables opens season 4, never 1.
    const closedSoFar = existing?.count ?? 0;

    // The SAME plan the settings screen and the confirmation sheet computed.
    //
    // Re-derived here from the club's own history rather than trusted from the
    // request: the refusal to carry on a season that is already full is a rule
    // about the club's data, and a rule only the client enforces is a rule an
    // old build or a replayed call walks straight through.
    const choice: HistoryChoice =
      data.historyChoice === 'sealNow' || data.closeFirstNow === true
        ? 'sealNow'
        : 'continue';
    const today = todayIn(undefined, now);
    const askedMonths = type === 'date' ? Number(data.months) : undefined;
    // A shipped client that predates the season-1 end picker sends no date.
    //
    // It must NOT be refused: 1.1.7 is live in the store and cannot learn to
    // send one, so requiring it turned "הפעל עונות" into "משהו השתבש" for
    // every club on the current build — reported within hours of the deploy,
    // and entirely my doing for putting the rule on the server first.
    //
    // Absent, season 1 simply runs the chosen length from today, which is what
    // the app did before the picker existed. A client that DOES send a date
    // still gets exactly what the admin chose.
    const season1EndsOn = isCalendarDate(data.season1EndsOn)
      ? data.season1EndsOn
      : type === 'date' && choice === 'continue' && isValidSeasonMonths(askedMonths)
        ? seasonEndDate(today, askedMonths as number)
        : undefined;
    const plan = planActivation({
      cadence: type,
      months: askedMonths,
      targetRounds: type === 'rounds' ? Math.round(Number(data.targetRounds)) : undefined,
      choice,
      // ZERO once the club has closed a season before.
      //
      // `playedEveningsFromGames` counts every evening the club has ever
      // played, and on a first activation that is exactly right: season 1 is
      // being asked to own that history. On a RE-activation it is wrong twice
      // over — those evenings are already sealed inside an archived season,
      // and counting them again refuses any target smaller than the club's
      // whole life. A club with 22 evenings behind it could not ask for a
      // 2-round season: the server answered failed-precondition and the app
      // showed "משהו השתבש" (owner report, reproduced on a real club).
      //
      // A season opened after a close starts at zero, which is what the close
      // itself already writes.
      playedHistory: closedSoFar > 0 ? 0 : await playedEveningsFromGames(groupId),
      today,
      season1EndsOn,
    });
    if (!plan.ok) {
      throw new HttpsError('failed-precondition', `season-plan:${plan.error}`);
    }
    // Carrying season 1 on under a DATE cadence: the admin picked its last day,
    // and the chosen length only starts applying from season 2.
    if (type === 'date' && choice === 'continue' && plan.endsOn) {
      cadence.startsOn = null; // season 1 reaches back as far as the club does
      cadence.endsOn = plan.endsOn;
      cadence.endsAt = null;
    }

    if (choice === 'sealNow') {
      const quiet = await clubIsQuiet(groupId);
      if (!quiet.ok) {
        throw new HttpsError('failed-precondition', quiet.blocker ?? 'busy');
      }
      const firstNo = closedSoFar + 1;
      await closeSeason({
        db,
        groupId,
        groupName: (group as { name?: string }).name ?? '',
        seasonId: `s${firstNo}`,
        seasonNo: firstNo,
        startsAt: 0, // display resolves the club's first game
        completedRounds: played,
        roundsAtStart: 0,
        // Assists were only collected from 21.06 and clean sheets from 17.08,
        // while clubs predate both. The spec awards titles anyway and flags it.
        partialData: true,
        now,
      });
      await ref.set(
        {
          seasons: {
            enabled: true,
            currentNo: firstNo + 1,
            currentId: `s${firstNo + 1}`,
            startedAt: now,
            // Everything played so far belongs to the season just sealed, so
            // the new one counts from here. Without this offset season 2 is
            // measured against the club's ALL-TIME evenings: a two-year-old
            // club that seals its history and picks a 24-round target is due
            // the moment it opens, and the sweep archives an empty season
            // within the hour — nine null awards, count bumped past anything
            // ever played.
            roundsAtStart: sealedAllTime,
            playedRounds: 0,
            reopenedAt: 0,
            // Measured from NOW: the cadence the admin just chose describes a
            // length, not a date in the sealed season's past.
            cadence: rebaseCadence(cadence, now, now),
            targetHistory: [],
            count: firstNo,
          },
        },
        { merge: true },
      );
      await announceSeasonClosed({
        groupId,
        groupName: (group as { name?: string }).name ?? '',
        seasonId: `s${firstNo}`,
        seasonNo: firstNo,
      });
      return { ok: true, closedSeasonNo: firstNo, currentNo: firstNo + 1 };
    }

    // Carry season 1 on. If the cadence counts rounds, the target has to be
    // ahead of what has already been played or "continue" ends it on save.
    //
    // ONLY for a club whose first season really is carrying its history. A
    // re-activation starts at zero (see the seasonSeed call below), so `played`
    // — which keeps growing while seasons are switched OFF — is not a floor for
    // anything: an admin who confirmed a 2-round season got one as long as
    // "every evening since the last close, plus one", silently, against a sheet
    // that promised 2.
    if (cadence.type === 'rounds' && closedSoFar === 0) {
      cadence.targetRounds = Math.max(cadence.targetRounds ?? 0, played + 1);
    }
    const no = closedSoFar + 1;
    await ref.set(
      {
        seasons: {
          enabled: true,
          currentNo: no,
          currentId: `s${no}`,
          startedAt: now,
          // A season starts at ZERO. Always, including the first one.
          //
          // It used to seed season 1 with the club's history, on the reasoning
          // that the first season owns everything played so far. The trouble is
          // that "everything played so far" was read from `eveningsSealed`, a
          // counter that only began on 26.08.2026 when evening-sealing shipped.
          // So a club that had played 19 evenings turned seasons on, asked for
          // 24, and was shown "7 מתוך 24" — not its history (19), and not a
          // fresh start (0), but however many evenings a young counter happened
          // to have seen. The owner's report, and he was right to push back:
          // "שיחקנו 19 ולא 7".
          //
          // Starting at zero fixes both halves. The number can no longer
          // disagree with what the club actually played, because it no longer
          // claims anything about the past — and "24 מחזורים" now means 24
          // evenings from the day you asked for them, which is what a person
          // means when they type it.
          //
          // The club's lifetime history is untouched and still shown as it
          // always was: "מפגשים שנערכו" on the club screen counts the games
          // themselves, which is why it correctly said 19 all along.
          // The club's real history, counted from its games. See seasonSeed:
          // the counter cannot see evenings older than 26.08.2026, and season 1
          // is supposed to own them.
          // Season 1 owns the club's history; season 5 does not.
          //
          // The seed exists because a club turning seasons on for the FIRST
          // time is asking its first season to hold everything played so far.
          // A club that has closed seasons before is asking for a NEW one, and
          // those evenings are already sealed in an archive — seeding them
          // again opened a 2-round season at 22 of 2, declared over before a
          // ball was kicked (owner report, reproduced on a real club).
          ...seasonSeed(
            await sealedEveningsOf(groupId),
            closedSoFar > 0 ? 0 : await playedEveningsFromGames(groupId),
          ),
          cadence,
          targetHistory: [],
          count: closedSoFar,
        },
      },
      { merge: true },
    );
    return { ok: true, currentNo: no, playedAlready: played };
  },
);

/**
 * Move the finish line of a running season.
 *
 * Allowed — an admin runs the club, and a season that lost six weeks to rain
 * genuinely needs adjusting. Refused when the new target is already behind the
 * club, in either cadence, because that is "end it now" in disguise and skips
 * the preview and confirmation the real action has.
 *
 * Every change is recorded on the club and shown. The protection here is
 * visibility, not prevention: a change everyone can see is a management
 * decision, and a quiet one is not.
 */
/**
 * Switch seasons off for a club.
 *
 * Deliberately does NOT close the running season. Closing is an archive plus a
 * table reset plus a set of titles, and none of that is what "I don't want this
 * feature" means — a manager who wants the season sealed has an action that
 * says so, with its own confirmation. Here the club simply goes back to one
 * table that never resets.
 *
 * Everything else on the block is left in place, `count` included, so
 * re-enabling continues the numbering: a club that ran seasons 1-3 opens
 * season 4, never season 1 again.
 */
export const disableClubSeasons = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    const data = (request.data ?? {}) as { groupId?: unknown };
    const { ref, group } = await requireClubAdmin(data.groupId, uid);
    const seasons = group.seasons as { enabled?: boolean } | undefined;
    if (!seasons?.enabled) return { ok: true, alreadyOff: true };
    await ref.set({ seasons: { enabled: false } }, { merge: true });
    return { ok: true };
  },
);

export const updateSeasonTarget = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    const data = (request.data ?? {}) as {
      groupId?: unknown;
      cadenceType?: unknown;
      months?: unknown;
      targetRounds?: unknown;
    };
    const { ref, group } = await requireClubAdmin(data.groupId, uid);
    const groupId = data.groupId as string;
    const seasons = group.seasons as
      | {
          enabled?: boolean;
          roundsAtStart?: number;
          /** The number on the card. The refusal below is about what the admin
           *  can SEE, so it has to be measured against the same figure. */
          playedRounds?: number;
          cadence?: { type: string; months?: number; endsAt?: number; targetRounds?: number };
          targetHistory?: unknown[];
        }
      | undefined;
    if (!seasons?.enabled) {
      throw new HttpsError('failed-precondition', 'seasons are off');
    }

    // The SAME quiet rule the other two close paths carry.
    //
    // Moving the finish line to where the club already stands ends the season
    // — the sweep closes it within the hour, or the next seal does it on the
    // spot — so this call produces the identical outcome to "סיים עונה עכשיו",
    // which refuses to run while an evening is in play. It had no such check,
    // which meant the ONE way to close a season mid-evening was the one that
    // never says it is closing anything. Closing across an evening splits it
    // between two seasons: each mini-game commits separately, so the first
    // מחזורון lands in the old season and the rest in the new.
    //
    // …but ONLY when the new target actually closes something — the check sits
    // below, once `played` is known. Gating every change refused the harmless
    // half: raising a target from 24 to 48 cannot close anything, and on a game
    // night an admin LENGTHENING the season was told "יש מחזור פתוח במועדון,
    // סיימו או בטלו אותו קודם" for an edit that does not touch the evening at
    // all — which is also exactly when the undo's own copy sends them here.
    const now = Date.now();
    // `playedRounds`, not a fresh derivation from `eveningsSealed`. Without it
    // this refused — or allowed — a new target against a number the club has
    // never been shown, so "the target is already behind you" could be said
    // about a season the card says has three evenings left. Four independent
    // reviewers found it; the sweep and the card already agree on this figure.
    const played = await completedRoundsOf(
      groupId,
      seasons.roundsAtStart,
      seasons.playedRounds,
    );
    const type = data.cadenceType === 'rounds' ? 'rounds' : 'date';

    // §8 — the KIND of season is frozen once the season has played an evening.
    //
    // Not a style rule. The two cadences are measured in different units, and
    // every number already recorded against this season was recorded under one
    // of them: a rounds season that becomes a date season has a `playedRounds`
    // count that no longer decides anything, and a date season that becomes a
    // rounds season has evenings behind it that were never counted towards a
    // target. Either way the season's own history stops describing it, and the
    // archive it eventually writes is measured in a unit it did not run in.
    //
    // Before the first evening there is nothing to contradict, so an admin who
    // picked the wrong kind on Monday can still fix it on Monday.
    const currentType = seasons.cadence?.type === 'rounds' ? 'rounds' : 'date';
    if (type !== currentType && played > 0) {
      throw new HttpsError(
        'failed-precondition',
        `cannot change a ${currentType} season to ${type} after ${played} rounds`,
      );
    }
    const askedRounds =
      typeof data.targetRounds === 'number' ? Math.round(data.targetRounds) : null;
    if (type === 'rounds' && askedRounds !== null && askedRounds <= played) {
      const quiet = await clubIsQuiet(groupId);
      if (!quiet.ok) {
        throw new HttpsError('failed-precondition', quiet.blocker ?? 'busy');
      }
    }

    // `null` on the unused half, for the same reason enableClubSeasons does it:
    // the seasons block is written with merge:true, and a merge into a nested
    // map merges field BY FIELD. Omitting a field leaves whatever the previous
    // cadence put there.
    //
    // Seen in production on a real club: an admin tried a date cadence, went
    // back to rounds, and the stored cadence kept `months: 3` and a stale
    // `endsAt` from the experiment. Nothing reads them today — every reader
    // branches on `type` first — which is exactly why they would have sat there
    // until one didn't.
    let next: {
      type: string;
      months?: number | null;
      endsAt?: number | null;
      endsOn?: CalendarDate | null;
      startsOn?: CalendarDate | null;
      targetRounds?: number | null;
    };
    if (type === 'rounds') {
      const asked = Math.round(Number(data.targetRounds));
      if (!Number.isFinite(asked) || asked <= 0) {
        throw new HttpsError('invalid-argument', 'targetRounds required');
      }
      // The documented floor, which only the ENABLE path was enforcing.
      //
      // `planActivation` refuses anything under MIN_SEASON_ROUNDS when seasons
      // are switched on, and this call — the other way to set the same number
      // — accepted 1. A one-מחזור season is over the evening it is asked for,
      // which is the same disguised close the refusal below is about, reached
      // through a number the client never offers.
      if (asked < MIN_SEASON_ROUNDS) {
        throw new HttpsError(
          'invalid-argument',
          `target ${asked} is below the ${MIN_SEASON_ROUNDS}-round floor`,
        );
      }
      if (asked <= played) {
        throw new HttpsError(
          'failed-precondition',
          `target ${asked} is not above the ${played} rounds already played`,
        );
      }
      next = {
        type: 'rounds',
        targetRounds: asked,
        months: null,
        endsAt: null,
        endsOn: null,
        startsOn: null,
      };
    } else {
      // Any length the CLIENT would accept, because the client is where the
      // admin chose it. Refusing here would be honest; rewriting silently is
      // not, and 6 was neither what they picked nor what they confirmed.
      const askedM = Number(data.months);
      const months = isValidSeasonMonths(askedM) ? askedM : 6;
      // There used to be a `endsAt <= now` refusal here. It could not fire:
      // `months` is at least 1 by the time it reaches this line, so adding it
      // to `now` is always in the future. A guard that cannot fail reads like
      // protection and is not — the real "this target is already behind you"
      // rule for a date cadence is the one the client applies to the END DATE
      // the admin picks, and it is listed for that owner, not faked here.
      const endsAt = addMonthsClampedServer(now, months);
      // Calendar boundaries alongside the legacy epoch, same as the enable path.
      const startsOn = todayIn(undefined, now);
      next = {
        type: 'date',
        months,
        endsAt,
        startsOn,
        endsOn: seasonEndDate(startsOn, months),
        targetRounds: null,
      };
    }

    const who = await db.collection('users').doc(uid).get();
    const byName =
      (who.data() as { name?: string } | undefined)?.name ?? '';

    // Does this move END the season rather than adjust it?
    //
    // A rounds target set to what the club has already played, or to one more
    // evening than that, is "סיים עונה עכשיו" spelled differently: the very
    // next seal meets it and `closeSeasonIfRoundsTargetMet` archives the
    // season on the spot. `endSeasonNow` produces that same outcome and stamps
    // `endedEarly` on the archive, so the hall of fame can say the season was
    // cut short. This path stamped nothing, and the season it ended was
    // archived looking exactly like one that ran its course.
    //
    // The refusal belongs to the admin, not to the server — an admin may well
    // mean "one more evening and we're done" — so it is recorded, not blocked.
    // `performSeasonClose` reads it back and seals it with the archive.
    // `<= played`, not `<= played + 1`.
    //
    // A target of `played + 1` is one the club then goes out and MEETS on the
    // next evening — that is a season reaching its finish line, and flagging it
    // put "נסגרה ידנית לפני שהגיעה ליעד" on a card for a season that arrived
    // exactly on time. The flag exists to say a season was cut short; the
    // honest boundary is a target the club has ALREADY passed, which the season
    // can never play its way to.
    const endsTheSeason =
      next.type === 'rounds' &&
      typeof next.targetRounds === 'number' &&
      next.targetRounds <= played;

    await ref.set(
      {
        seasons: {
          cadence: next,
          targetHistory: admin.firestore.FieldValue.arrayUnion({
            at: now,
            by: uid,
            byName,
            from: seasons.cadence ?? null,
            to: next,
            // Sealed with the entry, because `played` is a moving number and
            // nobody reading this later could recompute what it was.
            playedAtMove: played,
            endsTheSeason,
          }),
          // Cleared as well as set: an admin who moves the line to the edge and
          // then moves it back out again has not ended anything, and a stamp
          // left standing would mark the eventual archive early for ever.
          targetMovedToClose: endsTheSeason
            ? { at: now, by: uid, byName }
            : admin.firestore.FieldValue.delete(),
          // §8 — extending a season cancels the close that was waiting for it.
          //
          // This is the admin's escape from the correction window: the season
          // met its target, the 24-hour window opened, and the admin decides
          // the season should run longer after all. Moving the finish line
          // beyond where the club stands deletes the window, and with it the
          // close — there is no queued task holding a stale decision, because
          // `currentPendingClose` is the only thing the sweep consults and it
          // is now gone. Evenings may be started again the moment this write
          // lands.
          //
          // Left ALONE when the new target still ends the season: an admin who
          // moves the line to a number the club has already passed has not
          // extended anything, and clearing the window there would hand them a
          // fresh 24 hours they did not ask for.
          ...(endsTheSeason
            ? {}
            : { pendingClose: admin.firestore.FieldValue.delete() }),
        },
      },
      { merge: true },
    );
    return { ok: true, cadence: next, endsTheSeason };
  },
);

/**
 * End the running season now.
 *
 * Deliberately its own action rather than a target change, so it can carry the
 * guards a target change cannot: the club has to be quiet, and the client shows
 * the admin exactly which titles are about to be awarded before they confirm.
 * A manager who sees a name they did not expect stops on their own, and no
 * amount of validation beats that.
 */
/**
 * Undo the last close.
 *
 * Deliberately only the LAST one, and only while it is still the club's most
 * recent: reopening season 2 of four would leave seasons 3 and 4 sitting on
 * numbers that were counted from a table that no longer starts where they
 * think it does. This is a correction for "I pressed it a week early", not a
 * time machine.
 *
 * The same quiet rule as closing. Restoring a table while an evening is being
 * played would fold that evening's rounds into the season being reopened.
 */
export const reopenLastSeason = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    // Runs closeSeason (or its inverse): a transaction per player, one per
    // pair, and a batch of titles. The onCall default is 60 seconds, and a
    // sixty-player club is comfortably past it — being killed halfway leaves
    // the half-closed state the resume path exists to recover from.
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');

    // §12 — OPERATOR ONLY. A club admin cannot reopen a closed season.
    //
    // The product rule is that a closed season is final: locked to corrections
    // (`assertSeasonOpenForGame`), with no reopen offered anywhere in the app.
    // This callable stays, because it is the only way to recover a season that
    // closed on bad data, and deleting the one repair tool would mean the next
    // such club could not be repaired at all. It is a maintenance hook now,
    // reached from `firebase functions:shell`, not a feature.
    //
    // Note what this does NOT do: it does not make the operation safe. Reopen
    // destroys things it cannot restore — guest pair chemistry is minted per
    // season and the mint is gone, `chemistry.since` does not come back, and
    // the season-summary pushes sent at close point at an archive that will no
    // longer exist. Those are known and documented; the gate is what stops a
    // club admin meeting them by accident.
    if (uid !== OPERATOR_UID) {
      throw new HttpsError(
        'permission-denied',
        'a closed season is final — reopening is a maintenance operation',
      );
    }

    const data = (request.data ?? {}) as { groupId?: unknown };
    const { ref, group } = await requireClubAdmin(data.groupId, uid);
    const groupId = data.groupId as string;
    const seasons = group.seasons as
      | {
          currentNo?: number;
          currentId?: string;
          roundsAtStart?: number;
          cadence?: { type?: string; months?: number; endsAt?: number; targetRounds?: number };
          count?: number;
        }
      | undefined;
    const closedSoFar = seasons?.count ?? 0;
    if (closedSoFar < 1) {
      throw new HttpsError('failed-precondition', 'no closed season');
    }
    const quiet = await clubIsQuiet(groupId);
    if (!quiet.ok) {
      throw new HttpsError('failed-precondition', quiet.blocker ?? 'busy');
    }

    const lastNo = closedSoFar;
    const lastId = `s${lastNo}`;
    const archive = await db
      .collection('seasonSummary')
      .doc(`${groupId}__${lastId}`)
      .get();
    if (!archive.exists) {
      throw new HttpsError('not-found', 'no archive for the last season');
    }
    // How far back the reopened season had counted — its own offset, which the
    // season that replaced it recorded when it opened.
    const reopenedRoundsAtStart = archNum(archive.get('roundsAtStartOfSeason'));

    const result = await reopenSeason({ db, groupId, seasonId: lastId });

    await ref.set(
      {
        seasons: {
          enabled: true,
          currentNo: lastNo,
          currentId: lastId,
          startedAt: archNum(archive.get('startsAt')),
          roundsAtStart: reopenedRoundsAtStart,
          reopenedAt: Date.now(),
          // What the season HELD — counted from its own games, not from a
          // counter and not from its archive.
          //
          // It was `eveningsSealed - roundsAtStart` once: a subtraction of two
          // counters that drift for different reasons, so a season closed at 23
          // evenings came back as 1 and the admin who pressed undo watched it
          // shrink to nothing. Reading `archive.completedRounds` instead fixed
          // that and introduced the opposite failure: a season whose archive
          // figure was itself wrong came back holding that wrong figure. On a
          // real club a season that held NOTHING was reopened holding 22 —
          // the club's whole lifetime, inherited through the archive of a
          // season a seeding bug had created and closed inside a minute — and
          // the club card then said "22 מתוך 24" while the statistics screen,
          // which counts stamped games, said 0 for the same season.
          //
          // So it is counted where it can be checked. The games carry the
          // season's stamp; `didEveningHappen` decides which of them happened.
          // A failed count (-1) keeps the archive figure rather than zeroing a
          // season because one query timed out.
          playedRounds: await (async () => {
            const counted = await playedEveningsOfSeason(groupId, lastId, lastNo);
            if (counted >= 0) return counted;
            return typeof archive.get('completedRounds') === 'number'
              ? archNum(archive.get('completedRounds'))
              : Math.max(
                  0,
                  (await sealedEveningsOf(groupId)) - reopenedRoundsAtStart,
                );
          })(),
          // Its OWN record of every time its finish line moved.
          //
          // The close resets this to [] for the season that replaces it, and
          // the reopen used to omit it from a merge:true write — so a reopened
          // season came back holding the target history of the SUCCESSOR that
          // had just been deleted. Measured on production: the array season 2
          // holds today was created for season 3, twenty-seven seconds after
          // the reopen. The archive is where the season's own history was
          // sealed; an archive written before that existed has none, and an
          // explicit [] is the honest answer for it.
          targetHistory: Array.isArray(archive.get('targetHistory'))
            ? (archive.get('targetHistory') as unknown[])
            : [],
          // Facts about the season that REPLACED this one, and it is being
          // deleted. Left standing, `targetMovedToClose` would mark the
          // reopened season's next archive as cut short by a move that was
          // made against a different season, and `dueBlockedSince` would date
          // a block from before the reopen.
          targetMovedToClose: admin.firestore.FieldValue.delete(),
          dueBlockedSince: admin.firestore.FieldValue.delete(),
          // The target it was closed against, so it is not immediately due
          // again on a date cadence.
          cadence: rebaseCadence(
            (archive.get('originalTarget') ?? seasons?.cadence) as never,
            archNum(archive.get('startsAt')),
            Date.now(),
          ),
          count: closedSoFar - 1,
        },
      },
      { merge: true },
    );
    // An audit row for every reopen (§12).
    //
    // This is the one operation in the seasons system that destroys sealed
    // data, and until now it left no trace beyond a log line that ages out of
    // Cloud Logging in thirty days. If a club's numbers are ever disputed, the
    // first question is whether a season was pulled back open and when — and
    // there was no way to answer it. Written after the reopen has succeeded,
    // so a failed attempt does not leave a record claiming otherwise.
    //
    // Best-effort: the reopen has already committed and must not be reported
    // as failed because its audit row could not be written.
    try {
      await db.collection('seasonReopens').add({
        groupId,
        groupName: (group as { name?: string }).name ?? '',
        seasonId: lastId,
        seasonNo: lastNo,
        by: uid,
        at: Date.now(),
        // What the operation actually restored, straight from its own result,
        // so the row says what happened rather than what was asked for.
        result,
      });
    } catch (err) {
      console.error('[season] reopen audit row failed', groupId, lastId, err);
    }

    return { ok: true, ...result, reopenedNo: lastNo };
  },
);

export const endSeasonNow = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    // Runs closeSeason (or its inverse): a transaction per player, one per
    // pair, and a batch of titles. The onCall default is 60 seconds, and a
    // sixty-player club is comfortably past it — being killed halfway leaves
    // the half-closed state the resume path exists to recover from.
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    const data = (request.data ?? {}) as { groupId?: unknown };
    const { ref, group } = await requireClubAdmin(data.groupId, uid);
    const groupId = data.groupId as string;
    const seasons = group.seasons as
      | {
          enabled?: boolean;
          currentNo?: number;
          currentId?: string;
          startedAt?: number;
          roundsAtStart?: number;
          // Was missing from this type, and therefore from the close below —
          // which is how the one close path an admin actually presses ended up
          // sealing a different number from every other one.
          playedRounds?: number;
          cadence?: { type: string; months?: number; endsAt?: number; targetRounds?: number };
          /** Sealed with the season below; the next one opens with []. */
          targetHistory?: unknown[];
          count?: number;
        }
      | undefined;
    if (!seasons?.enabled || !seasons.currentId) {
      throw new HttpsError('failed-precondition', 'seasons are off');
    }

    const quiet = await clubIsQuiet(groupId);
    if (!quiet.ok) {
      throw new HttpsError('failed-precondition', quiet.blocker ?? 'busy');
    }

    const now = Date.now();
    const who = await db.collection('users').doc(uid).get();
    const result = await closeSeason({
      db,
      groupId,
      groupName: (group as { name?: string }).name ?? '',
      seasonId: seasons.currentId,
      seasonNo: seasons.currentNo ?? 1,
      startsAt: seasons.startedAt ?? 0,
      // THREE arguments, like every other close.
      //
      // This one passed two, so `completedRoundsOf` fell through to
      // `eveningsSealed - roundsAtStart` — a subtraction of two counters that
      // are not even in the same era. On the one club that has ever run
      // seasons those are 10 and 7, so "סיים עונה עכשיו" would have sealed a
      // season of THREE that the club had watched reach twenty-two, into an
      // archive that is written once and never recomputed.
      completedRounds: await completedRoundsOf(
        groupId,
        seasons.roundsAtStart,
        seasons.playedRounds,
      ),
      roundsAtStart: seasons.roundsAtStart ?? 0,
      endedEarly: true,
      closedBy: uid,
      closedByName: (who.data() as { name?: string } | undefined)?.name ?? '',
      originalTarget: seasons.cadence,
      // Sealed with the season, because the lifecycle write below resets the
      // club's copy to [] and then the archive is the only place it exists.
      targetHistory: Array.isArray(seasons.targetHistory)
        ? seasons.targetHistory
        : [],
      now,
    });

    // The next season inherits the same rules; the admin may change them.
    const nextNo = (seasons.currentNo ?? 1) + 1;
    await ref.set(
      {
        seasons: {
          currentNo: nextNo,
          currentId: `s${nextNo}`,
          startedAt: now,
          roundsAtStart: await sealedEveningsOf(groupId),
          playedRounds: 0,
          reopenedAt: 0,
          // Same length, measured from now — an inherited end date is already
          // in the past and would close this season the moment it opened.
          cadence: rebaseCadence(seasons.cadence, seasons.startedAt ?? 0, now),
          targetHistory: [],
          // Both belonged to the season just sealed. See performSeasonClose.
          targetMovedToClose: admin.firestore.FieldValue.delete(),
          dueBlockedSince: admin.firestore.FieldValue.delete(),
          count: (seasons.count ?? 0) + 1,
        },
      },
      { merge: true },
    );
    if (result.archived) {
      await announceSeasonClosed({
        groupId,
        groupName: (group as { name?: string }).name ?? '',
        seasonId: seasons.currentId,
        seasonNo: seasons.currentNo ?? 1,
      });
    }
    return { ok: true, ...result, closedNo: seasons.currentNo ?? 1 };
  },
);

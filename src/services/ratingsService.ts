// ratingsService — community-scoped player ratings.
//
// Storage:
//   /groups/{groupId}/ratings/{ratedUserId}                 — summary
//   /groups/{groupId}/ratings/{ratedUserId}/votes/{raterUid} — individual vote
//
// Vote writes happen client-side (signed-in member writes their own
// vote doc). Summary docs are kept in sync by the `onVoteWritten`
// Cloud Function — clients never write the summary directly so a
// malicious client can't fabricate an inflated average. The client
// reads the summary; voter identity stays private (rules only let
// each rater read their own vote).
//
// Mock mode: in-memory store keyed by (groupId, ratedUserId, raterUid)
// so the rating UX works locally without Firestore.

import {
  deleteDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  GroupId,
  GroupRatingSummary,
  RatingValue,
  RatingVote,
  UserId,
} from '@/types';
import { USE_MOCK_DATA } from '@/firebase/config';
import { docs } from '@/firebase/firestore';
import { mockGroup } from '@/data/mockUsers';
import { AnalyticsEvent, logEvent } from './analyticsService';

// ─── Mock store ───────────────────────────────────────────────────────────

type MockKey = string;
const mockKey = (groupId: GroupId, rated: UserId, rater: UserId) =>
  `${groupId}::${rated}::${rater}`;
const mockVotes = new Map<MockKey, RatingVote>();

function recomputeMockSummary(
  groupId: GroupId,
  ratedUserId: UserId,
): GroupRatingSummary {
  let count = 0;
  let sum = 0;
  const prefix = `${groupId}::${ratedUserId}::`;
  for (const [k, v] of mockVotes.entries()) {
    if (!k.startsWith(prefix)) continue;
    count += 1;
    sum += v.rating;
  }
  return {
    userId: ratedUserId,
    average: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    count,
    sum,
    updatedAt: Date.now(),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────

export const ratingsService = {
  /**
   * Cast or update the rater's vote on a community member.
   * Throws if the input is invalid; swallows all other errors with a
   * dev-mode warning (the originating UI shouldn't break on a bad
   * network blip).
   */
  async ratePlayerInGroup(
    groupId: GroupId,
    raterUserId: UserId,
    ratedUserId: UserId,
    rating: RatingValue,
  ): Promise<void> {
    if (raterUserId === ratedUserId) {
      throw new Error('ratePlayerInGroup: cannot rate self');
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('ratePlayerInGroup: rating must be 1–5');
    }
    if (USE_MOCK_DATA) {
      const k = mockKey(groupId, ratedUserId, raterUserId);
      const existing = mockVotes.get(k);
      const now = Date.now();
      mockVotes.set(k, {
        raterUserId,
        ratedUserId,
        rating,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      logEvent(AnalyticsEvent.PlayerRated, { groupId, rating, isUpdate: !!existing });
      return;
    }
    const ref = docs.ratingVote(groupId, ratedUserId, raterUserId);
    const existing = await getDoc(ref).catch(() => null);
    const now = Date.now();
    const createdAt =
      existing?.exists() &&
      typeof (existing.data() as RatingVote).createdAt === 'number'
        ? (existing.data() as RatingVote).createdAt
        : now;
    await setDoc(ref, {
      raterUserId,
      ratedUserId,
      rating,
      createdAt,
      updatedAt: now,
    } satisfies RatingVote);
    logEvent(AnalyticsEvent.PlayerRated, {
      groupId,
      rating,
      isUpdate: !!existing?.exists(),
    });
  },

  /** Read the rater's own vote, if any. Returns null when not voted yet. */
  async getMyVote(
    groupId: GroupId,
    raterUserId: UserId,
    ratedUserId: UserId,
  ): Promise<RatingVote | null> {
    if (raterUserId === ratedUserId) return null;
    if (USE_MOCK_DATA) {
      return (
        mockVotes.get(mockKey(groupId, ratedUserId, raterUserId)) ?? null
      );
    }
    const snap = await getDoc(
      docs.ratingVote(groupId, ratedUserId, raterUserId),
    ).catch(() => null);
    if (!snap?.exists()) return null;
    const d = snap.data() as RatingVote;
    return {
      raterUserId: d.raterUserId,
      ratedUserId: d.ratedUserId,
      rating: d.rating,
      createdAt: d.createdAt ?? Date.now(),
      updatedAt: d.updatedAt ?? Date.now(),
    };
  },

  /** Remove a vote. Used by the rating modal's "clear" action. */
  async clearMyVote(
    groupId: GroupId,
    raterUserId: UserId,
    ratedUserId: UserId,
  ): Promise<void> {
    if (USE_MOCK_DATA) {
      mockVotes.delete(mockKey(groupId, ratedUserId, raterUserId));
      logEvent(AnalyticsEvent.RatingCleared, { groupId });
      return;
    }
    await deleteDoc(
      docs.ratingVote(groupId, ratedUserId, raterUserId),
    ).catch(() => {
      /* swallow — best effort */
    });
    logEvent(AnalyticsEvent.RatingCleared, { groupId });
  },

  /**
   * Read the latest summary (count + average) for one rated user.
   * Returns a zero-summary when the doc doesn't exist yet.
   */
  async getSummary(
    groupId: GroupId,
    ratedUserId: UserId,
  ): Promise<GroupRatingSummary> {
    if (USE_MOCK_DATA) {
      return recomputeMockSummary(groupId, ratedUserId);
    }
    const snap = await getDoc(
      docs.ratingSummary(groupId, ratedUserId),
    ).catch(() => null);
    if (!snap?.exists()) {
      return {
        userId: ratedUserId,
        average: 0,
        count: 0,
        sum: 0,
        updatedAt: 0,
      };
    }
    const d = snap.data() as GroupRatingSummary;
    return {
      userId: d.userId ?? ratedUserId,
      average: typeof d.average === 'number' ? d.average : 0,
      count: typeof d.count === 'number' ? d.count : 0,
      sum: typeof d.sum === 'number' ? d.sum : 0,
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    };
  },

  /** Live subscription so the badge updates immediately after voting. */
  subscribeSummary(
    groupId: GroupId,
    ratedUserId: UserId,
    cb: (summary: GroupRatingSummary) => void,
  ): () => void {
    if (USE_MOCK_DATA) {
      cb(recomputeMockSummary(groupId, ratedUserId));
      return () => {};
    }
    const unsub = onSnapshot(
      docs.ratingSummary(groupId, ratedUserId),
      (snap) => {
        if (!snap.exists()) {
          cb({
            userId: ratedUserId,
            average: 0,
            count: 0,
            sum: 0,
            updatedAt: 0,
          });
          return;
        }
        const d = snap.data() as GroupRatingSummary;
        cb({
          userId: d.userId ?? ratedUserId,
          average: typeof d.average === 'number' ? d.average : 0,
          count: typeof d.count === 'number' ? d.count : 0,
          sum: typeof d.sum === 'number' ? d.sum : 0,
          updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
        });
      },
      (err) => {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[ratings] subscribeSummary failed', err);
        }
      },
    );
    return unsub;
  },
};

// Used for tests; lets the runtime reset between scenarios.
export function __resetRatingsForTests(): void {
  mockVotes.clear();
  mockSeeded = false;
}

// ─── Mock seeding ─────────────────────────────────────────────────────────
// Pre-fill realistic ratings for the demo community (g1) so player cards
// already show averages without anyone having to vote first. Skill values
// are hand-picked per player; each rater's vote is derived deterministically
// from (rater id, rated id) so reloads produce identical averages.
const MOCK_SKILL_BY_PLAYER_ID: Record<UserId, number> = {
  p1: 4.2, p2: 3.5, p3: 4.5, p4: 3.0, p5: 3.8,
  p6: 4.0, p7: 3.5, p8: 3.2, p9: 4.3, p10: 2.8,
  p11: 3.7, p12: 4.0, p13: 2.5, p14: 4.6, p15: 3.4,
  p16: 3.0, p17: 3.5, p18: 4.1, p19: 2.9, p20: 3.8,
  p21: 3.3, p22: 4.4, p23: 3.6, p24: 3.4, p25: 3.7,
};

let mockSeeded = false;
function seedMockRatings(): void {
  if (mockSeeded) return;
  mockSeeded = true;
  const groupId: GroupId = mockGroup.id;
  const memberIds = mockGroup.playerIds;
  const now = Date.now();
  const week = 1000 * 60 * 60 * 24 * 7;
  for (const rater of memberIds) {
    for (const rated of memberIds) {
      if (rater === rated) continue;
      const base = MOCK_SKILL_BY_PLAYER_ID[rated] ?? 3.5;
      // Deterministic ±0.5 noise from a hash of (rater, rated).
      const seed =
        (rater.charCodeAt(0) + rater.charCodeAt(rater.length - 1)) * 31 +
        rated.charCodeAt(rated.length - 1) * 17;
      const noise = ((seed % 11) - 5) / 10;
      let v = Math.round(base + noise);
      if (v < 1) v = 1;
      if (v > 5) v = 5;
      mockVotes.set(mockKey(groupId, rated, rater), {
        raterUserId: rater,
        ratedUserId: rated,
        rating: v as RatingValue,
        createdAt: now - week,
        updatedAt: now - week / 2,
      });
    }
  }
}

if (USE_MOCK_DATA) {
  seedMockRatings();
}

// Suppress unused-import warning for serverTimestamp — kept available
// in case a future migration switches createdAt to a server clock.
void serverTimestamp;

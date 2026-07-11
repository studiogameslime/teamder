// friendsService — mutual friendships + friend requests.
//
// Data model:
//   /friendRequests/{fromId__toId}   FriendRequestDoc (pending|accepted|declined)
//   /users/{uid}.friends: UserId[]   mutual, written ONLY server-side
//
// Trust boundary:
//   • SEND / DECLINE / CANCEL a request are direct client writes, gated
//     by firestore.rules (sender owns create+delete, recipient may
//     decline).
//   • ACCEPT and REMOVE mutate BOTH users' /users docs, so they go
//     through trusted callables (Admin SDK) — a client can't write
//     another user's doc, and we never trust a client to fabricate a
//     friendship. Those callables land in Phase 2; until then the
//     Firebase-mode accept/remove paths throw, while MOCK mode is fully
//     functional for building + testing the UI.
//
// A push to the recipient (friendRequest) and to the sender on accept
// (friendRequestAccepted) is fired by a Cloud Function watching
// /friendRequests — see Phase 2. No push is ever sent on decline.

import {
  deleteDoc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { col, docs } from '@/firebase/firestore';
import { userService } from './userService';
import { AnalyticsEvent, logEvent } from './analyticsService';
import { logError, isExpectedDenial } from '@/services/errorLog';
import { FriendRequestDoc, User, UserId } from '@/types';

/** Deterministic request id — blocks duplicate pending requests and lets
 *  us look up the reverse request in O(1). */
export const friendRequestId = (fromId: UserId, toId: UserId): string =>
  `${fromId}__${toId}`;

/** A pending request paired with the resolved "other" user for rendering. */
export interface FriendRequestWithUser {
  request: FriendRequestDoc;
  user: User | null;
}

/** How `me` relates to `other` — drives which button the UI shows. */
export type FriendRelationship =
  | 'self'
  | 'friends'
  | 'outgoing' // I sent a request, awaiting their approval
  | 'incoming' // they sent me a request, awaiting my approval
  | 'rejected' // I sent a request, they declined it — no re-send
  | 'none';

/** Thrown by sendRequest when the target already declined a prior request. */
export class FriendRequestDeclinedError extends Error {
  constructor() {
    super('friends: request was declined');
    this.name = 'FriendRequestDeclinedError';
  }
}

// ─── Mock state (dev / USE_MOCK_DATA) ────────────────────────────────────
const mockRequests: FriendRequestDoc[] = [];
const mockFriends: Record<UserId, Set<UserId>> = {};

function mockLink(a: UserId, b: UserId): void {
  (mockFriends[a] ??= new Set()).add(b);
  (mockFriends[b] ??= new Set()).add(a);
}
function mockUnlink(a: UserId, b: UserId): void {
  mockFriends[a]?.delete(b);
  mockFriends[b]?.delete(a);
}

function callable<T>(name: string, data: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { httpsCallable } = require('firebase/functions');
  const { functions } = getFirebase();
  return httpsCallable(functions, name)(data) as Promise<T>;
}

export const friendsService = {
  /**
   * Send a friend request from `fromUserId` to `toUserId`. Idempotent:
   * re-sending re-opens an existing doc as pending. If the target had
   * already sent ME a request, we short-circuit to an accepted
   * friendship (both clearly want it) in mock mode; in Firebase mode the
   * accept callable handles that race.
   */
  async sendRequest(fromUserId: UserId, toUserId: UserId): Promise<void> {
    if (!fromUserId || !toUserId || fromUserId === toUserId) {
      throw new Error('friends: invalid request target');
    }
    const id = friendRequestId(fromUserId, toUserId);
    if (USE_MOCK_DATA) {
      if (mockFriends[fromUserId]?.has(toUserId)) return; // already friends
      const reverse = mockRequests.find(
        (r) =>
          r.id === friendRequestId(toUserId, fromUserId) &&
          r.status === 'pending',
      );
      if (reverse) {
        reverse.status = 'accepted';
        reverse.updatedAt = Date.now();
        mockLink(fromUserId, toUserId);
        return;
      }
      const existing = mockRequests.find((r) => r.id === id);
      if (existing) {
        if (existing.status === 'declined') {
          throw new FriendRequestDeclinedError();
        }
        existing.status = 'pending';
        existing.updatedAt = Date.now();
        return;
      }
      mockRequests.push({
        id,
        fromUserId,
        toUserId,
        status: 'pending',
        createdAt: Date.now(),
      });
      return;
    }
    // Block re-sending after a decline: if my previous outgoing request to
    // this user was declined, don't let me reopen it. A declined doc is kept
    // (status:'declined') precisely so we can enforce this. A get() on a
    // NON-existent friendRequest throws permission-denied (the rule reads
    // null resource.data) — that's the normal "no prior request" case, so we
    // swallow it and let the send proceed.
    try {
      const prior = await getDoc(docs.friendRequest(id));
      if (prior.exists() && prior.data().status === 'declined') {
        throw new FriendRequestDeclinedError();
      }
    } catch (e) {
      if (e instanceof FriendRequestDeclinedError) throw e;
      // any read failure (incl. permission-denied on a missing doc) → proceed
    }
    try {
      await setDoc(docs.friendRequest(id), {
        id,
        fromUserId,
        toUserId,
        status: 'pending',
        createdAt: Date.now(),
      });
    } catch (e) {
      // Don't pollute the dashboard with expected denials (e.g. a transient
      // rules race) — only log genuine failures. Still rethrow so the UI
      // can surface a toast.
      if (!isExpectedDenial(e)) {
        logError('sendFriendRequest', e, { fromUserId, toUserId });
      }
      throw e;
    }
    logEvent(AnalyticsEvent.FriendRequestSent, { toUserId });
  },

  /**
   * Accept the request that `fromUserId` sent to me (`toUserId` = current
   * user). Mutates both users' friends arrays — Firebase mode delegates
   * to the trusted `acceptFriendRequest` callable.
   */
  async acceptRequest(fromUserId: UserId, toUserId: UserId): Promise<void> {
    const id = friendRequestId(fromUserId, toUserId);
    if (USE_MOCK_DATA) {
      const r = mockRequests.find((x) => x.id === id);
      if (r) {
        r.status = 'accepted';
        r.updatedAt = Date.now();
      }
      mockLink(fromUserId, toUserId);
      return;
    }
    try {
      await callable('acceptFriendRequest', { fromUserId });
    } catch (e) {
      logError('acceptFriendRequest', e, { fromUserId });
      throw e;
    }
    logEvent(AnalyticsEvent.FriendRequestAccepted, { fromUserId });
  },

  /** Decline an incoming request. No push is sent. */
  async declineRequest(fromUserId: UserId, toUserId: UserId): Promise<void> {
    const id = friendRequestId(fromUserId, toUserId);
    if (USE_MOCK_DATA) {
      const r = mockRequests.find((x) => x.id === id);
      if (r) {
        r.status = 'declined';
        r.updatedAt = Date.now();
      }
      logEvent(AnalyticsEvent.FriendRequestDeclined, { fromUserId });
      return;
    }
    try {
      await updateDoc(docs.friendRequest(id), {
        status: 'declined',
        updatedAt: Date.now(),
      });
    } catch (e) {
      logError('declineFriendRequest', e, { fromUserId, toUserId });
      throw e;
    }
    logEvent(AnalyticsEvent.FriendRequestDeclined, { fromUserId });
  },

  /** Withdraw an outgoing request I sent (deletes the doc). */
  async cancelRequest(fromUserId: UserId, toUserId: UserId): Promise<void> {
    const id = friendRequestId(fromUserId, toUserId);
    if (USE_MOCK_DATA) {
      const i = mockRequests.findIndex((x) => x.id === id);
      if (i >= 0) mockRequests.splice(i, 1);
      logEvent(AnalyticsEvent.FriendRequestCancelled, { toUserId });
      return;
    }
    try {
      await deleteDoc(docs.friendRequest(id));
    } catch (e) {
      logError('cancelFriendRequest', e, { fromUserId, toUserId });
      throw e;
    }
    logEvent(AnalyticsEvent.FriendRequestCancelled, { toUserId });
  },

  /** Remove an existing friendship (mutual). Firebase delegates to the
   *  trusted `removeFriendship` callable. */
  async removeFriend(meId: UserId, otherId: UserId): Promise<void> {
    if (USE_MOCK_DATA) {
      mockUnlink(meId, otherId);
      logEvent(AnalyticsEvent.FriendRemoved, { otherUserId: otherId });
      return;
    }
    try {
      await callable('removeFriendship', { otherUserId: otherId });
    } catch (e) {
      logError('removeFriend', e, { otherUserId: otherId });
      throw e;
    }
    logEvent(AnalyticsEvent.FriendRemoved, { otherUserId: otherId });
  },

  /** Accepted-friend ids for a user. */
  async listFriendIds(uid: UserId): Promise<UserId[]> {
    if (USE_MOCK_DATA) return Array.from(mockFriends[uid] ?? []);
    const u = await userService.getUserById(uid);
    return u?.friends ?? [];
  },

  /** Accepted friends resolved to User objects. */
  async listFriends(uid: UserId): Promise<User[]> {
    const ids = await this.listFriendIds(uid);
    // allSettled, not all: if ONE friend's user-doc read throws (deleted /
    // blocked / rules-restricted account) Promise.all would reject and the
    // ENTIRE list would fail. Skip the bad entry instead.
    const results = await Promise.allSettled(
      ids.map((id) => userService.getUserById(id)),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<User | null> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value)
      .filter((u): u is User => !!u);
  },

  /** Pending requests sent TO me, each paired with the sender. */
  async listIncomingRequests(uid: UserId): Promise<FriendRequestWithUser[]> {
    const reqs = await this.queryRequests('toUserId', uid);
    // One unresolvable sender must not fail the whole inbox — drop it.
    const results = await Promise.allSettled(
      reqs.map(async (request) => ({
        request,
        user: await userService.getUserById(request.fromUserId),
      })),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<FriendRequestWithUser> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);
  },

  /** Pending requests I sent, each paired with the target. */
  async listOutgoingRequests(uid: UserId): Promise<FriendRequestWithUser[]> {
    const reqs = await this.queryRequests('fromUserId', uid);
    const results = await Promise.allSettled(
      reqs.map(async (request) => ({
        request,
        user: await userService.getUserById(request.toUserId),
      })),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<FriendRequestWithUser> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);
  },

  /**
   * Relationship of `uid` toward `otherId`, so a player card can render
   * the correct action ("הוסף חבר" / "ממתין לאישור" / "אשר" / "חברים").
   */
  async getRelationship(
    uid: UserId,
    otherId: UserId,
  ): Promise<FriendRelationship> {
    if (!uid || !otherId) return 'none';
    if (uid === otherId) return 'self';
    const friendIds = await this.listFriendIds(uid);
    if (friendIds.includes(otherId)) return 'friends';
    if (USE_MOCK_DATA) {
      const outMock = mockRequests.find(
        (r) => r.id === friendRequestId(uid, otherId),
      );
      if (outMock?.status === 'pending') return 'outgoing';
      // They declined my request → blocked from re-sending.
      if (outMock?.status === 'declined') return 'rejected';
      if (
        mockRequests.some(
          (r) => r.id === friendRequestId(otherId, uid) && r.status === 'pending',
        )
      ) {
        return 'incoming';
      }
      return 'none';
    }
    // `get()` on a NON-EXISTENT friendRequest returns 'permission-denied'
    // (the rule reads resource.data, which is null) — that's just "no pending
    // request", the normal case. Each read gets its OWN try/catch: otherwise a
    // denial on the OUTGOING read (the common case when only an INCOMING
    // request exists) would skip the incoming read entirely, making the
    // 'incoming' state unreachable — so "אשר בקשה" never showed on the player
    // card and tapping created a duplicate reverse request.
    const readReq = async (id: string) => {
      try {
        return await getDoc(docs.friendRequest(id));
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== 'permission-denied') {
          logError('getFriendRelationship', e, { uid, otherId });
        }
        if (__DEV__) {
          console.warn('[friends] getRelationship request read failed', e);
        }
        return null;
      }
    };
    const outSnap = await readReq(friendRequestId(uid, otherId));
    const inSnap = await readReq(friendRequestId(otherId, uid));
    if (outSnap?.exists() && outSnap.data().status === 'pending') return 'outgoing';
    // A fresh INCOMING request wins over a STALE declined-outgoing one:
    // otherwise an old 'declined' A→B doc would mask a new B→A request and
    // 'אשר בקשה' would never show (the incoming state stayed unreachable).
    if (inSnap?.exists() && inSnap.data().status === 'pending') return 'incoming';
    // They declined my outgoing request → don't let me spam another.
    if (outSnap?.exists() && outSnap.data().status === 'declined') return 'rejected';
    return 'none';
  },

  // ── internal ──
  /** Query pending requests by a single field; status filtered in JS so
   *  no composite index is required. */
  async queryRequests(
    field: 'toUserId' | 'fromUserId',
    uid: UserId,
  ): Promise<FriendRequestDoc[]> {
    if (USE_MOCK_DATA) {
      return mockRequests.filter(
        (r) => r[field] === uid && r.status === 'pending',
      );
    }
    const snap = await getDocs(query(col.friendRequests(), where(field, '==', uid)));
    return snap.docs.map((d) => d.data()).filter((r) => r.status === 'pending');
  },
};

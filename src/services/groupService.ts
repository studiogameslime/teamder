// groupService — group CRUD + community-membership operations.
//
// Mock mode: in-memory map seeded from mockGroup + mockOtherGroup. Resets
// between cold starts.
// Firebase mode:
//   /groups/{groupId}                 → Group (canonical state, including
//                                       playerIds + pendingPlayerIds)
//   /groupJoinRequests/{requestId}    → audit trail of join decisions

import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  Group,
  GroupId,
  GroupPublic,
  GroupSearchHit,
  User,
  UserId,
} from '@/types';
import { mockGroup, mockOtherGroup, mockPublicGroups } from '@/data/mockUsers';
import { mockPlayers } from '@/data/mockData';
import { storage } from './storage';
import { optionalString, requireString } from '@/utils/validate';
import { enforceRateLimit } from '@/services/rateLimitService';
import { achievementsService } from './achievementsService';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { col, docs, GroupJoinRequestDoc } from '@/firebase/firestore';
import { stripUndefined } from '@/utils/stripUndefined';
import { notificationsService } from './notificationsService';
import { logError, logUnexpected } from '@/services/errorLog';

let groupsById: Record<GroupId, Group> = {
  [mockGroup.id]: { ...mockGroup },
  [mockOtherGroup.id]: { ...mockOtherGroup },
};

function genCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

// ─── Service ──────────────────────────────────────────────────────────────

export const groupService = {
  /**
   * Groups the user is an APPROVED community member of.
   */
  async listForUser(userId: UserId): Promise<Group[]> {
    if (USE_MOCK_DATA) {
      return Object.values(groupsById).filter(
        (g) =>
          g.isPersonal !== true &&
          (g.adminIds.includes(userId) || g.playerIds.includes(userId)),
      );
    }
    const q = query(col.groups(), where('playerIds', 'array-contains', userId));
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      logError('listForUser', err, { userId });
      if (__DEV__) console.warn('[groupService] listForUser failed', err);
      throw err;
    }
    // Hide personal/orphan-host groups from the user's "my communities"
    // list — they're an implementation detail of the orphan-game flow,
    // never surfaced as real communities until the user promotes.
    return snap.docs.map((d) => d.data()).filter((g) => g.isPersonal !== true);
  },

  /**
   * Groups the user has an outstanding join request for.
   */
  async listPendingForUser(userId: UserId): Promise<Group[]> {
    if (USE_MOCK_DATA) {
      return Object.values(groupsById).filter((g) =>
        g.pendingPlayerIds.includes(userId)
      );
    }
    const q = query(
      col.groups(),
      where('pendingPlayerIds', 'array-contains', userId)
    );
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      logError('listPendingForUser', err, { userId });
      if (__DEV__) console.warn('[groupService] listPendingForUser failed', err);
      throw err;
    }
    return snap.docs.map((d) => d.data());
  },

  async get(groupId: GroupId): Promise<Group | null> {
    if (USE_MOCK_DATA) return groupsById[groupId] ?? null;
    try {
      const snap = await getDoc(docs.group(groupId));
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      logError('getGroup', err, { groupId });
      if (__DEV__) console.warn('[groupService] get failed', err);
      throw err;
    }
  },

  /**
   * Communities both users are approved members of. Used by the
   * player-card "אתה ו-X" stats section. One `array-contains` query
   * + a client-side intersect — cheap regardless of how many groups
   * either user belongs to.
   */
  async findSharedCommunities(
    uidA: UserId,
    uidB: UserId,
  ): Promise<Group[]> {
    if (!uidA || !uidB || uidA === uidB) return [];
    if (USE_MOCK_DATA) {
      return Object.values(groupsById).filter((g) => {
        const ids = new Set([
          ...(Array.isArray(g.playerIds) ? g.playerIds : []),
          ...(Array.isArray(g.adminIds) ? g.adminIds : []),
        ]);
        return ids.has(uidA) && ids.has(uidB);
      });
    }
    // Two queries — the viewer might be a community admin who isn't
    // listed in `playerIds` (admin-only memberships exist on legacy
    // docs and on groups where the creator opted out of being a
    // player). A single `array-contains` would miss those. Merge
    // results by id.
    let byPlayer;
    let byAdmin;
    try {
      [byPlayer, byAdmin] = await Promise.all([
        getDocs(
          query(col.groups(), where('playerIds', 'array-contains', uidA)),
        ),
        getDocs(
          query(col.groups(), where('adminIds', 'array-contains', uidA)),
        ),
      ]);
    } catch (err) {
      logError('findSharedCommunities', err, { uidA, uidB });
      if (__DEV__) {
        console.warn('[groupService] findSharedCommunities failed', err);
      }
      throw err;
    }
    const seen = new Set<string>();
    const groups: Group[] = [];
    for (const doc of [...byPlayer.docs, ...byAdmin.docs]) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      groups.push(doc.data());
    }
    return groups.filter((g) => {
      const ids = new Set([
        ...(Array.isArray(g.playerIds) ? g.playerIds : []),
        ...(Array.isArray(g.adminIds) ? g.adminIds : []),
      ]);
      return ids.has(uidB);
    });
  },

  /**
   * Search groups by case-insensitive name prefix. Returns lightweight
   * GroupSearchHit projections suitable for listing in a search screen.
   *
   * Firestore prefix-match trick: range query on normalizedName from `q` to
   * `q + '\uf8ff'` returns all docs whose normalizedName starts with `q`.
   */
  async searchGroups(qstr: string): Promise<GroupSearchHit[]> {
    const norm = normalize(qstr);
    if (norm.length === 0) {
      // Empty query → return a few popular groups (mock returns all).
      if (USE_MOCK_DATA) {
        return Object.values(groupsById).slice(0, 10).map(toHit);
      }
      // In Firebase mode we just return [] to avoid scanning the full collection.
      return [];
    }
    if (USE_MOCK_DATA) {
      return Object.values(groupsById)
        .filter((g) => g.normalizedName.includes(norm))
        .map(toHit);
    }
    const q = query(
      col.groups(),
      where('normalizedName', '>=', norm),
      where('normalizedName', '<=', norm + '\uf8ff'),
      orderBy('normalizedName'),
      // Hard cap so a typo doesn't stream the whole collection
      // (limit() on the query)
    );
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      logError('searchGroups', err, { query: norm });
      if (__DEV__) console.warn('[groupService] searchGroups failed', err);
      throw err;
    }
    return snap.docs.map((d) => toHit(d.data())).slice(0, 30);
  },

  async createGroup(input: {
    // ── Identity (Step 1 of the wizard) ───────────────────────────
    name: string;
    description?: string;
    /** When true, joining is auto-approved (no admin gate). */
    isOpen?: boolean;
    // ── Info (Step 2 of the wizard) ───────────────────────────────
    /** Code-of-conduct text shown on the community page. */
    rules?: string;
    /** Phone for WhatsApp contact button (Israeli format, caller validated). */
    contactPhone?: string;
    /** General city the community is based in. NOT a fixed field. */
    city?: string;
    /** Geocoded city coords — when present, the public "nearby" filter
     *  uses true radius matching via Haversine instead of brittle
     *  city-name comparison. Caller (CreateGroupScreen) geocodes
     *  before submit; failures are tolerated and the field stays
     *  undefined. */
    lat?: number;
    lng?: number;
    /** Total community size cap. */
    maxMembers?: number;
    creator: User;
    // ── Removed (now per-Game) ────────────────────────────────────
    // fieldName / fieldAddress / street / addressNote / preferredDays /
    // preferredHour / recurringGameEnabled / defaultMaxPlayers /
    // costPerGame / notes — all moved to per-Game settings or dropped.
    // Old /groups docs that still carry these are read with optional
    // typing; the wizard simply doesn't expose them anymore.
  }): Promise<Group> {
    // The 5-per-day createGroup rate limit USED to live here as
    // `enforceRateLimit('createGroup')` writing /rateLimits/{uid}_…
    // — but that doc was client-writable, letting a malicious client
    // reset its own counter (Security Audit Finding #3). Enforcement
    // moved to `createGroupCallable` server-side, against the
    // /serverRateLimits collection (deny-all from client). The
    // callable returns `resource-exhausted` if the cap is hit; the
    // catch block below re-throws with that code preserved.
    //
    // Client-side validation gives a friendly Hebrew error before
    // we hit the wire. The CF re-validates authoritatively.
    const name = requireString('name', input.name, {
      max: 80,
      label: 'שם הקהילה',
    });
    const description = optionalString('description', input.description, {
      max: 500,
      label: 'תיאור',
    });
    const city = optionalString('city', input.city, {
      max: 80,
      label: 'עיר',
    });
    const now = Date.now();
    // Slim Group shape — only the surviving identity + membership
    // + info fields. Game-specific fields no longer get written.
    const baseGroup = {
      name,
      normalizedName: normalize(name),
      city,
      lat: input.lat,
      lng: input.lng,
      description,
      maxMembers: input.maxMembers,
      isOpen: input.isOpen,
      contactPhone: input.contactPhone,
      rules: input.rules,
      creatorId: input.creator.id,
      adminIds: [input.creator.id],
      playerIds: [input.creator.id],
      pendingPlayerIds: [] as UserId[],
      inviteCode: genCode(),
      createdAt: now,
      updatedAt: now,
    };

    if (USE_MOCK_DATA) {
      const g: Group = { id: genId('g'), ...baseGroup };
      groupsById[g.id] = g;
      // Mirror to mock public list so the Communities feed sees it.
      mockPublicGroups.push(toPublic(g));
      await storage.setCurrentGroupId(g.id);
      // Phase 3: Coach unlocks "Created First Team" achievement.
      achievementsService.bump(input.creator.id, 'teamsCreated', 1);
      return g;
    }
    // Firebase: route through the `createGroupCallable` Cloud Function.
    // Previously the client did a dual-write of /groups + /groupsPublic
    // and bumped /rateLimits client-side — but the rate-limit doc was
    // client-writable, so a malicious client could reset its own
    // counter and spam-create communities (Security Audit Finding #3).
    // The callable enforces the 5-per-day cap server-side via
    // /serverRateLimits (deny-all from client) and writes the docs
    // with Admin SDK.
    //
    // The callable returns { ok, groupId }. We then fetch the freshly
    // written canonical doc so the caller gets a fully-populated Group
    // (matching the legacy contract). The achievement bump runs
    // server-side too — kept on the client only for mock mode.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'createGroupCallable');
    let groupId: string;
    try {
      const res = (await fn({
        name: baseGroup.name,
        description: baseGroup.description,
        isOpen: baseGroup.isOpen,
        rules: baseGroup.rules,
        contactPhone: baseGroup.contactPhone,
        city: baseGroup.city,
        maxMembers: baseGroup.maxMembers,
      })) as { data?: { ok?: boolean; groupId?: string } };
      groupId = res?.data?.groupId ?? '';
      if (!groupId) {
        throw new Error('createGroupCallable: no groupId returned');
      }
    } catch (err) {
      // Re-throw with the Firebase error code preserved so the UI can
      // distinguish rate-limit (`resource-exhausted`) from validation
      // (`invalid-argument`) from auth (`unauthenticated`).
      const e = err as { code?: string; message?: string };
      const code = (e.code ?? 'unknown').replace(/^functions\//, '');
      if (
        ![
          'GROUP_FULL',
          'GROUP_MAX_BELOW_CURRENT',
          'LAST_ADMIN',
          'resource-exhausted',
          'unauthenticated',
        ].includes(code)
      ) {
        logError('createGroup', err, {
          name: baseGroup.name,
          isOpen: baseGroup.isOpen,
          city: baseGroup.city,
          maxMembers: baseGroup.maxMembers,
          code,
        });
      }
      const wrapped = new Error(e.message ?? 'createGroup failed') as Error & {
        code: string;
      };
      wrapped.code = code;
      throw wrapped;
    }
    // Read the freshly-written canonical doc.
    try {
      const fresh = await getDoc(docs.group(groupId));
      if (!fresh.exists()) {
        throw new Error('createGroup: callable wrote no doc');
      }
      const g = fresh.data() as Group;
      await storage.setCurrentGroupId(g.id);
      return g;
    } catch (e) {
      logError('createGroup', e, { groupId, phase: 'postCreateRead' });
      throw e;
    }
  },

  /**
   * Provision (or fetch) the caller's hidden "personal community" used
   * to host orphan / one-shot games. Returned id MUST be used as
   * `groupId` on the new game — the rest of the data model expects a
   * non-null group. After the game finishes, the user gets a
   * `promotePrompt` push that can flip this group into a real
   * community via `promoteOrphanGroup` below.
   *
   * Throws on auth / network failure so the wizard can surface the
   * error inline rather than silently writing a community-bound game.
   */
  async ensurePersonalGroupId(): Promise<GroupId> {
    if (USE_MOCK_DATA) {
      // Mock mode: synthesize a stable id keyed off the active user.
      // Matches the pattern used by other callables in mock mode.
      return 'mock-personal-group';
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'ensurePersonalGroup');
    let res: { data?: { groupId?: string } };
    try {
      res = (await fn({})) as { data?: { groupId?: string } };
    } catch (err) {
      logError('ensurePersonalGroup', err, {});
      if (__DEV__) console.warn('[groupService] ensurePersonalGroup failed', err);
      throw err;
    }
    const id = res?.data?.groupId ?? '';
    if (!id) throw new Error('ensurePersonalGroup: no groupId returned');
    return id;
  },

  /**
   * Flip the caller's personal group into a real community: applies
   * name/description/city, writes the public mirror, and queues
   * `groupInvitation` pushes to every uid in `inviteUserIds`.
   * Returns the count of invitees actually queued (deduped, self
   * removed).
   */
  async promoteOrphanGroup(input: {
    groupId: GroupId;
    name: string;
    description?: string;
    city?: string;
    inviteUserIds: UserId[];
  }): Promise<{ invited: number }> {
    if (USE_MOCK_DATA) {
      return { invited: input.inviteUserIds.length };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'promoteOrphanToGroup');
    let res: { data?: { ok?: boolean; invited?: number } };
    try {
      res = (await fn({
        groupId: input.groupId,
        name: input.name,
        description: input.description ?? '',
        city: input.city ?? '',
        inviteUserIds: input.inviteUserIds,
      })) as { data?: { ok?: boolean; invited?: number } };
    } catch (err) {
      logError('promoteOrphanGroup', err, {
        groupId: input.groupId,
        inviteCount: input.inviteUserIds.length,
      });
      if (__DEV__) console.warn('[groupService] promoteOrphanGroup failed', err);
      throw err;
    }
    return { invited: res?.data?.invited ?? 0 };
  },

  /**
   * Invite app-friends to an existing community. Each invitee lands in
   * `pendingPlayerIds` and gets a `groupInvitation` push. Server-side the
   * caller must belong to the group and the targets must be their actual
   * friends — see the `inviteFriendsToGroup` callable.
   */
  async inviteFriendsToGroup(
    groupId: GroupId,
    friendIds: UserId[],
  ): Promise<{ invited: number }> {
    if (!groupId || friendIds.length === 0) return { invited: 0 };
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (g) {
        const existing = new Set([
          ...(g.adminIds ?? []),
          ...(g.playerIds ?? []),
          ...(g.pendingPlayerIds ?? []),
        ]);
        const add = friendIds.filter((f) => !existing.has(f));
        g.pendingPlayerIds = [...(g.pendingPlayerIds ?? []), ...add];
        g.updatedAt = Date.now();
        return { invited: add.length };
      }
      return { invited: 0 };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'inviteFriendsToGroup');
    let res: { data?: { invited?: number } };
    try {
      res = (await fn({ groupId, friendIds })) as {
        data?: { invited?: number };
      };
    } catch (err) {
      logError('inviteFriendsToGroup', err, {
        groupId,
        friendCount: friendIds.length,
      });
      if (__DEV__) {
        console.warn('[groupService] inviteFriendsToGroup failed', err);
      }
      throw err;
    }
    return { invited: res?.data?.invited ?? 0 };
  },

  // ─── Public groups feed ────────────────────────────────────────────────

  /**
   * Read a single GroupPublic doc — used by the public details screen for
   * users who aren't members yet. Allows the read with our v2 rules
   * (`/groupsPublic` is open to any signed-in user) without touching
   * the private `/groups/{id}` doc.
   */
  async getPublic(groupId: GroupId): Promise<GroupPublic | null> {
    if (USE_MOCK_DATA) {
      return mockPublicGroups.find((g) => g.id === groupId) ?? null;
    }
    try {
      const snap = await getDoc(docs.groupPublic(groupId));
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      logError('getPublicGroup', err, { groupId });
      if (__DEV__) console.warn('[groupService] getPublic failed', err);
      throw err;
    }
  },

  async listPublicGroups(): Promise<GroupPublic[]> {
    if (USE_MOCK_DATA) {
      return [...mockPublicGroups];
    }
    let snap;
    try {
      snap = await getDocs(col.groupsPublic());
    } catch (err) {
      logError('listPublicGroups', err, {});
      if (__DEV__) console.warn('[groupService] listPublicGroups failed', err);
      throw err;
    }
    return snap.docs.map((d) => d.data());
  },

  async searchPublicGroups(qstr: string): Promise<GroupPublic[]> {
    const norm = normalize(qstr);
    if (norm.length === 0) return this.listPublicGroups();
    // Mock + Firestore both score each group on FOUR fields (name,
    // city, field, address) and prioritise CITY matches because users
    // typically search by city (e.g. "\u05ea\u05dc \u05d0\u05d1\u05d9\u05d1"). The previous
    // implementation only matched name + city + fieldName, missing
    // groups whose address contained the city but whose city field
    // was empty.
    const scoreMatch = (g: GroupPublic): number => {
      const name = g.normalizedName.includes(norm) ? 1 : 0;
      const city = (g.city ?? '').toLowerCase().includes(norm) ? 1 : 0;
      const field = (g.fieldName ?? '').toLowerCase().includes(norm) ? 1 : 0;
      const address = (g.fieldAddress ?? '').toLowerCase().includes(norm) ? 1 : 0;
      // City + name carry the most weight; address/field are
      // tie-breakers (the user is usually looking for a city, not
      // a specific field).
      return city * 4 + name * 3 + field * 1 + address * 1;
    };

    if (USE_MOCK_DATA) {
      return mockPublicGroups
        .map((g) => ({ g, score: scoreMatch(g) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.g);
    }

    // Firestore: prefix-index on normalizedName for the cheap hit,
    // then a local pass over the full directory for the broader
    // signals. A real cross-field search would need a third-party
    // search service (Typesense / Algolia / Elastic) \u2014 for the
    // current data volume the in-memory sweep is plenty fast.
    const q = query(
      col.groupsPublic(),
      where('normalizedName', '>=', norm),
      where('normalizedName', '<=', norm + '\uf8ff'),
      orderBy('normalizedName')
    );
    let nameSnap;
    try {
      nameSnap = await getDocs(q);
    } catch (err) {
      logError('searchPublicGroups', err, { query: norm });
      if (__DEV__) console.warn('[groupService] searchPublicGroups failed', err);
      throw err;
    }
    const byName = nameSnap.docs.map((d) => d.data());
    const all = await this.listPublicGroups();
    const seen = new Set(byName.map((g) => g.id));
    const extras = all
      .filter((g) => !seen.has(g.id) && scoreMatch(g) > 0)
      .map((g) => ({ g, score: scoreMatch(g) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.g);
    // City matches go FIRST even if normalizedName-prefix matches
    // exist \u2014 the user typed a city, surface those before "groups
    // whose name happens to start with the same string".
    const cityExtras = extras.filter((g) =>
      (g.city ?? '').toLowerCase().includes(norm),
    );
    const otherExtras = extras.filter(
      (g) => !(g.city ?? '').toLowerCase().includes(norm),
    );
    return cityExtras.concat(byName).concat(otherExtras).slice(0, 30);
  },

  /**
   * Submit a join request by group id (for search-based discovery) or by
   * invite code (for code-based join). Both paths land the user in the
   * group's `pendingPlayerIds` array AND write a groupJoinRequests doc as
   * an audit trail.
   */
  async requestJoinByCode(
    code: string,
    userId: UserId
  ): Promise<{
    group: Group;
    status: 'pending' | 'joined' | 'already_member' | 'not_found';
  }> {
    if (USE_MOCK_DATA) {
      const g = Object.values(groupsById).find(
        (x) => x.inviteCode.toUpperCase() === code.toUpperCase()
      );
      if (!g) return { group: { ...mockGroup, id: '' }, status: 'not_found' };
      return mockSubmitJoin(g, userId);
    }
    const q = query(col.groups(), where('inviteCode', '==', code.toUpperCase()));
    const snap = await getDocs(q);
    if (snap.empty) return { group: { id: '' } as Group, status: 'not_found' };
    // Defensive: invite codes are intended to be unique, but no rule
    // enforces that. If two groups somehow share a code (data
    // corruption / race on creation) we'd silently join the first one
    // and the user would land in the wrong community. Refuse instead.
    if (snap.size > 1) {
      if (__DEV__) {
        console.warn(
          '[groupService] invite-code collision — refusing join',
          code,
          snap.size,
        );
      }
      return { group: { id: '' } as Group, status: 'not_found' };
    }
    return submitJoin(snap.docs[0].data(), userId);
  },

  async requestJoinById(
    groupId: GroupId,
    userId: UserId
  ): Promise<{
    group: Group;
    status: 'pending' | 'joined' | 'already_member' | 'not_found';
  }> {
    // Spam guard: cap join requests per user per hour.
    await enforceRateLimit(userId, 'joinRequest');
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) return { group: { ...mockGroup, id: '' }, status: 'not_found' };
      return mockSubmitJoin(g, userId);
    }
    // Real mode: a non-member can't read /groups. We confirm existence via
    // the public projection, then write the request + arrayUnion update.
    const pubSnap = await getDoc(docs.groupPublic(groupId));
    if (!pubSnap.exists()) {
      return { group: { id: '' } as Group, status: 'not_found' };
    }
    return submitJoinByPublic(groupId, userId);
  },

  async approveMember(groupId: GroupId, userId: UserId): Promise<Group> {
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('approveMember: group not found');
      // Capacity recheck at approve time — even if the request was
      // created when there was room, an earlier approval today may
      // have filled the cap. Race-safe in mock mode by virtue of the
      // single-threaded JS runtime.
      if (
        typeof g.maxMembers === 'number' &&
        g.maxMembers > 0 &&
        !g.playerIds.includes(userId) &&
        g.playerIds.length >= g.maxMembers
      ) {
        const err = new Error('GROUP_FULL') as Error & { code: 'GROUP_FULL' };
        err.code = 'GROUP_FULL';
        throw err;
      }
      g.pendingPlayerIds = g.pendingPlayerIds.filter((id) => id !== userId);
      if (!g.playerIds.includes(userId)) g.playerIds = [...g.playerIds, userId];
      g.updatedAt = Date.now();
      syncMockPublic(g);
      // Symmetric to rejectMember — the requester gets a push the
      // moment their request is decided.
      notificationsService.dispatch({
        type: 'approved',
        recipientId: userId,
        payload: { groupId, groupName: g.name },
      });
      return g;
    }
    // Capacity recheck — race-safe via a transaction so two admins
    // approving simultaneously can't push the group past maxMembers.
    const { db, auth } = getFirebase();
    try {
      await runTransaction(db, async (tx) => {
        const gSnap = await tx.get(docs.group(groupId));
        if (!gSnap.exists()) {
          throw new Error('approveMember: group not found');
        }
        const g = gSnap.data();
        const already = (g.playerIds ?? []).includes(userId);
        if (
          !already &&
          typeof g.maxMembers === 'number' &&
          g.maxMembers > 0 &&
          (g.playerIds?.length ?? 0) >= g.maxMembers
        ) {
          const err = new Error('GROUP_FULL') as Error & { code: 'GROUP_FULL' };
          err.code = 'GROUP_FULL';
          throw err;
        }
        tx.update(docs.group(groupId), {
          playerIds: arrayUnion(userId),
          pendingPlayerIds: arrayRemove(userId),
          updatedAt: Date.now(),
        });
      });
    } catch (e) {
      const code = (e as { code?: string; message?: string })?.code
        ?? (e as Error)?.message;
      if (
        ![
          'GROUP_FULL',
          'GROUP_MAX_BELOW_CURRENT',
          'LAST_ADMIN',
          'resource-exhausted',
          'functions/resource-exhausted',
          'unauthenticated',
          'functions/unauthenticated',
        ].includes(code as string)
      ) {
        logError('approveMember', e, { groupId, userId });
      }
      throw e;
    }
    // Audit-trail flip happens outside the transaction (different
    // collection); keeping it best-effort is fine — the canonical
    // membership is already correct, so a failure here is logged and
    // swallowed rather than thrown (mirrors rejectMember's handling).
    try {
      const reqs = await getDocs(
        query(
          col.joinRequests(),
          where('groupId', '==', groupId),
          where('userId', '==', userId),
          where('status', '==', 'pending')
        )
      );
      const batch = writeBatch(db);
      reqs.docs.forEach((r) =>
        batch.update(r.ref, {
          status: 'approved',
          decidedAt: Date.now(),
          decidedBy: auth.currentUser?.uid ?? null,
        })
      );
      await batch.commit();
    } catch (err) {
      logError('approveMember', err, { groupId, userId, phase: 'auditTrail' });
      if (__DEV__) {
        console.warn('[groupService] approveMember audit-trail flip failed', err);
      }
    }
    const g = await this.get(groupId);
    if (!g) throw new Error('approveMember: group disappeared');
    // Mirror member count to the public doc so the feed stays accurate.
    // Best-effort — failure is logged, not thrown, so the approve still
    // looks successful to the user.
    try {
      const pubBatch = writeBatch(db);
      pubBatch.update(docs.groupPublic(groupId), {
        memberCount: g.playerIds.length,
        updatedAt: Date.now(),
      });
      await pubBatch.commit();
    } catch (err) {
      logError('approveMember', err, { groupId, phase: 'mirrorSync' });
      if (__DEV__) console.warn('[groupService] failed to sync public memberCount', err);
    }
    // Symmetric to rejectMember — push the requester a "your
    // community-join request was approved" notification so they see
    // confirmation without having to refresh the app.
    notificationsService.dispatch({
      type: 'approved',
      recipientId: userId,
      payload: { groupId, groupName: g.name },
    });
    return g;
  },

  async rejectMember(groupId: GroupId, userId: UserId): Promise<Group> {
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('rejectMember: group not found');
      g.pendingPlayerIds = g.pendingPlayerIds.filter((id) => id !== userId);
      g.updatedAt = Date.now();
      notificationsService.dispatch({
        type: 'rejected',
        recipientId: userId,
        payload: { groupId, groupName: g.name },
      });
      return g;
    }
    const { db, auth } = getFirebase();
    try {
      const reqs = await getDocs(
        query(
          col.joinRequests(),
          where('groupId', '==', groupId),
          where('userId', '==', userId),
          where('status', '==', 'pending')
        )
      );
      const batch = writeBatch(db);
      reqs.docs.forEach((r) =>
        batch.update(r.ref, {
          status: 'rejected',
          decidedAt: Date.now(),
          decidedBy: auth.currentUser?.uid ?? null,
        })
      );
      batch.update(docs.group(groupId), {
        pendingPlayerIds: arrayRemove(userId),
        updatedAt: Date.now(),
      });
      await batch.commit();
    } catch (e) {
      logError('rejectMember', e, { groupId, userId });
      throw e;
    }
    const g = await this.get(groupId);
    if (!g) throw new Error('rejectMember: group disappeared');
    // Push the rejected user a "your request was declined" notification.
    // The CF builds the body string from groupName; we pass it through
    // so the user sees which community declined them.
    notificationsService.dispatch({
      type: 'rejected',
      recipientId: userId,
      payload: { groupId, groupName: g.name },
    });
    return g;
  },

  /**
   * Update editable metadata on a community. Caller must be a coach.
   * Locked fields (`id`, `creatorId`, `adminIds`, `playerIds`,
   * `pendingPlayerIds`, `inviteCode`, `createdAt`, `normalizedName`)
   * are silently dropped — those have dedicated paths.
   */
  async updateGroupMetadata(
    groupId: GroupId,
    callerId: UserId,
    patch: Partial<
      Pick<
        Group,
        // Identity + info — the only fields the new community wizard
        // exposes. Removed (now per-Game): fieldName, fieldAddress,
        // street, addressNote, preferredDays, preferredHour,
        // recurringGameEnabled, recurringDayOfWeek, recurringTime,
        // recurringDefaultFormat, recurringNumberOfTeams,
        // defaultMaxPlayers, costPerGame, notes.
        | 'name'
        | 'description'
        | 'isOpen'
        | 'rules'
        | 'contactPhone'
        | 'city'
        | 'maxMembers'
        | 'coverPhotoUrl'
      >
    >,
  ): Promise<Group> {
    const guard = (g: Group): void => {
      if (!g.adminIds.includes(callerId)) {
        throw new Error('updateGroupMetadata: caller is not a coach');
      }
      // Refuse to lower maxMembers below the current member count.
      // We don't auto-kick anyone, and silently accepting would
      // produce confusing "29/25" displays + a permanently-blocked
      // join queue. The UI catches this with a toast.
      if (
        typeof patch.maxMembers === 'number' &&
        patch.maxMembers > 0 &&
        patch.maxMembers < (g.playerIds?.length ?? 0)
      ) {
        const err = new Error('GROUP_MAX_BELOW_CURRENT') as Error & {
          code: 'GROUP_MAX_BELOW_CURRENT';
          currentCount: number;
        };
        err.code = 'GROUP_MAX_BELOW_CURRENT';
        err.currentCount = g.playerIds?.length ?? 0;
        throw err;
      }
    };
    // Whitelist the fields we accept so a bad caller can't smuggle in
    // a `creatorId` override via this surface. The whitelist matches
    // the new responsibility split — community owns identity +
    // membership behaviour + general info; everything game-related
    // (field, schedule, recurring, format) was removed.
    const cleaned: Partial<Group> = {};
    if (patch.name !== undefined) {
      cleaned.name = patch.name;
      cleaned.normalizedName = normalize(patch.name);
    }
    for (const k of [
      'description',
      'isOpen',
      'rules',
      'contactPhone',
      'city',
      'maxMembers',
      'coverPhotoUrl',
    ] as const) {
      if (k in patch) (cleaned as Record<string, unknown>)[k] = patch[k];
    }

    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('updateGroupMetadata: group not found');
      guard(g);
      Object.assign(g, cleaned);
      g.updatedAt = Date.now();
      syncMockPublic(g);
      return g;
    }
    const g = await this.get(groupId);
    if (!g) throw new Error('updateGroupMetadata: group not found');
    guard(g);
    const { db } = getFirebase();
    const batch = writeBatch(db);
    // batch.update bypasses the typed converter — needed because our
    // groupConverter / groupPublic converter only implements the full-
    // object overload of toFirestore, so partial set+merge writes leak
    // `undefined` values that Firestore rejects.
    batch.update(
      docs.group(groupId),
      stripUndefined({
        ...cleaned,
        updatedAt: Date.now(),
      }),
    );
    // Public mirror — only the surviving fields. fieldName /
    // fieldAddress / preferredDays / preferredHour / costPerGame
    // are no longer mirrored on update; legacy values stay on the
    // doc but won't be refreshed through this surface.
    const publicPatch: Record<string, unknown> = {
      ...(cleaned.name !== undefined
        ? { name: cleaned.name, normalizedName: cleaned.normalizedName }
        : {}),
      ...(cleaned.city !== undefined ? { city: cleaned.city } : {}),
      ...(cleaned.description !== undefined ? { description: cleaned.description } : {}),
      ...(cleaned.maxMembers !== undefined ? { maxMembers: cleaned.maxMembers } : {}),
      ...(cleaned.isOpen !== undefined ? { isOpen: cleaned.isOpen } : {}),
      ...(cleaned.contactPhone !== undefined ? { contactPhone: cleaned.contactPhone } : {}),
      ...(cleaned.coverPhotoUrl !== undefined ? { coverPhotoUrl: cleaned.coverPhotoUrl } : {}),
      updatedAt: Date.now(),
    };
    // Only fire the public-projection update if there's something to
    // mirror — avoids a no-op write that updateDoc would reject.
    if (Object.keys(publicPatch).length > 1) {
      // The typed converter narrows batch.update to a strict GroupPublic
      // shape; we deliberately pass a flat field map and bypass typing
      // for the partial-update — runtime shape is correct.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (batch.update as any)(
        docs.groupPublic(groupId),
        stripUndefined(publicPatch),
      );
    }
    try {
      await batch.commit();
    } catch (err) {
      logError('updateGroupMetadata', err, {
        groupId,
        callerId,
        fields: Object.keys(cleaned),
      });
      if (__DEV__) {
        console.warn('[groupService] updateGroupMetadata failed', err);
      }
      throw err;
    }
    const fresh = await this.get(groupId);
    return fresh ?? g;
  },

  // ── Phase 8: coach promote / demote ───────────────────────────────────

  /**
   * Promote an existing community member to coach. Only the creator
   * may call this (enforced client-side here; mirrored in
   * firestore.rules for Firebase mode). Idempotent.
   */
  async promoteToCoach(
    groupId: GroupId,
    callerId: UserId,
    targetUserId: UserId,
  ): Promise<Group> {
    const guard = (g: Group): void => {
      const creator = g.creatorId ?? g.adminIds[0];
      if (creator !== callerId) {
        throw new Error('promoteToCoach: only the creator can promote');
      }
      if (!g.playerIds.includes(targetUserId) && !g.adminIds.includes(targetUserId)) {
        throw new Error('promoteToCoach: target is not a member');
      }
    };
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('promoteToCoach: group not found');
      guard(g);
      if (!g.adminIds.includes(targetUserId)) {
        g.adminIds = [...g.adminIds, targetUserId];
        g.updatedAt = Date.now();
      }
      return g;
    }
    const g = await this.get(groupId);
    if (!g) throw new Error('promoteToCoach: group not found');
    guard(g);
    if (g.adminIds.includes(targetUserId)) return g;
    try {
      await updateDoc(docs.group(groupId), {
        adminIds: arrayUnion(targetUserId),
        updatedAt: Date.now(),
      });
    } catch (err) {
      logError('promoteToCoach', err, { groupId, callerId, targetUserId });
      if (__DEV__) console.warn('[groupService] promoteToCoach failed', err);
      throw err;
    }
    const fresh = await this.get(groupId);
    return fresh ?? g;
  },

  /**
   * Demote a coach back to a regular member. Only the creator may
   * call this; the creator themselves cannot be demoted.
   */
  async demoteCoach(
    groupId: GroupId,
    callerId: UserId,
    targetUserId: UserId,
  ): Promise<Group> {
    const guard = (g: Group): void => {
      const creator = g.creatorId ?? g.adminIds[0];
      if (creator !== callerId) {
        throw new Error('demoteCoach: only the creator can demote');
      }
      if (creator === targetUserId) {
        throw new Error('demoteCoach: the creator cannot be demoted');
      }
    };
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('demoteCoach: group not found');
      guard(g);
      g.adminIds = g.adminIds.filter((id) => id !== targetUserId);
      g.updatedAt = Date.now();
      return g;
    }
    const g = await this.get(groupId);
    if (!g) throw new Error('demoteCoach: group not found');
    guard(g);
    try {
      await updateDoc(docs.group(groupId), {
        adminIds: arrayRemove(targetUserId),
        updatedAt: Date.now(),
      });
    } catch (err) {
      logError('demoteCoach', err, { groupId, callerId, targetUserId });
      if (__DEV__) console.warn('[groupService] demoteCoach failed', err);
      throw err;
    }
    const fresh = await this.get(groupId);
    return fresh ?? g;
  },

  /**
   * Leave a community.
   *
   * - Refuses if the user is the *only* admin (would orphan the group).
   * - Removes them from `playerIds` AND `adminIds` so a member-then-promoted
   *   admin can still leave by demoting themselves first via this same call.
   * - Mirrors the membership change to the public projection.
   */
  async leaveGroup(groupId: GroupId, userId: UserId): Promise<void> {
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('leaveGroup: group not found');
      const isLastAdmin =
        g.adminIds.includes(userId) && g.adminIds.length === 1;
      if (isLastAdmin) {
        throw new Error('LAST_ADMIN');
      }
      g.adminIds = g.adminIds.filter((id) => id !== userId);
      g.playerIds = g.playerIds.filter((id) => id !== userId);
      g.pendingPlayerIds = (g.pendingPlayerIds ?? []).filter(
        (id) => id !== userId,
      );
      g.updatedAt = Date.now();
      // Silent-failure guard: user must be gone from members.
      if (g.playerIds.includes(userId) || g.adminIds.includes(userId)) {
        logUnexpected('leaveGroupDidNotRemoveUser', { groupId, userId });
      }
      syncMockPublic(g);
      return;
    }
    const ref = docs.group(groupId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (e) {
      logError('leaveGroup', e, { groupId, userId, phase: 'preRead' });
      throw e;
    }
    if (!snap.exists()) throw new Error('leaveGroup: group not found');
    const g = snap.data();
    const isLastAdmin =
      g.adminIds.includes(userId) && g.adminIds.length === 1;
    if (isLastAdmin) {
      throw new Error('LAST_ADMIN');
    }
    // Single-doc write only. The /groupsPublic.memberCount mirror
    // used to be bumped here in a batch, but the hardened Storage /
    // /groupsPublic rules require admin to write the public doc —
    // which would deny a leaving NON-admin player. The
    // `onGroupPendingChanged` Cloud Function (Admin SDK) syncs the
    // public count when playerIds changes, so the client doesn't
    // need to (and shouldn't) write it.
    //
    // `pendingPlayerIds` is also cleared. Without it, a user who
    // ALSO had an in-flight pending join request (e.g. they tapped
    // "leave" while a previous re-join request was still pending)
    // would leave a stuck "pending" badge on the community card,
    // and the admin would see a request from someone who is no
    // longer interested.
    try {
      await updateDoc(ref, {
        adminIds: arrayRemove(userId),
        playerIds: arrayRemove(userId),
        pendingPlayerIds: arrayRemove(userId),
        updatedAt: Date.now(),
      });
    } catch (e) {
      logError('leaveGroup', e, { groupId, userId });
      throw e;
    }
    // Silent-failure guard: the arrayRemove write resolved, so the user
    // must be gone from both member arrays. Verify against the in-memory
    // next-state computed from the pre-write doc — no extra read.
    const nextAdminIds = g.adminIds.filter((id) => id !== userId);
    const nextPlayerIds = g.playerIds.filter((id) => id !== userId);
    if (nextPlayerIds.includes(userId) || nextAdminIds.includes(userId)) {
      logUnexpected('leaveGroupDidNotRemoveUser', { groupId, userId });
    }
    // Reject any still-pending audit-trail doc for this (user, group)
    // pair so a future re-join doesn't get blocked by the existing
    // "you already requested" check on the client. Best-effort —
    // failure here doesn't roll back the leave (the user IS out of
    // the group at this point); the dailyCleanup CF eventually
    // sweeps resolved requests by age anyway.
    try {
      const reqSnap = await getDocs(
        query(
          col.joinRequests(),
          where('groupId', '==', groupId),
          where('userId', '==', userId),
          where('status', '==', 'pending'),
        ),
      );
      for (const rd of reqSnap.docs) {
        try {
          await updateDoc(docs.joinRequest(rd.id), {
            status: 'rejected',
            decidedAt: Date.now(),
            decidedBy: userId,
          });
        } catch (err) {
          logError('leaveGroup', err, { groupId, phase: 'joinRequestSweep' });
          if (__DEV__)
            console.warn(
              '[groupService] leaveGroup: joinRequest reject failed',
              rd.id,
              err,
            );
        }
      }
    } catch (err) {
      logError('leaveGroup', err, { groupId, phase: 'joinRequestSweep' });
      if (__DEV__)
        console.warn(
          '[groupService] leaveGroup: pending joinRequests query failed',
          err,
        );
    }
  },

  /**
   * Admin removes another user from the community. Mirrors `leaveGroup`
   * but with an admin-check on the caller and a creator-protection on
   * the target. Closes TU-22.
   *
   * Rules:
   *   • Caller must be in adminIds of the group.
   *   • Target ≠ caller (use `leaveGroup` to remove yourself).
   *   • Target ≠ creator (the creator can't be kicked, even by another
   *     admin — they have to step down explicitly).
   *   • Removes target from adminIds, playerIds, and pendingPlayerIds in
   *     a single doc write. Public /groupsPublic mirror is synced by
   *     the `onGroupPendingChanged` CF, same as the leave path.
   *   • Best-effort: rejects any still-pending join request from this
   *     user so they don't see a phantom "pending" badge after the kick.
   */
  async removeMember(
    groupId: GroupId,
    callerId: UserId,
    targetUserId: UserId,
  ): Promise<void> {
    if (callerId === targetUserId) {
      throw new Error('removeMember: use leaveGroup to remove yourself');
    }
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('removeMember: group not found');
      if (!g.adminIds.includes(callerId)) {
        throw new Error('removeMember: caller is not an admin');
      }
      if (g.creatorId === targetUserId) {
        throw new Error('CANNOT_REMOVE_CREATOR');
      }
      g.adminIds = g.adminIds.filter((id) => id !== targetUserId);
      g.playerIds = g.playerIds.filter((id) => id !== targetUserId);
      g.pendingPlayerIds = (g.pendingPlayerIds ?? []).filter(
        (id) => id !== targetUserId,
      );
      g.updatedAt = Date.now();
      // Silent-failure guard: target must be gone from members.
      if (
        g.playerIds.includes(targetUserId) ||
        g.adminIds.includes(targetUserId)
      ) {
        logUnexpected('removeMemberDidNotApply', {
          groupId,
          userId: targetUserId,
        });
      }
      syncMockPublic(g);
      return;
    }
    const ref = docs.group(groupId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (e) {
      logError('removeMember', e, { groupId, targetUserId });
      throw e;
    }
    if (!snap.exists()) throw new Error('removeMember: group not found');
    const g = snap.data();
    if (!g.adminIds.includes(callerId)) {
      throw new Error('removeMember: caller is not an admin');
    }
    if (g.creatorId === targetUserId) {
      throw new Error('CANNOT_REMOVE_CREATOR');
    }
    try {
      await updateDoc(ref, {
        adminIds: arrayRemove(targetUserId),
        playerIds: arrayRemove(targetUserId),
        pendingPlayerIds: arrayRemove(targetUserId),
        updatedAt: Date.now(),
      });
    } catch (e) {
      logError('removeMember', e, { groupId, targetUserId });
      throw e;
    }
    // Silent-failure guard: the arrayRemove write resolved, so the target
    // must be gone from both member arrays. Verify against the in-memory
    // next-state computed from the pre-write doc — no extra read.
    const nextAdminIds = g.adminIds.filter((id) => id !== targetUserId);
    const nextPlayerIds = g.playerIds.filter((id) => id !== targetUserId);
    if (
      nextPlayerIds.includes(targetUserId) ||
      nextAdminIds.includes(targetUserId)
    ) {
      logUnexpected('removeMemberDidNotApply', {
        groupId,
        userId: targetUserId,
      });
    }
    // Sweep stale join requests so a future re-invite or re-request
    // isn't blocked by a stuck "pending" row.
    try {
      const reqSnap = await getDocs(
        query(
          col.joinRequests(),
          where('groupId', '==', groupId),
          where('userId', '==', targetUserId),
          where('status', '==', 'pending'),
        ),
      );
      for (const rd of reqSnap.docs) {
        try {
          await updateDoc(docs.joinRequest(rd.id), {
            status: 'rejected',
            decidedAt: Date.now(),
            decidedBy: callerId,
          });
        } catch (err) {
          logError('removeMember', err, { groupId, phase: 'joinRequestSweep' });
          if (__DEV__) {
            console.warn(
              '[groupService] removeMember: joinRequest reject failed',
              rd.id,
              err,
            );
          }
        }
      }
    } catch (err) {
      logError('removeMember', err, { groupId, phase: 'joinRequestSweep' });
      if (__DEV__) {
        console.warn('[groupService] removeMember: join-request sweep failed', err);
      }
    }
  },

  /**
   * Permanently delete a community. Caller must be a group admin —
   * Firestore rules enforce this. Cleans up cascading state in this
   * order:
   *   1. notify every player registered (players/waitlist/pending)
   *      to any non-terminal game in this group, then delete the
   *      game doc;
   *   2. mark every still-pending /groupJoinRequests for this group
   *      as `rejected` (their target community is gone);
   *   3. delete the canonical /groups doc;
   *   4. delete the /groupsPublic mirror.
   *
   * Steps 1–2 must run BEFORE step 3 — the firestore rules used to
   * authorize game-delete and join-request-update both depend on
   * `isGroupAdmin(groupId)`, which reads the still-existing /groups
   * doc. After step 3, that read fails and the cleanup writes would
   * be denied.
   */
  async deleteGroup(groupId: GroupId, callerId: UserId): Promise<void> {
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) return;
      if (!g.adminIds.includes(callerId)) {
        throw new Error('deleteGroup: caller is not an admin');
      }
      // Notify every member that the community is gone — distinct
      // from the per-game pushes below, since members not registered
      // to a current game wouldn't otherwise know.
      const memberRecipients = new Set<string>([
        ...(g.playerIds ?? []),
        ...(g.adminIds ?? []),
      ]);
      memberRecipients.delete(callerId);
      for (const uid of memberRecipients) {
        notificationsService.dispatch({
          type: 'groupDeleted',
          recipientId: uid,
          payload: { groupId, groupName: g.name },
        });
      }
      delete groupsById[groupId];
      const idx = mockPublicGroups.findIndex((p) => p.id === groupId);
      if (idx >= 0) mockPublicGroups.splice(idx, 1);
      return;
    }
    // 0) Read the canonical group doc to capture the member list +
    // name BEFORE we start cascading. After step 3 the doc is gone
    // and we can't fetch members anymore. Best-effort: if the read
    // fails (rules denial, etc.) we proceed without the per-member
    // groupDeleted push.
    let memberRecipients: string[] = [];
    let groupName = '';
    try {
      const gSnap = await getDoc(docs.group(groupId));
      if (gSnap.exists()) {
        const g = gSnap.data();
        groupName = g.name || '';
        const set = new Set<string>([
          ...(g.playerIds ?? []),
          ...(g.adminIds ?? []),
        ]);
        set.delete(callerId);
        memberRecipients = Array.from(set);
      }
    } catch (err) {
      logError('deleteGroup', err, { groupId, phase: 'preflight' });
      if (__DEV__)
        console.warn('[groupService] preflight read for member list failed', err);
    }
    // 1) Find all games in this community. We notify each affected
    // user (player / waitlist / pending) and then delete the game doc
    // outright. We don't filter by status — even a 'finished' game
    // doc is fair game to remove since the parent community is going
    // away and historical reads would 404 anyway.
    try {
      const gamesSnap = await getDocs(
        query(col.games(), where('groupId', '==', groupId)),
      );
      for (const gd of gamesSnap.docs) {
        const game = gd.data();
        // We deliberately DO NOT fan out a `gameCanceledOrUpdated`
        // push per game here. The single `groupDeleted` push at the
        // bottom of this function tells members the entire community
        // is gone — adding per-game cancel pushes on top would
        // produce N² spam (the CF interprets the type as a
        // fan-out marker and would push every participant once per
        // notification doc we created). One "community closed"
        // message per member is the right UX.
        try {
          await deleteDoc(docs.game(game.id));
        } catch (err) {
          logError('deleteGroup', err, { groupId, phase: 'gameCascade' });
          if (__DEV__)
            console.warn('[groupService] game cascade delete failed', game.id, err);
        }
      }
    } catch (err) {
      logError('deleteGroup', err, { groupId, phase: 'gameCascade' });
      if (__DEV__) console.warn('[groupService] game cascade lookup failed', err);
    }
    // 2) Reject all still-pending join requests so the requester's
    // "pending" badge clears (the audit trail itself stays).
    try {
      const reqSnap = await getDocs(
        query(
          col.joinRequests(),
          where('groupId', '==', groupId),
          where('status', '==', 'pending'),
        ),
      );
      for (const rd of reqSnap.docs) {
        try {
          await updateDoc(docs.joinRequest(rd.id), {
            status: 'rejected',
            decidedAt: Date.now(),
            decidedBy: callerId,
          });
        } catch (err) {
          logError('deleteGroup', err, { groupId, phase: 'joinRequestCleanup' });
          if (__DEV__)
            console.warn('[groupService] joinRequest reject failed', rd.id, err);
        }
      }
    } catch (err) {
      logError('deleteGroup', err, { groupId, phase: 'joinRequestCleanup' });
      if (__DEV__) console.warn('[groupService] joinRequest cleanup failed', err);
    }
    // 3) Canonical group doc — must precede the public mirror so the
    // mirror's "fall-through" delete rule fires.
    await deleteDoc(docs.group(groupId));
    // 4) Public projection. Retry once on transient failure — if the
    // public mirror lingers after delete, the discovery feed would
    // happily surface a community that no longer exists. The reads
    // would then 404 / permission-deny when the user taps in.
    let publicDeleted = false;
    for (let attempt = 0; attempt < 2 && !publicDeleted; attempt++) {
      try {
        await deleteDoc(docs.groupPublic(groupId));
        publicDeleted = true;
      } catch (err) {
        logError('deleteGroup', err, { groupId, phase: 'publicMirror' });
        if (__DEV__)
          console.warn(
            '[groupService] groupsPublic cleanup failed, attempt',
            attempt + 1,
            err,
          );
      }
    }
    if (!publicDeleted && __DEV__) {
      console.warn(
        '[groupService] groupsPublic still lingering for',
        groupId,
        '— discovery feed will filter at read time',
      );
    }
    // 5) Notify every former member that the community is gone.
    // Done last so the dispatch doesn't fire if the cascade itself
    // throws — if we get here, the canonical doc is reliably deleted
    // and the push reflects truth on the server.
    for (const uid of memberRecipients) {
      notificationsService.dispatch({
        type: 'groupDeleted',
        recipientId: uid,
        payload: { groupId, groupName },
      });
    }
  },

  async hydrateUsers(userIds: UserId[]): Promise<User[]> {
    if (USE_MOCK_DATA) {
      return userIds.map((id) => {
        const p = mockPlayers.find((x) => x.id === id);
        return {
          id,
          name: p?.displayName ?? id,
          photoUrl: p?.avatarUrl,
          createdAt: 0,
        };
      });
    }
    let fetched;
    try {
      fetched = await Promise.all(
        userIds.map(async (id) => {
          const snap = await getDoc(docs.user(id));
          return snap.exists() ? snap.data() : null;
        })
      );
    } catch (err) {
      logError('hydrateUsers', err, { userCount: userIds.length });
      if (__DEV__) console.warn('[groupService] hydrateUsers failed', err);
      throw err;
    }
    return fetched.filter((u): u is User => !!u);
  },
};

// ─── Internal helpers ─────────────────────────────────────────────────────

function toHit(g: Group): GroupSearchHit {
  // fieldName lingers on legacy docs; we still pass it through so the
  // search hit's "where they play" sub-line keeps working for groups
  // that pre-date the wizard split. New groups simply leave it
  // undefined and the consumer renders city / nothing instead.
  return {
    id: g.id,
    name: g.name,
    fieldName: g.fieldName,
    fieldAddress: g.fieldAddress,
    memberCount: g.playerIds.length,
  };
}

function toPublic(g: Group): GroupPublic {
  // The public projection now mirrors only the surviving community
  // fields. Legacy fieldName / fieldAddress / preferredDays etc.
  // remain on the canonical /groups doc for backward-compat reads
  // but are no longer surfaced to /groupsPublic. The
  // CommunityDetailsPublicScreen renders them conditionally — if a
  // legacy group still carries them, it renders; new groups don't.
  const out: GroupPublic = {
    id: g.id,
    name: g.name,
    normalizedName: g.normalizedName,
    description: g.description,
    memberCount: g.playerIds.length,
    isOpen: g.isOpen,
    maxMembers: g.maxMembers,
    contactPhone: g.contactPhone,
    city: g.city,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt ?? g.createdAt,
  };
  // Mirror the geo coords so the public feed's radius-based "nearby"
  // filter can do real distance math without an extra read of the
  // private /groups doc. Older groups without coords stay undefined
  // and the filter falls back to city-name match for them.
  if (typeof g.lat === 'number') out.lat = g.lat;
  if (typeof g.lng === 'number') out.lng = g.lng;
  // Mirror the admin-uploaded cover photo URL. The previous omission
  // meant every syncMockPublic re-build (and any production read that
  // round-trips through toPublic) silently wiped the cover, so the
  // feed card kept showing the bundled stadium fallback even after
  // the admin had set a real photo.
  if (typeof g.coverPhotoUrl === 'string' && g.coverPhotoUrl.length > 0) {
    out.coverPhotoUrl = g.coverPhotoUrl;
  }
  // Pass through legacy fields if present so re-publishing a
  // pre-refactor group via this helper doesn't blank them out.
  if (g.fieldName) out.fieldName = g.fieldName;
  if (g.fieldAddress) out.fieldAddress = g.fieldAddress;
  if (g.street) out.street = g.street;
  if (g.addressNote) out.addressNote = g.addressNote;
  return out;
}

function syncMockPublic(g: Group): void {
  const idx = mockPublicGroups.findIndex((p) => p.id === g.id);
  const next = toPublic(g);
  if (idx >= 0) mockPublicGroups[idx] = next;
  else mockPublicGroups.push(next);
}

function mockSubmitJoin(
  g: Group,
  userId: UserId
): { group: Group; status: 'pending' | 'joined' | 'already_member' } {
  if (g.playerIds.includes(userId) || g.adminIds.includes(userId)) {
    return { group: g, status: 'already_member' };
  }
  // Capacity gate: if the community has a maxMembers cap and is at or
  // above it, refuse the join — both for open groups (would auto-add)
  // and closed groups (would create a pending request that can never
  // be approved). The error is propagated as `GROUP_FULL` so the UI
  // can show a dedicated message.
  if (
    typeof g.maxMembers === 'number' &&
    g.maxMembers > 0 &&
    g.playerIds.length >= g.maxMembers
  ) {
    const err = new Error('GROUP_FULL') as Error & { code: 'GROUP_FULL' };
    err.code = 'GROUP_FULL';
    throw err;
  }
  if (g.isOpen) {
    g.playerIds = [...g.playerIds, userId];
    g.updatedAt = Date.now();
    syncMockPublic(g);
    return { group: g, status: 'joined' };
  }
  if (!g.pendingPlayerIds.includes(userId)) {
    g.pendingPlayerIds = [...g.pendingPlayerIds, userId];
    g.updatedAt = Date.now();
  }
  return { group: g, status: 'pending' };
}

async function submitJoin(
  g: Group,
  userId: UserId
): Promise<{ group: Group; status: 'pending' | 'joined' | 'already_member' }> {
  // Used by the code-based path, which started from a query on /groups by
  // inviteCode. The caller already has read access (the query succeeded
  // because they had access — or the invite-code lookup is admin-readable).
  if (g.playerIds.includes(userId) || g.adminIds.includes(userId)) {
    return { group: g, status: 'already_member' };
  }
  if (
    typeof g.maxMembers === 'number' &&
    g.maxMembers > 0 &&
    g.playerIds.length >= g.maxMembers
  ) {
    const err = new Error('GROUP_FULL') as Error & { code: 'GROUP_FULL' };
    err.code = 'GROUP_FULL';
    throw err;
  }
  await writeJoin(g.id, userId, !!g.isOpen);
  // Silent-failure guard: the write resolved, so the user should now be a
  // member (open group → playerIds) or pending (closed group →
  // pendingPlayerIds). Verify against the computed in-memory next-state
  // arrays only — no extra Firestore read.
  const nextPlayerIds = g.isOpen ? [...g.playerIds, userId] : g.playerIds;
  const nextPendingPlayerIds =
    !g.isOpen && !g.pendingPlayerIds.includes(userId)
      ? [...g.pendingPlayerIds, userId]
      : g.pendingPlayerIds;
  if (
    !nextPlayerIds.includes(userId) &&
    !g.adminIds.includes(userId) &&
    !nextPendingPlayerIds.includes(userId)
  ) {
    logUnexpected('joinGroupDidNotApply', {
      groupId: g.id,
      userId,
      viaCode: true,
    });
  }
  if (g.isOpen) {
    return {
      group: { ...g, playerIds: nextPlayerIds },
      status: 'joined',
    };
  }
  return {
    group: {
      ...g,
      pendingPlayerIds: nextPendingPlayerIds,
    },
    status: 'pending',
  };
}

/**
 * Used by the search/feed-based path. We only have the public projection,
 * so we can't tell client-side whether the user is already a member — we
 * rely on the caller's local membership cache (groupStore.groups) for that
 * UX hint, and let the security rule reject the write if the user IS
 * already a member.
 */
async function submitJoinByPublic(
  groupId: GroupId,
  userId: UserId
): Promise<{ group: Group; status: 'pending' | 'joined' }> {
  // Read the public projection so we can branch on `isOpen` without needing
  // read access to /groups (non-members can't read it).
  const pubSnap = await getDoc(docs.groupPublic(groupId));
  const isOpen = pubSnap.exists() ? !!pubSnap.data()?.isOpen : false;
  // Capacity gate based on the public projection — that's all a
  // non-member can see. memberCount is denormalised; if it lags a
  // newly-approved member, we'll let the canonical-side check on
  // approveMember catch it.
  if (pubSnap.exists()) {
    const pub = pubSnap.data();
    if (
      typeof pub.maxMembers === 'number' &&
      pub.maxMembers > 0 &&
      pub.memberCount >= pub.maxMembers
    ) {
      const err = new Error('GROUP_FULL') as Error & { code: 'GROUP_FULL' };
      err.code = 'GROUP_FULL';
      throw err;
    }
  }
  await writeJoin(groupId, userId, isOpen);
  // Silent-failure guard: post-write the user must be in members (open) or
  // pending (closed). Computed in-memory next-state — no extra read.
  const nextPlayerIds = isOpen ? [userId] : [];
  const nextPendingPlayerIds = isOpen ? [] : [userId];
  if (
    !nextPlayerIds.includes(userId) &&
    !nextPendingPlayerIds.includes(userId)
  ) {
    logUnexpected('joinGroupDidNotApply', {
      groupId,
      userId,
      viaCode: false,
    });
  }
  return {
    group: {
      id: groupId,
      // Empty stub — the screen relies on its own state; this object exists
      // to satisfy the return type. The store wraps any consumed value.
      name: '',
      normalizedName: '',
      fieldName: '',
      adminIds: [],
      playerIds: isOpen ? [userId] : [],
      pendingPlayerIds: isOpen ? [] : [userId],
      inviteCode: '',
      createdAt: 0,
    },
    status: isOpen ? 'joined' : 'pending',
  };
}

async function writeJoin(
  groupId: GroupId,
  userId: UserId,
  isOpen: boolean,
): Promise<void> {
  const { db } = getFirebase();
  const batch = writeBatch(db);
  if (isOpen) {
    // Open community: skip the join-request doc entirely and add the user
    // straight to playerIds. Mirrors the rule clause that allows a self-add
    // to playerIds when the group has isOpen=true.
    //
    // Note: we deliberately do NOT bump /groupsPublic.memberCount from the
    // client. The /groupsPublic update rule requires isGroupAdmin(gid),
    // and the joining user is not an admin. The public count can drift
    // by one until an admin write touches it; that's a cosmetic-only
    // staleness that's not worth a Cloud Function for now.
    batch.update(docs.group(groupId), {
      playerIds: arrayUnion(userId),
      updatedAt: Date.now(),
    });
  } else {
    const existing = await getDocs(
      query(
        col.joinRequests(),
        where('groupId', '==', groupId),
        where('userId', '==', userId),
        where('status', '==', 'pending'),
      ),
    );
    if (existing.empty) {
      const reqRef = doc(col.joinRequests());
      batch.set(reqRef, {
        id: reqRef.id,
        groupId,
        userId,
        status: 'pending',
        createdAt: Date.now(),
      } as GroupJoinRequestDoc);
    }
    batch.update(docs.group(groupId), {
      pendingPlayerIds: arrayUnion(userId),
      updatedAt: Date.now(),
    });
  }
  try {
    await batch.commit();
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (
      ![
        'GROUP_FULL',
        'GROUP_MAX_BELOW_CURRENT',
        'LAST_ADMIN',
        'resource-exhausted',
        'functions/resource-exhausted',
        'unauthenticated',
        'functions/unauthenticated',
      ].includes(code as string)
    ) {
      logError('joinGroup', e, { groupId, isOpen });
    }
    throw e;
  }
}

export function __resetGroupServiceForTests() {
  groupsById = {
    [mockGroup.id]: { ...mockGroup },
    [mockOtherGroup.id]: { ...mockOtherGroup },
  };
}

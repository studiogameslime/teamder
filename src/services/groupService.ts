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
import { achievementsService } from './achievementsService';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { col, docs, GroupJoinRequestDoc } from '@/firebase/firestore';
import { stripUndefined } from '@/utils/stripUndefined';

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
        (g) => g.adminIds.includes(userId) || g.playerIds.includes(userId)
      );
    }
    const q = query(col.groups(), where('playerIds', 'array-contains', userId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
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
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  },

  async get(groupId: GroupId): Promise<Group | null> {
    if (USE_MOCK_DATA) return groupsById[groupId] ?? null;
    const snap = await getDoc(docs.group(groupId));
    return snap.exists() ? snap.data() : null;
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
    const snap = await getDocs(q);
    return snap.docs.map((d) => toHit(d.data())).slice(0, 30);
  },

  async createGroup(input: {
    name: string;
    fieldName: string;
    fieldAddress?: string;
    city?: string;
    street?: string;
    addressNote?: string;
    description?: string;
    defaultMaxPlayers?: number;
    /** v2: total community size cap. */
    maxMembers?: number;
    /** v2: when true, joining is auto-approved. */
    isOpen?: boolean;
    /** v2: phone for WhatsApp contact button (Israeli format, validated by caller). */
    contactPhone?: string;
    /** Phase B: schedule + cost + extended notes. */
    preferredDays?: number[];
    preferredHour?: string;
    costPerGame?: number;
    notes?: string;
    creator: User;
  }): Promise<Group> {
    const now = Date.now();
    const baseGroup = {
      name: input.name,
      normalizedName: normalize(input.name),
      fieldName: input.fieldName,
      fieldAddress: input.fieldAddress,
      city: input.city,
      street: input.street,
      addressNote: input.addressNote,
      description: input.description,
      defaultMaxPlayers: input.defaultMaxPlayers ?? 15,
      maxMembers: input.maxMembers,
      isOpen: input.isOpen,
      contactPhone: input.contactPhone,
      preferredDays: input.preferredDays as Group['preferredDays'],
      preferredHour: input.preferredHour,
      costPerGame: input.costPerGame,
      notes: input.notes,
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
    // Firebase: dual-write private + public in a single batch.
    const privRef = doc(col.groups());
    const g: Group = { id: privRef.id, ...baseGroup };
    const { db } = getFirebase();
    const batch = writeBatch(db);
    batch.set(privRef, g);
    batch.set(docs.groupPublic(g.id), toPublic(g));
    await batch.commit();
    await storage.setCurrentGroupId(g.id);
    achievementsService.bump(input.creator.id, 'teamsCreated', 1);
    return g;
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
    const snap = await getDoc(docs.groupPublic(groupId));
    return snap.exists() ? snap.data() : null;
  },

  async listPublicGroups(): Promise<GroupPublic[]> {
    if (USE_MOCK_DATA) {
      return [...mockPublicGroups];
    }
    const snap = await getDocs(col.groupsPublic());
    return snap.docs.map((d) => d.data());
  },

  async searchPublicGroups(qstr: string): Promise<GroupPublic[]> {
    const norm = normalize(qstr);
    if (norm.length === 0) return this.listPublicGroups();
    // Mock mode: full-text-ish match across name / city / pitch.
    if (USE_MOCK_DATA) {
      return mockPublicGroups.filter(
        (g) =>
          g.normalizedName.includes(norm) ||
          (g.city ?? '').toLowerCase().includes(norm) ||
          (g.fieldName ?? '').toLowerCase().includes(norm)
      );
    }
    // Firestore: still uses the normalizedName prefix index. We then do a
    // local pass to broaden matches to city/pitch within the loaded slice.
    // A real cross-field search would need typesense/algolia.
    const q = query(
      col.groupsPublic(),
      where('normalizedName', '>=', norm),
      where('normalizedName', '<=', norm + '\uf8ff'),
      orderBy('normalizedName')
    );
    const nameSnap = await getDocs(q);
    const byName = nameSnap.docs.map((d) => d.data());
    if (byName.length >= 30) return byName.slice(0, 30);
    // Broaden with a local pass on the directory for city/pitch matches.
    const all = await this.listPublicGroups();
    const seen = new Set(byName.map((g) => g.id));
    const extras = all.filter(
      (g) =>
        !seen.has(g.id) &&
        ((g.city ?? '').toLowerCase().includes(norm) ||
          (g.fieldName ?? '').toLowerCase().includes(norm))
    );
    return byName.concat(extras).slice(0, 30);
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
    return submitJoin(snap.docs[0].data(), userId);
  },

  async requestJoinById(
    groupId: GroupId,
    userId: UserId
  ): Promise<{
    group: Group;
    status: 'pending' | 'joined' | 'already_member' | 'not_found';
  }> {
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
      g.pendingPlayerIds = g.pendingPlayerIds.filter((id) => id !== userId);
      if (!g.playerIds.includes(userId)) g.playerIds = [...g.playerIds, userId];
      g.updatedAt = Date.now();
      syncMockPublic(g);
      return g;
    }
    const reqs = await getDocs(
      query(
        col.joinRequests(),
        where('groupId', '==', groupId),
        where('userId', '==', userId),
        where('status', '==', 'pending')
      )
    );
    const { db, auth } = getFirebase();
    const batch = writeBatch(db);
    reqs.docs.forEach((r) =>
      batch.update(r.ref, {
        status: 'approved',
        decidedAt: Date.now(),
        decidedBy: auth.currentUser?.uid ?? null,
      })
    );
    // Move user from pending → approved on the canonical group doc.
    batch.update(docs.group(groupId), {
      playerIds: arrayUnion(userId),
      pendingPlayerIds: arrayRemove(userId),
      updatedAt: Date.now(),
    });
    await batch.commit();
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
      if (__DEV__) console.warn('[groupService] failed to sync public memberCount', err);
    }
    return g;
  },

  async rejectMember(groupId: GroupId, userId: UserId): Promise<Group> {
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) throw new Error('rejectMember: group not found');
      g.pendingPlayerIds = g.pendingPlayerIds.filter((id) => id !== userId);
      g.updatedAt = Date.now();
      return g;
    }
    const reqs = await getDocs(
      query(
        col.joinRequests(),
        where('groupId', '==', groupId),
        where('userId', '==', userId),
        where('status', '==', 'pending')
      )
    );
    const { db, auth } = getFirebase();
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
    const g = await this.get(groupId);
    if (!g) throw new Error('rejectMember: group disappeared');
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
        | 'name'
        | 'city'
        | 'street'
        | 'fieldName'
        | 'fieldAddress'
        | 'addressNote'
        | 'contactPhone'
        | 'description'
        | 'rules'
        | 'preferredDays'
        | 'preferredHour'
        | 'costPerGame'
        | 'maxMembers'
        | 'isOpen'
        | 'notes'
        | 'recurringGameEnabled'
        | 'recurringDayOfWeek'
        | 'recurringTime'
        | 'recurringDefaultFormat'
        | 'recurringNumberOfTeams'
      >
    >,
  ): Promise<Group> {
    const guard = (g: Group): void => {
      if (!g.adminIds.includes(callerId)) {
        throw new Error('updateGroupMetadata: caller is not a coach');
      }
    };
    // Whitelist the fields we accept so a bad caller can't smuggle in
    // a `creatorId` override via this surface.
    const cleaned: Partial<Group> = {};
    if (patch.name !== undefined) {
      cleaned.name = patch.name;
      cleaned.normalizedName = normalize(patch.name);
    }
    for (const k of [
      'city',
      'street',
      'fieldName',
      'fieldAddress',
      'addressNote',
      'contactPhone',
      'description',
      'rules',
      'preferredDays',
      'preferredHour',
      'costPerGame',
      'maxMembers',
      'isOpen',
      'notes',
      'recurringGameEnabled',
      'recurringDayOfWeek',
      'recurringTime',
      'recurringDefaultFormat',
      'recurringNumberOfTeams',
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
    const publicPatch: Record<string, unknown> = {
      ...(cleaned.name !== undefined
        ? { name: cleaned.name, normalizedName: cleaned.normalizedName }
        : {}),
      ...(cleaned.city !== undefined ? { city: cleaned.city } : {}),
      ...(cleaned.fieldName !== undefined ? { fieldName: cleaned.fieldName } : {}),
      ...(cleaned.fieldAddress !== undefined ? { fieldAddress: cleaned.fieldAddress } : {}),
      ...(cleaned.description !== undefined ? { description: cleaned.description } : {}),
      ...(cleaned.preferredDays !== undefined ? { preferredDays: cleaned.preferredDays } : {}),
      ...(cleaned.preferredHour !== undefined ? { preferredHour: cleaned.preferredHour } : {}),
      ...(cleaned.costPerGame !== undefined ? { costPerGame: cleaned.costPerGame } : {}),
      ...(cleaned.maxMembers !== undefined ? { maxMembers: cleaned.maxMembers } : {}),
      ...(cleaned.isOpen !== undefined ? { isOpen: cleaned.isOpen } : {}),
      ...(cleaned.contactPhone !== undefined ? { contactPhone: cleaned.contactPhone } : {}),
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
    await batch.commit();
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
    await updateDoc(docs.group(groupId), {
      adminIds: arrayUnion(targetUserId),
      updatedAt: Date.now(),
    });
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
    await updateDoc(docs.group(groupId), {
      adminIds: arrayRemove(targetUserId),
      updatedAt: Date.now(),
    });
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
      g.updatedAt = Date.now();
      syncMockPublic(g);
      return;
    }
    const ref = docs.group(groupId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('leaveGroup: group not found');
    const g = snap.data();
    const isLastAdmin =
      g.adminIds.includes(userId) && g.adminIds.length === 1;
    if (isLastAdmin) {
      throw new Error('LAST_ADMIN');
    }
    const { db } = getFirebase();
    const batch = writeBatch(db);
    batch.update(ref, {
      adminIds: arrayRemove(userId),
      playerIds: arrayRemove(userId),
      updatedAt: Date.now(),
    });
    // Public projection is denormalized — refresh memberCount lazily.
    const nextPlayerCount = Math.max(0, (g.playerIds?.length ?? 1) - 1);
    batch.update(docs.groupPublic(groupId), {
      memberCount: nextPlayerCount,
      updatedAt: Date.now(),
    });
    await batch.commit();
  },

  /**
   * Permanently delete a community. Caller must be a group admin —
   * Firestore rules enforce this. Deletes both the canonical /groups
   * doc and its /groupsPublic mirror. Games created under this group
   * become orphaned (rules will block reads since playerIds is gone),
   * which is acceptable for now; a sweep job can collect them later.
   */
  async deleteGroup(groupId: GroupId, callerId: UserId): Promise<void> {
    if (USE_MOCK_DATA) {
      const g = groupsById[groupId];
      if (!g) return;
      if (!g.adminIds.includes(callerId)) {
        throw new Error('deleteGroup: caller is not an admin');
      }
      delete groupsById[groupId];
      const idx = mockPublicGroups.findIndex((p) => p.id === groupId);
      if (idx >= 0) mockPublicGroups.splice(idx, 1);
      return;
    }
    // Two separate deletes — order matters: /groups first so the public
    // doc's "fall-through" delete rule fires (the rule allows deletion
    // when the canonical doc no longer exists). Doing them in a batch
    // would also work, but two sequential deletes keep error surfaces
    // separable if the second one fails for any reason.
    await deleteDoc(docs.group(groupId));
    try {
      await deleteDoc(docs.groupPublic(groupId));
    } catch (err) {
      if (__DEV__) console.warn('[groupService] groupsPublic cleanup failed', err);
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
    const fetched = await Promise.all(
      userIds.map(async (id) => {
        const snap = await getDoc(docs.user(id));
        return snap.exists() ? snap.data() : null;
      })
    );
    return fetched.filter((u): u is User => !!u);
  },
};

// ─── Internal helpers ─────────────────────────────────────────────────────

function toHit(g: Group): GroupSearchHit {
  return {
    id: g.id,
    name: g.name,
    fieldName: g.fieldName,
    fieldAddress: g.fieldAddress,
    memberCount: g.playerIds.length,
  };
}

function toPublic(g: Group): GroupPublic {
  return {
    id: g.id,
    name: g.name,
    normalizedName: g.normalizedName,
    fieldName: g.fieldName,
    fieldAddress: g.fieldAddress,
    city: g.city,
    street: g.street,
    addressNote: g.addressNote,
    description: g.description,
    memberCount: g.playerIds.length,
    isOpen: g.isOpen,
    maxMembers: g.maxMembers,
    contactPhone: g.contactPhone,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt ?? g.createdAt,
  };
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
  await writeJoin(g.id, userId, !!g.isOpen);
  if (g.isOpen) {
    return {
      group: { ...g, playerIds: [...g.playerIds, userId] },
      status: 'joined',
    };
  }
  return {
    group: {
      ...g,
      pendingPlayerIds: g.pendingPlayerIds.includes(userId)
        ? g.pendingPlayerIds
        : [...g.pendingPlayerIds, userId],
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
  await writeJoin(groupId, userId, isOpen);
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
  await batch.commit();
}

export function __resetGroupServiceForTests() {
  groupsById = {
    [mockGroup.id]: { ...mockGroup },
    [mockOtherGroup.id]: { ...mockOtherGroup },
  };
}

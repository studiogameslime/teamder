import { useMemo } from 'react';
import { create } from 'zustand';
import { Group, GroupId, SkillLevel, User, UserId } from '@/types';
import { groupService } from '@/services';
import { storage } from '@/services/storage';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { notificationsService } from '@/services/notificationsService';
import { achievementsService } from '@/services/achievementsService';
import { useUserStore } from '@/store/userStore';

type MembershipStatus =
  | 'none'      // user has no group at all
  | 'pending'   // request submitted, waiting for admin
  | 'member'    // approved member or admin
  | 'unknown';  // before hydrate completes

interface GroupStore {
  hydrated: boolean;
  currentGroupId: GroupId | null;
  groups: Group[];          // groups the user is a member of
  pendingGroups: Group[];   // groups the user has requested to join

  hydrate: (userId: UserId) => Promise<void>;

  // Membership state derived from currentGroupId + groups arrays
  getMembership: (userId: UserId) => MembershipStatus;
  getCurrentGroup: () => Group | null;
  isAdmin: (userId: UserId) => boolean;

  setCurrentGroup: (groupId: GroupId) => Promise<void>;

  // Operations
  createGroup: (input: {
    name: string;
    fieldName: string;
    fieldAddress?: string;
    city?: string;
    street?: string;
    addressNote?: string;
    description?: string;
    defaultMaxPlayers?: number;
    maxMembers?: number;
    isOpen?: boolean;
    contactPhone?: string;
    skillLevel?: SkillLevel;
    preferredDays?: number[];
    preferredHour?: string;
    costPerGame?: number;
    notes?: string;
    creator: User;
  }) => Promise<Group>;
  requestJoin: (
    code: string,
    userId: UserId
  ) => Promise<'pending' | 'already_member' | 'not_found'>;
  /** Search-based join (no invite code). */
  requestJoinById: (
    groupId: GroupId,
    userId: UserId
  ) => Promise<'pending' | 'already_member' | 'not_found'>;
  approve: (userId: UserId) => Promise<void>;
  reject: (userId: UserId) => Promise<void>;
  /**
   * Leave a community. Throws "LAST_ADMIN" if the user is the only
   * remaining admin — UI catches that to show a "transfer admin first"
   * message.
   */
  leaveGroup: (groupId: GroupId, userId: UserId) => Promise<void>;
}

export const useGroupStore = create<GroupStore>((set, get) => ({
  hydrated: false,
  currentGroupId: null,
  groups: [],
  pendingGroups: [],

  hydrate: async (userId) => {
    const [groups, pendingGroups, savedId] = await Promise.all([
      groupService.listForUser(userId),
      groupService.listPendingForUser(userId),
      storage.getCurrentGroupId(),
    ]);
    let currentGroupId = savedId;
    if (currentGroupId && !groups.find((g) => g.id === currentGroupId)) {
      currentGroupId = null;
      await storage.setCurrentGroupId(null);
    }
    if (!currentGroupId && groups.length > 0) {
      currentGroupId = groups[0].id;
      await storage.setCurrentGroupId(currentGroupId);
    }
    set({ hydrated: true, groups, pendingGroups, currentGroupId });
  },

  getMembership: (userId) => {
    const s = get();
    if (!s.hydrated) return 'unknown';
    const isMember = s.groups.some(
      (g) => g.adminIds.includes(userId) || g.playerIds.includes(userId)
    );
    if (isMember) return 'member';
    if (s.pendingGroups.length > 0) return 'pending';
    return 'none';
  },

  getCurrentGroup: () => {
    const s = get();
    return s.groups.find((g) => g.id === s.currentGroupId) ?? null;
  },

  isAdmin: (userId) => {
    const g = get().getCurrentGroup();
    return !!g && g.adminIds.includes(userId);
  },

  setCurrentGroup: async (groupId) => {
    await storage.setCurrentGroupId(groupId);
    set({ currentGroupId: groupId });
  },

  createGroup: async (input) => {
    const g = await groupService.createGroup(input);
    set((s) => ({
      groups: [...s.groups, g],
      currentGroupId: g.id,
    }));
    return g;
  },

  requestJoin: async (code, userId) => {
    const { group, status } = await groupService.requestJoinByCode(code, userId);
    if (status === 'pending') {
      set((s) => ({
        pendingGroups: s.pendingGroups.find((g) => g.id === group.id)
          ? s.pendingGroups
          : [...s.pendingGroups, group],
      }));
      // Notify each admin of the targeted group. We pull adminIds from
      // the freshly-returned group object — `submitJoinByPublic` returns
      // an empty stub, so this only fires for code-based joins (where
      // we read the private group successfully). Search-based joins go
      // through `requestJoinById` below, which has the same behaviour.
      group.adminIds.forEach((adminId) => {
        notificationsService.dispatch({
          type: 'joinRequest',
          recipientId: adminId,
          payload: {
            groupId: group.id,
            groupName: group.name,
            requesterId: userId,
          },
        });
      });
    }
    return status;
  },

  requestJoinById: async (groupId, userId) => {
    const { group, status } = await groupService.requestJoinById(groupId, userId);
    if (status === 'pending') {
      set((s) => ({
        pendingGroups: s.pendingGroups.find((g) => g.id === group.id)
          ? s.pendingGroups
          : [...s.pendingGroups, group],
      }));
      // Notify admins. For the public-projection path, group.adminIds
      // is empty (the non-member can't read it), so the dispatch happens
      // server-side via the join-request audit doc — left as a TODO for
      // the Cloud Function.
      group.adminIds.forEach((adminId) => {
        notificationsService.dispatch({
          type: 'joinRequest',
          recipientId: adminId,
          payload: {
            groupId: group.id,
            groupName: group.name,
            requesterId: userId,
          },
        });
      });
    }
    return status;
  },

  approve: async (userId) => {
    const g = get().getCurrentGroup();
    if (!g) return;
    const next = await groupService.approveMember(g.id, userId);
    set((s) => ({
      groups: s.groups.map((x) => (x.id === next.id ? { ...next } : x)),
    }));
    logEvent(AnalyticsEvent.GroupJoinApproved, { groupId: g.id, userId });
    notificationsService.dispatch({
      type: 'approved',
      recipientId: userId,
      payload: { groupId: g.id, groupName: g.name },
    });
    // Phase 3: the approved player gains "teamsJoined++"; the admin who
    // pressed approve gains "playersCoached++". Both are best-effort and
    // never block the approval flow.
    achievementsService.bump(userId, 'teamsJoined', 1);
    const me = useUserStore.getState().currentUser;
    if (me?.id) achievementsService.bump(me.id, 'playersCoached', 1);
  },

  reject: async (userId) => {
    const g = get().getCurrentGroup();
    if (!g) return;
    const next = await groupService.rejectMember(g.id, userId);
    set((s) => ({
      groups: s.groups.map((x) => (x.id === next.id ? { ...next } : x)),
    }));
    notificationsService.dispatch({
      type: 'rejected',
      recipientId: userId,
      payload: { groupId: g.id, groupName: g.name },
    });
  },

  leaveGroup: async (groupId, userId) => {
    await groupService.leaveGroup(groupId, userId);
    set((s) => {
      const groups = s.groups.filter((g) => g.id !== groupId);
      // If we just left the active group, switch to whatever's next, or
      // null if the user has no other communities.
      let currentGroupId = s.currentGroupId;
      if (s.currentGroupId === groupId) {
        currentGroupId = groups[0]?.id ?? null;
        storage.setCurrentGroupId(currentGroupId);
      }
      return { groups, currentGroupId };
    });
  },
}));

// ─── Selector hooks ──────────────────────────────────────────────────────
// Subscribe to atomic store fields and derive locally with useMemo so
// React re-renders only when the inputs actually change. This is more
// robust than `useGroupStore(s => s.getCurrentGroup())` which depends on
// `find()` returning a stable reference.

export function useCurrentGroup(): Group | null {
  const groups = useGroupStore((s) => s.groups);
  const currentGroupId = useGroupStore((s) => s.currentGroupId);
  return useMemo(
    () => groups.find((g) => g.id === currentGroupId) ?? null,
    [groups, currentGroupId]
  );
}

export function useIsAdmin(userId: UserId | undefined): boolean {
  const group = useCurrentGroup();
  if (!group || !userId) return false;
  return group.adminIds.includes(userId);
}

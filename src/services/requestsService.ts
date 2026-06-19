// requestsService — aggregates the three kinds of incoming ACTIONABLE requests
// into one "Requests" inbox: friend requests, community-join requests (for
// communities I admin), and game-join requests (for games I created). Powers
// the header bell badge + the unified Requests screen, plus bulk "approve all".
//
// Read-cost note: this reuses existing tight queries (my friend requests, my
// groups, my recent games) — no full-collection scans. The count path skips
// user-name resolution; only the full inbox resolves names for display.

import { friendsService, type FriendRequestWithUser } from './friendsService';
import { groupService } from './groupService';
import { gameService } from './gameService';
import { userService } from './userService';
import type { Game, Group, User, UserId } from '@/types';

export interface CommunityRequests {
  group: Group;
  pending: User[]; // resolved pending members (admin must approve)
}
export interface GameRequests {
  game: Game;
  pending: User[];
}
export interface InboxRequests {
  friends: FriendRequestWithUser[];
  communities: CommunityRequests[];
  games: GameRequests[];
  total: number;
}

/** Groups the user ADMINS that have at least one pending join request. */
async function myAdminGroupsWithPending(userId: UserId): Promise<Group[]> {
  const groups = await groupService.listForUser(userId).catch(() => [] as Group[]);
  return groups.filter(
    (g) => (g.adminIds ?? []).includes(userId) && (g.pendingPlayerIds ?? []).length > 0,
  );
}

/** Games the user CREATED that have at least one pending join request. */
async function myGamesWithPending(userId: UserId): Promise<Game[]> {
  const games = await gameService
    .getMyLiveOrUpcomingGames(userId)
    .catch(() => [] as Game[]);
  return games.filter(
    (g) => g.createdBy === userId && (g.pending ?? []).length > 0,
  );
}

// Resolve a set of uids to User objects, in parallel, dropping any that fail.
async function resolveUsers(uids: UserId[]): Promise<User[]> {
  const unique = [...new Set(uids)];
  const users = await Promise.all(
    unique.map((id) => userService.getUserById(id).catch(() => null)),
  );
  return users.filter((u): u is User => !!u);
}

/** Cheap count for the header badge — no user-name resolution. */
export async function getInboxCount(userId: UserId): Promise<number> {
  if (!userId) return 0;
  const [friends, groups, games] = await Promise.all([
    friendsService.listIncomingRequests(userId).catch(() => []),
    myAdminGroupsWithPending(userId),
    myGamesWithPending(userId),
  ]);
  const groupPending = groups.reduce((s, g) => s + (g.pendingPlayerIds?.length ?? 0), 0);
  const gamePending = games.reduce((s, g) => s + (g.pending?.length ?? 0), 0);
  return friends.length + groupPending + gamePending;
}

/** Full inbox with resolved names/avatars for the Requests screen. */
export async function getInboxRequests(userId: UserId): Promise<InboxRequests> {
  const empty: InboxRequests = { friends: [], communities: [], games: [], total: 0 };
  if (!userId) return empty;
  const [friends, groups, games] = await Promise.all([
    friendsService.listIncomingRequests(userId).catch(() => []),
    myAdminGroupsWithPending(userId),
    myGamesWithPending(userId),
  ]);
  const communities = await Promise.all(
    groups.map(async (group) => ({
      group,
      pending: await resolveUsers(group.pendingPlayerIds ?? []),
    })),
  );
  const gameReqs = await Promise.all(
    games.map(async (game) => ({
      game,
      pending: await resolveUsers(game.pending ?? []),
    })),
  );
  const total =
    friends.length +
    communities.reduce((s, c) => s + c.pending.length, 0) +
    gameReqs.reduce((s, g) => s + g.pending.length, 0);
  return { friends, communities, games: gameReqs, total };
}

export interface BulkResult {
  ok: number;
  failed: number;
  /** Human-readable reason for the first failure, if any (e.g. capacity). */
  firstError?: string;
}

async function runBulk(
  ids: UserId[],
  fn: (id: UserId) => Promise<unknown>,
): Promise<BulkResult> {
  let ok = 0;
  let failed = 0;
  let firstError: string | undefined;
  // Sequential — approving members/players mutates capacity, so we approve in
  // order and stop counting once the target fills (each fn enforces its own
  // capacity check and throws). allSettled-style: one failure never aborts.
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fn(id);
      ok += 1;
    } catch (err) {
      failed += 1;
      if (!firstError) firstError = (err as Error)?.message ?? String(err);
    }
  }
  return { ok, failed, firstError };
}

/** Approve ALL incoming friend requests. */
export function approveAllFriends(
  userId: UserId,
  requests: FriendRequestWithUser[],
): Promise<BulkResult> {
  return runBulk(
    requests.map((r) => r.request.fromUserId),
    (fromId) => friendsService.acceptRequest(fromId, userId),
  );
}

/** Approve ALL pending join requests for one community. */
export function approveAllForGroup(
  groupId: string,
  pendingUserIds: UserId[],
): Promise<BulkResult> {
  return runBulk(pendingUserIds, (uid) => groupService.approveMember(groupId, uid));
}

/** Approve ALL pending join requests for one game. */
export function approveAllForGame(
  gameId: string,
  pendingUserIds: UserId[],
): Promise<BulkResult> {
  return runBulk(pendingUserIds, (uid) => gameService.approveGameJoin(gameId, uid));
}

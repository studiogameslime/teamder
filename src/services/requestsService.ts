import { observeCaughtError } from '../utils/errorObservation';
// Aggregates actionable friend, club, round and outside-player requests
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
import { acceptsFillerApplications, actionableFillerIds, pendingFillerIds } from './fillerReview';
import type { Game, Group, User, UserId } from '@/types';

export interface CommunityRequests {
  group: Group;
  pending: User[]; // resolved pending members (admin must approve)
}
export interface GameRequests {
  game: Game;
  pending: User[];
  fillers?: User[];
}
export interface InboxRequests {
  friends: FriendRequestWithUser[];
  communities: CommunityRequests[];
  games: GameRequests[];
  total: number;
  partial?: boolean;
}

async function myAdminGroups(userId: UserId): Promise<Group[]> {
  const groups = await groupService.listForUser(userId, { includeAdminRatings: false });
  return groups.filter(g => (g.adminIds ?? []).includes(userId));
}

async function inboxSources(userId: UserId) {
  const [friends, adminGroups, mine] = await Promise.all([
    friendsService.listIncomingRequests(userId), myAdminGroups(userId), gameService.getMyLiveOrUpcomingGames(userId),
  ]);
  const clubs = new Set(adminGroups.map(g => g.id));
  const rounds = new Map(mine.filter(g => g.createdBy === userId).map(g => [g.id, g]));
  const failures: unknown[] = [];
  const upcoming = await Promise.all(adminGroups.map(async g => {
    try { return await gameService.getUpcomingGamesForGroup(g.id, true); }
    catch (error) {
      observeCaughtError(error, { source: 'src/services/requestsService.ts', handler: 'inboxSources', site: 'inbox:managed-rounds' });
      failures.push(error);
      return null;
    }
  }));
  for (const list of upcoming) {
    if (list) for (const game of list) rounds.set(game.id, game);
  }
  const games = await Promise.all([...rounds.values()].map(async game => {
    const pending = game.createdBy === userId ? game.pending ?? [] : [];
    let fillerIds: string[] = [];
    if (acceptsFillerApplications(game)) {
      try { fillerIds = actionableFillerIds(game, await pendingFillerIds(game.id, clubs.has(game.groupId))); }
      catch (error) {
        observeCaughtError(error, { source: 'src/services/requestsService.ts', handler: 'inboxSources', site: 'inbox:filler-interests' });
        failures.push(error);
      }
    }
    return { game, pending, fillerIds };
  }));
  return { friends, groups: adminGroups.filter(g => g.pendingPlayerIds?.length), games: games.filter(g => g.pending.length || g.fillerIds.length), failures };
}

// Resolve a set of uids to User objects, in parallel, dropping any that fail.
async function resolveUsers(uids: UserId[]): Promise<User[]> {
  const unique = [...new Set(uids)];
  const users = await Promise.all(
    unique.map((id) => userService.getUserById(id).catch((caughtError1045413675: unknown) => { observeCaughtError(caughtError1045413675, {"source":"src/services/requestsService.ts","handler":"resolveUsers","site":"requestsService:1045413675"}); return null; })),
  );
  return users.map((u, index) => u ?? ({ id: unique[index], name: 'משתמש', stats: {} } as User));
}

/** Cheap count for the header badge — no user-name resolution. */
export async function getInboxCount(userId: UserId): Promise<number> {
  if (!userId) return 0;
  const { friends, groups, games, failures } = await inboxSources(userId);
  if (failures.length) throw failures[0];
  const groupPending = groups.reduce((s, g) => s + (g.pendingPlayerIds?.length ?? 0), 0);
  const gamePending = games.reduce((s, g) => s + g.pending.length + g.fillerIds.length, 0);
  return friends.length + groupPending + gamePending;
}

/** Full inbox with resolved names/avatars for the Requests screen. */
export async function getInboxRequests(userId: UserId): Promise<InboxRequests> {
  const empty: InboxRequests = { friends: [], communities: [], games: [], total: 0 };
  if (!userId) return empty;
  const { friends, groups, games, failures } = await inboxSources(userId);
  const communities = await Promise.all(
    groups.map(async (group) => ({
      group,
      pending: await resolveUsers(group.pendingPlayerIds ?? []),
    })),
  );
  const gameReqs = await Promise.all(
    games.map(async ({ game, pending, fillerIds }) => {
      const [members, fillers] = await Promise.all([resolveUsers(pending), resolveUsers(fillerIds)]);
      return { game, pending: members, fillers };
    }),
  );
  const total =
    friends.length +
    communities.reduce((s, c) => s + c.pending.length, 0) +
    gameReqs.reduce((s, g) => s + g.pending.length + g.fillers.length, 0);
  return { friends, communities, games: gameReqs, total, partial: failures.length > 0 };
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
    observeCaughtError(err, {"source":"src/services/requestsService.ts","handler":"runBulk","site":"requestsService:0b215667fb"});
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

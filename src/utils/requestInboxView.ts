import type { InboxRequests } from '@/services/requestsService';
import type { User } from '@/types';
export type InboxRow = {
  key: string;
  kind: 'friend' | 'club' | 'game' | 'filler';
  user: User | null;
  userId: string;
  groupId?: string;
  targetId: string;
  context: string;
  createdAt?: number;
};

/** Club scope includes its rounds, but excludes personal friendship requests.
 * Pending arrays append arrivals, so reverse copies put the newest first.
 * No cross-club timestamps are inferred from account or membership dates. */
export function requestInboxRows(data: InboxRequests, groupId?: string, byName = false): InboxRow[] {
  const rows: InboxRow[] = [];
  if (!groupId) for (const {
    request,
    user
  } of [...data.friends].sort((a, b) => b.request.createdAt - a.request.createdAt)) rows.push({
    key: `friend:${request.id}`,
    kind: 'friend',
    user,
    userId: request.fromUserId,
    targetId: 'friends',
    context: 'בקשת חברות',
    createdAt: request.createdAt
  });
  for (const {
    group,
    pending
  } of data.communities) {
    if (groupId && group.id !== groupId) continue;
    for (const user of [...pending].reverse()) rows.push({
      key: `club:${group.id}:${user.id}`,
      kind: 'club',
      user,
      userId: user.id,
      groupId: group.id,
      targetId: group.id,
      context: group.name
    });
  }
  for (const {
    game,
    pending, fillers
  } of data.games) {
    if (groupId && game.groupId !== groupId) continue;
    for (const user of [...pending].reverse()) rows.push({
      key: `game:${game.id}:${user.id}`,
      kind: 'game',
      user,
      userId: user.id,
      groupId: game.groupId,
      targetId: game.id,
      context: `מחזור · ${game.title || 'כדורגל'}`
    });
    for (const user of fillers ?? []) rows.push({
      key: `filler:${game.id}:${user.id}`, kind: 'filler', user, userId: user.id, groupId: game.groupId,
      targetId: game.id, context: `השלמת שחקן למחזור: ${game.title || 'כדורגל'}`
    });
  }
  return byName ? rows.sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? '', 'he')) : rows;
}
